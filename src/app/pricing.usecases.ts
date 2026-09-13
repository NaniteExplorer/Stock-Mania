/**
 * Pricing use cases: getting history in, keeping it current, and recording the rate
 * a user says they got.
 *
 * The interesting one is {@link BackfillInstrumentHistory}. Without it, every
 * return figure silently starts at signup: a user who has held a fund since 2019
 * would see an XIRR computed from the day they installed the app, which is not a
 * smaller answer but a *wrong* one. Paisa fetches all history on every refresh and
 * so cannot afford to do this often; here the backfill is a one-time job on add,
 * resumable from what is already stored.
 */

import { AppError, Clock, Err, Ok, Result, UseCase, UserId } from "@/core/kernel";
import { CalendarDate, DateRange } from "@/core/time";
import { Quantity, UnitPrice } from "@/core/numeric";
import { Bar, BarRepository, makeBar } from "@/domain/analysis";
import {
  FxBook,
  InstrumentRef,
  PriceBook,
  QuoteRepository,
  QuoteType,
  RefreshReport,
} from "@/domain/pricing";
import type {
  HistoricalSeries,
  HistoryRequest,
  MarketCode,
  MarketDataResult,
} from "@/market-data/ports";

/* ═══ BackfillInstrumentHistory ════════════════════════════════════════ */

export interface BackfillInstrumentHistoryInput {
  readonly instrument: InstrumentRef;
  readonly quoteType?: QuoteType;
  /**
   * How far back to go. Defaults to twenty years, which is longer than any provider
   * here serves — the providers' own `maxHistoryYears` is what actually bounds it,
   * and asking for more than a provider has is not an error.
   */
  readonly years?: number;
  /** Forces a full re-fetch instead of resuming from what is stored. */
  readonly force?: boolean;
}

export interface BackfillInstrumentHistoryOutput {
  readonly range: DateRange | null;
  readonly persisted: number;
  readonly report: RefreshReport | null;
  /** Set when nothing was fetched because the coverage was already complete. */
  readonly skippedReason: string | null;
}

/**
 * Fetches an instrument's full available history when it is first added.
 *
 * **Resumable, and that is the point.** The stored coverage decides the range to
 * ask for, so re-adding an instrument, retrying a failed job, or adding a second
 * holding of something already tracked costs one small request rather than twenty
 * years of rows — and a provider that rate-limits is a provider you can only afford
 * to ask once.
 *
 * A gap in the middle is not filled by this: coverage is the outer bounds, and the
 * ladder carries a price forward across a hole anyway. Filling interior gaps needs
 * a gap scan, which belongs with the scheduler rather than with "add an instrument".
 */
export class BackfillInstrumentHistory
  implements UseCase<BackfillInstrumentHistoryInput, BackfillInstrumentHistoryOutput>
{
  constructor(
    private readonly prices: PriceBook,
    private readonly quotes: QuoteRepository,
    private readonly clock: Clock,
  ) {}

  async execute(
    input: BackfillInstrumentHistoryInput,
  ): Promise<Result<BackfillInstrumentHistoryOutput, AppError>> {
    const quoteType = input.quoteType ?? defaultQuoteTypeFor(input.instrument);
    const today = CalendarDate.parse(this.clock.today());
    const earliest = today.plusYears(-(input.years ?? 20));

    const covered = input.force
      ? null
      : await this.quotes.coverage(input.instrument.instrumentId, quoteType);

    // Already covered from before the requested start through today: nothing to do,
    // and saying so is more useful than an empty success.
    if (covered && covered.from.isOnOrBefore(earliest) && covered.through.isOnOrAfter(today)) {
      return Ok({
        range: null,
        persisted: 0,
        report: null,
        skippedReason:
          `Already have ${input.instrument.symbol} from ${covered.from.toISO()} to ` +
          `${covered.through.toISO()}.`,
      });
    }

    // Resume from the day after what is stored, not from the start of time.
    const from = covered && covered.through.isAfter(earliest) ? covered.through.plusDays(1) : earliest;
    if (from.isAfter(today)) {
      return Ok({
        range: null,
        persisted: 0,
        report: null,
        skippedReason: `${input.instrument.symbol} is current through ${covered?.through.toISO()}.`,
      });
    }

    const range = DateRange.of(from, today);
    const report = await this.prices.refresh({
      instruments: [input.instrument],
      range,
      quoteType,
    });

    // A backfill where every provider failed is a failure, not an empty success: the
    // caller has to know the instrument is unpriced, or it will render a blank chart
    // as though the history did not exist.
    if (report.persisted === 0 && report.attempts.every((attempt) => attempt.outcome !== "OK")) {
      const detail = report.attempts
        .map((attempt) => `${attempt.providerId}: ${attempt.outcome}${attempt.error ? ` (${attempt.error})` : ""}`)
        .join("; ");
      return Err(new BackfillFailedError(input.instrument.symbol, detail));
    }

    return Ok({ range, persisted: report.persisted, report, skippedReason: null });
  }
}

export class BackfillFailedError extends AppError {
  readonly code = "PRICING_BACKFILL_FAILED";

  constructor(symbol: string, detail: string) {
    super(`No provider could supply history for ${symbol}. ${detail}`, {
      userMessage:
        `We could not fetch price history for ${symbol}. You can still record its value ` +
        `yourself, and we will keep trying in the background.`,
    });
  }
}

/**
 * Which price an instrument's class actually has.
 *
 * A mutual fund has a NAV and an equity has a close, and they are not
 * interchangeable — asking a fund for a CLOSE gets nothing, which would look like a
 * dead provider rather than the wrong question.
 */
export function defaultQuoteTypeFor(instrument: InstrumentRef): QuoteType {
  return instrument.assetClass === "MUTUAL_FUND" ? "NAV" : "CLOSE";
}

/* ═══ RefreshPrices ════════════════════════════════════════════════════ */

export interface RefreshPricesInput {
  readonly instruments: readonly InstrumentRef[];
  /** Defaults to the last five days, which covers a long weekend plus a holiday. */
  readonly range?: DateRange;
  readonly quoteType?: QuoteType;
}

export interface RefreshPricesOutput {
  readonly reports: readonly RefreshReport[];
  readonly persisted: number;
  readonly warnings: readonly string[];
}

/**
 * The scheduled refresh.
 *
 * Grouped by quote type rather than run per instrument, because a provider's rate
 * limit is per provider: one request for forty funds is one token, and forty
 * requests is forty. Instruments that need different quote types are still separate
 * calls, since a NAV and a close come from different endpoints.
 */
export class RefreshPrices implements UseCase<RefreshPricesInput, RefreshPricesOutput> {
  constructor(
    private readonly prices: PriceBook,
    private readonly clock: Clock,
  ) {}

  async execute(input: RefreshPricesInput): Promise<Result<RefreshPricesOutput, AppError>> {
    const today = CalendarDate.parse(this.clock.today());
    const range = input.range ?? DateRange.of(today.plusDays(-5), today);

    const byQuoteType = new Map<QuoteType, InstrumentRef[]>();
    for (const instrument of input.instruments) {
      const quoteType = input.quoteType ?? defaultQuoteTypeFor(instrument);
      const bucket = byQuoteType.get(quoteType);
      if (bucket) bucket.push(instrument);
      else byQuoteType.set(quoteType, [instrument]);
    }

    const reports: RefreshReport[] = [];
    for (const [quoteType, instruments] of byQuoteType) {
      reports.push(await this.prices.refresh({ instruments, range, quoteType }));
    }

    return Ok({
      reports,
      persisted: reports.reduce((total, report) => total + report.persisted, 0),
      // Surfaced rather than logged: a divergence nobody sees is a divergence
      // nobody acts on.
      warnings: reports.flatMap((report) => report.warnings),
    });
  }
}

/* ═══ AssertFxRate ═════════════════════════════════════════════════════ */

export interface AssertFxRateInput {
  readonly userId: UserId;
  readonly base: string;
  readonly quote: string;
  readonly asOf: CalendarDate;
  /** Units of `quote` per one unit of `base` — 84.40 for USD→INR. */
  readonly rate: Quantity;
}

/**
 * Records the exchange rate the user actually got.
 *
 * It does not replace the provider's rate; it is stored beside it and wins when
 * both exist for the same day. The user's bank rate is what their return is
 * assessed on, and a report that used the ECB's published reference instead would
 * be defensibly wrong and practically useless.
 */
export class AssertFxRate implements UseCase<AssertFxRateInput, { asOf: string }> {
  constructor(private readonly fx: FxBook) {}

  async execute(input: AssertFxRateInput): Promise<Result<{ asOf: string }, AppError>> {
    if (!input.rate.isPositive) {
      return Err(new InvalidFxRateError(input.rate.toDecimalString()));
    }
    if (input.base === input.quote) {
      return Err(new InvalidFxRateError(`${input.base} to itself`));
    }

    await this.fx.assertUserRate({
      userId: input.userId,
      base: input.base,
      quote: input.quote,
      asOf: input.asOf,
      rate: input.rate,
    });

    return Ok({ asOf: input.asOf.toISO() });
  }
}

export class InvalidFxRateError extends AppError {
  readonly code = "PRICING_FX_RATE_INVALID";

  constructor(detail: string) {
    super(`Not a usable exchange rate: ${detail}.`, {
      userMessage: "Enter the rate as units of the second currency per unit of the first, e.g. 84.40.",
    });
  }
}

/* ═══ Bar ingestion and reconciliation ═════════════════════════════════ */

/**
 * The narrowest view of the market-data engine a use case needs.
 *
 * Deliberately not `HistoricalSeriesPort`: that carries `info` and `health()`,
 * which are the registry's business, and a use case that could read a source's
 * circuit-breaker state would sooner or later branch on it. What is handed in is
 * the already-chosen chain, collapsed to one call.
 */
export interface DailyHistoryFeed {
  history(request: HistoryRequest): Promise<MarketDataResult<HistoricalSeries>>;
}

/** A corporate action the **owner logged**. The only kind that may change a number. */
export interface LedgerCorporateAction {
  readonly onDate: CalendarDate;
  readonly kind: "SPLIT" | "BONUS" | "DIVIDEND" | "DEMERGER" | "OTHER";
}

export interface IngestInstrumentBarsInput {
  readonly instrument: InstrumentRef;
  /** The exact key the history adapter accepted. Never an uppercased user symbol. */
  readonly quoteKey: string;
  readonly market: MarketCode;
  /** Defaults to twenty years back, which outruns every free source here. */
  readonly years?: number;
  /** Ignores stored coverage and refetches the whole window. */
  readonly force?: boolean;
  /**
   * True when a newly logged split has invalidated the stored series (C5).
   *
   * The fetched bars then **supersede** what is stored rather than being appended
   * beside it, because the vendor has restated every prior day and the two
   * beliefs are contradictory rather than complementary.
   */
  readonly restate?: boolean;
  /** What the owner has logged, for the reconciliation pass. Never an input to a price. */
  readonly ledgerActions?: readonly LedgerCorporateAction[];
}

export interface IngestInstrumentBarsOutput {
  readonly range: DateRange | null;
  readonly appended: number;
  readonly superseded: number;
  readonly sourceId: string | null;
  readonly adjusted: boolean | null;
  /** Reconciliation findings. A warning surface only — nothing here mutates a ledger. */
  readonly alarms: readonly PriceAlarm[];
  readonly skippedReason: string | null;
}

/**
 * Daily bars into `price_bars`, resumably, from the market-data engine.
 *
 * Separate from {@link BackfillInstrumentHistory} rather than folded into it, and
 * that is not duplication: the two write different tables for different purposes.
 * `BackfillInstrumentHistory` fills `price_quotes`, the one number a holding is
 * *valued* at, through the price ladder. This fills `price_bars`, the OHLC series
 * a chart is *drawn* from, through the market-data engine's history chain. They
 * resume from their own coverage and neither can stand in for the other.
 *
 * **C4 is structural here.** The range is always an explicit start and end, built
 * from stored coverage; there is no code path that could ask for a "max" range,
 * which silently degrades to monthly data (AAPL: 169 rows instead of 11 529).
 *
 * **C14: payload, not request count, is the cost.** A full history is ~850 KB, so
 * a second call for an instrument already covered fetches the delta — a few rows
 * — rather than the twenty years again.
 */
export class IngestInstrumentBars
  implements UseCase<IngestInstrumentBarsInput, IngestInstrumentBarsOutput>
{
  constructor(
    private readonly feed: DailyHistoryFeed,
    private readonly bars: BarRepository,
    private readonly clock: Clock,
  ) {}

  async execute(
    input: IngestInstrumentBarsInput,
  ): Promise<Result<IngestInstrumentBarsOutput, AppError>> {
    const today = CalendarDate.parse(this.clock.today());
    const earliest = today.plusYears(-(input.years ?? 20));
    const instrumentId = input.instrument.instrumentId;

    const covered =
      input.force || input.restate ? null : await this.bars.coverage(instrumentId, "DAY");

    if (covered && covered.from.isOnOrBefore(earliest) && covered.through.isOnOrAfter(today)) {
      return Ok({
        range: null,
        appended: 0,
        superseded: 0,
        sourceId: null,
        adjusted: null,
        alarms: [],
        skippedReason:
          `Bars for ${input.quoteKey} already run ${covered.from.toISO()} to ` +
          `${covered.through.toISO()}.`,
      });
    }

    /*
     * Resume from the day after the last stored bar. Re-fetching that day would
     * be harmless — the bitemporal key dedupes an identical re-fetch — but it is
     * also pointless, and on a delta run it is the difference between one row and
     * two.
     */
    const from = covered && covered.through.isAfter(earliest) ? covered.through.plusDays(1) : earliest;
    if (from.isAfter(today)) {
      return Ok({
        range: null,
        appended: 0,
        superseded: 0,
        sourceId: null,
        adjusted: null,
        alarms: [],
        skippedReason: `${input.quoteKey} is current through ${covered?.through.toISO()}.`,
      });
    }

    const range = DateRange.of(from, today);
    const result = await this.feed.history({
      quoteKey: input.quoteKey,
      currency: input.instrument.currency,
      market: input.market,
      range,
      adjusted: true,
    });

    if (!result.ok) return Err(new BarIngestFailedError(input.quoteKey, result.error.message));

    const series = result.value;
    if (series.currency.code !== input.instrument.currency.code) {
      /*
       * A currency mismatch is the wrong instrument, not a bad price: RELIANCE
       * resolving to a London line would store GBP closes against an INR holding,
       * and every number downstream would be quietly eighty times off.
       */
      return Err(
        new BarIngestFailedError(
          input.quoteKey,
          `The source returned ${series.currency.code} for an ` +
            `${input.instrument.currency.code} instrument.`,
        ),
      );
    }

    const ingestedAt = this.clock.now();
    const bars = series.bars.map((bar) =>
      makeBar({
        instrumentId,
        asOf: bar.asOf,
        granularity: "DAY" as const,
        // Both sides are 1e8-scaled integers, so this is a relabelling rather
        // than a conversion — no float touches the price path (C8).
        open: UnitPrice.fromScaled(bar.openScaled, series.currency),
        high: UnitPrice.fromScaled(bar.highScaled, series.currency),
        low: UnitPrice.fromScaled(bar.lowScaled, series.currency),
        close: UnitPrice.fromScaled(bar.closeScaled, series.currency),
        volume: bar.volume,
        currency: series.currency,
        providerId: series.sourceId,
        ingestedAt,
      }),
    );

    let appended = 0;
    let superseded = 0;
    if (bars.length > 0) {
      if (input.restate) {
        const outcome = await this.bars.restate(bars);
        appended = outcome.appended;
        superseded = outcome.superseded;
      } else {
        await this.bars.append(bars);
        appended = bars.length;
      }
    }

    return Ok({
      range,
      appended,
      superseded,
      sourceId: series.sourceId,
      adjusted: series.adjusted,
      alarms: detectPriceAlarms({
        quoteKey: input.quoteKey,
        bars,
        ledgerActions: input.ledgerActions ?? [],
        providerActions: [],
      }),
      skippedReason: null,
    });
  }
}

export class BarIngestFailedError extends AppError {
  readonly code = "PRICING_BAR_INGEST_FAILED";

  constructor(quoteKey: string, detail: string) {
    super(`No source could supply daily bars for ${quoteKey}. ${detail}`, {
      userMessage:
        `We could not fetch the price chart for ${quoteKey}. Your holding and its valuation ` +
        `are unaffected, and we will keep trying in the background.`,
    });
  }
}

/* ── The unexplained-move alarm (C7) ───────────────────────────────── */

export type PriceAlarmKind = "UNEXPLAINED_MOVE" | "UNLOGGED_SPLIT";

/**
 * Something the owner should look at. **Never** something the system acts on.
 *
 * C2 is absolute: market data is prices and FX. The owner logs every split,
 * bonus, dividend and demerger himself, so a provider-observed action is evidence
 * that his register may be incomplete — it is not an instruction to change it. An
 * alarm therefore carries a date, a description and nothing executable.
 */
export interface PriceAlarm {
  readonly kind: PriceAlarmKind;
  readonly quoteKey: string;
  readonly onDate: CalendarDate;
  readonly message: string;
}

/** Single-day moves beyond this are reported. 25% per C7. */
export const UNEXPLAINED_MOVE_THRESHOLD_PERCENT = 25n;

export interface PriceAlarmInput {
  readonly quoteKey: string;
  /** Ascending by date. Consecutive stored bars, so a hole is not read as a crash. */
  readonly bars: readonly Bar[];
  readonly ledgerActions: readonly LedgerCorporateAction[];
  /** What a provider's split/dividend feed reported, for reconciliation only. */
  readonly providerActions: readonly { onDate: CalendarDate; kind: "SPLIT" | "DIVIDEND" }[];
  readonly thresholdPercent?: bigint;
}

/**
 * Two findings, both warnings.
 *
 * 1. **An unexplained move.** A single-day close-to-close move beyond 25% with no
 *    action logged on either day and no provider event. The measured cases this is
 *    written for: `TMPV.NS` at -40.2% on the Tata Motors demerger with no event
 *    flag at all, RELIANCE's corrupt +337% print on 2005-07-28, and NIFTYBEES
 *    arriving divided by ten. Every one of them passes schema validation, so the
 *    only thing that catches them is arithmetic on the series.
 * 2. **A split the ledger does not have.** The provider saw one and the owner has
 *    not logged it, which means his position is about to be valued in the wrong
 *    share terms.
 *
 * Integer arithmetic throughout: the comparison is
 * `|close - previous| x 100 > threshold x previous` on 1e8-scaled bigints, so
 * there is no percentage to round and no float anywhere near the price path (C8).
 */
export function detectPriceAlarms(input: PriceAlarmInput): readonly PriceAlarm[] {
  const threshold = input.thresholdPercent ?? UNEXPLAINED_MOVE_THRESHOLD_PERCENT;
  const alarms: PriceAlarm[] = [];

  const loggedOn = new Set(input.ledgerActions.map((action) => action.onDate.toISO()));
  const providerOn = new Set(input.providerActions.map((action) => action.onDate.toISO()));
  const loggedSplitOn = new Set(
    input.ledgerActions
      .filter((action) => action.kind === "SPLIT" || action.kind === "BONUS")
      .map((action) => action.onDate.toISO()),
  );

  const ordered = [...input.bars].sort((a, b) => a.asOf.compareTo(b.asOf));
  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1];
    const current = ordered[index];
    const before = previous.close.scaled;
    if (before <= 0n) continue;

    const delta = current.close.scaled - before;
    const magnitude = delta < 0n ? -delta : delta;
    if (magnitude * 100n <= threshold * before) continue;

    const day = current.asOf.toISO();
    /*
     * The action's own date and the day before both count as an explanation: an
     * ex-date is sometimes logged against the record date, and a one-day window
     * is cheaper than a false alarm every time the owner is a day out.
     */
    if (loggedOn.has(day) || loggedOn.has(previous.asOf.toISO())) continue;
    if (providerOn.has(day) || providerOn.has(previous.asOf.toISO())) continue;

    const direction = delta < 0n ? "fell" : "rose";
    alarms.push({
      kind: "UNEXPLAINED_MOVE",
      quoteKey: input.quoteKey,
      onDate: current.asOf,
      message:
        `${input.quoteKey} ${direction} from ${previous.close.toDecimalString()} to ` +
        `${current.close.toDecimalString()} on ${day} — more than ${threshold}% in one day, ` +
        `with no corporate action logged and none reported by the source. That is either a ` +
        `demerger or a corrupt print; check it before trusting the chart.`,
    });
  }

  for (const action of input.providerActions) {
    if (action.kind !== "SPLIT") continue;
    if (loggedSplitOn.has(action.onDate.toISO())) continue;
    alarms.push({
      kind: "UNLOGGED_SPLIT",
      quoteKey: input.quoteKey,
      onDate: action.onDate,
      message:
        `The price source reports a split in ${input.quoteKey} on ${action.onDate.toISO()} that ` +
        `is not in your register. Nothing has been changed — log it yourself if it is real, or ` +
        `the position will be valued in the wrong share terms.`,
    });
  }

  return alarms;
}

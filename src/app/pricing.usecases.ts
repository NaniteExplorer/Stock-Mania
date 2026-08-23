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
import { Quantity } from "@/core/numeric";
import {
  FxBook,
  InstrumentRef,
  PriceBook,
  QuoteRepository,
  QuoteType,
  RefreshReport,
} from "@/domain/pricing";

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

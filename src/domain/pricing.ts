/**
 * Pricing: what a holding is worth, where that number came from, and how sure we
 * are of it.
 *
 * The principles this file exists to enforce are `40-MARKET-DATA.md` §1, and two of
 * them shape every signature here:
 *
 *   - **Missing is not zero.** {@link PriceBook.priceOn} returns a resolution whose
 *     price may be `null` *with a reason*, never a zero. A zero valuation is a
 *     number a user will act on; a null is a question the UI must answer honestly.
 *   - **Never trust one vendor silently.** Two providers that disagree both persist,
 *     the golden record is chosen by declared priority, and a disagreement above 1%
 *     is recorded. Silent selection is how bad upstream data becomes invisible.
 *
 * Prices are **bitemporal**: `asOf` is the day the price refers to, `ingestedAt` is
 * the day we learned it. A vendor correction inserts a new row and points the old
 * one at it, so "what did we believe this was worth on 31 March, using the data we
 * had then" stays answerable — which is what makes a tax report reproducible and a
 * backtest honest.
 *
 * The provider *interfaces* live here, with the aggregate they serve; the retry,
 * rate-limit and circuit-breaker machinery that implements them lives in
 * `infra/providers.ts`. That split is deliberate: the domain says what a provider
 * must answer, and knows nothing about HTTP.
 */

import { AppError, Clock, DomainError, Err, Ok, Result, UserId } from "@/core/kernel";
import { Currency, Money, divideRounded } from "@/core/money";
import { Percentage, Quantity, UnitPrice } from "@/core/numeric";
import { CalendarDate, DateRange } from "@/core/time";

/**
 * `Quantity`s scale, restated here as the FX rate scale.
 *
 * An FX rate is a ratio of units, not an amount of money, so it is held as a
 * `Quantity`: 84.00 INR per USD is exact, and a float rate applied to a lakh is
 * how a conversion drifts. Naming the constant makes the conversion arithmetic
 * below readable rather than a wall of zeros.
 */
const FX_RATE_SCALE = 100_000_000n;

/* ═══ Vocabulary ══════════════════════════════════════════════════════ */

/** `20-DOMAIN-MODEL.md` §2.6. A NAV and a close are not interchangeable. */
export type QuoteType =
  | "CLOSE"
  | "ADJUSTED_CLOSE"
  | "NAV"
  | "BID"
  | "ASK"
  | "MID"
  | "LAST"
  | "SETTLEMENT"
  | "MARK";

export type PriceSourceType = "PROVIDER" | "MANUAL" | "DERIVED" | "BROKER" | "CARRIED_FORWARD";

/**
 * The asset classes pricing distinguishes — a subset of §2.2's 23, because what
 * matters *here* is only what changes the answer: how a price is identified, and
 * how fast it goes stale.
 */
export type PricedAssetClass =
  | "EQUITY"
  | "ETF"
  | "MUTUAL_FUND"
  | "BOND"
  | "COMMODITY"
  | "CRYPTO"
  | "FX"
  /**
   * Options and futures. Its own class because it goes stale in a day and
   * because an expired contract has no price at all — carrying one forward
   * would value a position that has ceased to exist.
   */
  | "DERIVATIVE"
  | "OTHER";

export type IdentifierType = "ISIN" | "FIGI" | "TICKER" | "SCHEME_CODE" | "MIC_TICKER" | "METAL" | "COIN";

/**
 * How we name an instrument to a provider.
 *
 * `providerRefs` is what keeps `40-MARKET-DATA.md` §1's second principle true: the
 * instrument master is ours, and a provider's identifier is a *mapping* held beside
 * the instrument, never its identity. Paisa binds an instrument to one provider's
 * code, so swapping providers invalidates the user's data.
 */
export interface InstrumentRef {
  readonly instrumentId: string;
  readonly symbol: string;
  readonly assetClass: PricedAssetClass;
  readonly currency: Currency;
  readonly identifierType: IdentifierType;
  readonly exchange?: string | null;
  /** Provider id → that provider's code for this instrument. */
  readonly providerRefs?: Readonly<Record<string, string>>;
}

/** One price, from one provider, for one day. */
export interface Quote {
  readonly instrumentId: string;
  readonly asOf: CalendarDate;
  readonly quoteType: QuoteType;
  /**
   * A `UnitPrice`, not `Money`: AMFI publishes NAV to four decimals, and holding
   * that as rupees-and-paise rounds ₹84.5612 to ₹84.56 at ingestion, where nothing
   * can see it. Rounding happens once, at `price.times(quantity)`.
   */
  readonly price: UnitPrice;
  readonly providerId: string;
  readonly sourceType: PriceSourceType;
  /** When we learned it — the second time axis. */
  readonly ingestedAt: Date;
  /** Set when a later row corrects this one. */
  readonly supersededBy?: string | null;
}

/**
 * How long a price stays usable, per asset class.
 *
 * Four days for anything exchange-traded, which is a Friday close read on the
 * following Tuesday after a Monday holiday — the common case, not an edge case.
 * Crypto gets one day because it never closes, so a day-old crypto price means a
 * failed fetch rather than a weekend. `OTHER` is generous because it covers assets
 * valued by assertion, where the last number the user gave is the best there is.
 */
export const STALENESS_DAYS: Readonly<Record<PricedAssetClass, number>> = {
  EQUITY: 4,
  ETF: 4,
  MUTUAL_FUND: 4,
  BOND: 7,
  COMMODITY: 4,
  CRYPTO: 1,
  FX: 4,
  DERIVATIVE: 1,
  OTHER: 30,
};

/* ═══ Provider errors ═════════════════════════════════════════════════ */

export type ProviderErrorKind =
  | "UNKNOWN_SYMBOL"
  | "RATE_LIMITED"
  | "TIMEOUT"
  | "CIRCUIT_OPEN"
  | "UPSTREAM"
  | "MALFORMED_RESPONSE"
  | "UNSUPPORTED";

/**
 * A provider failure, as a value.
 *
 * Returned in a `Result`, never thrown: an unknown symbol and a rate limit are
 * both ordinary outcomes of asking a third party for data, and code that has to
 * catch to find that out ends up catching too much. `retryable` is on the error
 * rather than inferred by the caller, because whether a 429 is worth retrying is
 * the provider layer's knowledge.
 */
export class ProviderError extends AppError {
  readonly code: string;

  constructor(
    readonly kind: ProviderErrorKind,
    readonly providerId: string,
    message: string,
    readonly retryable: boolean = false,
    options?: { cause?: unknown },
  ) {
    super(message, {
      ...options,
      // The user is told a source is unavailable, not which HTTP status it gave.
      userMessage: `${providerId} could not provide that price right now — showing the last known value.`,
    });
    this.code = `PROVIDER_${kind}`;
  }

  static unknownSymbol(providerId: string, symbol: string): ProviderError {
    return new ProviderError(
      "UNKNOWN_SYMBOL",
      providerId,
      `${providerId} does not know the symbol "${symbol}".`,
    );
  }

  static circuitOpen(providerId: string, until: Date): ProviderError {
    return new ProviderError(
      "CIRCUIT_OPEN",
      providerId,
      `${providerId} is failing; not calling it again until ${until.toISOString()}.`,
      true,
    );
  }
}

/* ═══ Provider ports ══════════════════════════════════════════════════ */

export interface ProviderCapabilities {
  readonly assetClasses: readonly PricedAssetClass[];
  readonly supportsIntraday: boolean;
  readonly supportsHistorical: boolean;
  readonly supportsCorporateActions: boolean;
  readonly supportsInstrumentSearch: boolean;
  readonly identifierTypes: readonly IdentifierType[];
  readonly maxHistoryYears: number;
  /** 0 for realtime, 15 for a delayed feed. */
  readonly quoteDelayMinutes: number;
  readonly quoteTypes: readonly QuoteType[];
}

/** Requests per window, and how many may burst. A token bucket, described. */
export interface RateLimitBudget {
  readonly requests: number;
  readonly perMillis: number;
  readonly burst: number;
}

export type HealthState = "HEALTHY" | "DEGRADED" | "UNAVAILABLE";

export interface HealthStatus {
  readonly state: HealthState;
  readonly consecutiveFailures: number;
  readonly lastError: string | null;
  /** When a tripped circuit will next allow a probe. */
  readonly circuitOpenUntil: Date | null;
}

export interface QuoteRequest {
  readonly instruments: readonly InstrumentRef[];
  readonly range: DateRange;
  readonly quoteType: QuoteType;
}

/**
 * What the pricing engine needs from anything that can produce a price.
 *
 * Extends Paisa's `PriceProvider`, which is the right shape and lacks the four
 * things failover needs: declared capabilities, a health signal, a rate-limit
 * budget, and an *incremental* range fetch. Paisa's `GetPrices` returns all history
 * on every call, which is why its refresh cannot be cheap.
 */
export interface QuoteProviderPort {
  readonly id: string;
  readonly displayName: string;
  capabilities(): ProviderCapabilities;
  health(): HealthStatus;
  rateLimit(): RateLimitBudget;
  fetchQuotes(request: QuoteRequest): Promise<Result<readonly Quote[], ProviderError>>;
}

export interface FxQuote {
  readonly base: string;
  readonly quote: string;
  readonly asOf: CalendarDate;
  /** Units of `quote` per one unit of `base`. */
  readonly rate: Quantity;
  readonly providerId: string;
  readonly sourceType: PriceSourceType;
  readonly ingestedAt: Date;
  /** How a DERIVED rate was produced, e.g. `(EUR/INR)/(EUR/USD)`. */
  readonly derivation?: string | null;
}

export interface FxProviderPort {
  readonly id: string;
  readonly displayName: string;
  capabilities(): ProviderCapabilities;
  health(): HealthStatus;
  rateLimit(): RateLimitBudget;
  fetchRates(request: {
    base: string;
    quotes: readonly string[];
    range: DateRange;
  }): Promise<Result<readonly FxQuote[], ProviderError>>;
}

/* ═══ Repository ports ════════════════════════════════════════════════ */

export interface QuoteRepository {
  /**
   * Appends quotes. Never updates: a correction is a new row, and pointing the old
   * row at it is {@link supersede}'s job.
   */
  append(quotes: readonly Quote[]): Promise<void>;

  /** Marks a quote corrected by a later one, keeping both. */
  supersede(supersededQuoteId: string, bySupersedingQuoteId: string): Promise<void>;

  /**
   * The ladder query: the newest current belief for this instrument on or before
   * `asOf`, newest `asOf` first, then newest `ingestedAt` first.
   */
  findLatestOnOrBefore(
    instrumentId: string,
    quoteType: QuoteType,
    asOf: CalendarDate,
    limit?: number,
  ): Promise<readonly Quote[]>;

  /** Everything current in a range, for a chart or a backfill gap check. */
  findRange(
    instrumentId: string,
    quoteType: QuoteType,
    range: DateRange,
  ): Promise<readonly Quote[]>;

  /** What we already have, so a backfill resumes rather than restarting. */
  coverage(
    instrumentId: string,
    quoteType: QuoteType,
  ): Promise<{ from: CalendarDate; through: CalendarDate } | null>;

  recordDivergence(divergence: PriceDivergence): Promise<void>;
}

export interface PriceDivergence {
  readonly instrumentId: string;
  readonly asOf: CalendarDate;
  readonly quoteType: QuoteType;
  readonly providerA: string;
  readonly providerB: string;
  readonly priceA: UnitPrice;
  readonly priceB: UnitPrice;
  readonly deltaPercent: Percentage;
}

export interface FxRateRepository {
  append(rates: readonly FxQuote[]): Promise<void>;

  /**
   * The rate for a pair on or before a date, newest first. A user-asserted rate is
   * returned alongside the provider's, not instead of it — which is what lets the
   * report say "your rate, not the vendor's".
   */
  findLatestOnOrBefore(
    base: string,
    quote: string,
    asOf: CalendarDate,
    userId?: UserId,
    limit?: number,
  ): Promise<readonly StoredFxRate[]>;

  /** Records the rate a user asserts for tax. Appended, like everything else. */
  setUserRate(rate: FxQuote & { userId: UserId }): Promise<void>;
}

export interface StoredFxRate extends FxQuote {
  readonly userId: string | null;
  /** Present when a user asserted a rate for this pair and date. */
  readonly userRate: Quantity | null;
}

/* ═══ Quote validation — invariants Q01–Q06 ═══════════════════════════ */

export type QuoteRejectionReason =
  | "Q01_NOT_POSITIVE"
  | "Q02_INGESTED_BEFORE_AS_OF"
  | "Q04_CURRENCY_MISMATCH";

export interface QuoteValidation {
  readonly accepted: readonly Quote[];
  readonly rejected: readonly { quote: Quote; reason: QuoteRejectionReason; detail: string }[];
  readonly warnings: readonly string[];
}

/**
 * `30-CALCULATIONS.md` §8's Q invariants, applied at the boundary where a provider's
 * number becomes our number.
 *
 * BLOCK invariants (Q01, Q02, Q04) reject the row; WARN invariants (Q03, Q06)
 * accept it and say so. That difference is the point: a 60% one-day move is
 * sometimes real, and a rule that dropped it would silently lose a crash.
 */
export class QuoteValidator {
  /** Q03: a day-over-day move beyond this is flagged for review. */
  static readonly SUSPICIOUS_MOVE = Percentage.of(50);

  validate(
    quotes: readonly Quote[],
    ref: InstrumentRef,
    previous?: Quote | null,
  ): QuoteValidation {
    const accepted: Quote[] = [];
    const rejected: { quote: Quote; reason: QuoteRejectionReason; detail: string }[] = [];
    const warnings: string[] = [];

    // Ascending, so the Q03 comparison walks a real series rather than whatever
    // order the provider happened to return.
    const ordered = [...quotes].sort((a, b) => a.asOf.compareTo(b.asOf));
    let prior = previous ?? null;

    for (const quote of ordered) {
      // Q01. Options and futures are the documented exception, and neither exists yet.
      if (!quote.price.isPositive) {
        rejected.push({
          quote,
          reason: "Q01_NOT_POSITIVE",
          detail: `${quote.providerId} returned ${quote.price.toDecimalString()} for ${ref.symbol} on ${quote.asOf.toISO()}.`,
        });
        continue;
      }

      // Q02. We cannot know a price before its date; a row claiming otherwise means
      // a clock or a parser is wrong, and a wrong ingestion time destroys the
      // bitemporal answer the column exists to give.
      if (CalendarDate.fromUtcInstant(quote.ingestedAt).isBefore(quote.asOf)) {
        rejected.push({
          quote,
          reason: "Q02_INGESTED_BEFORE_AS_OF",
          detail: `Ingested ${quote.ingestedAt.toISOString()} for a price dated ${quote.asOf.toISO()}.`,
        });
        continue;
      }

      // Q04.
      if (quote.price.currency.code !== ref.currency.code) {
        rejected.push({
          quote,
          reason: "Q04_CURRENCY_MISMATCH",
          detail: `${ref.symbol} is priced in ${ref.currency.code}, but ${quote.providerId} returned ${quote.price.currency.code}.`,
        });
        continue;
      }

      // Q03 — a WARN. The row is kept.
      if (prior && prior.price.isPositive) {
        const move = quote.price.percentDifferenceFrom(prior.price);
        if (move.compareTo(QuoteValidator.SUSPICIOUS_MOVE) > 0) {
          warnings.push(
            `${ref.symbol} moved ${move.toFixed(1)}% between ${prior.asOf.toISO()} and ` +
              `${quote.asOf.toISO()} (${prior.price.toDecimalString()} → ${quote.price.toDecimalString()}). ` +
              `Kept, and flagged for review — a real crash looks like this too (Q03).`,
          );
        }
      }

      accepted.push(quote);
      prior = quote;
    }

    return { accepted, rejected, warnings };
  }
}

/* ═══ Price resolution — the four-rung ladder ═════════════════════════ */

export type PriceRung =
  /** Rung 1: a quote for exactly that date. */
  | "EXACT"
  /** Rung 2: the most recent earlier quote, carried forward, with its age. */
  | "CARRIED_FORWARD"
  /** Rung 3: carried forward past the class threshold — usable, but marked. */
  | "STALE"
  /** Rung 4: nothing within reach. `price` is null, and is never zero. */
  | "UNAVAILABLE";

export interface PriceResolution {
  readonly instrumentId: string;
  readonly requestedOn: CalendarDate;
  readonly rung: PriceRung;
  /** `null` on the fourth rung. Never zero — `40-MARKET-DATA.md` §1.4. */
  readonly price: UnitPrice | null;
  /** The date the returned price actually refers to. */
  readonly pricedOn: CalendarDate | null;
  readonly providerId: string | null;
  readonly sourceType: PriceSourceType | null;
  /** Days between `pricedOn` and `requestedOn`. */
  readonly ageDays: number;
  readonly isStale: boolean;
  /** Plain-language explanation, for the UI to show instead of a number. */
  readonly reason: string | null;
}

/* ═══ PriceBook ═══════════════════════════════════════════════════════ */

export interface RefreshReport {
  readonly requested: number;
  readonly persisted: number;
  readonly rejected: readonly { quote: Quote; reason: QuoteRejectionReason; detail: string }[];
  readonly divergences: readonly PriceDivergence[];
  readonly warnings: readonly string[];
  /** Providers tried, and what each returned. Failover is visible, not silent. */
  readonly attempts: readonly {
    providerId: string;
    outcome: "OK" | "SKIPPED_UNHEALTHY" | "SKIPPED_UNSUPPORTED" | "FAILED";
    quotes: number;
    error: string | null;
  }[];
}

/**
 * Every price the app trusts comes through here.
 *
 * It holds providers **in priority order** and asks all healthy, capable ones —
 * not just the first. Asking one and stopping would make the 1% cross-check
 * impossible, and the cross-check is the only thing standing between a vendor's
 * bad tick and a user's net worth.
 *
 * Persistence is append-only, so every provider's answer survives even when only
 * the highest-priority one is used for valuation. The golden record is a *choice
 * among stored rows*, not the only row stored, which is what makes it reviewable
 * after the fact.
 */
export class PriceBook {
  private readonly validator = new QuoteValidator();

  constructor(
    /** In priority order: the first that is healthy and capable is the golden source. */
    private readonly providers: readonly QuoteProviderPort[],
    private readonly quotes: QuoteRepository,
    private readonly divergenceThreshold: Percentage = Percentage.of(1),
  ) {}

  /** The provider order, for a UI that wants to show which source won. */
  priorityOf(providerId: string): number {
    const index = this.providers.findIndex((provider) => provider.id === providerId);
    return index < 0 ? Number.MAX_SAFE_INTEGER : index;
  }

  /**
   * Fetches, validates, cross-checks and persists.
   *
   * Failover is not a fallback path bolted on: an unhealthy or incapable provider
   * is skipped and *reported as skipped*, so an outage shows up as a named absence
   * rather than as prices that quietly stopped updating.
   */
  async refresh(request: QuoteRequest): Promise<RefreshReport> {
    const attempts: RefreshReport["attempts"][number][] = [];
    const byProvider = new Map<string, readonly Quote[]>();

    for (const provider of this.providers) {
      const capabilities = provider.capabilities();
      const supported = request.instruments.filter((ref) =>
        capabilities.assetClasses.includes(ref.assetClass) &&
        capabilities.quoteTypes.includes(request.quoteType),
      );
      if (supported.length === 0) {
        attempts.push({ providerId: provider.id, outcome: "SKIPPED_UNSUPPORTED", quotes: 0, error: null });
        continue;
      }
      if (provider.health().state === "UNAVAILABLE") {
        attempts.push({
          providerId: provider.id,
          outcome: "SKIPPED_UNHEALTHY",
          quotes: 0,
          error: provider.health().lastError,
        });
        continue;
      }

      const result = await provider.fetchQuotes({ ...request, instruments: supported });
      if (!result.ok) {
        attempts.push({ providerId: provider.id, outcome: "FAILED", quotes: 0, error: result.error.message });
        continue;
      }
      attempts.push({ providerId: provider.id, outcome: "OK", quotes: result.value.length, error: null });
      byProvider.set(provider.id, result.value);
    }

    const rejected: RefreshReport["rejected"][number][] = [];
    const warnings: string[] = [];
    const toPersist: Quote[] = [];

    for (const ref of request.instruments) {
      for (const [providerId, quotes] of byProvider) {
        const mine = quotes.filter((quote) => quote.instrumentId === ref.instrumentId);
        if (mine.length === 0) continue;
        const previous = (await this.quotes.findLatestOnOrBefore(
          ref.instrumentId, request.quoteType, request.range.start, 1,
        ))[0] ?? null;
        const validation = this.validator.validate(mine, ref, previous);
        rejected.push(...validation.rejected);
        warnings.push(...validation.warnings);
        toPersist.push(...validation.accepted);
        void providerId;
      }
    }

    const divergences = this.findDivergences(toPersist);

    if (toPersist.length > 0) await this.quotes.append(toPersist);
    for (const divergence of divergences) await this.quotes.recordDivergence(divergence);

    return {
      requested: request.instruments.length,
      persisted: toPersist.length,
      rejected,
      divergences,
      warnings: [
        ...warnings,
        ...divergences.map(
          (d) =>
            `${d.providerA} and ${d.providerB} disagree by ${d.deltaPercent.toFixed(2)}% on ` +
            `${d.instrumentId} for ${d.asOf.toISO()} (${d.priceA.toDecimalString()} vs ` +
            `${d.priceB.toDecimalString()}). Both kept; the higher-priority provider is used.`,
        ),
      ],
      attempts,
    };
  }

  /**
   * Compares every provider pair on the same `(instrument, as_of, quote_type)`.
   *
   * Pairwise rather than "each against the golden record", because a third provider
   * agreeing with neither of the first two is exactly the case worth seeing, and
   * comparing only against the winner hides it.
   */
  private findDivergences(quotes: readonly Quote[]): PriceDivergence[] {
    const groups = new Map<string, Quote[]>();
    for (const quote of quotes) {
      const key = `${quote.instrumentId}|${quote.asOf.toISO()}|${quote.quoteType}`;
      const bucket = groups.get(key);
      if (bucket) bucket.push(quote);
      else groups.set(key, [quote]);
    }

    const found: PriceDivergence[] = [];
    for (const group of groups.values()) {
      for (let i = 0; i < group.length; i += 1) {
        for (let j = i + 1; j < group.length; j += 1) {
          const [a, b] = [group[i], group[j]];
          if (a.providerId === b.providerId) continue;
          if (a.price.currency.code !== b.price.currency.code) continue;
          if (!a.price.isPositive) continue;
          const delta = b.price.percentDifferenceFrom(a.price);
          if (delta.compareTo(this.divergenceThreshold) > 0) {
            found.push({
              instrumentId: a.instrumentId,
              asOf: a.asOf,
              quoteType: a.quoteType,
              providerA: a.providerId,
              providerB: b.providerId,
              priceA: a.price,
              priceB: b.price,
              deltaPercent: delta,
            });
          }
        }
      }
    }
    return found;
  }

  /**
   * The four-rung ladder: exact date → carry forward with an age → stale past the
   * class threshold → `null` with a reason.
   *
   * Among rows for the same date, the highest-priority provider wins and the newest
   * `ingestedAt` breaks the tie — the newest belief, from the best source we have.
   */
  async priceOn(ref: InstrumentRef, asOf: CalendarDate, quoteType: QuoteType = "CLOSE"): Promise<PriceResolution> {
    const candidates = await this.quotes.findLatestOnOrBefore(ref.instrumentId, quoteType, asOf, 50);
    const current = candidates.filter((quote) => !quote.supersededBy);

    if (current.length === 0) {
      return {
        instrumentId: ref.instrumentId,
        requestedOn: asOf,
        rung: "UNAVAILABLE",
        price: null,
        pricedOn: null,
        providerId: null,
        sourceType: null,
        ageDays: 0,
        isStale: true,
        reason:
          `No price for ${ref.symbol} on or before ${asOf.toISO()}. Reported as unavailable ` +
          `rather than as zero: a zero here is a number someone would act on.`,
      };
    }

    const newestDate = current.reduce(
      (latest, quote) => (quote.asOf.isAfter(latest) ? quote.asOf : latest),
      current[0].asOf,
    );
    const sameDay = current.filter((quote) => quote.asOf.compareTo(newestDate) === 0);
    const chosen = sameDay.sort((a, b) => {
      const byPriority = this.priorityOf(a.providerId) - this.priorityOf(b.providerId);
      return byPriority !== 0 ? byPriority : b.ingestedAt.getTime() - a.ingestedAt.getTime();
    })[0];

    const ageDays = chosen.asOf.daysUntil(asOf);
    const threshold = STALENESS_DAYS[ref.assetClass];
    const isStale = ageDays > threshold;
    const rung: PriceRung = ageDays === 0 ? "EXACT" : isStale ? "STALE" : "CARRIED_FORWARD";

    return {
      instrumentId: ref.instrumentId,
      requestedOn: asOf,
      rung,
      price: chosen.price,
      pricedOn: chosen.asOf,
      providerId: chosen.providerId,
      sourceType: rung === "EXACT" ? chosen.sourceType : "CARRIED_FORWARD",
      ageDays,
      isStale,
      reason:
        rung === "EXACT"
          ? null
          : `Priced from ${chosen.asOf.toISO()}, ${ageDays} day${ageDays === 1 ? "" : "s"} before ` +
            `${asOf.toISO()}${isStale ? `, which is past the ${threshold}-day limit for ${ref.assetClass} — treat as stale` : ""}.`,
    };
  }

  /** Convenience: what a holding of `quantity` units is worth on a date. */
  async valueOn(
    ref: InstrumentRef,
    quantity: Quantity,
    asOf: CalendarDate,
    quoteType: QuoteType = "CLOSE",
  ): Promise<{ value: Money | null; resolution: PriceResolution }> {
    const resolution = await this.priceOn(ref, asOf, quoteType);
    return {
      // Null propagates rather than collapsing to zero: an unpriceable holding makes
      // the *total* unknown too, and a total that silently omits it is worse than
      // one that admits the gap.
      value: resolution.price === null ? null : resolution.price.times(quantity),
      resolution,
    };
  }
}

/* ═══ FxBook ══════════════════════════════════════════════════════════ */

export interface FxResolution {
  readonly base: string;
  readonly quote: string;
  readonly requestedOn: CalendarDate;
  readonly rate: Quantity | null;
  readonly ratedOn: CalendarDate | null;
  readonly providerId: string | null;
  readonly sourceType: PriceSourceType | null;
  readonly ageDays: number;
  readonly isStale: boolean;
  /** True when the rate is one the user asserted rather than a vendor's. */
  readonly userAsserted: boolean;
  readonly reason: string | null;
}

export class FxRateUnavailableError extends DomainError {
  constructor(base: string, quote: string, asOf: CalendarDate) {
    super(
      "FX_RATE_UNAVAILABLE",
      `No ${base}/${quote} rate on or before ${asOf.toISO()}. A conversion cannot be ` +
        `guessed: report the position in its own currency instead.`,
    );
  }
}

/**
 * FX rates, resolved by the same ladder as prices — and with one addition that
 * matters for tax: **a user-asserted rate wins.**
 *
 * The rate a user actually got from their bank is the rate their return is assessed
 * on, and it will not match any published reference. Firefly's
 * `currency_exchange_rates.user_rate` beside `provider_rate` is the right shape and
 * is adopted here; the difference is that this one is append-only, so which rate was
 * used for a filed return stays answerable.
 */
export class FxBook {
  constructor(
    private readonly providers: readonly FxProviderPort[],
    private readonly rates: FxRateRepository,
    private readonly clock: Clock,
  ) {}

  /** Fetches and persists reference rates; provider failures are returned by name. */
  async refresh(
    base: string,
    quotes: readonly string[],
    range: DateRange,
  ): Promise<{ persisted: number; errors: readonly string[] }> {
    let persisted = 0;
    const errors: string[] = [];
    for (const provider of this.providers) {
      const result = await provider.fetchRates({ base, quotes, range });
      if (!result.ok) {
        errors.push(`${provider.id}: ${result.error.message}`);
        continue;
      }
      await this.rates.append(result.value);
      persisted += result.value.length;
    }
    return { persisted, errors };
  }

  async rateOn(
    base: string,
    quote: string,
    asOf: CalendarDate,
    userId?: UserId,
  ): Promise<FxResolution> {
    if (base === quote) {
      return {
        base, quote, requestedOn: asOf, rate: Quantity.fromString("1"), ratedOn: asOf,
        providerId: null, sourceType: "DERIVED", ageDays: 0, isStale: false,
        userAsserted: false, reason: null,
      };
    }

    const stored = await this.rates.findLatestOnOrBefore(base, quote, asOf, userId, 50);
    if (stored.length === 0) {
      return {
        base, quote, requestedOn: asOf, rate: null, ratedOn: null, providerId: null,
        sourceType: null, ageDays: 0, isStale: true, userAsserted: false,
        reason: `No ${base}/${quote} rate on or before ${asOf.toISO()}.`,
      };
    }

    const newest = stored.reduce(
      (latest, row) => (row.asOf.isAfter(latest.asOf) ? row : latest),
      stored[0],
    );
    // A user's own rate for that date beats every provider, whatever their priority.
    const sameDay = stored.filter((row) => row.asOf.compareTo(newest.asOf) === 0);
    const asserted = sameDay.find((row) => row.userRate !== null);
    const chosen = asserted ?? newest;
    const rate = asserted?.userRate ?? chosen.rate;

    const ageDays = chosen.asOf.daysUntil(asOf);
    const isStale = ageDays > STALENESS_DAYS.FX;

    return {
      base,
      quote,
      requestedOn: asOf,
      rate,
      ratedOn: chosen.asOf,
      providerId: asserted ? null : chosen.providerId,
      sourceType: asserted ? "MANUAL" : ageDays === 0 ? chosen.sourceType : "CARRIED_FORWARD",
      ageDays,
      isStale,
      userAsserted: asserted !== undefined,
      reason: asserted
        ? `Using the rate you recorded for ${chosen.asOf.toISO()} rather than the provider's — ` +
          `it is the rate your return is assessed on.`
        : ageDays === 0
          ? null
          : `Rate carried forward from ${chosen.asOf.toISO()}${isStale ? ", and is stale" : ""}.`,
    };
  }

  /**
   * Converts, or refuses.
   *
   * There is no "assume parity" branch and no zero: an unconvertible amount is a
   * `Result` failure, because a report that quietly treated $1,100 as ₹1,100 would
   * be wrong by a factor of 84 and look perfectly reasonable.
   */
  async convert(
    amount: Money,
    into: Currency,
    asOf: CalendarDate,
    userId?: UserId,
  ): Promise<Result<{ amount: Money; resolution: FxResolution }, AppError>> {
    if (amount.currency.code === into.code) {
      const resolution = await this.rateOn(amount.currency.code, into.code, asOf, userId);
      return Ok({ amount, resolution });
    }

    const resolution = await this.rateOn(amount.currency.code, into.code, asOf, userId);
    if (resolution.rate === null) {
      return Err(new FxRateUnavailableError(amount.currency.code, into.code, asOf));
    }

    // Exact integer arithmetic, in one step rather than two.
    //
    // Converting minor units to minor units has to carry both the rate *and* the
    // ratio of the two currencies' minor-unit factors — 100 paise per rupee against
    // 100 cents per dollar happens to cancel, and a rounding step in the middle
    // would still lose a paisa on most amounts. Written as a single ratio so there
    // is nowhere for that paisa to go:
    //
    //   targetMinor = sourceMinor × rate × targetFactor ÷ (rateScale × sourceFactor)
    const numerator = resolution.rate.scaled * into.minorUnitsPerMajor;
    const denominator = FX_RATE_SCALE * amount.currency.minorUnitsPerMajor;
    const converted = Money.fromMinor(
      divideRounded(BigInt(amount.toMinorNumber()) * numerator, denominator, "HALF_EVEN"),
      into,
    );

    return Ok({ amount: converted, resolution });
  }

  /** Records what the user says the rate was. Appended, never overwriting. */
  async assertUserRate(props: {
    userId: UserId;
    base: string;
    quote: string;
    asOf: CalendarDate;
    rate: Quantity;
  }): Promise<void> {
    await this.rates.setUserRate({
      userId: props.userId,
      base: props.base,
      quote: props.quote,
      asOf: props.asOf,
      rate: props.rate,
      providerId: "user",
      sourceType: "MANUAL",
      ingestedAt: this.clock.now(),
    });
  }

  /**
   * Q06: a rate and its inverse must agree within 0.1%.
   *
   * A WARN, not a BLOCK, and checkable only because a derived rate records how it
   * was derived — ECB publishes EUR-based rates, so USD/INR is
   * `(EUR/INR)/(EUR/USD)`, and the rounding in that division is exactly what this
   * tolerance is for.
   */
  static inverseConsistency(forward: Quantity, inverse: Quantity): {
    ok: boolean;
    productError: Percentage;
  } {
    // forward × inverse should be exactly 1. In scaled terms that is
    // FX_RATE_SCALE², and the shortfall as a percentage is difference × 100 ÷ unity
    // — carried in Percentage's own 1e6 scale so no float appears at all.
    const unity = FX_RATE_SCALE * FX_RATE_SCALE;
    const product = forward.scaled * inverse.scaled;
    const difference = product > unity ? product - unity : unity - product;
    const productError = Percentage.fromScaled((difference * 100n * 1_000_000n) / unity);
    return { ok: productError.compareTo(Percentage.of("0.1")) <= 0, productError };
  }

  /** Providers, for a UI that wants to say where a rate came from. */
  providerIds(): readonly string[] {
    return this.providers.map((provider) => provider.id);
  }
}

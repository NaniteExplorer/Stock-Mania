/**
 * The market-data ports: the seam a paid feed is dropped into, one capability at
 * a time.
 *
 * `src/infra/providers.ts` already models "a provider that returns quotes". This
 * layer models something different and deliberately narrower: **one capability,
 * one market, one adapter**. Search, live quote, daily history, FX, instrument
 * master and symbology are separate ports because in practice they come from
 * separate vendors, fail separately, and get replaced separately. A registry then
 * picks `capability x market -> ordered chain`, so replacing (say) Indian history
 * with a paid feed is one config edit plus one adapter file, and no caller changes.
 *
 * Two rules are encoded in the types rather than left to an adapter's good
 * intentions, because both have already been measured to break real numbers:
 *
 *  - **Every historical series declares `adjusted`.** Yahoo restates history into
 *    post-split terms; the NSE/BSE bhavcopy archives do not. Splicing one into the
 *    other inside a single series is a silent 40x error (C3), so the flag travels
 *    with the data and the chain refuses to mix.
 *  - **Every FX rate declares the `effectiveDate` the source actually used, and
 *    its rate *kind*.** Frankfurter silently clamps a pre-2000-01-13 request to
 *    2000-01-13; an ECB fixing, an indicative live rate and a market rate differ by
 *    ~0.18% (C12). A rate that cannot say which day and which kind it is cannot be
 *    put in a portfolio history.
 *
 * **No floats.** Prices, quantities and FX rates are bigints scaled by 1e8 — the
 * same scale as `price_quotes.price_scaled`, `price_bars.*_scaled` and
 * `fx_rates.provider_rate_scaled`, so a value crosses this layer into the database
 * without a conversion. Decimal text from a source is parsed straight to that
 * integer by {@link scaledFromDecimal}; nothing here multiplies a float by 1e8.
 */

import { Result } from "@/core/kernel";
import { Currency } from "@/core/money";
import { Quantity } from "@/core/numeric";
import { CalendarDate, DateRange } from "@/core/time";
import { HealthStatus, ProviderError } from "@/domain/pricing";

/* ═══ Scale ═══════════════════════════════════════════════════════════ */

/** Decimal places in every scaled integer here. Matches `Quantity` and the schema. */
export const PRICE_SCALE = 8;

/** 10^{@link PRICE_SCALE}, as a bigint, for callers that must divide. */
export const PRICE_FACTOR = 100_000_000n;

/**
 * Decimal text to a 1e8-scaled integer, exactly.
 *
 * `parseFloat(text) * 1e8` is the trap this exists to close: it loses pennies on
 * values as ordinary as 2924.35, and it is banned by the repository lint rule.
 * `Quantity` already does the exact string-to-bigint parse, so this is a one-line
 * delegation that gives the operation a name a reviewer can grep for.
 */
export function scaledFromDecimal(text: string): bigint {
  return Quantity.fromString(text).scaled;
}

/**
 * A JSON *number* from a source that shipped one, to a scaled integer.
 *
 * Yahoo and Nasdaq put prices in JSON numbers, so by the time `JSON.parse` returns,
 * the double already exists and no parser can undo that. `toFixed(8)` renders the
 * double's exact decimal at our scale and the parse is then exact — this is the
 * boundary, and it is the only place a `number` is allowed to become a price.
 * Sources that ship decimal *strings* (bhavcopy CSV, Moneycontrol, Frankfurter)
 * must use {@link scaledFromDecimal} instead and never route through here.
 */
export function scaledFromSourceNumber(value: number): bigint {
  if (!Number.isFinite(value)) throw new TypeError(`Not a finite price: ${value}`);
  return scaledFromDecimal(value.toFixed(PRICE_SCALE));
}

/** A scaled integer back to decimal text, for logs and for the UI's formatter. */
export function decimalFromScaled(scaled: bigint): string {
  return Quantity.fromScaled(scaled).toString();
}

/* ═══ Identity ════════════════════════════════════════════════════════ */

/**
 * Which market an adapter serves.
 *
 * `GLOBAL` is an adapter that serves every market (Yahoo), not a market of its
 * own; the registry appends it to every market's chain.
 */
export type MarketCode = "IN" | "US" | "GLOBAL";

export type MarketDataCapability =
  | "SEARCH"
  | "QUOTE"
  | "HISTORY"
  | "FX"
  | "MASTER"
  | "SYMBOLOGY"
  | "CORPORATE_ACTIONS";

export type TradableType = "EQUITY" | "ETF" | "INDEX" | "FUND" | "OTHER";

/** Every port returns this. `ProviderError` carries the retryable/kind taxonomy. */
export type MarketDataResult<T> = Result<T, ProviderError>;

/**
 * What the registry knows about an adapter without calling it.
 *
 * `keyless` is `true` by type, not by convention: C1 forbids a keyed source, and an
 * adapter that needed a key could not satisfy this interface without lying in a
 * place a reviewer looks.
 */
export interface MarketDataSourceInfo {
  readonly id: string;
  readonly displayName: string;
  /**
   * Every capability this adapter serves. A list, not one value: Yahoo's chart
   * endpoint genuinely answers a live quote, a daily history and a corporate-action
   * feed from the same call, and splitting that into three classes with three
   * breakers would let one of them keep hammering an endpoint the other two have
   * already found to be down.
   */
  readonly capabilities: readonly MarketDataCapability[];
  readonly markets: readonly MarketCode[];
  readonly keyless: true;
}

export interface MarketDataPort {
  readonly info: MarketDataSourceInfo;
  /** The breaker's view of this source. The chain skips a source whose circuit is open. */
  health(): HealthStatus;
}

/* ═══ Search ══════════════════════════════════════════════════════════ */

export interface SymbolSearchQuery {
  readonly text: string;
  readonly market?: MarketCode;
  readonly limit?: number;
}

/**
 * One candidate instrument.
 *
 * `quoteKey` is the exact string the history adapter accepted (`RELIANCE.NS`,
 * `BRK-B`) — not an uppercased user symbol. `score` is an integer 0..10000 so
 * ranking never introduces a float.
 */
export interface SymbolCandidate {
  readonly quoteKey: string;
  readonly symbol: string;
  readonly name: string;
  readonly exchange: string;
  readonly currency: Currency;
  readonly market: MarketCode;
  readonly instrumentType: TradableType;
  readonly isin: string | null;
  /** 0..10000. A generator that cannot rank returns 0 and defers to the ranker. */
  readonly score: number;
  readonly sourceId: string;
}

export interface SymbolSearchPort extends MarketDataPort {
  search(query: SymbolSearchQuery): Promise<MarketDataResult<readonly SymbolCandidate[]>>;
}

/* ═══ Live quote ══════════════════════════════════════════════════════ */

export interface QuoteSubject {
  readonly quoteKey: string;
  readonly currency: Currency;
  readonly market: MarketCode;
}

export interface LiveQuote {
  readonly quoteKey: string;
  readonly priceScaled: bigint;
  readonly currency: Currency;
  /** The trading day the price belongs to. */
  readonly asOf: CalendarDate;
  /** When the source says it observed the price. */
  readonly observedAt: Date;
  /** True when the price is older than the freshness the caller asked for. */
  readonly stale: boolean;
  readonly sourceId: string;
}

export interface LiveQuoteRequest {
  readonly subjects: readonly QuoteSubject[];
  /** A quote older than this is returned with `stale: true`, never dropped. */
  readonly freshnessMinutes?: number;
  /** "Now", injected, so staleness is testable without a clock. */
  readonly asAt?: Date;
}

export interface LiveQuotePort extends MarketDataPort {
  quote(request: LiveQuoteRequest): Promise<MarketDataResult<readonly LiveQuote[]>>;
}

/* ═══ Daily history ═══════════════════════════════════════════════════ */

/**
 * One daily bar, already satisfying every `price_bars` check constraint.
 *
 * Built only through {@link dailyBar}: `high >= low` is not a thing to validate in
 * a repository, it is a bar that does not exist.
 */
export interface DailyBar {
  readonly asOf: CalendarDate;
  readonly openScaled: bigint;
  readonly highScaled: bigint;
  readonly lowScaled: bigint;
  readonly closeScaled: bigint;
  /** Units traded. `null` when the source does not publish it — never 0 for unknown. */
  readonly volume: bigint | null;
}

/**
 * The only constructor for a {@link DailyBar}.
 *
 * A source whose OHLC does not cohere is a malformed response, not a bar to be
 * repaired: silently clamping `high` up to `open` would manufacture a print that
 * never traded, and that print would then pass every downstream invariant.
 */
export function dailyBar(
  sourceId: string,
  input: {
    asOf: CalendarDate;
    openScaled: bigint;
    highScaled: bigint;
    lowScaled: bigint;
    closeScaled: bigint;
    volume?: bigint | null;
  },
): DailyBar {
  const { asOf, openScaled, highScaled, lowScaled, closeScaled } = input;
  const volume = input.volume ?? null;
  const reject = (why: string): never => {
    throw new ProviderError(
      "MALFORMED_RESPONSE",
      sourceId,
      `${sourceId} returned an impossible bar for ${asOf.toISO()}: ${why}.`,
    );
  };
  if (lowScaled <= 0n) reject(`low ${decimalFromScaled(lowScaled)} is not positive`);
  if (highScaled < lowScaled) {
    reject(`high ${decimalFromScaled(highScaled)} is below low ${decimalFromScaled(lowScaled)}`);
  }
  if (openScaled < lowScaled || openScaled > highScaled) {
    reject(`open ${decimalFromScaled(openScaled)} is outside the day's range`);
  }
  if (closeScaled < lowScaled || closeScaled > highScaled) {
    reject(`close ${decimalFromScaled(closeScaled)} is outside the day's range`);
  }
  if (volume !== null && volume < 0n) reject(`volume ${volume} is negative`);
  return { asOf, openScaled, highScaled, lowScaled, closeScaled, volume };
}

export interface HistoryRequest {
  readonly quoteKey: string;
  readonly currency: Currency;
  readonly market: MarketCode;
  /** Explicit start and end. There is no "max" — C4: `range=max` degrades to monthly. */
  readonly range: DateRange;
  /**
   * Whether the caller wants a split/dividend-restated series.
   *
   * An adapter that can only serve the other kind returns what it has with its own
   * `adjusted` flag set honestly; the chain, not the adapter, decides whether that
   * is acceptable.
   */
  readonly adjusted: boolean;
}

export interface HistoricalSeries {
  readonly quoteKey: string;
  readonly currency: Currency;
  /**
   * True when the source restates history into post-split terms (Yahoo, Nasdaq);
   * false for an official archive that prints what traded (NSE/BSE bhavcopy).
   * Never inferred, never defaulted.
   */
  readonly adjusted: boolean;
  /** The last date this series speaks for. */
  readonly asOf: CalendarDate;
  /** Ascending by date, one bar per day. */
  readonly bars: readonly DailyBar[];
  readonly sourceId: string;
}

export interface HistoricalSeriesPort extends MarketDataPort {
  history(request: HistoryRequest): Promise<MarketDataResult<HistoricalSeries>>;
}

/* ═══ FX ══════════════════════════════════════════════════════════════ */

/**
 * Which *kind* of number the rate is.
 *
 * An ECB daily reference fixing, a broker's indicative live rate and a market rate
 * are three different measurements of the same pair and differ by roughly 0.18%.
 * Mixing them inside one portfolio's history produces a return that is an artefact
 * of the source mix, so the kind travels with the rate and the chain refuses.
 */
export type FxRateKind = "ECB_REFERENCE" | "INDICATIVE_LIVE" | "MARKET";

export interface FxRateRequest {
  readonly base: Currency;
  readonly quote: Currency;
  /** The date asked for. The answer says which date was actually served. */
  readonly on: CalendarDate;
}

export interface FxRate {
  readonly base: Currency;
  readonly quote: Currency;
  /** Units of `quote` per one unit of `base`, scaled by 1e8. */
  readonly rateScaled: bigint;
  /** What the caller asked for. */
  readonly requestedDate: CalendarDate;
  /** What the source actually returned. Frankfurter clamps; this records it. */
  readonly effectiveDate: CalendarDate;
  /** True when `effectiveDate` is not `requestedDate`. */
  readonly clamped: boolean;
  readonly kind: FxRateKind;
  readonly sourceId: string;
}

export interface FxRatePort extends MarketDataPort {
  /** Every rate this source produces is of this kind. */
  readonly rateKind: FxRateKind;
  rate(request: FxRateRequest): Promise<MarketDataResult<FxRate>>;
}

/* ═══ Instrument master ═══════════════════════════════════════════════ */

export interface InstrumentMasterRow {
  readonly symbol: string;
  readonly name: string;
  readonly exchange: string;
  readonly market: MarketCode;
  readonly currency: Currency;
  readonly instrumentType: TradableType;
  readonly isin: string | null;
  /** The candidate key to probe on the history endpoint. `.NS` for Indian equity (C9). */
  readonly candidateQuoteKey: string;
  readonly listedOn: CalendarDate | null;
  readonly sourceId: string;
}

export interface InstrumentMasterPort extends MarketDataPort {
  load(): Promise<MarketDataResult<readonly InstrumentMasterRow[]>>;
}

/* ═══ Symbology ═══════════════════════════════════════════════════════ */

export interface SymbologyJob {
  readonly idType: "ID_ISIN" | "TICKER";
  readonly idValue: string;
  readonly exchCode?: string;
}

export interface SymbologyMatch {
  readonly job: SymbologyJob;
  readonly figi: string;
  /** The rename-proof identity: a ticker change does not move the share class. */
  readonly shareClassFigi: string | null;
  readonly ticker: string | null;
  readonly exchCode: string | null;
  readonly securityType: string | null;
  readonly sourceId: string;
}

export interface SymbologyPort extends MarketDataPort {
  /** Batched: the free tier allows 10 jobs per request and 25 requests a minute. */
  map(jobs: readonly SymbologyJob[]): Promise<MarketDataResult<readonly SymbologyMatch[]>>;
}

/* ═══ Corporate actions (optional, reconciliation only) ═══════════════ */

/**
 * C2: the owner logs every split, bonus and dividend himself. A provider-observed
 * action is a *warning* input — it never mutates the ledger.
 */
export interface CorporateAction {
  readonly quoteKey: string;
  readonly onDate: CalendarDate;
  readonly kind: "SPLIT" | "DIVIDEND";
  /** For a split: numerator/denominator as integers (a 10:1 is 10/1). */
  readonly numerator: bigint | null;
  readonly denominator: bigint | null;
  /** For a dividend: amount per share, scaled 1e8, in `currency`. */
  readonly amountScaled: bigint | null;
  readonly currency: Currency | null;
  readonly sourceId: string;
}

export interface CorporateActionsPort extends MarketDataPort {
  actions(request: HistoryRequest): Promise<MarketDataResult<readonly CorporateAction[]>>;
}

/** Any adapter the registry can hold. */
export type AnyMarketDataPort =
  | SymbolSearchPort
  | LiveQuotePort
  | HistoricalSeriesPort
  | FxRatePort
  | InstrumentMasterPort
  | SymbologyPort
  | CorporateActionsPort;

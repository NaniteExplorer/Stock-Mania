import { Clock, UniqueId, UserId, newUuid } from "@/core/kernel";

const ISIN_PATTERN = /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/;
const DAY_MS = 24 * 60 * 60 * 1_000;

export const CATALOG_REFRESH_INTERVAL_MS = DAY_MS;

export class CatalogInstrumentId extends UniqueId {
  private readonly __catalogInstrumentId = true;

  static create(): CatalogInstrumentId {
    return new CatalogInstrumentId(newUuid());
  }

  static from(value: string): CatalogInstrumentId {
    return new CatalogInstrumentId(value);
  }
}

export type CatalogInstrumentType =
  | "EQUITY"
  | "ETF"
  | "MUTUAL_FUND"
  | "BOND"
  | "GOVT_SECURITY"
  | "REIT"
  | "DERIVATIVE"
  | "OTHER";

export interface CatalogListing {
  readonly id: string;
  readonly exchange: string;
  readonly segment: string;
  readonly symbol: string;
  readonly name: string;
  readonly instrumentType: CatalogInstrumentType;
  readonly currency: string;
  readonly active: boolean;
  /**
   * The exact string a history adapter accepted, or null if none ever has.
   *
   * Optional on the type only so the many existing fixtures that predate the gate
   * still compile; the repository always supplies it, and {@link isPriceable} on
   * the search output is what callers branch on.
   */
  readonly quoteKey?: string | null;
  readonly quoteStale?: boolean;
  /**
   * When the priceability gate last looked at this row, or null if it never has.
   *
   * The difference between "we asked and no source would price it" and "nobody
   * has asked yet" is the whole difference between a refusal and a queue, and
   * without this field the search output renders both as "Not priceable".
   */
  readonly quoteValidatedAt?: Date | null;
  readonly firstTradeDate?: string | null;
  readonly source: string;
  readonly fetchedAt: Date;
  readonly checksum: string;
}

/** A provider key is effective over [effectiveFrom, effectiveThrough). */
export interface CatalogProviderMapping {
  readonly id: string;
  readonly provider: string;
  readonly providerInstrumentId: string;
  readonly providerToken: string | null;
  readonly tradingSymbol: string;
  readonly effectiveFrom: string;
  readonly effectiveThrough: string | null;
  readonly source: string;
  readonly fetchedAt: Date;
  readonly checksum: string;
}

export interface CatalogCandidate {
  readonly catalogInstrumentId: CatalogInstrumentId;
  /** Present only when the source supplied and verified its ISIN. */
  readonly isin: string | null;
  readonly name: string;
  readonly instrumentType: CatalogInstrumentType;
  readonly listing: CatalogListing;
  readonly providerMappings: readonly CatalogProviderMapping[];
}

export interface CatalogMasterRecord {
  readonly verifiedIsin: string | null;
  readonly name: string;
  readonly instrumentType: CatalogInstrumentType;
  readonly listing: Omit<CatalogListing, "id" | "source" | "fetchedAt" | "checksum" | "active">;
  readonly providerMappings: readonly Omit<
    CatalogProviderMapping,
    "id" | "source" | "fetchedAt" | "checksum" | "effectiveThrough"
  >[];
}

export interface CatalogMappingRecord {
  readonly exchange: string;
  readonly segment: string;
  readonly tradingSymbol: string;
  readonly provider: string;
  readonly providerInstrumentId: string;
  readonly providerToken: string | null;
  readonly effectiveFrom: string;
}

export interface CatalogSnapshot {
  readonly source: string;
  readonly fetchedAt: Date;
  readonly checksum: string;
  readonly instruments: readonly CatalogMasterRecord[];
  readonly mappings: readonly CatalogMappingRecord[];
}

export interface CatalogFetchReceipt {
  readonly source: string;
  readonly fetchedAt: Date;
  readonly checksum: string;
  readonly rowCount: number;
}

export interface CatalogFetchAttempt {
  readonly source: string;
  readonly attemptedAt: Date;
  readonly outcome: "SUCCESS" | "FAILED";
}

export interface CatalogIngestReport {
  readonly instruments: number;
  readonly listings: number;
  readonly mappings: number;
  readonly unmatchedMappings: number;
}

export interface CatalogSearchRows {
  readonly candidates: readonly CatalogCandidate[];
  /** Exact symbol or ISIN matches are returned without the display-result limit. */
  readonly exactIdentifierMatches: readonly CatalogCandidate[];
}

export interface InstrumentCatalogRepository {
  latestSuccessfulFetch(source?: string): Promise<CatalogFetchReceipt | null>;
  latestFetchAttempt(source: string): Promise<CatalogFetchAttempt | null>;
  recordFetchFailure(source: string, attemptedAt: Date): Promise<void>;
  count(): Promise<number>;
  ingest(snapshot: CatalogSnapshot): Promise<CatalogIngestReport>;
  search(normalizedQuery: string, limit: number): Promise<CatalogSearchRows>;
  linkPortfolioInstrument(input: {
    userId: UserId;
    portfolioInstrumentId: string;
    catalogInstrumentId: CatalogInstrumentId;
    listingId: string;
    linkedAt: Date;
  }): Promise<boolean>;

  /* ── The priceability gate (C10, C6) ─────────────────────────────── */

  /**
   * Active listings whose quote key needs a first probe or a re-confirmation,
   * oldest first.
   *
   * Bounded by `limit` because this runs offline on a schedule, never under the
   * user's cursor (C10) — the catalogue is ~30 000 rows and a full sweep is a
   * budget to be spent over days, not a request to be awaited.
   */
  listingsDueQuoteKeyCheck(
    limit: number,
    asAt: Date,
  ): Promise<readonly (QuoteKeyCandidateListing & CatalogQuoteKeyState)[]>;

  /** The same rows, restricted to an explicit id set — the search's on-demand probe. */
  listingsForQuoteKeyProbe(
    listingIds: readonly string[],
    asAt: Date,
  ): Promise<readonly (QuoteKeyCandidateListing & CatalogQuoteKeyState)[]>;

  /** Records an accepted key, its adapter, its inception date and the confirmation. */
  recordQuoteKey(resolution: QuoteKeyResolution): Promise<void>;

  /**
   * Marks a key dead. **Never deletes** (C6): the holding stays valued at its last
   * known close behind a badge, and the row stops being offered in search.
   */
  markQuoteStale(listingId: string, at: Date, reason: string): Promise<void>;

  /** Records a confirmation without changing the key — the ordinary re-validation. */
  touchQuoteKey(listingId: string, at: Date): Promise<void>;

  /** Stores harvested Moneycontrol `sc_id`s. Offline only; never a keystroke dependency. */
  recordMoneycontrolScIds(rows: readonly MoneycontrolScIdRow[]): Promise<number>;

  /** The `sc_id` map the India quote adapter needs, keyed by normalised symbol. */
  moneycontrolScIdMap(): Promise<ReadonlyMap<string, string>>;
}

export type CatalogProviderResult =
  | { readonly ok: true; readonly snapshot: CatalogSnapshot }
  | { readonly ok: false; readonly error: string };

export interface InstrumentMasterProvider {
  readonly source: string;
  fetch(): Promise<CatalogProviderResult>;
}

export type CatalogMatchState = "EXACT" | "CONFIRM" | "MANUAL";

export interface CatalogSearchOutput {
  readonly query: string;
  readonly matchState: CatalogMatchState;
  readonly selected: CatalogSearchCandidateOutput | null;
  readonly candidates: readonly CatalogSearchCandidateOutput[];
  readonly manualEntryAllowed: true;
  readonly cache: {
    readonly status: "READY" | "EMPTY";
    readonly source: string | null;
    readonly fetchedAt: string | null;
    readonly checksum: string | null;
    readonly stale: boolean;
  };
}

export interface CatalogSearchCandidateOutput {
  readonly catalogInstrumentId: string;
  readonly isin: string | null;
  readonly name: string;
  readonly instrumentType: CatalogInstrumentType;
  readonly listing: {
    readonly id: string;
    readonly exchange: string;
    readonly segment: string;
    readonly symbol: string;
    readonly name: string;
    readonly currency: string;
  };
  /**
   * Whether this candidate can be added at all.
   *
   * C10's gate, rendered: false means no history adapter has ever accepted a key
   * for it, or the key it had has died. The UI shows such a candidate as visibly
   * unaddable and the submit path rejects it server-side — a candidate that cannot
   * be priced cannot be added, and saying so at selection time is the difference
   * between a clear refusal and a holding that renders a blank chart forever.
   */
  readonly priceable: boolean;
  readonly quoteKey: string | null;
  readonly quoteStale: boolean;
  /** False while the row is still waiting for its first probe — not a refusal. */
  readonly quoteChecked: boolean;
  /** The source's inception date, for the chart's left edge. */
  readonly firstTradeDate: string | null;
  readonly providerMappings: readonly {
    readonly provider: string;
    readonly providerInstrumentId: string;
    readonly providerToken: string | null;
    readonly tradingSymbol: string;
    readonly effectiveFrom: string;
  }[];
}

export function normalizeCatalogText(value: string): string {
  return value
    .trim()
    .toUpperCase()
    .replace(/[%_]/g, " ")
    .replace(/\s+/g, " ");
}

export function verifiedIsin(value: unknown): string | null {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const normalized = normalizeCatalogText(String(value));
  return ISIN_PATTERN.test(normalized) ? normalized : null;
}

export function isRefreshDue(last: CatalogFetchReceipt | null, clock: Clock): boolean {
  return last === null || clock.now().getTime() - last.fetchedAt.getTime() >= CATALOG_REFRESH_INTERVAL_MS;
}

export function isCatalogAttemptDue(last: CatalogFetchAttempt | null, clock: Clock): boolean {
  return last === null || clock.now().getTime() - last.attemptedAt.getTime() >= CATALOG_REFRESH_INTERVAL_MS;
}

export function toCatalogSearchCandidate(candidate: CatalogCandidate): CatalogSearchCandidateOutput {
  return {
    catalogInstrumentId: candidate.catalogInstrumentId.value,
    isin: candidate.isin,
    name: candidate.name,
    instrumentType: candidate.instrumentType,
    listing: {
      id: candidate.listing.id,
      exchange: candidate.listing.exchange,
      segment: candidate.listing.segment,
      symbol: candidate.listing.symbol,
      name: candidate.listing.name,
      currency: candidate.listing.currency,
    },
    priceable: isPriceable({
      listingId: candidate.listing.id,
      quoteKey: candidate.listing.quoteKey ?? null,
      quoteProvider: null,
      quoteValidatedAt: null,
      quoteStale: candidate.listing.quoteStale ?? false,
      firstTradeDate: candidate.listing.firstTradeDate ?? null,
    }),
    quoteKey: candidate.listing.quoteKey ?? null,
    quoteStale: candidate.listing.quoteStale ?? false,
    quoteChecked: (candidate.listing.quoteValidatedAt ?? null) !== null,
    firstTradeDate: candidate.listing.firstTradeDate ?? null,
    providerMappings: candidate.providerMappings
      .filter((mapping) => mapping.effectiveThrough === null)
      .map((mapping) => ({
        provider: mapping.provider,
        providerInstrumentId: mapping.providerInstrumentId,
        providerToken: mapping.providerToken,
        tradingSymbol: mapping.tradingSymbol,
        effectiveFrom: mapping.effectiveFrom,
      })),
  };
}

/* ═══ The priceability gate (C10, C6) ═════════════════════════════════ */

/**
 * How often a resolved quote key is re-confirmed.
 *
 * Thirty days, because a symbol does not die quietly on a schedule and it does not
 * die often: `TATAMOTORS.NS` resolved for years and then 404'd the week of the
 * demerger. Re-probing every key every day would be ~30 000 requests for an event
 * that happens a handful of times a year; a month's staleness on a *dead* key
 * costs nothing, because the holding is still valued at its last known close.
 */
export const QUOTE_KEY_REVALIDATION_INTERVAL_MS = 30 * DAY_MS;

/** The types a history endpoint may serve and we may index. C10. */
export const PRICEABLE_QUOTE_TYPES: readonly string[] = ["EQUITY", "ETF", "ETFS", "MUTUALFUND"];

/**
 * What a listing looks like to the reconciler.
 *
 * Deliberately not `CatalogListing`: the reconciler needs four fields, and a
 * function that takes four fields can be tested without building a catalogue.
 */
export interface QuoteKeyCandidateListing {
  readonly listingId: string;
  readonly exchange: string;
  readonly symbol: string;
  readonly currency: string;
  readonly instrumentType: CatalogInstrumentType;
}

/**
 * The keys to try, in order, for one listing.
 *
 * The order encodes C9: Indian equities canonicalise to `.NS`, because `.BO`
 * truncation is symbol-specific and hits exactly the dual-listed blue chips —
 * RELIANCE, INFY, HDFCBANK, ITC, SBIN and MRF all return 41 rows from 2026-07-17
 * on the BSE suffix and a full history on the NSE one. A BSE-*only* scrip is not a
 * degraded tier, though: it is 96% priceable, so `.BO` is a real second try rather
 * than a fallback nobody expects to work.
 *
 * US tickers replace `.` with `-` (`BRK.B` is `BRK-B` on the history endpoint) and
 * carry no suffix.
 *
 * A type that is never priced on a chart endpoint — a mutual fund, a bond, a
 * derivative — yields no candidates at all rather than a key that will 404: a
 * fund's NAV comes from AMFI and asking Yahoo for it is a request that can only
 * fail.
 */
export function candidateQuoteKeys(listing: QuoteKeyCandidateListing): readonly string[] {
  if (listing.instrumentType !== "EQUITY" && listing.instrumentType !== "ETF") return [];
  const symbol = normalizeCatalogText(listing.symbol).replace(/\s+/g, "");
  if (!symbol) return [];

  const exchange = normalizeCatalogText(listing.exchange);
  if (exchange === "NSE") return [`${symbol}.NS`, `${symbol}.BO`];
  if (exchange === "BSE") return [`${symbol}.BO`, `${symbol}.NS`];
  // A US listing: the history endpoint spells a class share with a hyphen.
  return [symbol.replace(/\./g, "-")];
}

/** What probing one candidate key against the history endpoint returned. */
export interface QuoteKeyProbeResult {
  readonly quoteKey: string;
  /** How many daily bars came back. Zero is a resolution failure, not an empty chart. */
  readonly bars: number;
  /** The currency the source says the series is in. */
  readonly currency: string | null;
  /** The source's own classification, verbatim. */
  readonly instrumentType: string | null;
  /** The source's inception date, `YYYY-MM-DD`, when it publishes one. */
  readonly firstTradeDate: string | null;
  /** Which adapter answered. Persisted as the vendor pin. */
  readonly sourceId: string;
}

export type QuoteKeyVerdict =
  | { readonly accepted: true; readonly probe: QuoteKeyProbeResult }
  | { readonly accepted: false; readonly reason: string };

/**
 * Whether a probe result is good enough to index the row for search.
 *
 * All three conditions are load-bearing and each has a measured failure behind it:
 *
 *  - **At least one bar.** A 200 with an empty series is what a dead-but-known
 *    symbol returns, and it is indistinguishable from success at the HTTP layer.
 *  - **A matching currency.** `RELIANCE` also resolves on a London line; storing
 *    GBP closes against an INR holding is silently eighty times wrong and passes
 *    every schema check.
 *  - **An EQUITY or ETF type.** The search endpoints happily rank a future or an
 *    option first, and an option's "history" is a series nothing here can value.
 */
export function acceptQuoteKeyProbe(
  probe: QuoteKeyProbeResult,
  expected: { currency: string },
): QuoteKeyVerdict {
  if (probe.bars < 1) {
    return { accepted: false, reason: `${probe.quoteKey} returned no bars` };
  }
  const currency = (probe.currency ?? "").toUpperCase();
  if (currency !== expected.currency.toUpperCase()) {
    return {
      accepted: false,
      reason: `${probe.quoteKey} is priced in ${currency || "an unstated currency"}, not ${expected.currency}`,
    };
  }
  const type = (probe.instrumentType ?? "").toUpperCase().replace(/[^A-Z]/g, "");
  if (!PRICEABLE_QUOTE_TYPES.includes(type)) {
    return {
      accepted: false,
      reason: `${probe.quoteKey} is a ${type || "unclassified"} instrument, not an equity or ETF`,
    };
  }
  return { accepted: true, probe };
}

/** A listing's quote-key state, as stored. */
export interface CatalogQuoteKeyState {
  readonly listingId: string;
  readonly quoteKey: string | null;
  readonly quoteProvider: string | null;
  readonly quoteValidatedAt: Date | null;
  readonly quoteStale: boolean;
  readonly firstTradeDate: string | null;
}

/**
 * Whether a listing may be offered for adding.
 *
 * The whole gate in one predicate, so "unpriceable implies unaddable" is one
 * thing a reader can check rather than a condition repeated at four call sites.
 */
export function isPriceable(state: CatalogQuoteKeyState): boolean {
  return state.quoteKey !== null && state.quoteKey.length > 0 && !state.quoteStale;
}

/** Whether a key is due another confirmation. Never validated counts as due. */
export function isQuoteKeyRevalidationDue(state: CatalogQuoteKeyState, clock: Clock): boolean {
  if (state.quoteValidatedAt === null) return true;
  return clock.now().getTime() - state.quoteValidatedAt.getTime() >= QUOTE_KEY_REVALIDATION_INTERVAL_MS;
}

export interface QuoteKeyResolution {
  readonly listingId: string;
  readonly quoteKey: string;
  readonly quoteProvider: string;
  readonly firstTradeDate: string | null;
  readonly validatedAt: Date;
}

export interface QuoteKeyReconciliationReport {
  readonly probed: number;
  readonly resolved: number;
  readonly markedStale: number;
  readonly stillUnresolved: number;
  /** One line per listing that could not be resolved, for the operator. */
  readonly reasons: readonly string[];
}

/** Moneycontrol's `sc_id`, harvested offline and stored beside the listing. */
export interface MoneycontrolScIdRow {
  readonly listingId: string;
  readonly scId: string;
}

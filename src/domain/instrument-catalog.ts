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

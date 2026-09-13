import type { CatalogInstrumentType, CatalogSearchCandidateOutput } from "@/domain/instrument-catalog";
import type { InstrumentKind } from "@/domain/instruments";

const CATALOG_KIND: Readonly<Record<CatalogInstrumentType, InstrumentKind>> = {
  EQUITY: "LISTED_EQUITY",
  ETF: "ETF",
  MUTUAL_FUND: "MUTUAL_FUND",
  BOND: "BOND",
  GOVT_SECURITY: "GOVT_SECURITY",
  REIT: "REIT",
  DERIVATIVE: "FUTURE",
  OTHER: "LISTED_EQUITY",
};

export interface CatalogPortfolioIdentity {
  readonly symbol: string;
  readonly name: string;
  readonly kind: InstrumentKind;
  readonly isin: string | null;
  readonly exchange: string | null;
  readonly currency: "INR" | "USD";
  readonly quoteRef: string;
  readonly catalogInstrumentId: string;
  readonly listingId: string;
}

/**
 * Converts a confirmed catalogue listing into the values stored on a portfolio
 * instrument. A market quote is deliberately absent from this contract: only
 * the user's execution-price field can value the trade being recorded.
 */
export function catalogPortfolioIdentity(candidate: CatalogSearchCandidateOutput): CatalogPortfolioIdentity {
  if (candidate.listing.currency !== "INR" && candidate.listing.currency !== "USD") {
    throw new Error(`Unsupported trading currency ${candidate.listing.currency}.`);
  }

  const amfi = candidate.providerMappings.find((mapping) => mapping.provider === "AMFI");
  const quoteRef = candidate.instrumentType === "MUTUAL_FUND"
    ? amfi?.providerInstrumentId || candidate.listing.symbol
    : candidate.listing.symbol;

  return {
    symbol: candidate.listing.symbol.toUpperCase(),
    name: candidate.name,
    kind: CATALOG_KIND[candidate.instrumentType],
    isin: candidate.isin,
    exchange: candidate.listing.exchange || null,
    currency: candidate.listing.currency,
    quoteRef,
    catalogInstrumentId: candidate.catalogInstrumentId,
    listingId: candidate.listing.id,
  };
}

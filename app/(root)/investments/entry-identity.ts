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
  /**
   * The exact string a price source accepted, or `null` when there is none.
   *
   * Never `symbol.toUpperCase()`. An invented key is worse than an absent one:
   * it looks priced, it is stored, and every chart drawn from it is empty for
   * the rest of the holding's life with nothing to point at.
   */
  readonly quoteRef: string | null;
  /** False when the holding is priced only by what the owner types in. */
  readonly livePriced: boolean;
  readonly catalogInstrumentId: string;
  readonly listingId: string;
}

/**
 * Whether a candidate may be added, and under which key.
 *
 * One predicate shared by the combobox and the server action, because "disabled
 * button" is not a gate: the server function is reachable by a direct POST, so
 * the refusal has to live somewhere both sides can call, and duplicating it
 * would be two chances to disagree about what "priceable" means.
 *
 * Two tiers, and the distinction is which capability prices the row:
 *
 *  - a **mutual fund** is priced off its AMFI scheme code, which is an exact
 *    identifier from the master ingest rather than a probe result, so the
 *    history-endpoint gate (C10) never applies to it;
 *  - every **exchange listing** is priced off a quote key that some history
 *    adapter actually accepted, which is precisely what `priceable` records.
 */
export type AddableReference =
  | { readonly ok: true; readonly quoteRef: string; readonly livePriced: true }
  | { readonly ok: false; readonly reason: string };

export function addableReference(candidate: CatalogSearchCandidateOutput): AddableReference {
  if (candidate.instrumentType === "MUTUAL_FUND") {
    const amfi = candidate.providerMappings.find((mapping) => mapping.provider === "AMFI");
    if (amfi?.providerInstrumentId) {
      return { ok: true, quoteRef: amfi.providerInstrumentId, livePriced: true };
    }
    return {
      ok: false,
      reason: `${candidate.listing.symbol} has no AMFI scheme code, so its NAV cannot be fetched.`,
    };
  }

  if (candidate.quoteStale) {
    return {
      ok: false,
      reason:
        `${candidate.quoteKey ?? candidate.listing.symbol} has stopped resolving on the history ` +
        `feed — the listing is kept for holdings that already reference it, but it cannot start a new one.`,
    };
  }

  if (!candidate.quoteChecked) {
    return {
      ok: false,
      reason:
        `${candidate.listing.symbol} has not been checked against a price source yet. ` +
        `The check is running now — search again in a moment.`,
    };
  }

  if (!candidate.priceable || !candidate.quoteKey) {
    return {
      ok: false,
      reason:
        `No price source has accepted a quote key for ${candidate.listing.symbol} on ` +
        `${candidate.listing.exchange} yet, so it cannot be charted or valued.`,
    };
  }

  return { ok: true, quoteRef: candidate.quoteKey, livePriced: true };
}

/**
 * Converts a confirmed catalogue listing into the values stored on a portfolio
 * instrument. A market quote is deliberately absent from this contract: only
 * the user's execution-price field can value the trade being recorded.
 *
 * Throws on an unpriceable listing rather than returning a degraded identity —
 * the caller is a mutation, and there is no half-add worth having.
 */
export function catalogPortfolioIdentity(candidate: CatalogSearchCandidateOutput): CatalogPortfolioIdentity {
  if (candidate.listing.currency !== "INR" && candidate.listing.currency !== "USD") {
    throw new Error(`Unsupported trading currency ${candidate.listing.currency}.`);
  }

  const reference = addableReference(candidate);
  if (!reference.ok) throw new Error(reference.reason);

  return {
    symbol: candidate.listing.symbol.toUpperCase(),
    name: candidate.name,
    kind: CATALOG_KIND[candidate.instrumentType],
    isin: candidate.isin,
    exchange: candidate.listing.exchange || null,
    currency: candidate.listing.currency,
    quoteRef: reference.quoteRef,
    livePriced: reference.livePriced,
    catalogInstrumentId: candidate.catalogInstrumentId,
    listingId: candidate.listing.id,
  };
}

import { readFileSync } from "node:fs";
import { SearchInstrumentCatalog, RefreshInstrumentCatalog } from "@/app/instrument-catalog.usecases";
import { FixedClock, UserId } from "@/core/kernel";
import {
  CatalogCandidate,
  CatalogInstrumentId,
  CatalogSnapshot,
  InstrumentCatalogRepository,
  InstrumentMasterProvider,
} from "@/domain/instrument-catalog";
import { CatalogQuoteKeyStubs } from "./doubles";
import { check, checkTrue, done, section } from "./harness";
import { addableReference, catalogPortfolioIdentity } from "../app/(root)/investments/entry-identity";

const now = new Date("2026-09-06T04:00:00.000Z");
const tcs: CatalogCandidate = {
  catalogInstrumentId: CatalogInstrumentId.from("11111111-1111-4111-8111-111111111111"),
  isin: "INE467B01029",
  name: "TATA CONSULTANCY SERV LT",
  instrumentType: "EQUITY",
  listing: {
    id: "listing-tcs",
    exchange: "NSE",
    segment: "NSE_EQ",
    symbol: "TCS",
    name: "TATA CONSULTANCY SERV LT",
    instrumentType: "EQUITY",
    currency: "INR",
    active: true,
    source: "UPSTOX_PUBLIC",
    fetchedAt: now,
    checksum: "a".repeat(64),
  },
  providerMappings: [{
    id: "mapping-tcs",
    provider: "UPSTOX",
    providerInstrumentId: "NSE_EQ|INE467B01029",
    providerToken: "11536",
    tradingSymbol: "TCS",
    effectiveFrom: "2026-09-06",
    effectiveThrough: null,
    source: "UPSTOX_PUBLIC",
    fetchedAt: now,
    checksum: "a".repeat(64),
  }],
};

async function main() {
  section("cash preview");
  const buy = preview({
    side: "BUY",
    quantity: "12.34567891",
    unitPrice: "100.10",
    brokerage: "20.00",
    exchangeFees: "1.25",
    statutoryCharges: "3.10",
    taxWithheld: "0.65",
  });
  check("buy preview signs cash leaving", buy.ok && buy.signedMinor, "-126080");
  check("buy preview displays to paise", buy.ok && buy.display, "INR -1260.80");

  const sell = preview({
    side: "SELL",
    quantity: "10",
    unitPrice: "420.00",
    brokerage: "12.50",
    statutoryCharges: "7.25",
    taxWithheld: "30.00",
  });
  check("sell preview signs net cash arriving", sell.ok && sell.signedMinor, "415025");

  const invalid = preview({
    side: "BUY",
    quantity: "0",
    unitPrice: "99.00",
  });
  checkTrue("invalid zero quantity is refused", !invalid.ok);

  section("search and confirmation structure");
  const searchSource = readFileSync("app/(root)/investments/new/instrument-search.tsx", "utf8");
  checkTrue("combobox role is present", searchSource.includes('role="combobox"'));
  checkTrue("listbox role is present", searchSource.includes('role="listbox"'));
  checkTrue("keyboard down navigation is handled", searchSource.includes('event.key === "ArrowDown"'));
  checkTrue("keyboard enter can stage a result", searchSource.includes('event.key === "Enter"'));
  checkTrue("manual fallback is explicit", searchSource.includes("Manual historical entry"));
  checkTrue("explicit identity confirmation is required", searchSource.includes("Use this identity"));

  const formSource = readFileSync("app/(root)/investments/new/record-investment-form.tsx", "utf8");
  checkTrue("client preview uses the same signed formula", formSource.includes('input.side === "BUY" ? -(consideration + costs) : consideration - costs'));
  checkTrue("catalogue identity is hidden only after confirmation", formSource.includes('name="selectionConfirmed"'));
  checkTrue("actual execution price is collected", formSource.includes("Execution price per unit"));
  checkTrue("tax withheld has its own field", formSource.includes('name="taxWithheld"'));
  checkTrue("submit waits for a confirmed and priceable identity", formSource.includes("disabled={pending || !addable || accounts.length === 0}"));
  checkTrue("the form reuses the shared priceability predicate", formSource.includes("addableReference(selected)"));
  checkTrue("manual entry is labelled not live-priced", formSource.includes("not live-priced"));

  section("as-you-type search");
  checkTrue("search is debounced", searchSource.includes("DEBOUNCE_MS"));
  checkTrue("out-of-order responses are discarded", searchSource.includes("ticket.current !== mine"));
  checkTrue("a failed search has a visible error state", searchSource.includes('role="alert"'));
  checkTrue("the empty result state is distinct from the error state", searchSource.includes("Nothing in the catalogue matches"));
  checkTrue("every candidate is labelled with its exchange", searchSource.includes("candidate.listing.exchange"));
  checkTrue("every candidate is labelled with its currency", searchSource.includes("candidate.listing.currency"));
  checkTrue("an unpriceable candidate is visibly unaddable", searchSource.includes("Not priceable"));
  checkTrue("confirm is disabled for an unpriceable candidate", searchSource.includes("disabled={!stagedReference?.ok}"));
  checkTrue("the spinner respects reduced motion", searchSource.includes("motion-safe:animate-spin"));

  section("search refresh regression");
  const actionSource = readFileSync("app/(root)/investments/catalog-actions.ts", "utf8");
  const searchActionBody = actionSource.slice(
    actionSource.indexOf("export async function searchInstrumentCatalogAction"),
    actionSource.indexOf("export async function recordInvestmentEntryAction"),
  );
  /*
   * This assertion used to read the other way round — refresh *before* search —
   * and that is exactly what shipped a combobox stuck on "Searching...": the
   * refresh walks five public masters, a source with no successful fetch on
   * record is retried every call, and the whole thing was awaited once per
   * debounce. C10 is the rule it broke: an ingest is never a keystroke
   * dependency. The cache is read first now, and only a genuinely empty one
   * blocks, because then there is nothing else to show.
   */
  const refreshIndex = searchActionBody.indexOf("refreshCatalogOnce(serviceBag)");
  const searchIndex = searchActionBody.indexOf("instrumentCatalog.search.execute({ query, limit: 12 })");
  checkTrue("the cache is read before any refresh is considered", searchIndex >= 0 && searchIndex < refreshIndex);
  checkTrue("a blocking refresh is reached only on an empty cache", searchActionBody.includes('first.cache.status === "EMPTY"'));
  checkTrue("a stale cache is refreshed after the response", searchActionBody.includes("after(() => refreshCatalogOnce(serviceBag))"));
  checkTrue("shown rows have their quote keys probed after the response", searchActionBody.includes("reconcileQuoteKeys.reconcileListings(unchecked)"));
  checkTrue("an unprobed row is not reported as a refusal", searchSource.includes("Checking price source"));
  checkTrue("production search does not return refresh errors", !searchActionBody.includes("sources") && !searchActionBody.includes("error"));

  const cachedRepo = new SearchRefreshRepository([tcs]);
  const failingCachedProvider = new FailingProvider();
  const cachedRefresh = await new RefreshInstrumentCatalog(
    cachedRepo,
    failingCachedProvider,
    null,
    new FixedClock(now),
  ).execute();
  check("provider failure falls back to cache", cachedRefresh.status, "CACHE_FALLBACK");
  check("refresh still made one due attempt", failingCachedProvider.calls, 1);
  const cachedSearch = await new SearchInstrumentCatalog(cachedRepo, new FixedClock(now)).execute({ query: "TCS" });
  check("cached search stays usable after provider failure", cachedSearch.matchState, "EXACT");
  check("cached search exposes candidates without provider error text", cachedSearch.selected?.listing.symbol, "TCS");

  const emptyRepo = new SearchRefreshRepository([]);
  const failingEmptyProvider = new FailingProvider();
  const emptyRefresh = await new RefreshInstrumentCatalog(
    emptyRepo,
    failingEmptyProvider,
    null,
    new FixedClock(now),
  ).execute();
  check("provider failure without cache leaves manual-only mode", emptyRefresh.status, "EMPTY_MANUAL_ONLY");
  const emptySearch = await new SearchInstrumentCatalog(emptyRepo, new FixedClock(now)).execute({ query: "UNKNOWN" });
  check("empty cache search returns manual state", emptySearch.matchState, "MANUAL");
  checkTrue("manual entry remains allowed", emptySearch.manualEntryAllowed);

  section("catalogue identity maps portfolio quote references");
  const fundIdentity = catalogPortfolioIdentity({
    ...tcs,
    catalogInstrumentId: "22222222-2222-4222-8222-222222222222",
    priceable: true,
    quoteChecked: true,
    quoteKey: null,
    quoteStale: false,
    firstTradeDate: null,
    isin: "INF209K01VE6",
    name: "Test Flexi Cap Fund - Direct - Growth",
    instrumentType: "MUTUAL_FUND",
    listing: { ...tcs.listing, id: "listing-fund", exchange: "AMFI", segment: "MUTUAL_FUND_NAV", symbol: "120503" },
    providerMappings: [{ ...tcs.providerMappings[0], provider: "AMFI", providerInstrumentId: "120503", tradingSymbol: "120503" }],
  });
  check("AMFI scheme code becomes the quote reference", fundIdentity.quoteRef, "120503");
  check("AMFI catalogue rows create mutual-fund holdings", fundIdentity.kind, "MUTUAL_FUND");

  const usIdentity = catalogPortfolioIdentity({
    ...tcs,
    catalogInstrumentId: "33333333-3333-4333-8333-333333333333",
    priceable: true,
    quoteChecked: true,
    quoteKey: "AAPL",
    quoteStale: false,
    firstTradeDate: "1980-12-12",
    isin: null,
    name: "Apple Inc.",
    listing: { ...tcs.listing, id: "listing-aapl", exchange: "NASDAQ", segment: "US_EQUITY", symbol: "AAPL", currency: "USD" },
    providerMappings: [{ ...tcs.providerMappings[0], provider: "SEC", providerInstrumentId: "0000320193", tradingSymbol: "AAPL" }],
  });
  check("US ticker remains the market quote reference", usIdentity.quoteRef, "AAPL");
  check("US catalogue rows retain USD", usIdentity.currency, "USD");
  checkTrue("a resolved catalogue identity is live-priced", usIdentity.livePriced);

  section("the priceability gate is server-side");
  const resolved = catalogPortfolioIdentity({
    ...tcs,
    catalogInstrumentId: "44444444-4444-4444-8444-444444444444",
    priceable: true,
    quoteChecked: true,
    quoteKey: "TCS.NS",
    quoteStale: false,
    firstTradeDate: "2004-08-25",
  });
  check("the engine-resolved quote key is stored, not the uppercased symbol", resolved.quoteRef, "TCS.NS");

  const unresolved = addableReference({
    ...tcs,
    catalogInstrumentId: "55555555-5555-4555-8555-555555555555",
    priceable: false,
    quoteChecked: true,
    quoteKey: null,
    quoteStale: false,
    firstTradeDate: null,
  });
  checkTrue("a listing with no accepted quote key is refused", !unresolved.ok);

  const dead = addableReference({
    ...tcs,
    catalogInstrumentId: "66666666-6666-4666-8666-666666666666",
    priceable: false,
    quoteChecked: true,
    quoteKey: "TATAMOTORS.NS",
    quoteStale: true,
    firstTradeDate: "2004-08-25",
  });
  checkTrue("a stale quote key cannot start a new holding", !dead.ok);

  let refusedServerSide = false;
  try {
    catalogPortfolioIdentity({
      ...tcs,
      catalogInstrumentId: "77777777-7777-4777-8777-777777777777",
      priceable: false,
      quoteChecked: true,
      quoteKey: null,
      quoteStale: false,
      firstTradeDate: null,
    });
  } catch {
    refusedServerSide = true;
  }
  checkTrue("resolveIdentity's mapper throws rather than fabricating a key", refusedServerSide);

  const catalogActionSource = readFileSync("app/(root)/investments/catalog-actions.ts", "utf8");
  checkTrue(
    "manual mode stores no fabricated quote key",
    !catalogActionSource.includes("quoteRef: input.symbol.toUpperCase()"),
  );
  checkTrue("manual mode is flagged as not live-priced", catalogActionSource.includes("livePriced: false"));

  done();
}

function preview(input: {
  side: "BUY" | "SELL";
  quantity: string;
  unitPrice: string;
  brokerage?: string;
  exchangeFees?: string;
  statutoryCharges?: string;
  taxWithheld?: string;
}): { ok: true; signedMinor: string; display: string } | { ok: false; message: string } {
  if (!/^\d+(\.\d{1,8})?$/.test(input.quantity) || !/^\d+(\.\d{1,2})?$/.test(input.unitPrice)) {
    return { ok: false, message: "Enter quantity and price." };
  }
  const quantity = scaled(input.quantity, 8);
  const price = scaled(input.unitPrice, 2);
  if (quantity <= 0n || price <= 0n) return { ok: false, message: "Quantity and price must be positive." };
  const consideration = divideHalfUp(quantity * price, 100_000_000n);
  const costs =
    rupees(input.brokerage) +
    rupees(input.exchangeFees) +
    rupees(input.statutoryCharges) +
    rupees(input.taxWithheld);
  const signed = input.side === "BUY" ? -(consideration + costs) : consideration - costs;
  return { ok: true, signedMinor: signed.toString(), display: `INR ${formatMinor(signed)}` };
}

function rupees(value: string | undefined): bigint {
  if (!value) return 0n;
  return scaled(value, 2);
}

function scaled(value: string, decimals: number): bigint {
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole + fraction.padEnd(decimals, "0"));
}

function divideHalfUp(numerator: bigint, denominator: bigint): bigint {
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  return remainder * 2n >= denominator ? quotient + 1n : quotient;
}

function formatMinor(value: bigint): string {
  const sign = value < 0n ? "-" : "";
  const abs = value < 0n ? -value : value;
  return `${sign}${abs / 100n}.${(abs % 100n).toString().padStart(2, "0")}`;
}

class SearchRefreshRepository extends CatalogQuoteKeyStubs implements InstrumentCatalogRepository {
  failureRecorded = false;

  constructor(private readonly rows: readonly CatalogCandidate[]) {
    super();
  }

  async latestSuccessfulFetch() {
    return this.rows.length > 0
      ? { source: "UPSTOX_PUBLIC", fetchedAt: now, checksum: "a".repeat(64), rowCount: this.rows.length }
      : null;
  }

  async latestFetchAttempt() {
    return null;
  }

  async recordFetchFailure() {
    this.failureRecorded = true;
  }

  async count() {
    return this.rows.length;
  }

  async ingest(_snapshot: CatalogSnapshot) {
    return { instruments: 0, listings: 0, mappings: 0, unmatchedMappings: 0 };
  }

  async search(query: string) {
    const matches = this.rows.filter(
      (candidate) => candidate.listing.symbol === query || candidate.isin === query,
    );
    return { candidates: matches, exactIdentifierMatches: matches };
  }

  async linkPortfolioInstrument(_input: {
    userId: UserId;
    portfolioInstrumentId: string;
    catalogInstrumentId: CatalogInstrumentId;
    listingId: string;
    linkedAt: Date;
  }) {
    return true;
  }
}

class FailingProvider implements InstrumentMasterProvider {
  readonly source = "UPSTOX_PUBLIC";
  calls = 0;

  async fetch() {
    this.calls += 1;
    return { ok: false as const, error: "UPSTOX_PUBLIC is unavailable." };
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

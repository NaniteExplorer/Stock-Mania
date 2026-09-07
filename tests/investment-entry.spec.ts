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
import { check, checkTrue, done, section } from "./harness";

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
  checkTrue("submit waits for a confirmed identity", formSource.includes("disabled={pending || !selection || accounts.length === 0}"));

  section("search refresh regression");
  const actionSource = readFileSync("app/(root)/investments/catalog-actions.ts", "utf8");
  const refreshIndex = actionSource.indexOf("instrumentCatalog.refresh.execute()");
  const searchIndex = actionSource.indexOf("instrumentCatalog.search.execute({ query, limit: 12 })");
  checkTrue("production search invokes refresh before local search", refreshIndex >= 0 && refreshIndex < searchIndex);
  const searchActionBody = actionSource.slice(
    actionSource.indexOf("export async function searchInstrumentCatalogAction"),
    actionSource.indexOf("export async function recordInvestmentEntryAction"),
  );
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

class SearchRefreshRepository implements InstrumentCatalogRepository {
  failureRecorded = false;

  constructor(private readonly rows: readonly CatalogCandidate[]) {}

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

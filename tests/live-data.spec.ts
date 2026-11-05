import { Count } from "@/core/units";
import { FixedClock, UserId } from "@/core/kernel";
import { Currency } from "@/core/money";
import { ViewLiveDataCenter } from "@/app/live-data.usecases";
import type { InstrumentCatalogRepository } from "@/domain/instrument-catalog";
import type { InstrumentRepository, MarketInstrument } from "@/domain/instruments";
import { CatalogQuoteKeyStubs } from "./doubles";
import { check, checkTrue, done, section } from "./harness";

const now = new Date("2026-09-06T04:00:00.000Z");
const userId = UserId.from("live-data-user");

const instrument = (input: {
  id: string;
  symbol: string;
  name: string;
  kind: "LISTED_EQUITY" | "MUTUAL_FUND";
  currency: "INR" | "USD";
}): MarketInstrument => ({
  id: { value: input.id },
  symbol: input.symbol,
  name: input.name,
  kind: input.kind,
  currency: Currency.of(input.currency),
}) as MarketInstrument;

class InstrumentFixture implements InstrumentRepository {
  constructor(private readonly rows: readonly MarketInstrument[]) {}
  async list() { return this.rows; }
  async findById() { return null; }
  async findBySymbol() { return null; }
  async isSymbolReserved() { return false; }
  async countTrades() { return Count(0); }
  async save() {}
  async softDelete() {}
}

class CatalogFixture extends CatalogQuoteKeyStubs implements InstrumentCatalogRepository {
  async latestSuccessfulFetch(source?: string) {
    return source === "AMFI_NAV"
      ? { source, fetchedAt: now, checksum: "a".repeat(64), rowCount: Count(1) }
      : null;
  }
  async latestFetchAttempt() { return null; }
  async recordFetchFailure() {}
  async count() { return Count(1); }
  async ingest() { return { instruments: Count(0), listings: Count(0), mappings: Count(0), unmatchedMappings: Count(0) }; }
  async search() { return { candidates: [], exactIdentifierMatches: [] }; }
  async linkPortfolioInstrument() { return true; }
}

async function main() {
  section("primitive provider readiness without secrets or execution");
  const view = new ViewLiveDataCenter(
    new InstrumentFixture([
      instrument({ id: "infy", symbol: "INFY", name: "Infosys", kind: "LISTED_EQUITY", currency: "INR" }),
      instrument({ id: "fund", symbol: "120503", name: "Test Fund", kind: "MUTUAL_FUND", currency: "INR" }),
      instrument({ id: "aapl", symbol: "AAPL", name: "Apple", kind: "LISTED_EQUITY", currency: "USD" }),
    ]),
    new CatalogFixture(),
    new FixedClock(now),
    { finnhubConfigured: true, zerodhaConfigured: false },
  );
  const output = await view.execute({ userId });
  check("Indian equity coverage", output.coverage.indianStocks, 1);
  check("Indian fund coverage", output.coverage.indianFunds, 1);
  check("US equity coverage", output.coverage.usStocks, 1);
  check("configured Finnhub is ready", output.providers.find((row) => row.id === "finnhub")?.state, "READY");
  check("missing Zerodha configuration is explicit", output.providers.find((row) => row.id === "zerodha")?.state, "CONFIG_REQUIRED");
  check("AMFI fetch provenance is exposed", output.providers.find((row) => row.id === "amfi")?.lastFetch, now.toISOString());
  check("USD tracking keeps USD", output.tracked.find((row) => row.symbol === "AAPL")?.currency, "USD");
  check("configured US current data marks the seam ready", output.tracked.find((row) => row.symbol === "AAPL")?.hftReady, true);
  check("mutual funds remain daily NAV", output.tracked.find((row) => row.symbol === "120503")?.preferredPriceFreshness, "NAV_DAILY");
  check("execution remains deferred", output.automationReadiness.find((row) => row.label.includes("HFT"))?.state, "DEFERRED");
  const serialized = JSON.stringify(output);
  checkTrue("the read model is serializable", serialized.length > 0);
  checkTrue(
    "provider credential values are never emitted",
    !serialized.includes("finnhub-fixture-value") && !serialized.includes("zerodha-fixture-value"),
  );
  checkTrue("no order capability is advertised", !output.providers.some((provider) => provider.capabilities.some((item) => /order/i.test(item))));

  section("catalogue-log failures stay isolated and explicit");
  const sourceProviders = [
    ["UPSTOX_PUBLIC", "upstox-public"], ["AMFI_NAV", "amfi"],
    ["SEC_COMPANY_TICKERS", "sec"], ["ZERODHA_CSV", "zerodha"],
  ];
  const marker = "private-catalog-connection-detail";
  class FaultingCatalog extends CatalogFixture {
    constructor(private readonly failures: readonly string[]) { super(); }
    override async latestSuccessfulFetch(source?: string) {
      if (this.failures.includes(source ?? "")) throw new Error(marker);
      return { source: source ?? "", fetchedAt: now, checksum: "b".repeat(64), rowCount: Count(2) };
    }
  }
  const tracked = [instrument({ id: "retained", symbol: "INFY", name: "Infosys", kind: "LISTED_EQUITY", currency: "INR" })];
  for (const failures of [...sourceProviders.map(([source]) => [source]), sourceProviders.map(([source]) => source)]) {
    const degraded = await new ViewLiveDataCenter(
      new InstrumentFixture(tracked), new FaultingCatalog(failures), new FixedClock(now),
      { finnhubConfigured: true, zerodhaConfigured: true },
    ).execute({ userId });
    const label = failures.join(",");
    check(`${label}: tracked holdings retained`, degraded.tracked[0]?.instrumentId, "retained");
    check(`${label}: unrelated provider stays ready`, degraded.providers.find((row) => row.id === "finnhub")?.state, "READY");
    for (const [source, id] of sourceProviders) {
      const row = degraded.providers.find((provider) => provider.id === id)!;
      if (failures.includes(source)) {
        check(`${label}/${id}: unavailable state`, row.state, "UNAVAILABLE");
        check(`${label}/${id}: unavailable freshness`, row.freshness, "UNAVAILABLE");
        check(`${label}/${id}: fetch unknown`, row.lastFetch, null);
        checkTrue(`${label}/${id}: unreadable reason visible`, row.limitations.some((text) => text.includes("unreadable")));
      } else {
        check(`${label}/${id}: successful receipt retained`, row.lastFetch, now.toISOString());
        check(`${label}/${id}: readiness retained`, row.state, "READY");
      }
    }
    check(`${label}: error details not serialized`, JSON.stringify(degraded).includes(marker), false);
    check(`${label}: unreadable not labelled never fetched`, JSON.stringify(degraded).includes("never succeeded"), false);
  }
  class BrokenInstruments extends InstrumentFixture {
    override async list(): Promise<readonly MarketInstrument[]> { throw new Error("portfolio read failed"); }
  }
  let portfolioFailure = "";
  try {
    await new ViewLiveDataCenter(new BrokenInstruments([]), new FaultingCatalog([]), new FixedClock(now),
      { finnhubConfigured: false, zerodhaConfigured: false }).execute({ userId });
  } catch (error) { portfolioFailure = (error as Error).message; }
  check("portfolio read failure propagates rather than becoming an empty portfolio", portfolioFailure, "portfolio read failed");

  section("Live Data Center route stays truthful and read-only");
  const page = readFileSync("app/(root)/investments/data/page.tsx", "utf8");
  const nav = readFileSync("app/(root)/investments/investment-nav.tsx", "utf8");
  const action = readFileSync("app/(root)/investments/actions.ts", "utf8");
  checkTrue("investment navigation reaches the data center", nav.includes('href: "/investments/data"'));
  checkTrue("page renders provider readiness", page.includes("Readiness, cost and freshness"));
  checkTrue("page renders India mutual-fund and US coverage", page.includes("Indian mutual funds") && page.includes("US stocks"));
  checkTrue("page states the execution boundary", page.includes("Automated execution, strategy loops and order placement are disabled"));
  checkTrue("only refresh is exposed from the data center", page.includes("<RefreshPricesButton") && !/placeOrder|submitOrder|executeStrategy/.test(page));
  checkTrue("portfolio refresh groups quote types", action.includes("refsByQuoteType"));

  done();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
import { readFileSync } from "node:fs";

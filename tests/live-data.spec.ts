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
  async countTrades() { return 0; }
  async save() {}
  async softDelete() {}
}

class CatalogFixture extends CatalogQuoteKeyStubs implements InstrumentCatalogRepository {
  async latestSuccessfulFetch(source?: string) {
    return source === "AMFI_NAV"
      ? { source, fetchedAt: now, checksum: "a".repeat(64), rowCount: 1 }
      : null;
  }
  async latestFetchAttempt() { return null; }
  async recordFetchFailure() {}
  async count() { return 1; }
  async ingest() { return { instruments: 0, listings: 0, mappings: 0, unmatchedMappings: 0 }; }
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

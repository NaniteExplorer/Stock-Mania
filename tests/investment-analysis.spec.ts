import { AccountId } from "@/domain/accounts";
import { ViewInvestmentAnalysis, ViewInvestmentTracker } from "@/app/investment-analysis.usecases";
import { FixedClock, UserId } from "@/core/kernel";
import { Currency } from "@/core/money";
import { UnitPrice } from "@/core/numeric";
import { CalendarDate } from "@/core/time";
import { Etf, InstrumentId, ListedEquity, type InstrumentRepository, type MarketInstrument } from "@/domain/instruments";
import { InMemoryBarRepository, InMemoryQuoteRepository } from "./doubles";
import { check, checkTrue, done, section } from "./harness";

const userId = UserId.from("analysis-owner");
const otherUserId = UserId.from("another-owner");
const now = new Date("2026-09-19T05:00:00.000Z");
const clock = new FixedClock(now);
const on = (date: string) => CalendarDate.parse(date);
const price = (value: number) => UnitPrice.of(String(value), Currency.INR);
const props = (id: string, symbol: string) => ({
  id: InstrumentId.from(id), userId, symbol, name: symbol, currency: Currency.INR,
  assetAccountId: AccountId.create(),
});
const stock = new ListedEquity(props("stock-1", "ACME"));
const goldEtf = new Etf(props("gold-etf-1", "GOLDBEES"), "GOLD");

class Instruments implements InstrumentRepository {
  constructor(private readonly rows: readonly MarketInstrument[]) {}
  async findById(requestedUser: UserId, id: InstrumentId) {
    if (!requestedUser.equals(userId)) return null;
    return this.rows.find((row) => row.id.equals(id)) ?? null;
  }
  async list(requestedUser: UserId) { return requestedUser.equals(userId) ? this.rows : []; }
  async findBySymbol() { return null; }
  async isSymbolReserved() { return false; }
  async save() {}
  async softDelete() {}
  async countTrades() { return 0; }
}

async function main() {
  const bars = new InMemoryBarRepository();
  const quotes = new InMemoryQuoteRepository();
  const instruments = new Instruments([stock, goldEtf]);
  for (let index = 0; index < 40; index += 1) {
    const close = 100 + index - (index === 25 ? 12 : 0);
    await bars.append([{
      instrumentId: stock.id.value, asOf: on("2026-08-01").plusDays(index), granularity: "DAY",
      open: price(close - 1), high: price(close + 1), low: price(close - 2), close: price(close),
      volume: 1000n + BigInt(index), currency: Currency.INR, providerId: "fixture", ingestedAt: now,
    }]);
  }

  section("semantic classification and domain-formula analysis");
  const analysis = new ViewInvestmentAnalysis(instruments, bars, clock);
  const all = await analysis.execute({ userId, from: on("2026-08-01"), through: on("2026-09-19") });
  check("gold ETF is metal exposure", all.rows.find((row) => row.instrumentId === goldEtf.id.value)?.assetFamily, "DIGITAL_METALS");
  const stockAnalysis = all.rows.find((row) => row.instrumentId === stock.id.value)!;
  check("forty bars are analysed", stockAnalysis.barsUsed, 40);
  check("SMA 20 is available", stockAnalysis.indicators.find((metric) => metric.name === "SMA(20)")?.status, "AVAILABLE");
  check("MACD histogram is available", stockAnalysis.indicators.find((metric) => metric.name.includes("histogram"))?.status, "AVAILABLE");
  check("period return fixture", stockAnalysis.periodReturn.status, "AVAILABLE");
  check("maximum drawdown uses the domain function", stockAnalysis.maximumDrawdown.status, "AVAILABLE");
  check("Bollinger position is available", stockAnalysis.bollingerPosition.status, "AVAILABLE");
  checkTrue("analysis output is primitive serializable", JSON.stringify(all).length > 0);

  section("insufficient history and tenant boundary");
  const sparse = await analysis.execute({ userId, instrumentId: goldEtf.id.value, from: on("2026-09-01"), through: on("2026-09-19") });
  check("empty selected history is explicit", sparse.rows[0].periodReturn.status, "UNAVAILABLE");
  let barReads = 0;
  const guardedBars = { ...bars, findRange: async (...args: Parameters<typeof bars.findRange>) => { barReads += 1; return bars.findRange(...args); } } as typeof bars;
  const guarded = new ViewInvestmentAnalysis(instruments, guardedBars, clock);
  const denied = await guarded.execute({ userId: otherUserId, instrumentId: stock.id.value, from: on("2026-08-01"), through: on("2026-09-19") });
  check("cross-tenant selection is indistinguishable from missing", denied.selection, "NOT_FOUND");
  check("bars are not read before ownership succeeds", barReads, 0);

  section("tracker health requires observations, entitlement and freshness");
  await quotes.append([
    { instrumentId: stock.id.value, asOf: on("2026-09-18"), quoteType: "CLOSE", price: price(120), providerId: "zerodha", sourceType: "BROKER", ingestedAt: new Date("2026-09-18T10:00:00Z") },
    { instrumentId: stock.id.value, asOf: on("2026-09-19"), quoteType: "CLOSE", price: price(123), providerId: "zerodha", sourceType: "BROKER", ingestedAt: new Date("2026-09-19T04:55:00Z") },
  ]);
  const configuredOnly = await new ViewInvestmentTracker(instruments, quotes, clock, { providerIds: [] })
    .execute({ userId, asOf: on("2026-09-19") });
  check("observation without entitlement is delayed, not live", configuredOnly.rows.find((row) => row.instrumentId === stock.id.value)?.freshness, "DELAYED");
  const entitled = await new ViewInvestmentTracker(instruments, quotes, clock, { providerIds: ["zerodha"] })
    .execute({ userId, asOf: on("2026-09-19") });
  check("entitlement and recent ingestion do not turn a close into live data", entitled.rows.find((row) => row.instrumentId === stock.id.value)?.freshness, "DELAYED");
  check("missing quote stays unavailable", entitled.rows.find((row) => row.instrumentId === goldEtf.id.value)?.availability, "UNAVAILABLE");
  check("missing quote exposes its data gap", entitled.rows.find((row) => row.instrumentId === goldEtf.id.value)?.dataGap, "NO_OBSERVATION");
  check("two observations support day movement", entitled.rows.find((row) => row.instrumentId === stock.id.value)?.dataGap, "NONE");
  checkTrue("tracker is primitive serializable", JSON.stringify(entitled).length > 0);

  let quoteReads = 0;
  const guardedQuotes = {
    ...quotes,
    findLatestOnOrBefore: async (...args: Parameters<typeof quotes.findLatestOnOrBefore>) => {
      quoteReads += 1;
      return quotes.findLatestOnOrBefore(...args);
    },
  } as typeof quotes;
  const otherTenantTracker = await new ViewInvestmentTracker(instruments, guardedQuotes, clock)
    .execute({ userId: otherUserId, asOf: on("2026-09-19") });
  check("another tenant receives no tracker rows", otherTenantTracker.rows.length, 0);
  check("quotes are not read without an owned instrument", quoteReads, 0);

  const unsafeProviderQuotes = new InMemoryQuoteRepository();
  await unsafeProviderQuotes.append([{
    instrumentId: stock.id.value, asOf: on("2026-09-19"), quoteType: "CLOSE", price: price(123),
    providerId: "<script>credential-like-metadata</script>", sourceType: "PROVIDER", ingestedAt: now,
  }]);
  const sanitized = await new ViewInvestmentTracker(instruments, unsafeProviderQuotes, clock)
    .execute({ userId, asOf: on("2026-09-19") });
  check("unsafe provider metadata is not emitted", sanitized.rows.find((row) => row.instrumentId === stock.id.value)?.providerId, "unknown");

  done();
}

void main();

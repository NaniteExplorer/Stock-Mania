/**
 * The benchmark shadow-portfolio replay.
 *
 * The claim under test is the one the table makes on screen: **every row received
 * the same rupees on the same dates, and differs only in what the money bought.**
 * That is easy to state and easy to break — an entry load applied to the wrong
 * side, a tax threshold read from the wrong category, a dead feed becoming a zero
 * instead of a blank — and each of those is asserted here rather than assumed.
 *
 * Every price is a fixture. **Nothing in this file touches the network**, and the
 * two external series arrive through a stub feed, which is what the port exists
 * for: a test that needs Yahoo to be up is not a test of this code.
 *
 * The arithmetic is checked against hand-computable numbers rather than against
 * whatever the implementation happened to produce. Where a figure is derived
 * (units bought after an entry load, tax at a term boundary), the expected value
 * is worked out in the comment above the assertion.
 */

import { UserId } from "@/core/kernel";
import { Currency, Money } from "@/core/money";
import { Percentage, Quantity, UnitPrice } from "@/core/numeric";
import { CalendarDate, DateRange } from "@/core/time";
import {
  DEFAULT_BENCHMARK_ASSUMPTIONS,
  GoldBenchmarkReplay,
  type BenchmarkSeriesFeed,
  type BenchmarkSeriesKey,
  type BenchmarkSeriesOutcome,
} from "@/app/gold-benchmark.usecases";
import { Institution, InstitutionId, type InstitutionRepository } from "@/domain/institutions";
import {
  InstrumentId,
  MarketInstrument,
  type InstrumentRepository,
} from "@/domain/instruments";
import type { LotRepository, TradeRecord } from "@/domain/lots";
import type { Quote, QuoteRepository, QuoteType } from "@/domain/pricing";
import { AmfiNavHistoryProvider } from "@/infra/providers";
import { AccountId } from "@/domain/accounts";
import { check, checkTrue, done, section } from "./harness";

const INR = Currency.INR;
const on = (value: string) => CalendarDate.parse(value);
const rupees = (value: string) => Money.fromRupees(value, INR);
const grams = (value: string) => Quantity.fromString(value);
const rate = (value: string) => UnitPrice.of(value, INR);

const userId = UserId.from("user_gold_benchmark_1");
const goldId = InstrumentId.from("11111111-1111-4111-8111-111111111111");
const platformId = InstitutionId.from("22222222-2222-4222-8222-222222222222");

/* ═══ Doubles — narrow on purpose ═════════════════════════════════════ */

/*
 * Each fake implements only what the use case calls and throws on everything
 * else. A fake that silently returns `[]` for a method the code was not supposed
 * to reach would turn "this use case quietly grew a dependency" into a passing
 * test.
 */
const unreachable = (name: string) => (): never => {
  throw new Error(`${name} should not be called by the benchmark replay`);
};

class StubInstruments implements InstrumentRepository {
  constructor(private readonly instrument: MarketInstrument | null) {}
  async findById() {
    return this.instrument;
  }
  findBySymbol = unreachable("findBySymbol") as InstrumentRepository["findBySymbol"];
  isSymbolReserved = unreachable("isSymbolReserved") as InstrumentRepository["isSymbolReserved"];
  list = unreachable("list") as InstrumentRepository["list"];
  save = unreachable("save") as InstrumentRepository["save"];
  softDelete = unreachable("softDelete") as InstrumentRepository["softDelete"];
  countTrades = unreachable("countTrades") as InstrumentRepository["countTrades"];
}

class StubLots implements LotRepository {
  constructor(private readonly trades: readonly TradeRecord[]) {}
  async tradesFor(): Promise<readonly TradeRecord[]> {
    return this.trades;
  }
  recordTrade = unreachable("recordTrade") as LotRepository["recordTrade"];
  openLots = unreachable("openLots") as LotRepository["openLots"];
  allLots = unreachable("allLots") as LotRepository["allLots"];
  saveLots = unreachable("saveLots") as LotRepository["saveLots"];
  saveDisposals = unreachable("saveDisposals") as LotRepository["saveDisposals"];
  disposalsWithin = unreachable("disposalsWithin") as LotRepository["disposalsWithin"];
  findTrade = unreachable("findTrade") as LotRepository["findTrade"];
  lotsFromBuy = unreachable("lotsFromBuy") as LotRepository["lotsFromBuy"];
  matchesForSell = unreachable("matchesForSell") as LotRepository["matchesForSell"];
  matchesAgainstLot = unreachable("matchesAgainstLot") as LotRepository["matchesAgainstLot"];
  voidTrade = unreachable("voidTrade") as LotRepository["voidTrade"];
}

class StubQuotes implements QuoteRepository {
  constructor(private readonly quotes: readonly Quote[]) {}
  async findLatestOnOrBefore(
    _instrumentId: string,
    quoteType: QuoteType,
    asOf: CalendarDate,
    limit = 1,
  ): Promise<readonly Quote[]> {
    return this.quotes
      .filter((quote) => quote.quoteType === quoteType && quote.asOf.isOnOrBefore(asOf))
      .sort((a, b) => b.asOf.compareTo(a.asOf))
      .slice(0, limit);
  }
  async findRange(
    _instrumentId: string,
    quoteType: QuoteType,
    range: DateRange,
  ): Promise<readonly Quote[]> {
    return this.quotes.filter(
      (quote) => quote.quoteType === quoteType && range.contains(quote.asOf),
    );
  }
  append = unreachable("append") as QuoteRepository["append"];
  supersede = unreachable("supersede") as QuoteRepository["supersede"];
  coverage = unreachable("coverage") as QuoteRepository["coverage"];
  recordDivergence = unreachable("recordDivergence") as QuoteRepository["recordDivergence"];
}

class StubPlatforms implements InstitutionRepository {
  constructor(private readonly institution: Institution | null) {}
  async findById() {
    return this.institution;
  }
  findByName = unreachable("findByName") as InstitutionRepository["findByName"];
  list = unreachable("list") as InstitutionRepository["list"];
  save = unreachable("save") as InstitutionRepository["save"];
  softDelete = unreachable("softDelete") as InstitutionRepository["softDelete"];
}

/** A feed whose answers are written by the test, never fetched. */
class StubFeed implements BenchmarkSeriesFeed {
  calls = 0;
  constructor(private readonly answers: Record<string, BenchmarkSeriesOutcome>) {}
  async load(request: { keys: readonly BenchmarkSeriesKey[] }) {
    this.calls += 1;
    const map = new Map<BenchmarkSeriesKey, BenchmarkSeriesOutcome>();
    for (const key of request.keys) {
      const answer = this.answers[key];
      if (answer) map.set(key, answer);
    }
    return map;
  }
}

const series = (
  key: BenchmarkSeriesKey,
  symbol: string,
  points: readonly [string, string][],
): BenchmarkSeriesOutcome => ({
  ok: true,
  series: {
    key,
    symbol,
    sourceId: "fixture",
    points: points.map(([date, value]) => ({ on: on(date), price: rate(value) })),
  },
});

const quote = (date: string, value: string): Quote => ({
  instrumentId: goldId.value,
  asOf: on(date),
  quoteType: "CLOSE",
  price: rate(value),
  providerId: "fixture",
  sourceType: "MANUAL",
  ingestedAt: new Date("2026-09-05T00:00:00Z"),
});

const buy = (props: {
  id: string;
  on: string;
  grams: string;
  price: string;
  charges: string;
  settled?: boolean;
}): TradeRecord => ({
  id: props.id,
  instrumentId: goldId,
  side: "BUY",
  tradedOn: on(props.on),
  quantity: grams(props.grams),
  pricePerUnit: rupees(props.price),
  charges: rupees(props.charges),
  transactionId: `txn_${props.id}`,
  settlementAccountId: props.settled === false ? null : "44444444-4444-4444-8444-444444444444",
});

const digitalGold = MarketInstrument.of("DIGITAL_GOLD", {
  id: goldId,
  userId,
  symbol: "SGOLD",
  name: "SafeGold 24k",
  currency: INR,
  assetAccountId: AccountId.from("33333333-3333-4333-8333-333333333333"),
  institutionId: platformId,
});

const platform = new Institution({
  id: platformId,
  userId,
  name: "SafeGold",
  kind: "BULLION",
  sellSpread: Percentage.of("5"),
});

/* ═══ The scenario ════════════════════════════════════════════════════ */

/*
 * Two purchases, deliberately straddling gold's 730-day long-term threshold as at
 * 2026-09-05:
 *
 *   2024-01-15  10g at ₹6,000 + ₹1,800 charges = ₹61,800   →  599 days short of
 *               the threshold?  No: 2024-01-15 → 2026-09-05 is 964 days. LONG.
 *   2025-06-16   5g at ₹8,000 + ₹1,200 charges = ₹41,200   →  446 days. SHORT.
 *
 * Total invested: ₹1,03,000. Every row below receives exactly that, on exactly
 * those two dates.
 */
const TRADES: readonly TradeRecord[] = [
  buy({ id: "t1", on: "2024-01-15", grams: "10", price: "6000", charges: "1800" }),
  buy({ id: "t2", on: "2025-06-16", grams: "5", price: "8000", charges: "1200" }),
  // A lease accrual: grams credited, no cash account settled. It must not become
  // rupees handed to the shadow portfolios.
  buy({ id: "t3", on: "2025-09-01", grams: "0.5", price: "8500", charges: "0", settled: false }),
];

const GRAM_QUOTES: readonly Quote[] = [
  quote("2024-01-15", "6000"),
  quote("2025-06-16", "8000"),
  quote("2026-09-04", "9000"),
];

const ASOF = on("2026-09-05");

const replay = (props: {
  feed?: BenchmarkSeriesFeed;
  trades?: readonly TradeRecord[];
  quotes?: readonly Quote[];
  platform?: Institution | null;
}) =>
  new GoldBenchmarkReplay(
    new StubInstruments(digitalGold),
    new StubLots(props.trades ?? TRADES),
    new StubQuotes(props.quotes ?? GRAM_QUOTES),
    new StubPlatforms(props.platform === undefined ? platform : props.platform),
    props.feed ??
      new StubFeed({
        GOLD_ETF: series("GOLD_ETF", "GOLDBEES.NS", [
          ["2024-01-15", "50"],
          ["2025-06-16", "66"],
          ["2026-09-04", "75"],
        ]),
        NIFTY_50: series("NIFTY_50", "^NSEI", [
          ["2024-01-15", "21600"],
          ["2025-06-16", "24800"],
          ["2026-09-04", "27000"],
        ]),
      }),
  );

async function main() {
  section("the same money, on the same dates, into every vehicle");

  const result = await replay({}).execute({ userId, instrumentId: goldId, asOf: ASOF });
  checkTrue("the comparison loads", result.ok);
  if (!result.ok) return done();
  const value = result.value;

  check("two dated outflows, not three", value.outflows.length, 2);
  check(
    "the lease accrual is not money the user paid",
    value.outflows.some((flow) => flow.on.toISO() === "2025-09-01"),
    false,
  );
  check("10g × ₹6,000 + ₹1,800", value.outflows[0].amount.toDecimalString(), "61800.00");
  check("5g × ₹8,000 + ₹1,200", value.outflows[1].amount.toDecimalString(), "41200.00");

  const rows = value.rows;
  check("the user's own holding leads the table", rows[0].key, "ACTUAL");
  checkTrue(
    "every row was handed the identical amount",
    rows.every((row) => row.invested.toDecimalString() === "103000.00"),
  );
  check(
    "and it is what was actually paid",
    rows[0].invested.toDecimalString(),
    "103000.00",
  );
  check("the holding is its own baseline", rows[0].versusHolding?.toDecimalString(), "0.00");

  section("the actual holding is valued at the buy-back rate, not the benchmark");

  /*
   * 15g held (the 0.5g lease credit is excluded, like every other non-cash
   * event), benchmark ₹9,000/g, 5% spread → ₹8,550/g realisable.
   * 15 × 8,550 = ₹1,28,250.
   */
  check("15 bought grams", rows[0].unitsHeld?.toDecimalString(), "15");
  check("at the 5%-discounted rate", rows[0].terminalValue?.toDecimalString(), "128250.00");
  checkTrue("and the note says so", rows[0].entryCostNote.includes("5.00%"));

  section("tax comes from the regime, per dated purchase");

  const actualTax = rows[0].tax!;
  check("gold's long-term threshold is the regime's", actualTax.longTermDays, 730);
  check("at the regime's long-term rate", actualTax.longTermRate.toFixed(2), "12.50");
  check("with no short-term rate in statute, the slab is used", actualTax.shortTermIsSlab, true);
  check("which is the assumption's", actualTax.shortTermRate.toFixed(2), "30.00");
  check("and gold has no exemption limit", actualTax.exemption, null);
  /*
   * Parcel 1: 10g × ₹8,550 = ₹85,500 against ₹61,800 → +₹23,700, held 964 days
   *           → long-term.
   * Parcel 2:  5g × ₹8,550 = ₹42,750 against ₹41,200 → +₹1,550, held 446 days
   *           → short-term.
   * Tax = 12.5% × 23,700 + 30% × 1,550 = 2,962.50 + 465.00 = ₹3,427.50
   */
  check("the older parcel is long-term", actualTax.longTermGain.toDecimalString(), "23700.00");
  check("the newer one is not", actualTax.shortTermGain.toDecimalString(), "1550.00");
  check("so the tax is the two rates on the two parcels", rows[0].taxDue?.toDecimalString(), "3427.50");
  check(
    "post-tax terminal wealth follows",
    rows[0].postTaxTerminalValue?.toDecimalString(),
    "124822.50",
  );
  checkTrue("and the return is a real rate", rows[0].postTaxXirr.ok);

  section("a gold ETF is taxed at gold's rate over the listed holding period");

  const etf = rows.find((row) => row.key === "GOLD_ETF")!;
  check("twelve months, not twenty-four", etf.tax?.longTermDays, 365);
  check("but still gold's 12.5%", etf.tax?.longTermRate.toFixed(2), "12.50");
  check("and no equity exemption", etf.tax?.exemption, null);
  // Both parcels are more than 365 days old, so nothing is short-term here even
  // though the second parcel was short-term for the digital-gold row.
  check("so both parcels are long-term", etf.tax?.shortTermGain.toDecimalString(), "0.00");

  section("the Nifty gets equity treatment, exemption and all");

  const nifty = rows.find((row) => row.key === "NIFTY_50")!;
  check("the equity long-term rate", nifty.tax?.longTermRate.toFixed(2), "12.50");
  check("the equity short-term rate, from the regime not the slab", nifty.tax?.shortTermRate.toFixed(2), "20.00");
  check("the regime's own exemption limit", nifty.tax?.exemption?.toDecimalString(), "125000.00");
  check("which is not a hardcoded slab", nifty.tax?.shortTermIsSlab, false);

  section("entry cost is charged, and it is what makes the physical rows differ");

  const coin = rows.find((row) => row.key === "PHYSICAL_COIN")!;
  const jewellery = rows.find((row) => row.key === "PHYSICAL_JEWELLERY")!;
  /*
   * Coin: 4% premium + 3% GST on (100 + 4) = 4 + 3.12 → 7.12% all-in.
   * Jewellery: 12% making + 3% GST on metal + 5% GST on the making
   *            = 12 + 3 + 0.6 → 15.60%.
   */
  checkTrue("a coin costs a premium plus GST", coin.entryCostNote.includes("7.12%"));
  checkTrue("jewellery costs making plus two GST rates", jewellery.entryCostNote.includes("15.60%"));
  checkTrue(
    "so the same rupees buy fewer grams as jewellery than as a coin",
    jewellery.unitsHeld!.compareTo(coin.unitsHeld!) < 0,
  );
  checkTrue(
    "and the ornament is worth less than the coin at the end",
    jewellery.postTaxTerminalValue!.isLessThan(coin.postTaxTerminalValue!),
  );
  checkTrue(
    "the making charge is named as unrecoverable",
    jewellery.entryCostNote.includes("not recoverable"),
  );
  /*
   * The coin's entry load is 7.12% but the digital-gold trades already carried
   * their GST inside `charges` (₹1,800 on ₹60,000 is 3%), so the coin buys fewer
   * grams than the holding did — which is the whole point of charging entry cost.
   */
  checkTrue(
    "physical gold buys fewer grams than the platform did",
    coin.unitsHeld!.compareTo(rows[0].unitsHeld!) < 0,
  );

  section("the deposit needs no feed, and is taxed at slab whatever the term");

  const fd = rows.find((row) => row.key === "BANK_FD")!;
  check("a deposit holds no units", fd.unitsHeld, null);
  check("no holding-period benefit exists for it", fd.tax?.longTermDays, null);
  check("it is slab income", fd.tax?.shortTermIsSlab, true);
  checkTrue("it grew", fd.terminalValue!.isGreaterThan(rupees("103000")));
  checkTrue("it was taxed", fd.taxDue!.isPositive);
  checkTrue(
    "and 7% quarterly compounding over ~2.5 years is a plausible ₹1.16-1.20 lakh",
    fd.terminalValue!.isGreaterThan(rupees("116000")) &&
      fd.terminalValue!.isLessThan(rupees("120000")),
  );
  checkTrue("TDS is explained as a credit, not a cost", fd.tax!.note.includes("194A"));

  section("every row is comparable to the holding, and the sign is meaningful");

  for (const row of rows) {
    check(
      `${row.key}: the difference is post-tax wealth less the holding's`,
      row.versusHolding?.toDecimalString(),
      row.postTaxTerminalValue!.minus(rows[0].postTaxTerminalValue!).toDecimalString(),
    );
  }

  section("SGB is absent with its real reason, not an empty column");

  const sgb = value.unavailable.find((entry) => entry.key === "SGB")!;
  checkTrue("SGB never appears as a row", rows.every((row) => row.key !== "SGB"));
  checkTrue("the reason names the NSE block", sgb.because.includes("403"));
  checkTrue("and the Yahoo gap", sgb.because.includes("Yahoo"));
  checkTrue("and it is a sentence, not a code", sgb.because.length > 80);

  section("the basis says what the table does not model");

  checkTrue("sales are declared excluded", value.basis.includes("Sales and lease credits"));
  checkTrue("the regime is named", value.basis.includes("IN-FY2025"));
  checkTrue("and the expense-ratio omission is admitted", value.basis.includes("expense ratio"));

  section("a dead feed costs one row, never the page");

  const outage = await replay({
    feed: new StubFeed({
      GOLD_ETF: { ok: false, because: "Yahoo is failing (503)." },
      NIFTY_50: series("NIFTY_50", "^NSEI", [
        ["2024-01-15", "21600"],
        ["2026-09-04", "27000"],
      ]),
    }),
  }).execute({ userId, instrumentId: goldId, asOf: ASOF });
  checkTrue("the comparison still loads", outage.ok);
  if (!outage.ok) return done();
  check(
    "the ETF is not a zero row",
    outage.value.rows.some((row) => row.key === "GOLD_ETF"),
    false,
  );
  checkTrue(
    "it is an absence with the upstream's own reason",
    (outage.value.unavailable.find((entry) => entry.key === "GOLD_ETF")?.because ?? "").includes("503"),
  );
  checkTrue(
    "and the rest of the table survives",
    outage.value.rows.some((row) => row.key === "NIFTY_50"),
  );

  section("a series that starts after the first purchase is refused, not extrapolated");

  const shortSeries = await replay({
    feed: new StubFeed({
      GOLD_ETF: series("GOLD_ETF", "GOLDBEES.NS", [
        ["2025-01-01", "60"],
        ["2026-09-04", "75"],
      ]),
      NIFTY_50: series("NIFTY_50", "^NSEI", [["2024-01-15", "21600"], ["2026-09-04", "27000"]]),
    }),
  }).execute({ userId, instrumentId: goldId, asOf: ASOF });
  if (!shortSeries.ok) return done();
  const refused = shortSeries.value.unavailable.find((entry) => entry.key === "GOLD_ETF")!;
  checkTrue("the row is left out", shortSeries.value.rows.every((row) => row.key !== "GOLD_ETF"));
  checkTrue("naming the date it reaches back to", refused.because.includes("2025-01-01"));
  checkTrue("and the purchase it cannot price", refused.because.includes("2024-01-15"));

  section("no price at all is a blank, never a zero");

  const unpriced = await replay({ quotes: [] }).execute({
    userId,
    instrumentId: goldId,
    asOf: ASOF,
  });
  if (!unpriced.ok) return done();
  const actualUnpriced = unpriced.value.rows[0];
  check("still the first row", actualUnpriced.key, "ACTUAL");
  check("with no terminal value", actualUnpriced.terminalValue, null);
  check("and no tax on a value we do not have", actualUnpriced.taxDue, null);
  check("the return is undefined, not zero", actualUnpriced.postTaxXirr.ok, false);
  checkTrue(
    "physical gold goes to the unavailable list with a reason",
    (unpriced.value.unavailable.find((entry) => entry.key === "PHYSICAL_COIN")?.because ?? "").length > 40,
  );

  section("no purchases means nothing is claimed");

  const empty = await replay({ trades: [] }).execute({
    userId,
    instrumentId: goldId,
    asOf: ASOF,
  });
  if (!empty.ok) return done();
  check("the holding row is still there", empty.value.rows[0].key, "ACTUAL");
  check("with no invented value", empty.value.rows[0].terminalValue, null);
  check("and a typed reason for the missing rate", empty.value.rows[0].postTaxXirr.ok, false);
  check(
    "the deposit does not compound nothing into something",
    empty.value.rows.find((row) => row.key === "BANK_FD")?.terminalValue,
    null,
  );

  section("assumptions are inputs with defaults, and overriding one moves the answer");

  check("the shipped GST is 3%", DEFAULT_BENCHMARK_ASSUMPTIONS.metalGstPercent.toFixed(2), "3.00");
  const richer = await replay({}).execute({
    userId,
    instrumentId: goldId,
    asOf: ASOF,
    assumptions: { makingChargePercent: Percentage.of("25") },
  });
  if (!richer.ok) return done();
  const dearJewellery = richer.value.rows.find((row) => row.key === "PHYSICAL_JEWELLERY")!;
  checkTrue(
    "a 25% making charge buys materially fewer grams",
    dearJewellery.unitsHeld!.compareTo(jewellery.unitsHeld!) < 0,
  );
  check(
    "and the assumptions used are reported back",
    richer.value.assumptions.makingChargePercent.toFixed(2),
    "25.00",
  );

  section("a spreadless platform says the row is flattered rather than pretending");

  const noSpread = await replay({ platform: null }).execute({
    userId,
    instrumentId: goldId,
    asOf: ASOF,
  });
  if (!noSpread.ok) return done();
  // 15g × ₹9,000 benchmark, undiscounted.
  check(
    "valued at the benchmark",
    noSpread.value.rows[0].terminalValue?.toDecimalString(),
    "135000.00",
  );
  checkTrue(
    "and it admits the flattery",
    noSpread.value.rows[0].entryCostNote.includes("flattered"),
  );

  section("the AMFI history report parses past its own section headings");

  /*
   * The real report interleaves bare section-heading lines between scheme rows,
   * and its column order is not the daily file's. Both are exercised here: a
   * parser that assumed a fixed index would return the repurchase price, and one
   * that assumed every line is a scheme would read the heading as a fund.
   */
  const report = [
    "Scheme Code;Scheme Name;ISIN Div Payout/ISIN Growth;ISIN Div Reinvestment;Net Asset Value;Repurchase Price;Sale Price;Date",
    "",
    "Open Ended Schemes ( Exchange Traded Funds (ETFs) - Gold ETF )",
    "",
    "Nippon India Mutual Fund",
    "",
    "101234;Nippon India ETF Gold BeES;INF204KB17I5;-;74.5612;74.4000;74.6000;03-Sep-2026",
    "101234;Nippon India ETF Gold BeES;INF204KB17I5;-;75.1200;75.0000;75.2000;04-Sep-2026",
    "999999;Some Other Scheme;INF000000000;-;12.3456;12.30;12.40;04-Sep-2026",
    "",
  ].join("\n");

  const parsed = AmfiNavHistoryProvider.parseReport(report);
  check("three data rows, no headings", parsed.length, 3);
  check("the NAV column, not the repurchase price", parsed[0].nav, "74.5612");
  check("dated from the report's own column", parsed[0].on.toISO(), "2026-09-03");
  check("and the scheme code is kept as text", parsed[1].schemeCode, "101234");
  check("a report with no header yields nothing rather than guessing", AmfiNavHistoryProvider.parseReport("junk").length, 0);
  check(
    "the endpoint's date format is DD-Mon-YYYY",
    AmfiNavHistoryProvider.formatDate(on("2026-09-05")),
    "05-Sep-2026",
  );

  done();
}

void main();

import { Money } from "@/core/money";
import { Percentage } from "@/core/numeric";
import { CalendarDate, FinancialYear } from "@/core/time";
import {
  TaxEngine,
  RegimeRegistry,
  IndiaFY2024,
  IndiaFY2025,
  NoRegimeError,
  type CarryForward,
  type TaxableEvent,
  type TaxSettings,
} from "@/domain/tax";
import { check, section, done, throws } from "./harness";

/**
 * Tax engine golden fixtures.
 *
 * Every expected number below is hand-computed in the comment above it. That is
 * the whole point of a golden fixture — an engine agreeing with itself proves
 * nothing, and a tax figure nobody can derive by hand is not defensible.
 *
 * The gate for this item is `equity-grandfathered`: a pre-2018 equity holding
 * sold today must report `gain ≠ taxable`.
 */

const engine = new TaxEngine();
const rupees = (m: Money) => m.toDecimalString();

const SETTINGS: TaxSettings = {
  slabRate: Percentage.of("30"),
  totalIncome: Money.fromRupees("1500000"), // below the surcharge bands
  residentStatus: "RESIDENT",
};

let seq = 0;
const disposal = (over: Partial<TaxableEvent> = {}): TaxableEvent => {
  seq += 1;
  const proceeds = over.proceeds ?? Money.fromRupees("120000");
  const cost = over.costBasis ?? Money.fromRupees("100000");
  return {
    id: `event-${seq}`,
    kind: "CAPITAL_GAIN",
    onDate: CalendarDate.parse("2025-09-10"),
    taxCategory: "LISTED_EQUITY",
    instrumentId: "INFY",
    acquiredOn: CalendarDate.parse("2025-04-10"),
    holdingDays: 153,
    proceeds,
    costBasis: cost,
    gain: proceeds.minus(cost),
    deductibleCharges: Money.zero(),
    fmvOnGrandfatherDate: null,
    sourceTransactionId: `txn-${seq}`,
    sourceLotId: `lot-${seq}`,
    ...over,
  };
};

const assess = (events: TaxableEvent[], fy = "2025-26", brought?: CarryForward[]) =>
  engine.assess(FinancialYear.parse(fy), events, SETTINGS, {
    broughtForwardLosses: brought,
  });

const rateLine = (a: ReturnType<typeof assess>, index = 0) =>
  a.lines.filter((l) => l.rule === "IN.APPLY_RATE")[index];

section("equity-stcg-fy2025 — 100 shares, ₹1,000 to ₹1,200, held 153 days");

/*
 * proceeds  ₹1,20,000   cost ₹1,00,000   gain ₹20,000
 * 153 days < 365, so short-term. FY2025 equity STCG is 20%.
 *   tax   20% of 20,000 = 4,000.00
 *   cess  4%  of  4,000 =   160.00
 *   total                  4,160.00
 */
const stcg = assess([disposal()]);
check("regime selected", stcg.regime, "IN-FY2025");
check("term", rateLine(stcg).term, "SHORT_TERM");
check("gain", rupees(rateLine(stcg).gain), "20000.00");
check("taxable equals gain when no relief applies", rupees(rateLine(stcg).taxableAmount), "20000.00");
check("rate", rateLine(stcg).rate.toFixed(2), "20.00");
check("tax", rupees(rateLine(stcg).tax), "4000.00");
check("cess", rupees(stcg.cess), "160.00");
check("total tax", rupees(stcg.totalTax), "4160.00");

section("equity-ltcg-under-exemption — gain ₹1,00,000 held 400 days");

/*
 * Long-term equity. The ₹1,25,000 exemption covers the whole gain.
 *   taxable 0, tax 0, exemption consumed 1,00,000, remaining 25,000
 */
const underExemption = assess([
  disposal({
    proceeds: Money.fromRupees("200000"),
    costBasis: Money.fromRupees("100000"),
    gain: Money.fromRupees("100000"),
    holdingDays: 400,
    acquiredOn: CalendarDate.parse("2024-08-01"),
  }),
]);
check("term", rateLine(underExemption).term, "LONG_TERM");
check("gain is still reported in full", rupees(rateLine(underExemption).gain), "100000.00");
check("taxable is nil after the exemption", rupees(rateLine(underExemption).taxableAmount), "0.00");
check("tax", rupees(rateLine(underExemption).tax), "0.00");
check("exemption consumed", rupees(underExemption.exemptionUsed), "100000.00");

section("equity-ltcg-over-exemption — gain ₹2,00,000 held 400 days");

/*
 *   gain          2,00,000
 *   exemption     1,25,000
 *   taxable         75,000
 *   tax   12.5% of 75,000 = 9,375.00
 *   cess  4%   of  9,375  =   375.00
 *   total                   9,750.00
 */
const overExemption = assess([
  disposal({
    proceeds: Money.fromRupees("300000"),
    costBasis: Money.fromRupees("100000"),
    gain: Money.fromRupees("200000"),
    holdingDays: 400,
    acquiredOn: CalendarDate.parse("2024-08-01"),
  }),
]);
check("taxable after exemption", rupees(rateLine(overExemption).taxableAmount), "75000.00");
check("rate", rateLine(overExemption).rate.toFixed(2), "12.50");
check("tax", rupees(rateLine(overExemption).tax), "9375.00");
check("cess", rupees(overExemption.cess), "375.00");
check("total tax", rupees(overExemption.totalTax), "9750.00");

section("equity-ltcg-exemption-shared — two disposals compete for one exemption");

/*
 * First gain 1,00,000 consumes 1,00,000 of the 1,25,000 and is taxed on nil.
 * Second gain 80,000 finds only 25,000 left, so 55,000 is taxable.
 * This is why event ordering is deterministic: the answer depends on it.
 */
const shared = assess([
  disposal({
    onDate: CalendarDate.parse("2025-06-01"),
    proceeds: Money.fromRupees("200000"),
    costBasis: Money.fromRupees("100000"),
    gain: Money.fromRupees("100000"),
    holdingDays: 400,
    acquiredOn: CalendarDate.parse("2024-04-01"),
    instrumentId: "AAA",
  }),
  disposal({
    onDate: CalendarDate.parse("2025-09-01"),
    proceeds: Money.fromRupees("180000"),
    costBasis: Money.fromRupees("100000"),
    gain: Money.fromRupees("80000"),
    holdingDays: 400,
    acquiredOn: CalendarDate.parse("2024-04-01"),
    instrumentId: "BBB",
  }),
]);
check("first disposal is fully exempt", rupees(rateLine(shared, 0).taxableAmount), "0.00");
check("second disposal sees only the remainder", rupees(rateLine(shared, 1).taxableAmount), "55000.00");
check("exemption fully consumed", rupees(shared.exemptionUsed), "125000.00");
check("tax on the remainder", rupees(rateLine(shared, 1).tax), "6875.00");

section("equity-grandfathered — THE GATE: gain must differ from taxable");

/*
 * Bought 2015-06-01: 1,000 shares at ₹100 = cost ₹1,00,000
 * FMV on 2018-01-31: ₹400 a share       = ₹4,00,000
 * Sold  2025-08-01 at ₹900 a share      = proceeds ₹9,00,000
 *
 *   gain           = 9,00,000 − 1,00,000 = 8,00,000   (economic, unchanged)
 *   adjustedBasis  = max(cost, min(fmv, proceeds))
 *                  = max(1,00,000, min(4,00,000, 9,00,000)) = 4,00,000
 *   taxable        = 9,00,000 − 4,00,000 = 5,00,000
 *   less exemption                       − 1,25,000
 *                                        = 3,75,000
 *   tax  12.5% of 3,75,000 = 46,875.00
 *   cess 4%    of 46,875   =  1,875.00
 *   total                    48,750.00
 */
const grandfathered = assess([
  disposal({
    onDate: CalendarDate.parse("2025-08-01"),
    acquiredOn: CalendarDate.parse("2015-06-01"),
    holdingDays: 3714,
    proceeds: Money.fromRupees("900000"),
    costBasis: Money.fromRupees("100000"),
    gain: Money.fromRupees("800000"),
    fmvOnGrandfatherDate: Money.fromRupees("400000"),
  }),
]);
const gfLine = rateLine(grandfathered);
check("gain is the economic gain", rupees(gfLine.gain), "800000.00");
check("taxable is after step-up and exemption", rupees(gfLine.taxableAmount), "375000.00");
// The gate, asserted as a line of code rather than left as an inference.
check("gain !== taxable", gfLine.gain.minor === gfLine.taxableAmount.minor, false);
check("tax", rupees(gfLine.tax), "46875.00");
check("cess", rupees(grandfathered.cess), "1875.00");
check("total tax", rupees(grandfathered.totalTax), "48750.00");
check(
  "the step-up names its own rule",
  grandfathered.lines.some((l) => l.rule === "IN.GRANDFATHERING_2018"),
  true,
);
check(
  "and records the fair value it used",
  grandfathered.lines.find((l) => l.rule === "IN.GRANDFATHERING_2018")?.inputs.adjustedBasis,
  "400000.00",
);

section("equity-grandfathered-capped — the step-up cannot exceed the sale price");

/*
 * Same holding, sold at ₹300 a share = proceeds ₹3,00,000.
 *   adjustedBasis = max(1,00,000, min(4,00,000, 3,00,000)) = 3,00,000
 *   taxable       = 3,00,000 − 3,00,000 = 0
 *   gain          = 3,00,000 − 1,00,000 = 2,00,000
 * Without the inner min(), the basis would be 4,00,000 and the sale would
 * manufacture a ₹1,00,000 loss that never happened.
 */
const capped = assess([
  disposal({
    onDate: CalendarDate.parse("2025-08-01"),
    acquiredOn: CalendarDate.parse("2015-06-01"),
    holdingDays: 3714,
    proceeds: Money.fromRupees("300000"),
    costBasis: Money.fromRupees("100000"),
    gain: Money.fromRupees("200000"),
    fmvOnGrandfatherDate: Money.fromRupees("400000"),
  }),
]);
check("gain is real", rupees(rateLine(capped).gain), "200000.00");
check("but nothing is taxable", rupees(rateLine(capped).taxableAmount), "0.00");
check("and no loss was manufactured", rateLine(capped).taxableAmount.isNegative, false);
check(
  "the cap is recorded",
  capped.lines.find((l) => l.rule === "IN.GRANDFATHERING_2018")?.inputs.cappedAtProceeds,
  "yes",
);

section("debt-indexed-legacy — indexation under FY2024");

/*
 * Bought 2019-06-01 for ₹5,00,000 (CII 2019-20 = 289)
 * Sold  2023-03-15 for ₹6,00,000 (CII 2022-23 = 331)
 *
 *   indexedCost = 5,00,000 × 331 / 289 = 5,72,664.36 (HALF_UP) -> 5,72,664.36
 *   taxable     = 6,00,000 − 5,72,664.36 = 27,335.64
 *   gain        = 6,00,000 − 5,00,000    = 1,00,000
 *   tax  20% of 27,335.64 = 5,467.13
 */
const indexed = assess(
  [
    disposal({
      taxCategory: "DEBT_LEGACY",
      onDate: CalendarDate.parse("2023-03-15"),
      acquiredOn: CalendarDate.parse("2019-06-01"),
      holdingDays: 1383,
      proceeds: Money.fromRupees("600000"),
      costBasis: Money.fromRupees("500000"),
      gain: Money.fromRupees("100000"),
    }),
  ],
  "2022-23",
);
check("the older regime is selected", indexed.regime, "IN-FY2024");
check("gain is the unindexed gain", rupees(rateLine(indexed).gain), "100000.00");
check("taxable is after indexation", rupees(rateLine(indexed).taxableAmount), "27335.64");
check("gain !== taxable", rateLine(indexed).gain.minor === rateLine(indexed).taxableAmount.minor, false);
check("rate is 20%", rateLine(indexed).rate.toFixed(2), "20.00");
check("tax", rupees(rateLine(indexed).tax), "5467.13");
check(
  "both index values are recorded",
  `${indexed.lines.find((l) => l.rule === "IN.INDEXATION_CII")?.inputs.ciiBuy}/${
    indexed.lines.find((l) => l.rule === "IN.INDEXATION_CII")?.inputs.ciiSell
  }`,
  "289/331",
);

section("debt-post-2023-slab — no indexation, gain equals taxable");

/*
 * Debt acquired after 2023-04-01 is taxed at slab whatever the holding period,
 * with no indexation. A null rate means slab, not zero.
 *   gain = taxable = 1,00,000; tax 30% = 30,000
 */
const debtSlab = assess([
  disposal({
    taxCategory: "DEBT",
    onDate: CalendarDate.parse("2025-06-01"),
    acquiredOn: CalendarDate.parse("2023-06-01"),
    holdingDays: 731,
    proceeds: Money.fromRupees("600000"),
    costBasis: Money.fromRupees("500000"),
    gain: Money.fromRupees("100000"),
  }),
]);
check("taxed at slab", rateLine(debtSlab).term, "SLAB");
check("rate is the slab rate", rateLine(debtSlab).rate.toFixed(2), "30.00");
check("gain equals taxable — no relief applies", rupees(rateLine(debtSlab).taxableAmount), "100000.00");
check("tax", rupees(rateLine(debtSlab).tax), "30000.00");

section("vda-flat — 30%, and a loss that goes nowhere");

/*
 * A virtual digital asset is flat-rated with no set-off and no carry-forward.
 *   gain 1,00,000 -> tax 30% = 30,000
 *   a separate 40,000 loss is neither offset nor carried
 */
const vda = assess([
  disposal({
    taxCategory: "VDA",
    instrumentId: "BTC",
    proceeds: Money.fromRupees("500000"),
    costBasis: Money.fromRupees("400000"),
    gain: Money.fromRupees("100000"),
    holdingDays: 900,
  }),
  disposal({
    taxCategory: "VDA",
    instrumentId: "ETH",
    proceeds: Money.fromRupees("60000"),
    costBasis: Money.fromRupees("100000"),
    gain: Money.fromRupees("-40000"),
    holdingDays: 900,
  }),
]);
check("flat rate ignores the holding period", rateLine(vda, 0).rate.toFixed(2), "30.00");
check("tax on the gain", rupees(rateLine(vda, 0).tax), "30000.00");
check("the loss is not offset against the gain", rupees(rateLine(vda, 0).taxableAmount), "100000.00");
check("and is not carried forward", vda.lossesCarriedForward.length, 0);
check(
  "which is stated rather than silent",
  vda.lines.some((l) => l.label.includes("not available for set-off")),
  true,
);

section("gold-24mo — long-term at 12.5%, no equity exemption");

/*
 * Gold held 800 days > 730, so long-term at 12.5%. The ₹1.25L exemption is
 * equity-only, so it does not apply.
 *   gain 2,00,000 -> tax 12.5% = 25,000
 */
const gold = assess([
  disposal({
    taxCategory: "GOLD",
    instrumentId: "XAU",
    proceeds: Money.fromRupees("700000"),
    costBasis: Money.fromRupees("500000"),
    gain: Money.fromRupees("200000"),
    holdingDays: 800,
  }),
]);
check("term", rateLine(gold).term, "LONG_TERM");
check("bucket is not the equity one", rateLine(gold).bucket, "LTCG_OTHER");
check("no exemption applies", rupees(rateLine(gold).taxableAmount), "200000.00");
check("tax", rupees(rateLine(gold).tax), "25000.00");
check("no exemption consumed", rupees(gold.exemptionUsed), "0.00");

section("loss-setoff-ordering — a short-term loss reaches both terms");

/*
 * Brought forward: a ₹50,000 short-term equity loss from FY2024-25.
 * This year: a ₹30,000 short-term gain and a ₹40,000 long-term gain.
 *
 * A short-term loss may be set off against either term, oldest first, so it
 * absorbs the ₹30,000 short-term gain entirely and ₹20,000 of the long-term one.
 *   STCG taxable 0
 *   LTCG taxable 40,000 − 20,000 = 20,000, then the exemption covers it -> 0
 */
const setOff = assess(
  [
    disposal({
      onDate: CalendarDate.parse("2025-05-01"),
      instrumentId: "AAA",
      proceeds: Money.fromRupees("130000"),
      costBasis: Money.fromRupees("100000"),
      gain: Money.fromRupees("30000"),
      holdingDays: 100,
    }),
    disposal({
      onDate: CalendarDate.parse("2025-06-01"),
      instrumentId: "BBB",
      proceeds: Money.fromRupees("140000"),
      costBasis: Money.fromRupees("100000"),
      gain: Money.fromRupees("40000"),
      holdingDays: 500,
      acquiredOn: CalendarDate.parse("2024-01-01"),
    }),
  ],
  "2025-26",
  [
    {
      bucket: "STCG_EQUITY",
      financialYear: "2024-25",
      amount: Money.fromRupees("50000"),
      expiresInFinancialYear: "2032-33",
    },
  ],
);
check("the short-term gain is absorbed", rupees(rateLine(setOff, 0).taxableAmount), "0.00");
check("and the remainder reaches the long-term gain", rupees(rateLine(setOff, 1).taxableAmount), "0.00");
check(
  "the set-off names the year it drew on",
  setOff.lines.find((l) => l.rule === "IN.LOSS_SET_OFF")?.inputs.lossYear,
  "2024-25",
);
check("nothing is left to carry", setOff.lossesCarriedForward.length, 0);

section("loss-carry-forward-8y — a loss older than eight years lapses");

const lapsed = assess([disposal()], "2025-26", [
  {
    bucket: "LTCG_EQUITY",
    financialYear: "2016-17",
    amount: Money.fromRupees("90000"),
    expiresInFinancialYear: "2024-25",
  },
]);
check("the lapse is reported, not silently dropped", lapsed.warnings.length, 1);
check("and names the year", lapsed.warnings[0].includes("2016-17"), true);
check("the gain is taxed in full", rupees(rateLine(lapsed).taxableAmount), "20000.00");

section("a fresh loss is carried forward with an expiry");

const carried = assess([
  disposal({
    proceeds: Money.fromRupees("70000"),
    costBasis: Money.fromRupees("100000"),
    gain: Money.fromRupees("-30000"),
    holdingDays: 100,
  }),
]);
check("one carry-forward recorded", carried.lossesCarriedForward.length, 1);
check("the amount", rupees(carried.lossesCarriedForward[0].amount), "30000.00");
check("expiring eight years on", carried.lossesCarriedForward[0].expiresInFinancialYear, "2033-34");
check("and nothing is taxable", rupees(rateLine(carried).taxableAmount), "0.00");

section("ppf-epf-exempt — a zero rate is not the same as exempt");

const exempt = assess([
  disposal({
    taxCategory: "EXEMPT_SCHEME",
    kind: "INTEREST",
    instrumentId: "PPF",
    proceeds: null,
    costBasis: null,
    gain: Money.fromRupees("80000"),
    holdingDays: null,
    acquiredOn: null,
  }),
]);
check("one line, and it is the exemption", exempt.lines[0].rule, "IN.EXEMPT_SCHEME");
check("term", exempt.lines[0].term, "EXEMPT");
check("the income is still reported", rupees(exempt.lines[0].gain), "80000.00");
check("nothing is taxable", rupees(exempt.lines[0].taxableAmount), "0.00");
check("no rate line is emitted at all", exempt.lines.some((l) => l.rule === "IN.APPLY_RATE"), false);
check("total tax", rupees(exempt.totalTax), "0.00");

section("surcharge-cess-band — banded on total income, cess on the sum");

/*
 * Total income ₹60,00,000 crosses the ₹50,00,000 band, so 10% surcharge.
 *   gain 2,00,000 long-term equity, exemption 1,25,000, taxable 75,000
 *   tax        12.5% of 75,000 = 9,375.00
 *   surcharge  10%   of  9,375 =   937.50
 *   cess       4%    of 10,312.50 = 412.50
 *   total                          10,725.00
 */
const banded = engine.assess(
  FinancialYear.parse("2025-26"),
  [
    disposal({
      proceeds: Money.fromRupees("300000"),
      costBasis: Money.fromRupees("100000"),
      gain: Money.fromRupees("200000"),
      holdingDays: 400,
      acquiredOn: CalendarDate.parse("2024-08-01"),
    }),
  ],
  { ...SETTINGS, totalIncome: Money.fromRupees("6000000") },
);
check("tax before surcharge", rupees(rateLine(banded).tax), "9375.00");
check("surcharge at the 10% band", rupees(banded.surcharge), "937.50");
check("cess on tax plus surcharge", rupees(banded.cess), "412.50");
check("total", rupees(banded.totalTax), "10725.00");

section("fy2024-vs-fy2025 — the same disposal, either side of 23 July 2024");

/*
 * Identical long-term equity gain of ₹3,00,000.
 *   FY2024: exemption 1,00,000, taxable 2,00,000, rate 10%   -> 20,000
 *   FY2025: exemption 1,25,000, taxable 1,75,000, rate 12.5% -> 21,875
 * Two vintages of the same law, and both must remain computable.
 */
const before = assess(
  [
    disposal({
      onDate: CalendarDate.parse("2024-07-01"),
      acquiredOn: CalendarDate.parse("2023-01-01"),
      holdingDays: 547,
      proceeds: Money.fromRupees("400000"),
      costBasis: Money.fromRupees("100000"),
      gain: Money.fromRupees("300000"),
    }),
  ],
  "2024-25",
);
const after = assess(
  [
    disposal({
      onDate: CalendarDate.parse("2024-08-01"),
      acquiredOn: CalendarDate.parse("2023-01-01"),
      holdingDays: 578,
      proceeds: Money.fromRupees("400000"),
      costBasis: Money.fromRupees("100000"),
      gain: Money.fromRupees("300000"),
    }),
  ],
  "2024-25",
);
check("the earlier disposal uses FY2024", before.regime, "IN-FY2024");
check("exemption is ₹1,00,000", rupees(before.exemptionUsed), "100000.00");
check("rate is 10%", rateLine(before).rate.toFixed(2), "10.00");
check("tax", rupees(rateLine(before).tax), "20000.00");

check("the later disposal uses FY2025", after.regime, "IN-FY2025");
check("exemption is ₹1,25,000", rupees(after.exemptionUsed), "125000.00");
check("rate is 12.5%", rateLine(after).rate.toFixed(2), "12.50");
check("tax", rupees(rateLine(after).tax), "21875.00");

section("a gap in the regime table throws rather than guessing");

const sparse = new TaxEngine(new RegimeRegistry([new IndiaFY2025()]));
throws(
  "a disposal before any shipped regime",
  () =>
    sparse.assess(
      FinancialYear.parse("2010-11"),
      [disposal({ onDate: CalendarDate.parse("2010-06-01") })],
      SETTINGS,
    ),
  "No tax regime is in force",
);
check(
  "and it is the typed error",
  (() => {
    try {
      sparse.assess(
        FinancialYear.parse("2010-11"),
        [disposal({ onDate: CalendarDate.parse("2010-06-01") })],
        SETTINGS,
      );
      return "no throw";
    } catch (e) {
      return e instanceof NoRegimeError ? "NoRegimeError" : "wrong type";
    }
  })(),
  "NoRegimeError",
);

section("both regimes coexist and neither is reachable by accident");

const registry = new RegimeRegistry();
check("July 22 2024 is the old regime", registry.forDate(CalendarDate.parse("2024-07-22")).name, "IN-FY2024");
check("July 23 2024 is the new one", registry.forDate(CalendarDate.parse("2024-07-23")).name, "IN-FY2025");
check("a 2026 disposal is the new one", registry.forDate(CalendarDate.parse("2026-03-01")).name, "IN-FY2025");
check("IndiaFY2024 is frozen", new IndiaFY2024().effectiveTo?.toISO(), "2024-07-22");

done();

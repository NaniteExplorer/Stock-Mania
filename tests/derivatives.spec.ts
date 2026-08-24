/**
 * Phase 8's gate, cashed in.
 *
 * The gate is: *adding a new asset class or a new tax regime is a single new class
 * in a single existing file, proven by doing it once.* This spec is the proof, and
 * it proves it the only way that means anything — by exercising the two new
 * leaves through the same engines every other instrument goes through, and
 * asserting that no engine learned they exist.
 *
 * The money content is the F&O tax head, which is the part everyone gets wrong:
 *
 *   - F&O is **non-speculative business income**, taxed at the slab rate. Not a
 *     capital gain, so no holding period, no indexation, no ₹1.25 lakh exemption.
 *   - Its losses may be set off **only against business income**, and a capital
 *     loss may not reduce it. Both directions are asserted, because a one-way wall
 *     is not a wall.
 */

import { readFileSync, readdirSync } from "node:fs";
import { UserId } from "@/core/kernel";
import { Currency, Money } from "@/core/money";
import { Percentage, Quantity, UnitPrice } from "@/core/numeric";
import { CalendarDate, FinancialYear } from "@/core/time";
import { AccountId } from "@/domain/accounts";
import { Future, InstrumentId, MarketInstrument, Option, type InstrumentProps } from "@/domain/instruments";
import { TaxEngine, type TaxSettings, type TaxableEvent } from "@/domain/tax";
import { check, checkDeep, checkTrue, done, section, throws } from "./harness";

const userId = UserId.from("user-derivatives");
const assetAccountId = AccountId.create();
const on = (value: string) => CalendarDate.parse(value);
const lots = (value: string) => Quantity.fromString(value);
const rupees = (value: string) => Money.fromRupees(value, Currency.INR);

const base = (symbol: string): Omit<InstrumentProps, "metadata"> => ({
  id: InstrumentId.from(`instrument-${symbol.toLowerCase()}`),
  userId,
  symbol,
  name: symbol,
  currency: Currency.INR,
  assetAccountId,
});

const NIFTY_CALL = {
  underlyingSymbol: "NIFTY",
  right: "CALL" as const,
  strike: "24000",
  expiry: "2026-09-24",
  lotSize: 75,
};

const call = new Option({ ...base("NIFTY26SEP24000CE"), metadata: NIFTY_CALL });
const put = new Option({
  ...base("NIFTY26SEP24000PE"),
  metadata: { ...NIFTY_CALL, right: "PUT" as const },
});
const future = new Future({
  ...base("NIFTY26SEPFUT"),
  metadata: {
    underlyingSymbol: "NIFTY",
    expiry: "2026-09-24",
    contractMonth: "2026-09",
    lotSize: 75,
  },
});

/* ═══ The three polymorphic questions ═════════════════════════════════ */

section("both new leaves answer all three questions");

check("an option's tax category", call.taxProfile().category, "FNO_BUSINESS");
check("a future's tax category", future.taxProfile().category, "FNO_BUSINESS");
check("no long-term treatment at any holding period", call.taxProfile().slabTaxedAlways, true);
check("no lock-in — an expiry is not a lock", call.taxProfile().lockInMonths, null);
check("STT applies", call.taxProfile().securitiesTransactionTax, true);

check("priced as a derivative", call.quoteKey().assetClass, "DERIVATIVE");
check("from a close", call.quoteKey().quoteType, "CLOSE");
check("a contract is quantified in lots", call.unit, "CONTRACT");
check("and reads as lots", call.formatQuantity(lots("3")), "3 lots");

check("the registry builds it from a stored kind", MarketInstrument.of("OPTION", { ...base("X"), metadata: NIFTY_CALL }).kind, "OPTION");
check("and the future", future.kind, "FUTURE");

/* ═══ The gate: nothing downstream knows ══════════════════════════════ */

section("the gate — no engine switched on the new kinds");

/*
 * The structural claim, checked the same way `instruments.spec.ts` checks it: if
 * adding an option had required a case in the tax engine, the price book or a
 * use case, the cost of the *next* asset class would be the same search again.
 */
const offenders: string[] = [];
for (const directory of ["src/domain", "src/app"]) {
  for (const file of readdirSync(directory)) {
    if (file === "instruments.ts") continue;
    const source = readFileSync(`${directory}/${file}`, "utf8");
    for (const literal of ['"OPTION"', '"FUTURE"']) {
      if (source.includes(`=== ${literal}`) || source.includes(`case ${literal}`)) {
        offenders.push(`${directory}/${file} compares against ${literal}`);
      }
    }
  }
}
checkDeep("no engine compares against OPTION or FUTURE", offenders, []);

/* ═══ Metadata is a constructor invariant ═════════════════════════════ */

section("a half-specified contract is not a contract");

throws(
  "an option with no strike is refused",
  () =>
    new Option({
      ...base("BAD"),
      metadata: { underlyingSymbol: "NIFTY", right: "CALL", expiry: "2026-09-24", lotSize: 75 },
    }),
  "not usable",
);
throws(
  "and one with no metadata at all",
  () => new Option(base("BAD2")),
  "not usable",
);
throws(
  "a strike must be a decimal string, not a float",
  () => new Option({ ...base("BAD3"), metadata: { ...NIFTY_CALL, strike: 24000 } }),
  "not usable",
);
throws(
  "a lot size must be a whole positive number",
  () => new Option({ ...base("BAD4"), metadata: { ...NIFTY_CALL, lotSize: 0 } }),
  "not usable",
);
throws(
  "a zero strike is refused by the constructor, not the schema",
  () => new Option({ ...base("BAD5"), metadata: { ...NIFTY_CALL, strike: "0" } }),
  "positive amount",
);

check("a parsed strike is exact money", call.strike.toDecimalString(), "24000.00");
check("and the expiry is a calendar date", call.expiry.toISO(), "2026-09-24");

/* ═══ Contract mathematics ════════════════════════════════════════════ */

section("lots, moneyness and mark-to-market");

check("3 lots of a 75-lot contract is 225 units", future.underlyingUnits(lots("3")).toDecimalString(), "225");

check("a call above its strike is in the money", call.moneyness(rupees("24500")), "ITM");
check("and its intrinsic value is the difference", call.intrinsicValue(rupees("24500")).toDecimalString(), "500.00");
check("below the strike it is out of the money", call.moneyness(rupees("23500")), "OTM");
check("and intrinsic value is zero, not negative", call.intrinsicValue(rupees("23500")).toDecimalString(), "0.00");
check("at the strike it is at the money", call.moneyness(rupees("24000")), "ATM");
check("a put is the mirror image", put.moneyness(rupees("23500")), "ITM");
check("and its intrinsic value", put.intrinsicValue(rupees("23500")).toDecimalString(), "500.00");

// 225 units, ₹24,150 in at ₹24,050 settle: a ₹100 loss per unit.
check(
  "a future's mark-to-market can be negative — the gain is realised daily",
  future
    .markToMarket(lots("3"), UnitPrice.of("24150", Currency.INR), UnitPrice.of("24050", Currency.INR))
    .toDecimalString(),
  "-22500.00",
);
check(
  "and positive the other way",
  future
    .markToMarket(lots("3"), UnitPrice.of("24050", Currency.INR), UnitPrice.of("24150", Currency.INR))
    .toDecimalString(),
  "22500.00",
);

section("an expired contract cannot be traded");

check("before expiry there is no obstacle", future.tradableOn(on("2026-09-24")), null);
checkTrue(
  "after it, the reason says so",
  (future.tradableOn(on("2026-09-25")) ?? "").includes("expired on 2026-09-24"),
);
check("nothing without an expiry answers this", MarketInstrument.of("LISTED_EQUITY", base("INFY")).tradableOn(on("2026-09-25")), null);
check("days to expiry", future.daysToExpiry(on("2026-09-01")), 23);

/* ═══ The tax head ════════════════════════════════════════════════════ */

section("F&O is business income, at slab");

const settings: TaxSettings = {
  slabRate: Percentage.of("30"),
  totalIncome: rupees("2500000"),
  residentStatus: "RESIDENT",
};
const fy = FinancialYear.parse("2026-27");
const engine = new TaxEngine();

const fnoEvent = (id: string, gain: string, date = "2026-09-24"): TaxableEvent => ({
  id,
  kind: "BUSINESS_INCOME",
  onDate: on(date),
  taxCategory: "FNO_BUSINESS",
  instrumentId: future.id.value,
  acquiredOn: on("2026-09-01"),
  holdingDays: 23,
  proceeds: null,
  costBasis: null,
  gain: rupees(gain),
  deductibleCharges: Money.zero(Currency.INR),
  fmvOnGrandfatherDate: null,
  sourceTransactionId: `txn-${id}`,
  sourceLotId: null,
});

const equityEvent = (id: string, gain: string): TaxableEvent => ({
  id,
  kind: "CAPITAL_GAIN",
  onDate: on("2026-10-10"),
  taxCategory: "LISTED_EQUITY",
  instrumentId: "instrument-infy",
  acquiredOn: on("2024-01-10"),
  holdingDays: 1004,
  proceeds: rupees("1000000"),
  costBasis: rupees("500000"),
  gain: rupees(gain),
  deductibleCharges: Money.zero(Currency.INR),
  fmvOnGrandfatherDate: null,
  sourceTransactionId: `txn-${id}`,
  sourceLotId: "lot-1",
});

const profit = engine.assess(fy, [fnoEvent("fno-1", "400000")], settings);
check("the bucket is the business head", profit.totals.BUSINESS_NON_SPECULATIVE?.tax !== undefined, true);
check("₹4,00,000 at 30%", profit.totals.BUSINESS_NON_SPECULATIVE?.tax.toDecimalString(), "120000.00");
checkTrue(
  "the provenance names the head, not a capital-gains rule",
  profit.lines.some((line) => line.rule === "IN.FNO_BUSINESS_INCOME"),
);
checkDeep(
  "and no capital-gain classification ran",
  profit.lines.filter((line) => line.rule === "IN.CLASSIFY_TERM").map((line) => line.rule),
  [],
);
check("the term is slab, not short or long", profit.lines[0].term, "SLAB");

section("the wall between the business and capital heads");

/*
 * The assertion that matters most in this file.
 *
 * A ₹3,00,000 F&O loss and a ₹5,00,000 long-term equity gain in one year. If the
 * loss were allowed to reduce the gain, the equity tax would fall by ₹37,500 — a
 * refund the statute does not offer, and the most common F&O filing error.
 */
const mixed = engine.assess(
  fy,
  [fnoEvent("fno-loss", "-300000"), equityEvent("eq-gain", "500000")],
  settings,
);
const equityTax = mixed.totals.LTCG_EQUITY?.tax.toDecimalString() ?? "missing";
// ₹5,00,000 less the ₹1,25,000 exemption is ₹3,75,000 at 12.5%.
check("the equity gain is taxed in full, untouched by the F&O loss", equityTax, "46875.00");
check("and the F&O loss is taxed at nothing", mixed.totals.BUSINESS_NON_SPECULATIVE?.tax.toDecimalString(), "0.00");
checkTrue(
  "the loss is carried forward under its own bucket",
  mixed.lossesCarriedForward.some(
    (carried) => carried.bucket === "BUSINESS_NON_SPECULATIVE" && carried.amount.toDecimalString() === "300000.00",
  ),
);

/* An F&O loss brought forward *does* meet an F&O gain. */
const nextYear = engine.assess(
  FinancialYear.parse("2027-28"),
  [
    {
      ...fnoEvent("fno-2", "500000", "2027-09-24"),
    },
  ],
  settings,
  {
    broughtForwardLosses: [
      {
        bucket: "BUSINESS_NON_SPECULATIVE",
        financialYear: "2026-27",
        amount: rupees("300000"),
        expiresInFinancialYear: "2034-35",
      },
    ],
  },
);
// ₹5,00,000 less the ₹3,00,000 brought forward is ₹2,00,000 at 30%.
check(
  "a brought-forward F&O loss does meet an F&O gain",
  nextYear.totals.BUSINESS_NON_SPECULATIVE?.tax.toDecimalString(),
  "60000.00",
);

/* And a capital loss may not reduce business income. */
const capitalLossAgainstFno = engine.assess(
  fy,
  [fnoEvent("fno-3", "400000")],
  settings,
  {
    broughtForwardLosses: [
      {
        bucket: "STCG_EQUITY",
        financialYear: "2025-26",
        amount: rupees("400000"),
        expiresInFinancialYear: "2033-34",
      },
    ],
  },
);
check(
  "a carried equity loss cannot reduce business income either",
  capitalLossAgainstFno.totals.BUSINESS_NON_SPECULATIVE?.tax.toDecimalString(),
  "120000.00",
);

done();

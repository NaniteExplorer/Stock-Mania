/**
 * The instrument hierarchy, and the claim that makes it worth having.
 *
 * The plan's done-when is that **adding a fourteenth instrument type touches
 * exactly one file** — a claim Phase 8 cashed in twice, by adding `Option` and
 * `Future` with no change to any engine. That cannot be tested directly, so it is tested by its two
 * preconditions:
 *
 *   - **Every leaf answers all three questions**, so nothing downstream needs a
 *     special case. Asserted by looping over `MarketInstrument.kinds()` — a new
 *     kind that forgot a `taxProfile` fails here rather than at a call site.
 *   - **No engine switches on the kind.** Asserted by grepping the domain and app
 *     layers for a comparison against an instrument kind: the tax engine sees a
 *     `TaxCategory`, the price book sees an identifier, and neither knows what a
 *     liquid fund is.
 *
 * The tax differences between leaves are the interesting content, and each is a
 * real number: a debt fund is slab-taxed at any holding period, an SGB is exempt
 * at maturity and taxed as gold before it, and crypto losses cannot be set off at
 * all.
 */

import { readFileSync, readdirSync } from "node:fs";
import { Currency, Money } from "@/core/money";
import { Quantity, UnitPrice } from "@/core/numeric";
import { CalendarDate } from "@/core/time";
import { UserId } from "@/core/kernel";
import { AccountId } from "@/domain/accounts";
import {
  Bond,
  Crypto,
  DebtFund,
  DigitalGold,
  ELSS_LOCK_IN_MONTHS,
  ElssFund,
  Etf,
  InstrumentId,
  ListedEquity,
  LiquidFund,
  MarketInstrument,
  SovereignGoldBond,
  type InstrumentProps,
  type PriceLookup,
} from "@/domain/instruments";
import { check, checkDeep, checkTrue, done, section, throws } from "./harness";

const userId = UserId.from("user-instruments");
const assetAccountId = AccountId.create();
const on = (value: string) => CalendarDate.parse(value);
const units = (value: string) => Quantity.fromString(value);

const props = (symbol: string, name = symbol): InstrumentProps => ({
  id: InstrumentId.from(`instrument-${symbol.toLowerCase()}`),
  userId,
  symbol,
  name,
  currency: Currency.INR,
  assetAccountId,
});

/**
 * Metadata a leaf cannot do without.
 *
 * Only the derivatives are here: an option with no strike is refused at
 * construction, deliberately, so the loop below has to supply one. Every other
 * leaf either has no facts of its own or treats them as optional.
 */
const metadataFor = (kind: string): unknown => {
  if (kind === "OPTION") {
    return {
      underlyingSymbol: "NIFTY",
      right: "CALL",
      strike: "24000",
      expiry: "2026-09-24",
      lotSize: 75,
    };
  }
  if (kind === "FUTURE") {
    return { underlyingSymbol: "NIFTY", expiry: "2026-09-24", contractMonth: "2026-09", lotSize: 75 };
  }
  return undefined;
};

const propsFor = (kind: string): InstrumentProps => ({
  ...props(kind),
  metadata: metadataFor(kind),
});

/* ═══ Every leaf answers every question ═══════════════════════════════ */

section("every one of the fifteen leaves answers all three questions");

check("fifteen kinds", MarketInstrument.kinds().length, 15);

let missing = 0;
for (const kind of MarketInstrument.kinds()) {
  const instrument = MarketInstrument.of(kind, propsFor(kind));
  const profile = instrument.taxProfile();
  const key = instrument.quoteKey();
  if (!profile.category || !key.assetClass || !key.quoteType || !instrument.unit) missing += 1;
}
check("none is missing a tax profile, a quote key or a unit", missing, 0);

const kinds = new Set(
  MarketInstrument.kinds().map((kind) => MarketInstrument.of(kind, propsFor(kind)).kind),
);
check("and each builds the leaf that matches its own kind", kinds.size, 15);

/* ═══ No engine switches on the kind ══════════════════════════════════ */

section("nothing downstream switches on an instrument kind");

/*
 * The structural half of "a fourteenth type touches one file". If the tax engine
 * or a use case compared against `LIQUID_FUND`, adding a fourteenth kind would
 * mean finding every such comparison — which is exactly the maintenance burden the
 * hierarchy exists to remove.
 */
/*
 * Only the kinds whose *name* is unique to `InstrumentKind`. `LISTED_EQUITY` is
 * also a `TaxCategory` and `MUTUAL_FUND` a `PricedAssetClass`, so a match on those
 * strings elsewhere is the tax engine or the price book doing its own job — the
 * check would fail on a false positive and then be deleted, which is worse than
 * narrowing it here.
 */
const SHARED_WITH_OTHER_ENUMS = new Set([
  "LISTED_EQUITY",
  "MUTUAL_FUND",
  "ETF",
  "BOND",
  "CRYPTO",
]);
const KIND_LITERALS = MarketInstrument.kinds()
  .filter((kind) => !SHARED_WITH_OTHER_ENUMS.has(kind))
  .map((kind) => `"${kind}"`);
const offenders: string[] = [];
for (const directory of ["src/domain", "src/app"]) {
  for (const file of readdirSync(directory)) {
    if (file === "instruments.ts") continue;
    const source = readFileSync(`${directory}/${file}`, "utf8");
    for (const literal of KIND_LITERALS) {
      if (source.includes(`=== ${literal}`) || source.includes(`case ${literal}`)) {
        offenders.push(`${directory}/${file} compares against ${literal}`);
      }
    }
  }
}
checkDeep("no file outside instruments.ts compares against a kind", offenders, []);

/* ═══ Tax profiles: the differences that are money ════════════════════ */

section("equity");

const infy = new ListedEquity(props("INFY", "Infosys Ltd"));
check("category", infy.taxProfile().category, "LISTED_EQUITY");
check("STT applies", infy.taxProfile().securitiesTransactionTax, true);
check("no lock-in", infy.taxProfile().lockInMonths, null);
check("losses can be set off", infy.taxProfile().lossesSetOffAllowed, true);
check("priced from an exchange close", infy.quoteKey().quoteType, "CLOSE");
check("by symbol", infy.quoteKey().identifierType, "SYMBOL");
check("units are shares", infy.formatQuantity(units("12")), "12 shares");

section("a liquid fund is slab-taxed at every holding period");

const liquid = new LiquidFund(props("SBI-LIQUID", "SBI Liquid Fund"));
check("category", liquid.taxProfile().category, "DEBT");
check("slab always", liquid.taxProfile().slabTaxedAlways, true);
// The April 2023 change. A two-year holding does not help, and treating it as an
// equity fund would report 12.5% where 30% is due.
checkTrue(
  "so it is not equity-taxed however long it is held",
  liquid.taxProfile().category !== "EQUITY_MUTUAL_FUND",
);
check("priced from a NAV", liquid.quoteKey().quoteType, "NAV");
check("by scheme code", liquid.quoteKey().identifierType, "SCHEME_CODE");

section("a debt fund's legacy units keep indexation");

const debtNew = new DebtFund(props("HDFC-DEBT"));
const debtLegacy = new DebtFund(props("HDFC-DEBT"), true);
check("post-2023 units are slab-taxed", debtNew.taxProfile().category, "DEBT");
check("pre-2023 units are not", debtLegacy.taxProfile().category, "DEBT_LEGACY");
check("and keep long-term treatment", debtLegacy.taxProfile().slabTaxedAlways, false);

section("an ETF's treatment follows what it holds");

check("an equity ETF", new Etf(props("NIFTYBEES")).taxProfile().category, "EQUITY_MUTUAL_FUND");
check("a gold ETF", new Etf(props("GOLDBEES"), "GOLD").taxProfile().category, "GOLD");
check("a debt ETF", new Etf(props("LIQUIDBEES"), "DEBT").taxProfile().category, "DEBT");
check("and a debt ETF is slab-taxed", new Etf(props("LIQUIDBEES"), "DEBT").taxProfile().slabTaxedAlways, true);

section("ELSS: a three-year lock on every purchase");

const elss = new ElssFund(props("AXIS-ELSS", "Axis ELSS Tax Saver"));
check("the lock-in", elss.taxProfile().lockInMonths, ELSS_LOCK_IN_MONTHS);
check("which is three years, in months", ELSS_LOCK_IN_MONTHS, 36);
check("taxed as an equity fund", elss.taxProfile().category, "EQUITY_MUTUAL_FUND");

// Per purchase, not per account: a SIP creates a new lock every month.
const blocked = elss.disposalBlockedOn(on("2026-04-01"), on("2029-03-31"));
checkTrue("a redemption one day early is refused", blocked !== null);
checkTrue("and the message says how long is left", (blocked ?? "").includes("day to go"));
check("on the anniversary it is allowed", elss.disposalBlockedOn(on("2026-04-01"), on("2029-04-01")), null);
/*
 * Counted in calendar months rather than 1,095 days, and the leap year is why:
 * 1 April 2026 to 1 April 2029 is 1,096 days, so a day count would have unlocked
 * these units on 31 March 2029 — one day before the registrar would.
 */
check("which is 1,096 days later, not 1,095", on("2026-04-01").daysUntil(on("2029-04-01")), 1096);
check("an equity share has no such block", infy.disposalBlockedOn(on("2026-04-01"), on("2026-04-02")), null);

check(
  "§80C is capped at 1.5 lakh, net of what is already claimed",
  elss.deductibleInvestment(Money.fromRupees("100000"), Money.fromRupees("100000")).toDecimalString(),
  "50000.00",
);
check(
  "and nothing is left once the cap is used",
  elss.deductibleInvestment(Money.fromRupees("100000"), Money.fromRupees("150000")).toDecimalString(),
  "0.00",
);

section("a sovereign gold bond: two answers for one instrument");

const sgb = new SovereignGoldBond(props("SGBAUG29", "SGB 2021-22 Series IV"), {
  issuedOn: on("2021-08-01"),
  maturesOn: on("2029-08-01"),
});
check("gold, for tax", sgb.taxProfile().category, "GOLD");
check("exempt at maturity", sgb.taxProfile().exemptOnMaturity, true);
check("a sale before maturity is not a redemption", sgb.isMaturityRedemption(on("2027-01-01")), false);
check("on or after maturity it is", sgb.isMaturityRedemption(on("2029-08-01")), true);
check("units are grams", sgb.formatQuantity(units("25")), "25 g");
// 2.5% a year on the issue price, paid half-yearly.
check(
  "the half-yearly coupon on 25g issued at ₹4,800/g",
  sgb.interestFor(units("25"), UnitPrice.of("4800")).toDecimalString(),
  "1500.00",
);

section("digital gold is measured in grams");

const gold = new DigitalGold(props("SAFEGOLD", "SafeGold"));
check("commodity", gold.quoteKey().assetClass, "COMMODITY");
check("valued at the mid rate, not the buy or sell one", gold.quoteKey().quoteType, "MID");
check("grams", gold.formatQuantity(units("12.5")), "12.5 g");
check("gold, for tax", gold.taxProfile().category, "GOLD");

section("crypto: flat, and losses go nowhere");

const btc = new Crypto(props("BTC", "Bitcoin"));
check("a virtual digital asset", btc.taxProfile().category, "VDA");
check("losses cannot be set off", btc.taxProfile().lossesSetOffAllowed, false);
check("no long-term relief either", btc.taxProfile().slabTaxedAlways, false);
check("priced from the last trade", btc.quoteKey().quoteType, "LAST");
check("units are coins", btc.formatQuantity(units("0.0125")), "0.0125 coins");

section("a bond's coupon is income, not a change in value");

const bond = new Bond(props("NCD-2029"), {
  faceValue: Money.fromRupees("1000"),
  couponRate: (await import("@/core/numeric")).Percentage.of("9"),
  maturesOn: on("2029-06-30"),
});
// ₹1,000 face × 9% ÷ 2 = ₹45 per bond per half-year, over 50 bonds.
check("half-yearly coupon on 50 bonds", bond.couponFor(units("50"))?.toDecimalString(), "2250.00");
check("a bond with no terms has no coupon", new Bond(props("NCD-X")).couponFor(units("50")), null);
check("priced by ISIN when there is one", new Bond({ ...props("NCD"), isin: "INE001A07QW1" }).quoteKey().identifierType, "ISIN");

/* ═══ Valuation ═══════════════════════════════════════════════════════ */

section("valuation: a missing price is not zero");

/** A price source that answers from a fixture, so the test needs no network. */
const priced = (price: string | null, ageDays = 0): PriceLookup => ({
  async priceOn() {
    return {
      price: price === null ? null : UnitPrice.of(price),
      pricedOn: price === null ? null : on("2026-08-24").plusDays(-ageDays),
      isStale: ageDays > 4,
      rung: price === null ? "UNAVAILABLE" : "GOLDEN",
    };
  },
});

const valued = await infy.valueOn(units("100"), on("2026-08-24"), priced("1543.75"));
check("units times price", valued.value?.toDecimalString(), "154375.00");
check("the price is kept at full precision", valued.price?.toDecimalString(), "1543.75");
check("not stale", valued.isStale, false);
check("and there is no unpriced reason", valued.unpricedReason, null);

const unpriced = await infy.valueOn(units("100"), on("2026-08-24"), priced(null));
check("a missing price gives no value", unpriced.value, null);
// The whole point: ₹0 and "unknown" are opposite claims about someone's net worth.
checkTrue("and says why", (unpriced.unpricedReason ?? "").includes("No close"));
check("and is marked stale", unpriced.isStale, true);

const stale = await infy.valueOn(units("100"), on("2026-08-24"), priced("1543.75", 9));
check("a nine-day-old equity price is stale", stale.isStale, true);
check("but it is still a value", stale.value?.toDecimalString(), "154375.00");

const empty = await infy.valueOn(units("0"), on("2026-08-24"), priced(null));
check("a zero holding is worth zero, and needs no price to say so", empty.value?.toDecimalString(), "0.00");

section("a NAV keeps four decimals until it meets a quantity");

const fund = new LiquidFund(props("SBI-LIQUID"));
const navValued = await fund.valueOn(units("1250.4321"), on("2026-08-24"), priced("84.5612"));
// 1250.4321 × 84.5612 = 105,738.0429… — rounded once, at the multiplication.
check("value", navValued.value?.toDecimalString(), "105738.04");
check("the NAV itself is unrounded", navValued.price?.toDecimalString(), "84.5612");

section("metadata survives a round-trip through storage");

/*
 * The bug this section exists for.
 *
 * Before Phase 8, `Etf`'s underlying and `Bond`'s terms were constructor
 * arguments and nothing else — `MarketInstrument.of(kind, props)` could not pass
 * them, so an instrument *read back from the database* lost them silently. A gold
 * ETF became an equity ETF (12.5% long-term instead of 20% at slab) and a bond's
 * coupon became `null` forever. Both are money, and neither threw.
 */
const goldEtfStored = MarketInstrument.of("ETF", {
  ...props("GOLDBEES"),
  metadata: { underlying: "GOLD" },
});
check("a gold ETF read back is still gold", goldEtfStored.taxProfile().category, "GOLD");

const equityEtfStored = MarketInstrument.of("ETF", props("NIFTYBEES"));
check(
  "an ETF with no metadata defaults to equity, as before",
  equityEtfStored.taxProfile().category,
  "EQUITY_MUTUAL_FUND",
);

const legacyDebtStored = MarketInstrument.of("DEBT_FUND", {
  ...props("HDFC-DEBT"),
  metadata: { legacyUnits: true },
});
check(
  "pre-April-2023 debt units keep indexation across a round-trip",
  legacyDebtStored.taxProfile().category,
  "DEBT_LEGACY",
);

const bondStored = MarketInstrument.of("BOND", {
  ...props("NCD-2029"),
  metadata: { faceValue: "1000", couponRatePercent: "9.5", maturesOn: "2029-03-31" },
}) as Bond;
// 9.5% of ₹1,000 is ₹95 a year, ₹47.50 half-yearly, times 50 bonds.
check(
  "a bond's coupon survives storage",
  bondStored.couponFor(units("50"))?.toDecimalString(),
  "2375.00",
);
check("and its maturity date", bondStored.terms?.maturesOn.toISO(), "2029-03-31");

throws(
  "a half-specified bond is refused rather than defaulted",
  () => MarketInstrument.of("BOND", { ...props("NCD-Y"), metadata: { faceValue: "1000" } }),
  "not usable",
);

check(
  "a schema is published per kind, so a form can be generated from it",
  MarketInstrument.metadataSchemaFor("OPTION").safeParse({}).success,
  false,
);

section("bad construction is refused");

throws(
  "an instrument needs a symbol",
  () => new ListedEquity({ ...props("X"), symbol: "  " }),
  "needs a symbol",
);
throws(
  "and a name",
  () => new ListedEquity({ ...props("X"), name: "" }),
  "needs a name",
);
throws("an id cannot be blank", () => InstrumentId.from("  "), "cannot be blank");

done();

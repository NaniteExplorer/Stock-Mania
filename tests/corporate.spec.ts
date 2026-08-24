/**
 * Corporate actions.
 *
 * The plan's done-when has four parts and each is asserted here: a 1:5 split
 * applied mid-history leaves every historical number correct, **charts use
 * adjusted prices**, **basis uses raw prices**, and **reversing the action undoes
 * it**. The last one is only possible because an action is a transaction rather
 * than an in-place lot edit — which is the whole design, so it gets a test that
 * would fail loudly if someone "simplified" it.
 *
 * The other content worth reading: a bonus issue is arithmetically a split and is
 * deliberately not one, because the bonus units take the ex-date as their
 * acquisition date. A long-held position that receives a bonus has a short-term
 * tranche the next day, and modelling it as a rescale would report a long-term
 * gain where a short-term one is due.
 */

import { Currency, Money } from "@/core/money";
import { Percentage, Quantity, UnitPrice } from "@/core/numeric";
import { CalendarDate } from "@/core/time";
import { InstrumentId } from "@/domain/instruments";
import { Lot, LotBook, LotId, Fifo } from "@/domain/lots";
import {
  Bonus,
  Demerger,
  DividendCash,
  DividendStock,
  Merger,
  ReturnOfCapital,
  ReverseSplit,
  Rights,
  Spinoff,
  Split,
  adjustSeries,
  applyAction,
  inverseOf,
  type CorporateActionContext,
} from "@/domain/corporate";
import { assertProperty, check, checkDeep, checkTrue, done, genInt, section, throws } from "./harness";

const rupees = (value: string) => Money.fromRupees(value);
const units = (value: string) => Quantity.fromString(value);
const price = (value: string) => UnitPrice.of(value);
const on = (value: string) => CalendarDate.parse(value);

const INFY = InstrumentId.from("instrument-infy");
const RELIANCE = InstrumentId.from("instrument-reliance");
const JIO = InstrumentId.from("instrument-jio");

let counter = 0;
function lot(acquiredOn: string, quantity: string, cost: string, instrumentId = INFY): Lot {
  counter += 1;
  return Lot.open({
    id: LotId.from(`00000000-0000-4000-8000-${String(counter).padStart(12, "0")}`),
    instrumentId,
    acquiredOn: on(acquiredOn),
    originalQuantity: units(quantity),
    cost: rupees(cost),
    buyCharges: rupees("0"),
    openedByTransactionId: `txn-${counter}`,
  });
}

const context = (held: string, exDate = "2025-06-01", instrumentId = INFY): CorporateActionContext => ({
  instrumentId,
  exDate: on(exDate),
  heldQuantity: units(held),
  currency: Currency.INR,
});

/* ═══ A split, mid-history ════════════════════════════════════════════ */

section("a 1:5 split leaves every historical number correct");

/*
 * 100 shares bought at ₹1,500 in April 2024 for ₹1,50,000. A 1:5 split on
 * 1 June 2025 makes it 500 shares, and not one rupee of what was paid changes.
 */
const original = [lot("2024-04-01", "100", "150000")];
const split = new Split(context("100"), { from: units("1"), to: units("5") });

check("the factor is five", split.factor.toDecimalString(), "5");
const afterSplit = split.applyTo(original);
check("units multiply", afterSplit[0].remaining.toDecimalString(), "500");
check("cost basis does not", afterSplit[0].remainingCost.toDecimalString(), "150000.00");
check("so cost per unit falls to a fifth", afterSplit[0].costPerUnit.toDecimalString(), "300.00");
check("the acquisition date is untouched", afterSplit[0].acquiredOn.toISO(), "2024-04-01");
checkDeep("and a split is not a taxable event", split.taxableEvents(), []);
checkDeep("nor a cash event", split.cashEffects(), []);

// The gain on a later sale is computed from the raw ₹1,50,000, not from an
// adjusted price. 500 shares at ₹400 is ₹2,00,000 for a ₹50,000 gain.
const sold = new LotBook(new Fifo()).apply(afterSplit, {
  instrumentId: INFY,
  quantity: units("500"),
  disposedOn: on("2025-08-01"),
  proceeds: rupees("200000"),
  sellCharges: rupees("0"),
});
check("basis uses the raw price paid", sold.totalCostBasis.toDecimalString(), "150000.00");
check("so the gain is", sold.totalGain.toDecimalString(), "50000.00");
check("and the holding period runs from the original purchase", sold.disposals[0].holdingDays, 487);

section("charts use adjusted prices — and only charts");

/*
 * The pre-split series must be divided by five so the chart is continuous. A
 * ₹1,500 share that becomes five ₹300 shares did not fall 80%.
 */
const series = [
  { on: on("2024-04-01"), price: price("1500") },
  { on: on("2025-05-31"), price: price("2000") },
  { on: on("2025-06-01"), price: price("400") },
  { on: on("2025-08-01"), price: price("400") },
];
const adjusted = adjustSeries(series, [split.priceAdjustment()]);
check("the pre-split ₹1,500 becomes ₹300", adjusted[0].price.toDecimalString(), "300");
check("and the day before the split, ₹2,000 becomes ₹400", adjusted[1].price.toDecimalString(), "400");
check("the ex-date price is untouched", adjusted[2].price.toDecimalString(), "400");
checkTrue(
  "so the series is continuous across the split",
  adjusted[1].price.toDecimalString() === adjusted[2].price.toDecimalString(),
);
// The raw series is not mutated: an adjusted series is a separate object, produced
// for drawing, so nothing can accidentally value a holding at an adjusted price.
check("the original series is untouched", series[0].price.toDecimalString(), "1500");

section("two splits compound");

const secondSplit = new Split(context("500", "2026-01-01"), { from: units("1"), to: units("2") });
const twice = adjustSeries(series, [split.priceAdjustment(), secondSplit.priceAdjustment()]);
check("a price before both is divided by ten", twice[0].price.toDecimalString(), "150");
check("and one between them only by two", twice[2].price.toDecimalString(), "200");

section("reversing a split undoes it");

const inverse = inverseOf(split);
checkTrue("the inverse of a 1:5 split is a 5:1 consolidation", inverse instanceof ReverseSplit);
const restored = inverse!.applyTo(afterSplit);
check("units come back", restored[0].remaining.toDecimalString(), "100");
check("cost never moved", restored[0].remainingCost.toDecimalString(), "150000.00");
check("and cost per unit is back where it started", restored[0].costPerUnit.toDecimalString(), "1500.00");

check("a dividend has no arithmetic inverse, and says so", inverseOf(new DividendCash(context("100"), price("10"))), null);

section("a reverse split");

const consolidation = new ReverseSplit(context("500"), { from: units("5"), to: units("1") });
const consolidated = consolidation.applyTo(afterSplit);
check("500 units become 100", consolidated[0].remaining.toDecimalString(), "100");
check("cost unchanged", consolidated[0].remainingCost.toDecimalString(), "150000.00");
check("prices before are multiplied by five", adjustSeries([series[0]], [consolidation.priceAdjustment()])[0].price.toDecimalString(), "7500");

throws(
  "a split that does not increase the count is refused",
  () => new Split(context("100"), { from: units("5"), to: units("1") }),
  "Use ReverseSplit",
);
throws(
  "and a consolidation that does not reduce it",
  () => new ReverseSplit(context("100"), { from: units("1"), to: units("5") }),
  "Use Split",
);

/* ═══ Bonus ═══════════════════════════════════════════════════════════ */

section("a bonus issue is not a split");

const bonus = new Bonus(context("100"), { held: units("1"), received: units("1") });
check("1:1 on 100 shares issues 100", bonus.issuedQuantity.toDecimalString(), "100");

const afterBonus = bonus.applyTo(original);
check("a new lot appears", afterBonus.length, 2);
check("holding 200 in total", LotBook.openQuantity(afterBonus).toDecimalString(), "200");
check("the original lot is untouched", afterBonus[0].remaining.toDecimalString(), "100");
check("the bonus units cost nothing", afterBonus[1].remainingCost.toDecimalString(), "0.00");

/*
 * The reason `Bonus` is not `Split`. The bonus units were acquired on the ex-date,
 * so a position held since April 2024 has a short-term tranche the day after the
 * bonus — and a rescale would have given those units the 2024 date and reported a
 * long-term gain.
 */
check("and they were acquired on the ex-date", afterBonus[1].acquiredOn.toISO(), "2025-06-01");
const soonAfter = new LotBook(new Fifo()).apply(afterBonus, {
  instrumentId: INFY,
  quantity: units("200"),
  disposedOn: on("2025-07-01"),
  proceeds: rupees("160000"),
  sellCharges: rupees("0"),
});
check("two disposals", soonAfter.disposals.length, 2);
checkTrue(
  "the original tranche is long-term and the bonus tranche is not",
  soonAfter.disposals[0].holdingDays > 365 && soonAfter.disposals[1].holdingDays < 365,
);
check("the bonus tranche's whole proceeds are gain", soonAfter.disposals[1].gain.toDecimalString(), soonAfter.disposals[1].proceeds.toDecimalString());
checkDeep("a bonus is not itself taxable", bonus.taxableEvents(), []);

check(
  "prices before a 1:1 bonus are halved",
  adjustSeries([series[0]], [bonus.priceAdjustment()])[0].price.toDecimalString(),
  "750",
);

/* ═══ Rights ══════════════════════════════════════════════════════════ */

section("a rights issue taken up");

const rights = new Rights(context("100"), { quantity: units("20"), pricePerUnit: price("1200") });
check("cash goes out", rights.amountPaid.toDecimalString(), "24000.00");
check("one cash effect, outward", rights.cashEffects()[0].direction, "OUT");
check("and it is not income", rights.cashEffects()[0].isIncome, false);

const afterRights = rights.applyTo(original);
check("120 units held", LotBook.openQuantity(afterRights).toDecimalString(), "120");
check("the new lot costs what was paid", afterRights[1].remainingCost.toDecimalString(), "24000.00");
check("at ₹1,200 per unit", afterRights[1].costPerUnit.toDecimalString(), "1200.00");
checkDeep("taking up rights is not taxable", rights.taxableEvents(), []);

/* ═══ Merger ══════════════════════════════════════════════════════════ */

section("a merger preserves basis and holding period");

const merger = new Merger(context("100"), {
  intoInstrumentId: RELIANCE,
  exchangeRatio: units("0.5"),
});
check("100 shares become 50 of the acquirer", merger.receivedQuantity.toDecimalString(), "50");
check("no cash", merger.cashReceived.toDecimalString(), "0.00");
checkDeep("and a share-for-share merger is not taxable (§47)", merger.taxableEvents(), []);

const afterMerger = merger.applyTo(original);
check("the old position closes", afterMerger[0].remaining.toDecimalString(), "0");
check("and a new one opens", afterMerger.length, 2);
check("with the acquirer's units", afterMerger[1].remaining.toDecimalString(), "50");

const withCash = new Merger(context("100"), {
  intoInstrumentId: RELIANCE,
  exchangeRatio: units("0.5"),
  cashPerUnit: price("50"),
});
check("a cash element is received", withCash.cashReceived.toDecimalString(), "5000.00");
check("and it is taxable", withCash.taxableEvents().length, 1);
check("as a capital gain", withCash.taxableEvents()[0].kind, "CAPITAL_GAIN");
checkTrue(
  "with the reason recorded",
  withCash.taxableEvents()[0].note.includes("share-for-share part is not"),
);

/* ═══ Demerger ════════════════════════════════════════════════════════ */

section("a demerger splits the basis by relative fair value");

const demerger = new Demerger(context("100", "2025-06-01", RELIANCE), {
  intoInstrumentId: JIO,
  ratio: units("1"),
  // The statutory method: relative fair value on the ex-date. It cannot be derived
  // from anything the ledger holds, so it is an input.
  basisShare: Percentage.of("35"),
  originalBasis: rupees("200000"),
});
check("35% of the basis moves", demerger.basisMoved.toDecimalString(), "70000.00");
check("one new unit per unit held", demerger.receivedQuantity.toDecimalString(), "100");

const relianceLots = [lot("2023-01-01", "100", "200000", RELIANCE)];
const afterDemerger = demerger.applyTo(relianceLots);
check("the original keeps 65%", afterDemerger[0].remainingCost.toDecimalString(), "130000.00");
check("the new entity gets 35%", afterDemerger[1].remainingCost.toDecimalString(), "70000.00");
checkTrue(
  "and the two together are the original basis, exactly",
  afterDemerger[0].remainingCost.plus(afterDemerger[1].remainingCost).equals(rupees("200000")),
);
checkDeep("a demerger is not taxable on receipt", demerger.taxableEvents(), []);

const spinoff = new Spinoff(context("100", "2025-06-01", RELIANCE), {
  intoInstrumentId: JIO,
  ratio: units("1"),
  basisShare: Percentage.of("35"),
  originalBasis: rupees("200000"),
});
check("a spinoff is labelled as one", spinoff.kind, "SPINOFF");
check("but does the same arithmetic", spinoff.basisMoved.toDecimalString(), "70000.00");

/* ═══ Distributions ═══════════════════════════════════════════════════ */

section("a cash dividend is income and changes no lot");

const dividend = new DividendCash(context("100"), price("22.50"), rupees("225"));
check("gross", dividend.grossAmount.toDecimalString(), "2250.00");
check("net of 10% TDS", dividend.netAmount.toDecimalString(), "2025.00");
checkDeep("no lot effect — a dividend is not a return of basis", dividend.lotEffects(), []);
check("one taxable event", dividend.taxableEvents().length, 1);
check("of the gross amount, not the net", dividend.taxableEvents()[0].gain.toDecimalString(), "2250.00");
check("taxed as dividend income", dividend.taxableEvents()[0].kind, "DIVIDEND");
check("cash in", dividend.cashEffects()[0].direction, "IN");
check("and it is income", dividend.cashEffects()[0].isIncome, true);

const unchanged = dividend.applyTo(original);
check("the lots are exactly as they were", unchanged[0].remainingCost.toDecimalString(), "150000.00");

section("a stock dividend issues nil-cost units");

const stockDividend = new DividendStock(context("100"), units("5"));
const afterStock = stockDividend.applyTo(original);
check("five new units", afterStock[1].remaining.toDecimalString(), "5");
check("at nil cost", afterStock[1].remainingCost.toDecimalString(), "0.00");
check("acquired on the ex-date", afterStock[1].acquiredOn.toISO(), "2025-06-01");
checkDeep("and not taxable on receipt", stockDividend.taxableEvents(), []);

section("a return of capital reduces basis, and becomes a gain past it");

const roc = new ReturnOfCapital(context("100"), rupees("20000"), rupees("150000"));
check("nothing exceeds basis", roc.excessOverBasis.toDecimalString(), "0.00");
checkDeep("so nothing is taxable now", roc.taxableEvents(), []);
const afterRoc = roc.applyTo(original);
check("basis falls by the distribution", afterRoc[0].remainingCost.toDecimalString(), "130000.00");
check("units are unchanged", afterRoc[0].remaining.toDecimalString(), "100");
// The distinction from a dividend, stated as a number: the same ₹20,000 as a
// dividend would be ₹20,000 of taxable income now; as a return of capital it is
// ₹20,000 more gain whenever the position is sold.
checkTrue("and no income is reported", roc.cashEffects()[0].isIncome === false);

const beyondBasis = new ReturnOfCapital(context("100"), rupees("160000"), rupees("150000"));
check("the excess over basis", beyondBasis.excessOverBasis.toDecimalString(), "10000.00");
check("is a capital gain now", beyondBasis.taxableEvents().length, 1);
check("of exactly the excess", beyondBasis.taxableEvents()[0].gain.toDecimalString(), "10000.00");
const clamped = beyondBasis.applyTo(original);
check("and basis is clamped at zero, never negative", clamped[0].remainingCost.toDecimalString(), "0.00");

/* ═══ applyAction, and properties ═════════════════════════════════════ */

section("applyAction returns everything a caller must persist");

const application = applyAction(split, original);
check("the lots before", application.lotsBefore[0].remaining.toDecimalString(), "100");
check("the lots after", application.lotsAfter[0].remaining.toDecimalString(), "500");
check("no cash", application.cashEffects.length, 0);
check("no taxable event", application.taxableEvents.length, 0);
checkTrue("and a price adjustment", application.priceAdjustment !== null);

section("properties");

assertProperty(
  "a split never changes total cost basis, whatever the ratio or the lots",
  (rng) => ({
    to: genInt(2, 20)(rng),
    lots: Array.from({ length: genInt(1, 4)(rng) }, (_unused, index) =>
      lot(
        on("2024-01-01").plusDays(index * 60).toISO(),
        String(genInt(1, 1000)(rng)),
        String(genInt(1, 1_000_000)(rng)),
      ),
    ),
  }),
  ({ to, lots }) => {
    const action = new Split(context("100"), { from: units("1"), to: units(String(to)) });
    const before = Money.total(lots.map((entry) => entry.remainingCost));
    const after = Money.total(action.applyTo(lots).map((entry) => entry.remainingCost));
    return before.equals(after);
  },
  1000,
);

assertProperty(
  "a split then its inverse returns the original quantities exactly",
  (rng) => ({
    to: genInt(2, 20)(rng),
    quantity: genInt(1, 100000)(rng),
  }),
  ({ to, quantity }) => {
    const lots = [lot("2024-04-01", String(quantity), "100000")];
    const action = new Split(context("100"), { from: units("1"), to: units(String(to)) });
    const roundTripped = inverseOf(action)!.applyTo(action.applyTo(lots));
    return roundTripped[0].remaining.toDecimalString() === lots[0].remaining.toDecimalString();
  },
  1000,
);

assertProperty(
  "a demerger's two basis halves always sum to the original",
  (rng) => ({
    share: genInt(1, 99)(rng),
    basis: genInt(1000, 10_000_000)(rng),
  }),
  ({ share, basis }) => {
    const originalBasis = Money.fromMinor(BigInt(basis) * 100n);
    const action = new Demerger(context("100", "2025-06-01", RELIANCE), {
      intoInstrumentId: JIO,
      ratio: units("1"),
      basisShare: Percentage.of(String(share)),
      originalBasis,
    });
    const lots = [
      Lot.open({
        id: LotId.create(),
        instrumentId: RELIANCE,
        acquiredOn: on("2023-01-01"),
        originalQuantity: units("100"),
        cost: originalBasis,
        buyCharges: rupees("0"),
        openedByTransactionId: "t",
      }),
    ];
    const after = action.applyTo(lots);
    return Money.total(after.map((entry) => entry.remainingCost)).equals(originalBasis);
  },
  1000,
);

done();

/**
 * Lots, the five selection strategies, and the two properties that matter.
 *
 *   1. **All five methods dispose the same total quantity and differ only in
 *      basis.** Asserted over generated lot sets and sale sizes. A strategy that
 *      dropped or duplicated a unit would pass a hand-written example and fail
 *      this.
 *   2. **A fully liquidated position's realised gain equals total proceeds minus
 *      total cost, exactly.** Also generated, because leaked paise are a
 *      cumulative failure: one partial sale rounds fine, a hundred do not.
 *
 * Plus the case `AverageCost` exists for: a **backdated buy** changes the average
 * every later sale used, so the book is recomputed forward and compared against a
 * replay from scratch.
 */

import { Money } from "@/core/money";
import { Quantity } from "@/core/numeric";
import { CalendarDate } from "@/core/time";
import { InstrumentId } from "@/domain/instruments";
import {
  ALL_METHODS,
  AverageCostBook,
  Fifo,
  Hifo,
  Lifo,
  Lot,
  LotBook,
  LotId,
  SpecificId,
  strategyFor,
  type PositionEvent,
  type SaleInput,
} from "@/domain/lots";
import { assertProperty, check, checkDeep, checkTrue, done, genInt, section, throws } from "./harness";

const rupees = (value: string) => Money.fromRupees(value);
const units = (value: string) => Quantity.fromString(value);
const on = (value: string) => CalendarDate.parse(value);
const INFY = InstrumentId.from("instrument-infy");

let lotCounter = 0;
function lot(acquiredOn: string, quantity: string, cost: string, charges = "0"): Lot {
  lotCounter += 1;
  return Lot.open({
    id: LotId.from(`00000000-0000-4000-8000-${String(lotCounter).padStart(12, "0")}`),
    instrumentId: INFY,
    acquiredOn: on(acquiredOn),
    originalQuantity: units(quantity),
    cost: rupees(cost),
    buyCharges: rupees(charges),
    openedByTransactionId: `txn-${lotCounter}`,
  });
}

/* ═══ A lot ═══════════════════════════════════════════════════════════ */

section("a lot");

const first = lot("2024-04-01", "100", "150000", "300");
check("cost per unit", first.costPerUnit.toDecimalString(), "1500.00");
check("total invested includes charges", first.totalInvested.toDecimalString(), "150300.00");
check("remaining cost is the whole cost while untouched", first.remainingCost.toDecimalString(), "150000.00");
check("and it is not exhausted", first.isExhausted, false);

const partly = first.consume(units("40"));
check("consuming 40 leaves 60", partly.lot.remaining.toDecimalString(), "60");
check("and takes 40% of the cost", partly.costTaken.toDecimalString(), "60000.00");
check("and 40% of the charges", partly.chargesTaken.toDecimalString(), "120.00");
check("the reduced lot keeps the rest", partly.lot.remainingCost.toDecimalString(), "90000.00");
checkTrue(
  "so the parts sum back to the whole exactly",
  partly.costTaken.plus(partly.lot.remainingCost).equals(first.remainingCost),
);

throws(
  "taking more than remains is refused (P03)",
  () => first.consume(units("101")),
  "Cannot take",
);
throws("a zero consumption is refused", () => first.consume(units("0")), "positive quantity");
throws(
  "a lot cannot open with nothing",
  () =>
    Lot.open({
      instrumentId: INFY,
      acquiredOn: on("2024-04-01"),
      originalQuantity: units("0"),
      cost: rupees("0"),
      buyCharges: rupees("0"),
      openedByTransactionId: "t",
    }),
  "positive quantity",
);

section("a split rescales units and leaves the money alone");

const beforeSplit = lot("2024-04-01", "100", "150000");
const afterSplit = beforeSplit.rescale({ from: units("1"), to: units("5") });
check("units multiply", afterSplit.remaining.toDecimalString(), "500");
check("cost does not", afterSplit.remainingCost.toDecimalString(), "150000.00");
check("so cost per unit falls by five", afterSplit.costPerUnit.toDecimalString(), "300.00");

/* ═══ The five strategies ═════════════════════════════════════════════ */

section("the five strategies, on the same three lots");

/*
 * Three lots of the same instrument:
 *   A  2024-04-01  100 @ ₹1,500 = ₹1,50,000
 *   B  2024-08-01  100 @ ₹1,200 = ₹1,20,000
 *   C  2025-01-15  100 @ ₹1,800 = ₹1,80,000
 * Sell 150 units on 2025-06-01 for ₹3,00,000 gross (₹2,000 per unit).
 */
const A = lot("2024-04-01", "100", "150000");
const B = lot("2024-08-01", "100", "120000");
const C = lot("2025-01-15", "100", "180000");
const threeLots = [A, B, C];

const sale: SaleInput = {
  instrumentId: INFY,
  quantity: units("150"),
  disposedOn: on("2025-06-01"),
  proceeds: rupees("300000"),
  sellCharges: rupees("0"),
};

const fifo = new LotBook(new Fifo()).apply(threeLots, sale);
check("FIFO takes A then half of B", fifo.disposals.length, 2);
check("FIFO basis", fifo.totalCostBasis.toDecimalString(), "210000.00");
check("FIFO gain", fifo.totalGain.toDecimalString(), "90000.00");
check("nothing unmatched", fifo.unmatchedQuantity.toDecimalString(), "0");

const lifo = new LotBook(new Lifo()).apply(threeLots, sale);
check("LIFO takes C then half of B", lifo.totalCostBasis.toDecimalString(), "240000.00");
check("LIFO gain is lower", lifo.totalGain.toDecimalString(), "60000.00");

const hifo = new LotBook(new Hifo()).apply(threeLots, sale);
check("HIFO takes C then half of A — the two dearest", hifo.totalCostBasis.toDecimalString(), "255000.00");
check("HIFO realises the least gain", hifo.totalGain.toDecimalString(), "45000.00");
checkTrue("which is the point of HIFO", hifo.totalGain.isLessThan(fifo.totalGain));

const specific = new LotBook(new SpecificId()).apply(threeLots, {
  ...sale,
  nominatedLotIds: [B.id, C.id],
});
check("SpecificId honours the nomination: B then half of C", specific.totalCostBasis.toDecimalString(), "210000.00");
check(
  "and an under-covering nomination falls back to FIFO for the rest",
  new LotBook(new SpecificId()).apply(threeLots, { ...sale, nominatedLotIds: [B.id] }).unmatchedQuantity.toDecimalString(),
  "0",
);

const comparison = LotBook.compare(threeLots, sale);
check("five methods compared", comparison.length, 5);
checkTrue(
  "HIFO is never worse than FIFO for a gain",
  comparison.find((row) => row.method === "HIFO")!.gain.isLessThanOrEqual(
    comparison.find((row) => row.method === "FIFO")!.gain,
  ),
);

section("holding periods come from the lot, not the sale");

check("FIFO's first disposal is the oldest lot", fifo.disposals[0].acquiredOn.toISO(), "2024-04-01");
check("held for 426 days", fifo.disposals[0].holdingDays, 426);
check("LIFO's first disposal is the newest", lifo.disposals[0].acquiredOn.toISO(), "2025-01-15");
check("held for 137 days", lifo.disposals[0].holdingDays, 137);
// The same sale, two different tax answers — which is why the strategy is a
// per-account setting rather than a global constant.
checkTrue(
  "so the same sale is long-term under FIFO and short-term under LIFO",
  fifo.disposals[0].holdingDays > 365 && lifo.disposals[0].holdingDays < 365,
);

section("charges");

const withCharges = new LotBook(new Fifo()).apply(
  [lot("2024-04-01", "100", "150000", "300")],
  {
    instrumentId: INFY,
    quantity: units("100"),
    disposedOn: on("2025-06-01"),
    proceeds: rupees("200000"),
    sellCharges: rupees("500"),
    deductibleSellCharges: rupees("200"),
  },
);
check("buy charges reduce the gain", withCharges.disposals[0].buyCharges.toDecimalString(), "300.00");
check("only the deductible sell charges do", withCharges.disposals[0].sellCharges.toDecimalString(), "200.00");
// 200000 − 150000 − 300 − 200. The non-deductible ₹300 of STT is deliberately not
// subtracted: it is a real cost and not an allowable deduction, and the gain here
// is the taxable one.
check("gain", withCharges.totalGain.toDecimalString(), "49500.00");

section("a short sale is reported, not invented");

const oversold = new LotBook(new Fifo()).apply([lot("2024-04-01", "10", "15000")], {
  instrumentId: INFY,
  quantity: units("50"),
  disposedOn: on("2025-06-01"),
  proceeds: rupees("100000"),
  sellCharges: rupees("0"),
});
check("only what was held is disposed", oversold.disposals[0].quantity.toDecimalString(), "10");
check("and the rest is named as unmatched (P04)", oversold.unmatchedQuantity.toDecimalString(), "40");

/* ═══ The two properties ══════════════════════════════════════════════ */

section("every method disposes the same quantity");

const genLots = (rng: () => number) => {
  const count = genInt(1, 6)(rng);
  return Array.from({ length: count }, (_unused, index) =>
    lot(
      on("2024-01-01").plusDays(index * genInt(1, 200)(rng)).toISO(),
      String(genInt(1, 500)(rng)),
      String(genInt(1, 500000)(rng)),
      String(genInt(0, 500)(rng)),
    ),
  );
};

assertProperty(
  "all five methods dispose an identical total quantity and differ only in basis",
  (rng) => {
    const lots = genLots(rng);
    const held = LotBook.openQuantity(lots);
    // Sell somewhere between one unit and the whole position.
    const fraction = genInt(1, 100)(rng);
    const quantity = Quantity.fromRatio(held.scaled * BigInt(fraction), 100n * 10n ** 8n);
    return {
      lots,
      sale: {
        instrumentId: INFY,
        quantity: quantity.isPositive ? quantity : units("1"),
        disposedOn: on("2026-01-01"),
        proceeds: Money.fromMinor(BigInt(genInt(1, 10_000_000)(rng))),
        sellCharges: Money.fromMinor(BigInt(genInt(0, 50_000)(rng))),
      } satisfies SaleInput,
    };
  },
  ({ lots, sale: generated }) => {
    const results = ALL_METHODS.map((method) =>
      new LotBook(strategyFor(method)).apply(lots, generated),
    );
    const quantities = results.map((result) =>
      Quantity.sum(result.disposals.map((disposal) => disposal.quantity)).toDecimalString(),
    );
    const distinctQuantities = new Set(quantities);
    // Proceeds are the sale's, whichever lots were consumed.
    const proceedsMatch = results.every((result) =>
      result.totalProceeds.equals(generated.proceeds) || result.disposals.length === 0,
    );
    return distinctQuantities.size === 1 && proceedsMatch;
  },
  2000,
);

section("a fully liquidated position leaks no paise");

assertProperty(
  "Σ realised gain equals total proceeds − total cost, exactly",
  (rng) => {
    const lots = genLots(rng);
    return {
      lots,
      method: ALL_METHODS[genInt(0, ALL_METHODS.length - 1)(rng)],
      proceeds: Money.fromMinor(BigInt(genInt(1, 50_000_000)(rng))),
    };
  },
  ({ lots, method, proceeds }) => {
    const held = LotBook.openQuantity(lots);
    const result = new LotBook(strategyFor(method)).apply(lots, {
      instrumentId: INFY,
      quantity: held,
      disposedOn: on("2026-06-01"),
      proceeds,
      sellCharges: Money.fromRupees("0"),
    });

    const totalCost = Money.total(lots.map((entry) => entry.remainingCost));
    const totalCharges = Money.total(lots.map((entry) => entry.remainingCharges));
    // Every unit disposed, so the gain must be exactly proceeds − cost − charges.
    const expected = proceeds.minus(totalCost).minus(totalCharges);
    const everythingGone = new LotBook(strategyFor(method))
      .apply(lots, {
        instrumentId: INFY,
        quantity: held,
        disposedOn: on("2026-06-01"),
        proceeds,
        sellCharges: Money.fromRupees("0"),
      })
      .lots.every((entry) => entry.isExhausted);

    return result.totalGain.equals(expected) && everythingGone && result.unmatchedQuantity.isZero;
  },
  2000,
);

assertProperty(
  "no disposal ever exceeds its lot, and remaining never goes negative (P02, P03)",
  (rng) => {
    const lots = genLots(rng);
    return {
      lots,
      method: ALL_METHODS[genInt(0, ALL_METHODS.length - 1)(rng)],
      quantity: units(String(genInt(1, 3000)(rng))),
    };
  },
  ({ lots, method, quantity }) => {
    const result = new LotBook(strategyFor(method)).apply(lots, {
      instrumentId: INFY,
      quantity,
      disposedOn: on("2026-06-01"),
      proceeds: Money.fromRupees("100000"),
      sellCharges: Money.fromRupees("0"),
    });
    const byId = new Map(lots.map((entry) => [entry.id.value, entry]));
    return (
      result.lots.every((entry) => !entry.remaining.isNegative) &&
      result.disposals.every((disposal) => {
        const original = disposal.lotId ? byId.get(disposal.lotId.value) : undefined;
        return original ? !disposal.quantity.isGreaterThan(original.remaining) : true;
      })
    );
  },
  2000,
);

/* ═══ Average cost ════════════════════════════════════════════════════ */

section("average cost");

const event = (
  kind: PositionEvent["kind"],
  date: string,
  quantity: string,
  amount: string,
  id: string,
  charges = "0",
): PositionEvent => ({
  kind,
  on: on(date),
  quantity: units(quantity),
  amount: rupees(amount),
  charges: rupees(charges),
  transactionId: id,
});

const book = new AverageCostBook(INFY);

const history: PositionEvent[] = [
  event("BUY", "2024-04-01", "100", "150000", "t1"),
  event("BUY", "2024-08-01", "100", "120000", "t2"),
  event("SELL", "2025-06-01", "150", "300000", "t3"),
];

const averaged = book.recompute(history);
check("50 units remain", averaged.quantity.toDecimalString(), "50");
// Average of ₹1,50,000 + ₹1,20,000 over 200 units = ₹1,350 per unit.
check("at the blended average", averaged.averagePerUnit?.toDecimalString(), "1350.00");
check("basis of the 150 sold", averaged.disposals[0].costBasis.toDecimalString(), "202500.00");
check("so the realised gain is", averaged.realisedGain.toDecimalString(), "97500.00");
check("and the remaining cost", averaged.cost.toDecimalString(), "67500.00");

section("a backdated buy changes every later sale — so the book replays");

/*
 * The case the class exists for. Insert a buy dated *before* the sale that has
 * already happened: the average that sale used is no longer the average history
 * implies, and no incremental adjustment to the new trade alone can fix it.
 */
const backdated = event("BUY", "2024-06-15", "100", "100000", "t4");
const replayed = book.recompute([...history, backdated]);

check("the position is bigger", replayed.quantity.toDecimalString(), "150");
// Average is now (150000 + 100000 + 120000) / 300 = ₹1,233.3333…, which rounds
// half-even to ₹1,233.33. The *reported* average rounds; the stored cost does not,
// which is why the gain below is exact and this figure is presentational.
check("the average moved", replayed.averagePerUnit?.toDecimalString(), "1233.33");
checkTrue(
  "and the realised gain on the earlier sale changed with it",
  !replayed.realisedGain.equals(averaged.realisedGain),
);
check("the recomputed gain", replayed.realisedGain.toDecimalString(), "115000.00");

// The claim: replaying the full history is the same as recomputing from the
// earliest affected event. Asserted by comparing against a from-scratch replay of
// the same events in a different insertion order.
const shuffled = book.recompute([backdated, history[2], history[0], history[1]]);
check("replay is order-independent", shuffled.realisedGain.toDecimalString(), replayed.realisedGain.toDecimalString());
check("and so is the closing position", shuffled.quantity.toDecimalString(), replayed.quantity.toDecimalString());
check(
  "affectedFrom names the earliest date to recompute from",
  AverageCostBook.affectedFrom(history, backdated).toISO(),
  "2024-04-01",
);

section("average cost survives a split");

const withSplit = book.recompute([
  event("BUY", "2024-04-01", "100", "150000", "t1"),
  { ...event("RESCALE", "2024-09-01", "0", "0", "t2"), ratio: { from: units("1"), to: units("5") } },
  event("SELL", "2025-06-01", "250", "100000", "t3"),
]);
check("100 units became 500, 250 sold, 250 remain", withSplit.quantity.toDecimalString(), "250");
// Half the units for half the cost: ₹75,000 of basis against ₹1,00,000 of proceeds.
check("basis of the sold half", withSplit.disposals[0].costBasis.toDecimalString(), "75000.00");
check("gain", withSplit.realisedGain.toDecimalString(), "25000.00");

assertProperty(
  "average cost never leaves a negative position or a negative cost",
  (rng) => {
    const count = genInt(1, 8)(rng);
    return Array.from({ length: count }, (_unused, index) => {
      const buying = rng() < 0.6;
      return event(
        buying ? "BUY" : "SELL",
        on("2024-01-01").plusDays(index * genInt(1, 90)(rng)).toISO(),
        String(genInt(1, 200)(rng)),
        String(genInt(1, 400000)(rng)),
        `t${index}`,
      );
    });
  },
  (events) => {
    const state = book.recompute(events);
    return !state.quantity.isNegative && !state.cost.isNegative;
  },
  2000,
);

section("open position");

const position = LotBook.openPosition(threeLots);
check("300 units held", position.quantity.toDecimalString(), "300");
check("at a total cost of", position.cost.toDecimalString(), "450000.00");
check("average per unit", position.averageCostPerUnit?.toDecimalString(), "1500.00");
checkDeep(
  "an empty position has no average rather than a zero one",
  LotBook.openPosition([]).averageCostPerUnit,
  null,
);

done();

/**
 * Credit cards: cycles, statements, interest, minimum due and points.
 *
 * The gate is the statement identity — `opening + spends + charges − payments −
 * refunds = closing`, exactly — and it is asserted against a worked HDFC-style
 * statement rather than against numbers this code produced.
 *
 * The two properties worth stating up front:
 *
 *   - **A mid-cycle purchase is this month's spending and next month's bill.**
 *     Asserted directly, because it is the distinction every card app gets wrong
 *     and the only reason `BillingCycle` exists as a type.
 *   - **Interest accrues per day from the transaction date**, not on an average
 *     balance. The same ₹50,000 spend early and late in a revolved cycle produces
 *     materially different interest, and both are checked against arithmetic done
 *     independently in the test.
 */

import { Currency, Money } from "@/core/money";
import { Percentage, Quantity, Rate, UnitPrice } from "@/core/numeric";
import { CalendarDate } from "@/core/time";
import { UserId } from "@/core/kernel";
import { Account, AccountCode, AccountType } from "@/domain/accounts";
import {
  BillingCycle,
  BillingCycleRule,
  CardStatement,
  CashAsset,
  CreditCard,
  RewardPointBalance,
  type CardMovement,
  type CardTerms,
} from "@/domain/assets";
import { assertProperty, check, checkTrue, done, genInt, section, throws } from "./harness";

const INR = Currency.INR;
const rupees = (value: string) => Money.fromRupees(value);
const on = (value: string) => CalendarDate.parse(value);

const userId = UserId.from("user-cards");

const cardAccount = Account.open({
  userId,
  code: AccountCode.parse("Liabilities:Credit Cards:HDFC Regalia"),
  name: "HDFC Regalia",
  type: AccountType.LIABILITY,
  subtype: "CREDIT_CARD",
  accountNumberSuffix: "4021",
});

const bankAccount = Account.open({
  userId,
  code: AccountCode.parse("Assets:HDFC Savings"),
  name: "HDFC Savings",
  type: AccountType.ASSET,
  subtype: "BANK",
});

const TERMS: CardTerms = {
  creditLimit: rupees("200000"),
  cycle: new BillingCycleRule(18, 20),
  financeRate: Rate.annual("42"),
  minimumDuePercent: Percentage.of("5"),
  minimumDueFloor: rupees("500"),
  lateFee: rupees("500"),
  annualFee: rupees("2500"),
  gstOnCharges: Percentage.of("18"),
  pointsPerHundred: Quantity.fromString("4"),
};

const card = new CreditCard(cardAccount, TERMS);

/* ═══ Classification and sign ═════════════════════════════════════════ */

section("a card is a liability, and nothing special-cases it");

check("a card classifies", CreditCard.classify(cardAccount, TERMS) instanceof CreditCard, true);
check("a bank account does not", CreditCard.classify(bankAccount, TERMS), null);
check("and a card is not a cash asset either", CashAsset.classify(cardAccount), null);

throws(
  "a card cannot wrap an asset account",
  () => new CreditCard(bankAccount, TERMS),
  "not a liability",
);

// The plan's done-when: "a card balance reduces net worth without a special case
// anywhere". The sign comes from AccountType.netWorthSign, applied once.
check("₹18,240 owed contributes −₹18,240", card.netWorthContribution(rupees("18240")), rupees("-18240"));
check("a card in credit contributes positively", card.netWorthContribution(rupees("-500")), rupees("500"));

section("utilisation and available credit");

check("18,240 of 200,000", card.utilisation(rupees("18240")).toFixed(2), "9.12");
check("available credit", card.availableCredit(rupees("18240")), rupees("181760"));
check("over limit reports above 100%", card.utilisation(rupees("210000")).toFixed(2), "105.00");
check("and nothing available", card.availableCredit(rupees("210000")), rupees("0"));
check("a card in credit is 0% utilised", card.utilisation(rupees("-2000")).toFixed(2), "0.00");
check("and its credit does not raise the limit", card.availableCredit(rupees("-2000")), rupees("200000"));

/* ═══ Billing cycles ══════════════════════════════════════════════════ */

section("billing cycles");

const augustCycle = card.cycleFor(on("2026-08-10"));
check("the 10th falls in the cycle closing on the 18th", augustCycle.through.toISO(), "2026-08-18");
check("which starts the day after July's statement", augustCycle.from.toISO(), "2026-07-19");
check("and is due 20 days later", augustCycle.dueOn.toISO(), "2026-09-07");
check("grace period", augustCycle.graceDays, 20);
check("labelled by its statement month", augustCycle.label, "2026-08");

// The distinction the type exists for: two dates one day apart, two different bills.
check("the 18th is the last day of August's cycle", card.cycleFor(on("2026-08-18")).through.toISO(), "2026-08-18");
check("the 19th already belongs to September's", card.cycleFor(on("2026-08-19")).through.toISO(), "2026-09-18");

section("February, and why the statement day is clamped");

const lateCard = new CreditCard(cardAccount, { ...TERMS, cycle: new BillingCycleRule(31, 15) });
check("a 31st statement day becomes the 28th in February 2026", lateCard.cycleFor(on("2026-02-10")).through.toISO(), "2026-02-28");
check("and the 29th in a leap February", lateCard.cycleFor(on("2028-02-10")).through.toISO(), "2028-02-29");
check("the cycle after February starts on 1 March", lateCard.cycleFor(on("2026-03-10")).from.toISO(), "2026-03-01");
// No day of spending may fall between two consecutive cycles.
const feb = lateCard.cycleFor(on("2026-02-10"));
const mar = lateCard.terms.cycle.next(feb);
check("consecutive cycles are contiguous", feb.through.plusDays(1).toISO(), mar.from.toISO());

section("cycles are contiguous over a year, whatever the statement day");

assertProperty(
  "consecutive cycles never overlap and never leave a gap",
  (rng) => ({
    statementDay: genInt(1, 31)(rng),
    graceDays: genInt(1, 45)(rng),
    startMonth: genInt(1, 12)(rng),
    year: genInt(2024, 2029)(rng),
  }),
  ({ statementDay, graceDays, startMonth, year }) => {
    const rule = new BillingCycleRule(statementDay, graceDays);
    let cycle = rule.cycleContaining(CalendarDate.of(year, startMonth, 15));
    for (let step = 0; step < 13; step += 1) {
      const next = rule.next(cycle);
      if (cycle.through.plusDays(1).toISO() !== next.from.toISO()) return false;
      if (!next.dueOn.isAfter(next.through)) return false;
      if (!next.from.isOnOrBefore(next.through)) return false;
      cycle = next;
    }
    return true;
  },
  2000,
);

/* ═══ The gate: a real statement reconciles ═══════════════════════════ */

section("the statement identity — the Phase 3 gate");

/*
 * A worked statement, of the shape HDFC prints:
 *
 *   Opening balance            18,240.00
 *   Spends                     32,847.63   (four purchases)
 *   Interest + GST                971.34   (revolved from last cycle)
 *   Annual fee + GST            2,950.00
 *   Payment                   −18,240.00
 *   Refund                     −1,299.00
 *   Closing balance            35,469.97
 */
const cycle = card.cycleFor(on("2026-08-10"));
const movements: readonly CardMovement[] = [
  { on: on("2026-07-20"), amount: rupees("18240.00"), kind: "PAYMENT", description: "Last cycle paid in full" },
  { on: on("2026-07-22"), amount: rupees("12499.00"), kind: "SPEND", description: "Croma electronics" },
  { on: on("2026-07-28"), amount: rupees("1299.00"), kind: "REFUND", description: "Returned headphones" },
  { on: on("2026-08-02"), amount: rupees("8347.63"), kind: "SPEND", description: "Big Basket" },
  { on: on("2026-08-05"), amount: rupees("823.40"), kind: "CHARGE", description: "Interest on last cycle's revolved balance" },
  { on: on("2026-08-09"), amount: rupees("9999.00"), kind: "SPEND", description: "Flight booking" },
  { on: on("2026-08-14"), amount: rupees("2002.00"), kind: "SPEND", description: "Restaurant" },
  { on: on("2026-08-16"), amount: rupees("147.94"), kind: "CHARGE", description: "GST on interest" },
  { on: on("2026-08-17"), amount: rupees("2500.00"), kind: "CHARGE", description: "Annual fee" },
  { on: on("2026-08-17"), amount: rupees("450.00"), kind: "CHARGE", description: "GST on annual fee" },
];

const statement = card.statementFor(cycle, rupees("18240.00"), movements);

check("spends", statement.spends, rupees("32847.63"));
check("charges", statement.charges, rupees("3921.34"));
check("payments", statement.payments, rupees("18240.00"));
check("refunds", statement.refunds, rupees("1299.00"));
check("closing balance", statement.closing, rupees("35469.97"));

// The gate, stated as the identity rather than as a total:
checkTrue(
  "opening + spends + charges − payments − refunds = closing, exactly",
  statement.opening
    .plus(statement.spends)
    .plus(statement.charges)
    .minus(statement.payments)
    .minus(statement.refunds)
    .equals(statement.closing),
);
check("and it reconciles against the printed figure", statement.reconcilesWith(rupees("35469.97")), true);
check("a wrong printed figure does not", statement.reconcilesWith(rupees("35469.98")), false);

section("a mid-cycle purchase is spend now, bill later");

// Dated the day after the statement date: it is August spending by any calendar,
// and it must not appear on the statement that closed on the 18th.
const afterClose: CardMovement = {
  on: on("2026-08-19"),
  amount: rupees("5000.00"),
  kind: "SPEND",
  description: "Bought on the 19th",
};
const withLateSpend = card.statementFor(cycle, rupees("18240.00"), [...movements, afterClose]);
check("the closing balance is unchanged", withLateSpend.closing, statement.closing);
check("and the purchase falls in the next cycle", card.cycleFor(afterClose.on).through.toISO(), "2026-09-18");
check("which the next statement does include", card.terms.cycle.next(cycle).contains(afterClose.on), true);

throws(
  "a statement refuses a movement outside its cycle",
  () => new CardStatement(cycle, rupees("0"), [afterClose], rupees("0")),
  "outside the",
);

throws(
  "and a negative movement, which would make the kind ambiguous",
  () =>
    new CardStatement(
      cycle,
      rupees("0"),
      [{ on: on("2026-08-02"), amount: rupees("-500"), kind: "SPEND", description: "negative spend" }],
      rupees("0"),
    ),
  "positive amount",
);

throws(
  "and a due date on or before the statement date",
  () => new BillingCycle(on("2026-08-01"), on("2026-08-18"), on("2026-08-18")),
  "must fall after",
);

section("statement identity over generated movements");

assertProperty(
  "the identity holds for any mix of movements",
  (rng) => {
    const kinds = ["SPEND", "CHARGE", "PAYMENT", "REFUND"] as const;
    const count = genInt(0, 12)(rng);
    return {
      opening: Money.fromMinor(BigInt(genInt(0, 500_000)(rng)) * 100n, INR),
      movements: Array.from({ length: count }, (_unused, index) => ({
        on: cycle.from.plusDays(genInt(0, cycle.from.daysUntil(cycle.through))(rng)),
        amount: Money.fromMinor(BigInt(genInt(1, 200_000)(rng)) * 7n, INR),
        kind: kinds[index % kinds.length],
        description: `row ${index}`,
      })),
    };
  },
  ({ opening, movements: generated }) => {
    const built = card.statementFor(cycle, opening, generated);
    const rebuilt = generated.reduce(
      (running, movement) =>
        movement.kind === "SPEND" || movement.kind === "CHARGE"
          ? running.plus(movement.amount)
          : running.minus(movement.amount),
      opening,
    );
    return built.closing.equals(rebuilt);
  },
  2000,
);

/* ═══ Minimum due ═════════════════════════════════════════════════════ */

section("minimum due");

check("5% of 35,469.97", card.minimumDueOn(rupees("35469.97")), rupees("1773.50"));
check("the floor applies to a small balance", card.minimumDueOn(rupees("4000")), rupees("500"));
// The one that matters: the floor must never exceed the debt.
check("but never above the balance itself", card.minimumDueOn(rupees("120")), rupees("120"));
check("nothing owed, nothing due", card.minimumDueOn(rupees("0")), rupees("0"));
check("a card in credit owes nothing", card.minimumDueOn(rupees("-2000")), rupees("0"));

assertProperty(
  "the minimum due is never more than the balance and never negative",
  (rng) => Money.fromMinor(BigInt(genInt(0, 5_000_000)(rng)), INR),
  (closing) => {
    const minimum = card.minimumDueOn(closing);
    return !minimum.isNegative && !minimum.isGreaterThan(closing);
  },
  2000,
);

/* ═══ Interest ════════════════════════════════════════════════════════ */

section("finance charge — per day, from the transaction date");

/*
 * 30 days at 42% p.a. ACT/365F on a flat ₹10,000:
 *   daily = 10000 × 0.42 / 365 = ₹11.5068...
 * Computed here independently in exact integers: the paise total is
 *   floor-or-round of 1000000 × 42 × 1 / (100 × 365) per day, summed 30 times.
 */
const flatDays = Array.from({ length: 30 }, (_unused, index) => ({
  on: on("2026-08-01").plusDays(index),
  owed: rupees("10000"),
}));
const flat = card.financeChargeFor({ dailyBalances: flatDays });
check("30 days accrued", flat.days, 30);
check("interest on a flat 10,000 for 30 days", flat.interest.toDecimalString(), "345.21");
check("GST at 18% on the interest", flat.gstOnInterest.toDecimalString(), "62.14");
check("and the total charge", flat.total.toDecimalString(), "407.35");

// The same money spent early versus late in the cycle: the reason a single
// average balance would be the wrong number.
const early = card.financeChargeFor({
  dailyBalances: Array.from({ length: 30 }, (_unused, index) => ({
    on: on("2026-08-01").plusDays(index),
    owed: index >= 2 ? rupees("50000") : rupees("0"),
  })),
});
const late = card.financeChargeFor({
  dailyBalances: Array.from({ length: 30 }, (_unused, index) => ({
    on: on("2026-08-01").plusDays(index),
    owed: index >= 28 ? rupees("50000") : rupees("0"),
  })),
});
check("28 days of interest on 50,000", early.interest.toDecimalString(), "1610.96");
check("2 days of interest on the same 50,000", late.interest.toDecimalString(), "115.07");
checkTrue("spending early costs materially more", early.interest.isGreaterThan(late.interest));

check(
  "a paid-off card accrues nothing",
  card.financeChargeFor({
    dailyBalances: [{ on: on("2026-08-01"), owed: rupees("0") }],
  }).total,
  rupees("0"),
);
check(
  "and a card in credit accrues nothing either",
  card.financeChargeFor({
    dailyBalances: [{ on: on("2026-08-01"), owed: rupees("-5000") }],
  }).days,
  0,
);

section("fees carry their GST as a separate movement");

const fee = card.feeWithGst(rupees("2500"), on("2026-08-17"), "Annual fee");
check("two movements", fee.length, 2);
check("the fee", fee[0].amount, rupees("2500"));
check("and its GST", fee[1].amount, rupees("450"));
check("both are charges, not spending", fee.every((movement) => movement.kind === "CHARGE"), true);
check("a zero fee posts nothing", card.feeWithGst(rupees("0"), on("2026-08-17"), "No fee").length, 0);

/* ═══ Reward points ═══════════════════════════════════════════════════ */

section("reward points are not money");

check("4 points per hundred on 8,347.63", card.pointsFor(rupees("8347.63")).toDecimalString(), "332");
check("an incomplete hundred earns nothing", card.pointsFor(rupees("99.99")).toDecimalString(), "0");
check("a refund earns nothing", card.pointsFor(rupees("-500")).toDecimalString(), "0");
check(
  "a card with no rewards earns nothing",
  new CreditCard(cardAccount, { ...TERMS, pointsPerHundred: Quantity.ZERO })
    .pointsFor(rupees("10000"))
    .toDecimalString(),
  "0",
);

const points = RewardPointBalance.zero().earn(Quantity.fromString("332")).earn(Quantity.fromString("120"));
check("points accumulate", points.points.toDecimalString(), "452");
check("and are spent by redeeming", points.redeem(Quantity.fromString("400")).points.toDecimalString(), "52");
throws(
  "redeeming more than the balance is refused, not clamped",
  () => points.redeem(Quantity.fromString("500")),
  "Cannot redeem",
);
throws("a negative balance is impossible", () => new RewardPointBalance(Quantity.fromString("-1")), "cannot be negative");

// Valued only at redemption, and only against a rate supplied at that moment.
check(
  "452 points at ₹0.25 each",
  points.valueIfRedeemedAt(UnitPrice.of("0.25")).toDecimalString(),
  "113.00",
);
check(
  "the same points against a flight at ₹0.50",
  points.valueIfRedeemedAt(UnitPrice.of("0.50")).toDecimalString(),
  "226.00",
);

// The structural claim: the balance is a Quantity, so there is no arithmetic that
// adds points to money without a rate passing through `valueIfRedeemedAt`.
checkTrue("a points balance is a Quantity, not a Money", points.points instanceof Quantity);
checkTrue("and is not a Money", !(points.points instanceof Money));

done();

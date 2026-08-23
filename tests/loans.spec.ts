/**
 * Loan mathematics, and the four invariants that make a schedule trustworthy.
 *
 * N01 (`Σ principal` equals the principal exactly), N02 (the final closing balance
 * is exactly zero) and N03 (`opening − principal = closing` on every row) are
 * asserted over **generated** rates, terms and frequencies, not over a handful of
 * examples. That matters because the failure mode is arithmetic drift: a schedule
 * built without the mandatory final-period adjustment ends a few paise short, and
 * a few paise is exactly the amount that looks like nothing and never closes.
 *
 * The EMI itself is checked against figures worked independently — a ₹50,00,000
 * home loan at 8.5% over 20 years is ₹43,391 a month, a number any Indian lender's
 * calculator will print.
 */

import { Money } from "@/core/money";
import { Percentage, Rate } from "@/core/numeric";
import { CalendarDate } from "@/core/time";
import { UserId } from "@/core/kernel";
import { Account, AccountCode, AccountType } from "@/domain/accounts";
import {
  EducationLoan,
  HomeLoan,
  PersonalLoan,
  comparePayoffStrategies,
  equatedInstalment,
  loanFor,
  payoffPlan,
  type LoanTerms,
  type PayoffDebt,
} from "@/domain/loans";
import { assertProperty, check, checkTrue, done, genInt, genOneOf, section, throws } from "./harness";

const rupees = (value: string) => Money.fromRupees(value);
const on = (value: string) => CalendarDate.parse(value);
const userId = UserId.from("user-loans");

const loanAccount = (name: string) =>
  Account.open({
    userId,
    code: AccountCode.parse(`Liabilities:Loans:${name}`),
    name,
    type: AccountType.LIABILITY,
    subtype: "LOAN",
  });

const home = loanAccount("HDFC Home Loan");
const personal = loanAccount("Bajaj Personal Loan");
const assetAccount = Account.open({
  userId,
  code: AccountCode.parse("Assets:HDFC"),
  name: "HDFC",
  type: AccountType.ASSET,
  subtype: "BANK",
});

/* ═══ EMI ═════════════════════════════════════════════════════════════ */

section("the equated instalment");

// ₹50,00,000 at 8.5% p.a. over 240 months. Any lender's calculator: ₹43,391.
check(
  "a 20-year home loan at 8.5%",
  equatedInstalment(rupees("5000000"), Rate.annual("8.5"), 240).toDecimalString(),
  "43391.16",
);
// ₹5,00,000 at 14% over 60 months. Worked independently:
//   r = 0.14/12, (1+r)^60 = 2.005617…, EMI = 500000·r·(1+r)^60 / ((1+r)^60 − 1).
check(
  "a five-year personal loan at 14%",
  equatedInstalment(rupees("500000"), Rate.annual("14"), 60).toDecimalString(),
  "11634.13",
);
// ₹8,00,000 at 9.2% over 84 months: r = 0.092/12, (1+r)^84 = 1.899444…
check(
  "a seven-year car loan at 9.2%",
  equatedInstalment(rupees("800000"), Rate.annual("9.2"), 84).toDecimalString(),
  "12952.61",
);
check(
  "a zero-interest scheme is the principal spread evenly",
  equatedInstalment(rupees("36000"), Rate.annual("0"), 12).toDecimalString(),
  "3000.00",
);
check(
  "and it rounds up, so no 13th payment is left over",
  equatedInstalment(rupees("10000"), Rate.annual("0"), 3).toDecimalString(),
  "3333.34",
);
check(
  "quarterly payments are priced off a quarterly rate",
  equatedInstalment(rupees("1000000"), Rate.annual("12"), 20, "QUARTERLY").toDecimalString(),
  "67215.71",
);

throws("a zero-period loan is refused", () => equatedInstalment(rupees("1000"), Rate.annual("10"), 0), "whole number");
throws("a negative rate is refused", () => equatedInstalment(rupees("1000"), Rate.annual("-1"), 12), "cannot be negative");

/* ═══ The schedule and its invariants ═════════════════════════════════ */

section("N01–N03 on a worked schedule");

const HOME_TERMS: LoanTerms = {
  principal: rupees("5000000"),
  annualRate: Rate.annual("8.5"),
  periods: 240,
  frequency: "MONTHLY",
  disbursedOn: on("2026-04-01"),
  interestType: "REDUCING_BALANCE",
};
const homeLoan = new HomeLoan(home, HOME_TERMS);
const schedule = homeLoan.schedule();

check("240 rows", schedule.rows.length, 240);
check("N01: the principal column sums to the principal exactly", schedule.principalRepaid, rupees("5000000"));
check("N02: the final closing balance is exactly zero", schedule.rows[239].closing, rupees("0"));
check("the loan closes on the last payment date", schedule.closedOn?.toISO(), homeLoan.paymentDate(240).toISO());
check("the final row is marked as adjusted", schedule.rows[239].note?.includes("adjusted"), true);
checkTrue("the final instalment differs from the rest", !schedule.rows[239].instalment.equals(schedule.rows[0].instalment));

// The first row: interest is 8.5%/12 of the whole principal.
check("first interest", schedule.rows[0].interest.toDecimalString(), "35416.67");
check("first principal", schedule.rows[0].principal.toDecimalString(), "7974.49");
check("total paid over the loan", schedule.totalPaid.toDecimalString(), "10413879.44");
check("of which interest", schedule.totalInterest.toDecimalString(), "5413879.44");

let n03Failures = 0;
for (const row of schedule.rows) {
  if (!row.opening.minus(row.principal).equals(row.closing)) n03Failures += 1;
}
check("N03: opening − principal = closing on every row", n03Failures, 0);
checkTrue(
  "and total paid is principal plus interest",
  schedule.totalPaid.equals(schedule.principalRepaid.plus(schedule.totalInterest)),
);

section("N01–N03 over generated loans");

assertProperty(
  "every schedule repays exactly the principal and closes at exactly zero",
  (rng) => ({
    principalMinor: BigInt(genInt(1, 5_000_000)(rng)) * 100n,
    rateScaled: genInt(0, 4500)(rng), // 0% – 45% in hundredths
    periods: genInt(1, 360)(rng),
    frequency: genOneOf(["MONTHLY", "QUARTERLY", "ANNUALLY"] as const)(rng),
  }),
  ({ principalMinor, rateScaled, periods, frequency }) => {
    const loan = new PersonalLoan(personal, {
      principal: Money.fromMinor(principalMinor),
      annualRate: Rate.annual((rateScaled / 100).toFixed(2)),
      periods,
      frequency,
      disbursedOn: on("2026-01-01"),
      interestType: "REDUCING_BALANCE",
    });
    const built = loan.schedule();
    if (!built.principalRepaid.equals(Money.fromMinor(principalMinor))) return false;
    if (!built.rows[built.rows.length - 1].closing.isZero) return false;
    return built.rows.every((row) => row.opening.minus(row.principal).equals(row.closing));
  },
  3000,
);

assertProperty(
  "no row ever has a negative closing balance or a negative interest charge",
  (rng) => ({
    principalMinor: BigInt(genInt(1, 1_000_000)(rng)) * 100n,
    rateScaled: genInt(0, 6000)(rng),
    periods: genInt(1, 120)(rng),
  }),
  ({ principalMinor, rateScaled, periods }) => {
    const loan = new PersonalLoan(personal, {
      principal: Money.fromMinor(principalMinor),
      annualRate: Rate.annual((rateScaled / 100).toFixed(2)),
      periods,
      frequency: "MONTHLY",
      disbursedOn: on("2026-01-01"),
      interestType: "REDUCING_BALANCE",
    });
    return loan
      .schedule()
      .rows.every((row) => !row.closing.isNegative && !row.interest.isNegative && !row.principal.isNegative);
  },
  2000,
);

/* ═══ Flat versus reducing ════════════════════════════════════════════ */

section("flat versus reducing — the number a lender does not print");

const flatLoan = new PersonalLoan(personal, {
  principal: rupees("100000"),
  annualRate: Rate.annual("10"),
  periods: 36,
  frequency: "MONTHLY",
  disbursedOn: on("2026-04-01"),
  interestType: "FLAT",
});

// Flat: ₹1,00,000 + 10% × 3 years = ₹1,30,000 over 36 months.
check("a flat instalment", flatLoan.instalment().toDecimalString(), "3611.12");
const flatSchedule = flatLoan.schedule();
check("N01 holds for a flat loan too", flatSchedule.principalRepaid, rupees("100000"));
check("N02 holds", flatSchedule.rows[flatSchedule.rows.length - 1].closing, rupees("0"));

const comparison = flatLoan.quotedVersusEffective();
check("the quoted rate", comparison.quoted.percent.toFixed(2), "10.00");
checkTrue(
  "the effective rate is far higher — this is the point of showing both",
  comparison.effective.percent.toApproximateNumber() > 17,
);
checkTrue("and it is not double-counted as more than 20%", comparison.effective.percent.toApproximateNumber() < 20);

// Sanity: the effective rate reproduces the flat instalment through the ordinary
// reducing-balance formula, to within a paisa.
const reconstructed = equatedInstalment(rupees("100000"), comparison.effective, 36);
checkTrue(
  "the solved rate reproduces the flat instalment",
  reconstructed.minus(flatLoan.instalment()).abs().isLessThanOrEqual(rupees("0.01")),
);

check(
  "a reducing-balance loan's effective rate is its quoted rate",
  homeLoan.quotedVersusEffective().effective.percent.toFixed(2),
  "8.50",
);

assertProperty(
  "a flat loan's effective rate always exceeds its quoted rate",
  (rng) => ({
    rateScaled: genInt(100, 3000)(rng),
    periods: genInt(6, 84)(rng),
  }),
  ({ rateScaled, periods }) => {
    const loan = new PersonalLoan(personal, {
      principal: rupees("100000"),
      annualRate: Rate.annual((rateScaled / 100).toFixed(2)),
      periods,
      frequency: "MONTHLY",
      disbursedOn: on("2026-01-01"),
      interestType: "FLAT",
    });
    const { quoted, effective } = loan.quotedVersusEffective();
    return effective.scaled > quoted.scaled;
  },
  1000,
);

/* ═══ Prepayment ══════════════════════════════════════════════════════ */

section("prepayment");

const withTermReduction = new HomeLoan(home, {
  ...HOME_TERMS,
  prepayments: [{ on: on("2031-04-01"), amount: rupees("1000000"), reduces: "TERM" }],
});
const termCut = withTermReduction.schedule();
check("N01 still holds with a prepayment", termCut.principalRepaid, rupees("5000000"));
check("N02 still holds", termCut.rows[termCut.rows.length - 1].closing, rupees("0"));
checkTrue("the loan closes earlier", termCut.rows.length < 241 && termCut.closedOn!.isBefore(on("2046-04-01")));
checkTrue(
  "and total interest falls",
  termCut.totalInterest.isLessThan(schedule.totalInterest),
);

const withInstalmentReduction = new HomeLoan(home, {
  ...HOME_TERMS,
  prepayments: [{ on: on("2031-04-01"), amount: rupees("1000000"), reduces: "INSTALMENT" }],
});
const instalmentCut = withInstalmentReduction.schedule();
check("N01 holds here too", instalmentCut.principalRepaid, rupees("5000000"));
checkTrue(
  "reducing the term saves more interest than reducing the instalment",
  termCut.totalInterest.isLessThan(instalmentCut.totalInterest),
);
checkTrue(
  "but the instalment does fall",
  instalmentCut.rows.find((row) => row.period > 60 && !row.note)!.instalment.isLessThan(
    schedule.rows[0].instalment,
  ),
);

const paidOff = new HomeLoan(home, {
  ...HOME_TERMS,
  prepayments: [{ on: on("2027-04-01"), amount: rupees("9000000"), reduces: "TERM" }],
});
const closed = paidOff.schedule();
check("an over-large prepayment closes the loan and no more", closed.principalRepaid, rupees("5000000"));
check("on the day it was made", closed.closedOn?.toISO(), "2027-04-01");

const penalised = new HomeLoan(home, {
  ...HOME_TERMS,
  prepaymentPenalty: Percentage.of("2"),
  prepayments: [{ on: on("2031-04-01"), amount: rupees("1000000"), reduces: "TERM" }],
});
const penalisedSchedule = penalised.schedule();
const penaltyRow = penalisedSchedule.rows.find((row) => row.note?.includes("Prepayment"))!;
check("a 2% penalty is charged on the prepayment", penaltyRow.interest.toDecimalString(), "20000.00");
check("and the principal applied is unchanged", penaltyRow.principal.toDecimalString(), "1000000.00");

/* ═══ Outstanding and interest windows ═══════════════════════════════ */

section("outstanding balance and interest by period");

check("nothing is owed before disbursement", homeLoan.outstandingOn(on("2026-03-31")), rupees("0"));
check(
  "the full principal is owed before the first payment",
  homeLoan.outstandingOn(on("2026-04-15")),
  rupees("5000000"),
);
check(
  "after one payment",
  homeLoan.outstandingOn(on("2026-05-01")).toDecimalString(),
  "4992025.51",
);
check("and nothing at the end", homeLoan.outstandingOn(on("2046-05-01")), rupees("0"));

// §24(b): interest on a self-occupied home is deductible up to ₹2 lakh a year.
const fy2026 = homeLoan.interestWithin(on("2026-04-01"), on("2027-03-31"));
checkTrue("the first year's interest exceeds the cap", fy2026.isGreaterThan(rupees("200000")));
check(
  "so the deduction is capped at 2 lakh",
  homeLoan.deductibleInterest(on("2026-04-01"), on("2027-03-31")).toDecimalString(),
  "200000.00",
);
check(
  "a let-out property has no cap",
  homeLoan.deductibleInterest(on("2026-04-01"), on("2027-03-31"), false).toDecimalString(),
  fy2026.toDecimalString(),
);

const education = new EducationLoan(personal, {
  principal: rupees("1000000"),
  annualRate: Rate.annual("10.5"),
  periods: 96,
  frequency: "MONTHLY",
  disbursedOn: on("2026-04-01"),
  interestType: "REDUCING_BALANCE",
});
checkTrue(
  "§80E has no cap, so the whole year's interest is deductible",
  education
    .deductibleInterest(on("2026-04-01"), on("2027-03-31"))
    .equals(education.interestWithin(on("2026-04-01"), on("2027-03-31"))),
);

throws(
  "a loan cannot wrap an asset account",
  () => new PersonalLoan(assetAccount, HOME_TERMS),
  "not a liability",
);

section("stored terms rebuild the right subclass");

const rebuilt = loanFor(home, {
  accountId: home.id,
  kind: "HOME",
  principal: rupees("5000000"),
  annualRate: Rate.annual("8.5"),
  periods: 240,
  frequency: "MONTHLY",
  disbursedOn: on("2026-04-01"),
  firstPaymentOn: null,
  interestType: "REDUCING_BALANCE",
  prepaymentPenalty: null,
});
checkTrue("a HOME loan rebuilds as a HomeLoan", rebuilt instanceof HomeLoan);
check("with the same instalment", rebuilt.instalment().toDecimalString(), homeLoan.instalment().toDecimalString());

/* ═══ Payoff strategies ═══════════════════════════════════════════════ */

section("avalanche versus snowball");

const debts: readonly PayoffDebt[] = [
  {
    id: "card",
    label: "Credit card",
    balance: rupees("80000"),
    annualRate: Rate.annual("42"),
    minimumPayment: rupees("4000"),
  },
  {
    id: "personal",
    label: "Personal loan",
    balance: rupees("200000"),
    annualRate: Rate.annual("16"),
    minimumPayment: rupees("6000"),
  },
  {
    id: "phone",
    label: "Phone EMI",
    balance: rupees("18000"),
    annualRate: Rate.annual("22"),
    minimumPayment: rupees("1500"),
  },
];

const budget = rupees("20000");
const avalanche = payoffPlan(debts, budget, "AVALANCHE");
const snowball = payoffPlan(debts, budget, "SNOWBALL");

check("avalanche clears the highest rate first", avalanche.order[0], "Credit card");
check("snowball clears the smallest balance first", snowball.order[0], "Phone EMI");
checkTrue("both clear everything", avalanche.months[avalanche.months.length - 1].remaining.isZero);
checkTrue("both clear everything, the other way too", snowball.months[snowball.months.length - 1].remaining.isZero);

const compared = comparePayoffStrategies(debts, budget);
checkTrue(
  "avalanche never pays more interest than snowball",
  !compared.avalanche.totalInterest.isGreaterThan(compared.snowball.totalInterest),
);
checkTrue("and the saving is a real, quotable figure", compared.interestSavedByAvalanche.isPositive);

throws(
  "a budget below the minimums is refused rather than projected",
  () => payoffPlan(debts, rupees("5000"), "AVALANCHE"),
  "never close",
);

assertProperty(
  "avalanche is never worse than snowball, for any budget above the minimums",
  (rng) => rupees(String(11_500 + genInt(0, 40_000)(rng))),
  (monthlyBudget) => {
    const result = comparePayoffStrategies(debts, monthlyBudget);
    return !result.avalanche.totalInterest.isGreaterThan(result.snowball.totalInterest);
  },
  300,
);

done();

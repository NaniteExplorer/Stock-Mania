/**
 * Deposits and retirement products.
 *
 * Maturity values are checked two ways. The first is against the figure a bank's
 * certificate prints (₹1,00,000 at 7.1% for five years, compounded quarterly, is
 * ₹1,42,174.67). The second is against an **independently computed** factor: the test
 * multiplies by `(1 + r/4)` twenty times as an exact rational, while
 * `compoundFactor` raises the rational to the 20th power in one step. Two different
 * routes through the same arithmetic have to agree, which is what makes the
 * exponentiation trustworthy rather than merely plausible.
 *
 * The other property under test is the one the plan cares about most: **nothing
 * accrues on a schedule**. `valueOn` is a pure function of the terms and the date,
 * so calling it twice, in any order, from any starting point, gives the same
 * answer — which is precisely what a nightly balance-mutating job cannot promise.
 */

import { Currency, Money } from "@/core/money";
import { Percentage, Quantity, Rate, UnitPrice } from "@/core/numeric";
import { CalendarDate, DateRange, FinancialYear } from "@/core/time";
import { UserId } from "@/core/kernel";
import { Account, AccountCode, AccountType } from "@/domain/accounts";
import {
  EmployeeProvidentFund,
  FixedDeposit,
  NationalPensionSystem,
  PPF_ANNUAL_LIMIT,
  PublicProvidentFund,
  RecurringDeposit,
  compoundFactor,
  simpleInterest,
  type EpfTerms,
  type FixedDepositTerms,
  type NpsScheme,
} from "@/domain/deposits";
import { assertProperty, check, checkDeep, checkTrue, done, genInt, section, throws } from "./harness";

const rupees = (value: string) => Money.fromRupees(value);
const on = (value: string) => CalendarDate.parse(value);
const userId = UserId.from("user-deposits");

const depositAccount = (name: string, subtype: "DEPOSIT" | "RETIREMENT" = "DEPOSIT") =>
  Account.open({
    userId,
    code: AccountCode.parse(`Assets:${name}`),
    name,
    type: AccountType.ASSET,
    subtype,
  });

const fdAccount = depositAccount("HDFC FD 5yr");
const rdAccount = depositAccount("SBI RD");
const ppfAccount = depositAccount("PPF", "RETIREMENT");
const epfAccount = depositAccount("EPF", "RETIREMENT");
const npsAccount = depositAccount("NPS Tier I", "RETIREMENT");
const cardAccount = Account.open({
  userId,
  code: AccountCode.parse("Liabilities:Credit Cards:X"),
  name: "X",
  type: AccountType.LIABILITY,
  subtype: "CREDIT_CARD",
});

/* ═══ The compounding factor, cross-checked ═══════════════════════════ */

section("compounding, two independent ways");

/** The same factor by repeated multiplication rather than by exponentiation. */
function factorByRepeatedMultiplication(rate: Rate, periodsPerYear: bigint, periods: number) {
  const base = periodsPerYear * 10n ** 10n * 100n;
  const step = base + rate.scaled;
  let numerator = 1n;
  let denominator = 1n;
  for (let index = 0; index < periods; index += 1) {
    numerator *= step;
    denominator *= base;
  }
  return { numerator, denominator };
}

const quarterly20 = compoundFactor(Rate.annual("7.1"), "QUARTERLY", 20);
const repeated20 = factorByRepeatedMultiplication(Rate.annual("7.1"), 4n, 20);
checkTrue(
  "exponentiation and repeated multiplication agree exactly",
  quarterly20.numerator === repeated20.numerator && quarterly20.denominator === repeated20.denominator,
);
// Verified against the same arithmetic done outside this codebase:
// (4·1e12 + 7.1·1e10)^20 / (4·1e12)^20 × ₹1,00,000 = ₹1,42,174.67.
check(
  "and applied to a lakh they give the certificate figure",
  rupees("100000").timesRatio(quarterly20.numerator, quarterly20.denominator, "HALF_UP").toDecimalString(),
  "142174.67",
);

check("zero periods is a factor of one", compoundFactor(Rate.annual("9"), "MONTHLY", 0).numerator, compoundFactor(Rate.annual("9"), "MONTHLY", 0).denominator);
throws("a fractional period count is refused", () => compoundFactor(Rate.annual("9"), "MONTHLY", 1.5), "whole number");

check(
  "simple interest for a year at 7%",
  simpleInterest(rupees("100000"), Rate.annual("7"), 365).toDecimalString(),
  "7000.00",
);
check(
  "and for 90 days",
  simpleInterest(rupees("100000"), Rate.annual("7"), 90).toDecimalString(),
  "1726.03",
);
check(
  "ACT/360 pays more for the same days — which is why the convention is carried",
  simpleInterest(rupees("100000"), Rate.annual("7", "ACT_360"), 90).toDecimalString(),
  "1750.00",
);

/* ═══ Fixed deposits ══════════════════════════════════════════════════ */

section("fixed deposits");

const FD: FixedDepositTerms = {
  principal: rupees("100000"),
  rate: Rate.annual("7.1"),
  openedOn: on("2026-04-01"),
  maturesOn: on("2031-04-01"),
  interestType: "COMPOUND",
  compounding: "QUARTERLY",
  payout: "CUMULATIVE",
  prematureWithdrawalPenalty: Percentage.of("1"),
};
const fd = new FixedDeposit(fdAccount, FD);

check("maturity value matches the certificate", fd.maturityValue().toDecimalString(), "142174.67");
check("nothing before it was opened", fd.valueOn(on("2026-03-31")), rupees("0"));
check("the principal on day one", fd.valueOn(on("2026-04-01")).toDecimalString(), "100000.00");
check("one quarter in", fd.valueOn(on("2026-07-01")).toDecimalString(), "101775.00");
check("one year in — four whole quarters", fd.valueOn(on("2027-04-01")).toDecimalString(), "107291.28");
check("and it stops growing at maturity", fd.valueOn(on("2035-01-01")).toDecimalString(), "142174.67");

// The stub period: a deposit two months into a quarter earns simple interest on
// the days that do not complete it. Ignoring this is the most common reason a
// computed maturity value misses a certificate.
checkTrue(
  "a part quarter earns simple interest on the stub days",
  fd.valueOn(on("2026-06-01")).isGreaterThan(rupees("100000")) &&
    fd.valueOn(on("2026-06-01")).isLessThan(rupees("101775")),
);

const simpleFd = new FixedDeposit(fdAccount, { ...FD, interestType: "SIMPLE" });
// 1,826 days over the five years (2028 is a leap year), so ₹35,519.45 of simple
// interest — the leap day is worth ₹19.45 and is not rounded away.
check(
  "the same deposit as simple interest pays far less",
  simpleFd.maturityValue().toDecimalString(),
  "135519.45",
);
checkTrue(
  "compounding is worth more than simple interest over five years",
  fd.maturityValue().isGreaterThan(simpleFd.maturityValue()),
);

const payoutFd = new FixedDeposit(fdAccount, { ...FD, payout: "PERIODIC_PAYOUT" });
check("a payout FD's value never grows", payoutFd.valueOn(on("2029-04-01")).toDecimalString(), "100000.00");
check("but it pays out each quarter", payoutFd.schedule().rows[0].interest.toDecimalString(), "1775.00");
check("and the total paid over five years", payoutFd.schedule().totalInterest.toDecimalString(), "35500.00");

check(
  "breaking early recomputes at the penalised rate, it does not deduct a fee",
  fd.prematureWithdrawalValue(on("2028-04-01")).toDecimalString(),
  new FixedDeposit(fdAccount, { ...FD, rate: Rate.annual("6.1") }).valueOn(on("2028-04-01")).toDecimalString(),
);
checkTrue(
  "and it is less than holding to term",
  fd.prematureWithdrawalValue(on("2028-04-01")).isLessThan(fd.valueOn(on("2028-04-01"))),
);
check(
  "at maturity there is no penalty",
  fd.prematureWithdrawalValue(on("2031-04-01")).toDecimalString(),
  fd.maturityValue().toDecimalString(),
);

const fdSchedule = fd.schedule();
check("20 quarters", fdSchedule.rows.length, 20);
check("the schedule's maturity matches valueOn", fdSchedule.maturityValue.toDecimalString(), fd.maturityValue().toDecimalString());
checkTrue(
  "and interest plus principal is the maturity value",
  fdSchedule.totalInterest.plus(rupees("100000")).equals(fd.maturityValue()),
);

// Three quarterly credits fall inside FY2026-27 (July, October, January); the
// fourth lands on 1 April 2027, in the next year. That boundary is the whole
// reason interest is reported by financial year rather than by "a year".
check(
  "interest in FY2026-27 is the three credits that fall inside it",
  fd.interestInFinancialYear(FinancialYear.parse("2026-27")).toDecimalString(),
  "5420.08",
);

throws(
  "a deposit that matures before it opens is refused",
  () => new FixedDeposit(fdAccount, { ...FD, maturesOn: on("2026-03-01") }),
  "must mature",
);
throws(
  "a deposit cannot wrap a liability account",
  () => new FixedDeposit(cardAccount, FD),
  "not an asset",
);

section("valueOn is pure — there is no accrual to run");

assertProperty(
  "the same date always gives the same value, however it is reached",
  (rng) => on("2026-04-01").plusDays(genInt(0, 2000)(rng)),
  (date) => {
    const first = fd.valueOn(date);
    // Deliberately compute other dates in between: a stateful accrual would let
    // these calls affect one another.
    fd.valueOn(date.plusDays(37));
    fd.valueOn(date.plusDays(-11));
    const second = fd.valueOn(date);
    return first.equals(second);
  },
  1000,
);

assertProperty(
  "value never decreases as the date advances, and never exceeds maturity",
  (rng) => genInt(0, 1900)(rng),
  (days) => {
    const earlier = fd.valueOn(on("2026-04-01").plusDays(days));
    const later = fd.valueOn(on("2026-04-01").plusDays(days + 1));
    return !later.isLessThan(earlier) && !later.isGreaterThan(fd.maturityValue());
  },
  1000,
);

/* ═══ Recurring deposits ══════════════════════════════════════════════ */

section("recurring deposits");

const rd = new RecurringDeposit(rdAccount, {
  instalment: rupees("5000"),
  rate: Rate.annual("6.8"),
  openedOn: on("2026-04-01"),
  months: 24,
  compounding: "QUARTERLY",
});

check("24 instalments of 5,000", rd.schedule().totalContributed.toDecimalString(), "120000.00");
checkTrue("maturity exceeds what was paid in", rd.maturityValue().isGreaterThan(rupees("120000")));
checkTrue(
  "but by less than a lump sum would earn — each instalment compounds for less time",
  rd.maturityValue().isLessThan(
    new FixedDeposit(fdAccount, {
      ...FD,
      principal: rupees("120000"),
      rate: Rate.annual("6.8"),
      maturesOn: on("2028-04-01"),
    }).maturityValue(),
  ),
);
check("maturity value", rd.maturityValue().toDecimalString(), "128829.78");
check("nothing before it opened", rd.valueOn(on("2026-03-01")), rupees("0"));
check("one instalment in", rd.valueOn(on("2026-04-01")).toDecimalString(), "5000.00");

section("a missed instalment costs more than the instalment");

const missed = new RecurringDeposit(rdAccount, {
  instalment: rupees("5000"),
  rate: Rate.annual("6.8"),
  openedOn: on("2026-04-01"),
  months: 24,
  compounding: "QUARTERLY",
  missedInstalments: [7],
  missedInstalmentPenalty: rupees("100"),
});
check("one fewer instalment was paid", missed.schedule().totalContributed.toDecimalString(), "115000.00");
checkTrue(
  "and the shortfall exceeds the missed 5,000 — the interest it would have earned is gone too",
  rd.maturityValue().minus(missed.maturityValue()).isGreaterThan(rupees("5000")),
);
// ₹5,000 of instalment, ₹532.17 of interest it would have earned, ₹100 penalty.
check(
  "the shortfall is the instalment, its lost interest and the penalty",
  rd.maturityValue().minus(missed.maturityValue()).toDecimalString(),
  "5632.17",
);
check("the schedule says which instalment was missed", missed.schedule().rows[6].note, "Instalment 7 missed");

throws(
  "a zero-month RD is refused",
  () =>
    new RecurringDeposit(rdAccount, {
      instalment: rupees("5000"),
      rate: Rate.annual("6.8"),
      openedOn: on("2026-04-01"),
      months: 0,
      compounding: "QUARTERLY",
    }),
  "whole number of months",
);

/* ═══ PPF ═════════════════════════════════════════════════════════════ */

section("PPF — limit, lock and extension");

const ppfRates = new Map(
  Array.from({ length: 20 }, (_unused, index) => [
    FinancialYear.startingIn(2026 + index).label,
    Rate.annual("7.1"),
  ]),
);
const ppf = new PublicProvidentFund(ppfAccount, {
  openedOn: on("2026-05-10"),
  contributions: Array.from({ length: 15 }, (_unused, index) => ({
    financialYear: FinancialYear.startingIn(2026 + index).label,
    amount: rupees("150000"),
  })),
  ratesByFinancialYear: ppfRates,
});

check("the statutory limit", PPF_ANNUAL_LIMIT.toDecimalString(), "150000.00");
throws(
  "a contribution above the limit is refused rather than modelled",
  () =>
    new PublicProvidentFund(ppfAccount, {
      openedOn: on("2026-05-10"),
      contributions: [{ financialYear: "2026-27", amount: rupees("200000") }],
      ratesByFinancialYear: ppfRates,
    }),
  "statutory limit",
);

check("15-year lock from the end of the opening year", ppf.maturesOn.toISO(), "2042-03-31");
check("nothing can be withdrawn before then", ppf.canWithdrawOn(on("2042-03-30")), false);
check("and everything after", ppf.canWithdrawOn(on("2042-03-31")), true);
check("first year: 1.5 lakh plus a year's interest", ppf.schedule().rows[0].closing.toDecimalString(), "160650.00");
check("total contributed over fifteen years", ppf.schedule().totalContributed.toDecimalString(), "2250000.00");
/*
 * ₹43,57,052, not the ₹40,68,209 every PPF calculator prints — and the difference
 * is one year of interest, deliberately.
 *
 * The scheme rules (PPF 2019, para 12) mature the account fifteen years from the
 * *end of the year it was opened*: opened May 2026, so FY2026-27 ends 31 March
 * 2027 and maturity is 31 March 2042. The balance therefore earns interest in
 * sixteen financial years while receiving fifteen contributions. Popular
 * calculators credit fifteen years of interest, which is the number most people
 * have seen and is one year short of the statute.
 */
check("maturity value", ppf.schedule().maturityValue.toDecimalString(), "4357052.09");
check(
  "which is the calculators' figure plus one more year at 7.1%",
  rupees("4068208.60").timesRatio(1071n, 1000n, "HALF_UP").toDecimalString(),
  "4357051.41",
);
check("sixteen interest credits over fifteen contributions", ppf.schedule().rows.length, 16);

const extended = new PublicProvidentFund(ppfAccount, {
  openedOn: on("2026-05-10"),
  contributions: [{ financialYear: "2026-27", amount: rupees("150000") }],
  ratesByFinancialYear: ppfRates,
  extensionBlocks: 2,
});
check("two extension blocks add ten years", extended.maturesOn.toISO(), "2052-03-31");

const belowMinimum = new PublicProvidentFund(ppfAccount, {
  openedOn: on("2026-05-10"),
  contributions: [
    { financialYear: "2026-27", amount: rupees("150000") },
    { financialYear: "2027-28", amount: rupees("400") },
  ],
  ratesByFinancialYear: ppfRates,
});
checkDeep("a year below the 500 minimum is flagged", belowMinimum.yearsBelowMinimum(), ["2027-28"]);

checkDeep("PPF is EEE", ppf.taxTreatment(), {
  contribution: "EXEMPT",
  accrual: "EXEMPT",
  withdrawal: "EXEMPT",
});

/* ═══ EPF ═════════════════════════════════════════════════════════════ */

section("EPF — three sub-balances, tracked separately");

const EPF_TERMS: EpfTerms = {
  openedOn: on("2026-04-01"),
  contributions: [
    { financialYear: "2026-27", employee: rupees("180000"), employer: rupees("180000"), voluntary: rupees("120000") },
    { financialYear: "2027-28", employee: rupees("196000"), employer: rupees("196000"), voluntary: rupees("120000") },
  ],
  ratesByFinancialYear: new Map([
    ["2026-27", Rate.annual("8.25")],
    ["2027-28", Rate.annual("8.25")],
  ]),
  taxableContributionThreshold: rupees("250000"),
};
const epf = new EmployeeProvidentFund(epfAccount, EPF_TERMS);

const balances = epf.balancesOn(on("2028-03-31"));
check("employee balance", balances.employee.toDecimalString(), "408316.11");
check("employer balance", balances.employer.toDecimalString(), "408316.11");
check("VPF balance", balances.voluntary.toDecimalString(), "261067.41");
checkTrue(
  "and the total is the sum of the three",
  balances.total.equals(balances.employee.plus(balances.employer).plus(balances.voluntary)),
);
check("valueOn is that total", epf.valueOn(on("2028-03-31")).toDecimalString(), balances.total.toDecimalString());
check("nothing before the first year closes", epf.valueOn(on("2026-06-01")).toDecimalString(), "0.00");

// The question one combined balance cannot answer: employee + VPF is ₹3,00,000 in
// FY2026-27, ₹50,000 above the threshold, so a sixth of that year's interest on
// those two balances is taxable.
const taxable = epf.taxableInterestByYear();
check("two years reported", taxable.length, 2);
// A year's contributions earn 6.5 months of interest on average, not twelve, so
// FY2026-27's own-contribution interest is ₹13,406.25 — a sixth of which is
// taxable, being the share attributable to the ₹50,000 above the threshold.
check("FY2026-27 taxable interest", taxable[0].taxable.toDecimalString(), "2234.38");
check("and the exempt part", taxable[0].exempt.toDecimalString(), "11171.87");
checkTrue(
  "which together are the whole of that year's own-contribution interest",
  taxable[0].taxable.plus(taxable[0].exempt).toDecimalString() === "13406.25",
);

const underThreshold = new EmployeeProvidentFund(epfAccount, {
  ...EPF_TERMS,
  contributions: [
    { financialYear: "2026-27", employee: rupees("120000"), employer: rupees("120000"), voluntary: rupees("0") },
  ],
});
check(
  "below the threshold nothing is taxable",
  underThreshold.taxableInterestByYear()[0].taxable.toDecimalString(),
  "0.00",
);

/* ═══ NPS ═════════════════════════════════════════════════════════════ */

section("NPS — priced, not accrued");

const nps = new NationalPensionSystem(npsAccount, {
  tier: "TIER_I",
  openedOn: on("2026-04-01"),
  holdings: [
    { scheme: "E", units: Quantity.fromString("1250.4321") },
    { scheme: "C", units: Quantity.fromString("800.1234") },
    { scheme: "G", units: Quantity.fromString("640.5000") },
  ],
});

const navs = new Map<NpsScheme, UnitPrice>([
  ["E", UnitPrice.of("48.7231")],
  ["C", UnitPrice.of("39.1104")],
  ["G", UnitPrice.of("35.6712")],
]);

// Each holding priced and rounded once (HALF_EVEN), then summed:
// ₹60,924.93 + ₹31,293.15 + ₹22,847.40.
check("value from NAVs", nps.valueFrom(navs)?.toDecimalString(), "115065.48");
check("units per scheme", nps.unitsIn("E").toDecimalString(), "1250.4321");
check("a scheme not held is zero units", nps.unitsIn("A").toDecimalString(), "0");

// The honest failure: one missing NAV means no total, not a partial one.
const partial = new Map<NpsScheme, UnitPrice>([["E", UnitPrice.of("48.7231")]]);
check("a missing NAV gives no value at all", nps.valueFrom(partial), null);

check(
  "the deposit contract cannot invent a value",
  nps.valueOn(on("2027-04-01")).toDecimalString(),
  "0.00",
);
check("and there is no accrual schedule to show", nps.schedule().rows.length, 0);

const allocation = nps.allocation(navs);
check("three schemes allocated", allocation.length, 3);
checkTrue(
  "and the shares sum to 100%",
  Math.abs(
    allocation.reduce((total, row) => total + row.share.toApproximateNumber(), 0) - 100,
  ) < 0.01,
);
check("equity is the largest holding", allocation[0].scheme, "E");

check("Tier I is locked", nps.liquidity, "LOCKED");
check(
  "Tier II is not",
  new NationalPensionSystem(npsAccount, {
    tier: "TIER_II",
    openedOn: on("2026-04-01"),
    holdings: [],
  }).liquidity,
  "FREE",
);

section("every deposit reports in its account's currency");

check("FD currency", fd.currency.code, Currency.reporting.code);
check("interest within a range", fd.interestWithin(DateRange.of(on("2026-04-01"), on("2027-03-31"))).toDecimalString(), "5420.08");

done();

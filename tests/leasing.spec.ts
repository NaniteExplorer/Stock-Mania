/**
 * Gold leasing: a yield paid in grams, withheld in grams.
 *
 * Every expected number here is hand-worked to eight decimals from the arithmetic
 * the platform states — `qty × rate × months / 12`, less 10% — rather than
 * captured from a run. That distinction is the whole value of the file: a captured
 * value asserts the code still does what it did, not that it does the right thing.
 *
 * The behaviours that are not arithmetic, and that a spreadsheet gets wrong:
 *
 *   - **A part month earns nothing.** Interest is paid on completed months, so a
 *     lease that started on the 15th has earned nothing on the 1st, however many
 *     calendar pages have turned.
 *   - **A matured lease stops accruing** even if nobody has closed it in the UI.
 *   - **Gross, TDS and net always reconcile**, because net is subtraction rather
 *     than a third rounding.
 *   - **A missing price gives no value**, not a zero one. A lease valued at ₹0
 *     because IBJA did not publish reads as a total loss of the user's gold.
 */

import { UserId } from "@/core/kernel";
import { Currency, Money } from "@/core/money";
import { Percentage, Quantity, UnitPrice } from "@/core/numeric";
import { CalendarDate } from "@/core/time";
import { AccountId } from "@/domain/accounts";
import { InstrumentId } from "@/domain/instruments";
import {
  DEFAULT_TDS_RATE,
  GoldLease,
  LeaseId,
  leasePortfolio,
  leaseReturn,
  unleasedGrams,
  type GoldLeaseProps,
} from "@/domain/leasing";
import { check, checkTrue, done, section, throws } from "./harness";

const userId = UserId.from("user-leasing");
const instrumentId = InstrumentId.from("instrument-gold");
const holdingAccountId = AccountId.create();
const on = (value: string) => CalendarDate.parse(value);
const grams = (value: string) => Quantity.fromString(value);
const perGram = (value: string) => UnitPrice.of(value, Currency.INR);

let sequence = 0;
const lease = (overrides: Partial<GoldLeaseProps> = {}): GoldLease =>
  new GoldLease({
    id: LeaseId.from(`lease-${(sequence += 1)}`),
    userId,
    reference: `LEASE-000${sequence}`,
    instrumentId,
    holdingAccountId,
    platform: "SafeGold",
    quantity: grams("4.3989"),
    startOn: on("2026-01-15"),
    closesOn: on("2027-01-15"),
    annualRate: Percentage.of("4"),
    ...overrides,
  });

/* ═══ The arithmetic ══════════════════════════════════════════════════ */

section("interest is paid in grams, on completed months");

const twelveMonth = lease();

check("the term is twelve months", twelveMonth.termMonths, 12);
check("the default withholding is 10%", DEFAULT_TDS_RATE.toFixed(2), "10.00");

// 4.3989g × 4% × 7/12 = 0.102641g, less 10% = 0.0092376…
const sevenMonths = twelveMonth.accrualOn(on("2026-08-15"));
check("seven completed months", sevenMonths.monthsCompleted, 7);
check("gross interest", sevenMonths.gross.toDecimalString(), "0.102641");
check("TDS at 10%", sevenMonths.tds.toDecimalString(), "0.0102641");
check("net to the holding", sevenMonths.net.toDecimalString(), "0.0923769");
checkTrue(
  "and the three reconcile exactly",
  sevenMonths.gross.minus(sevenMonths.tds).equals(sevenMonths.net),
);
// "paid", not "completed": with a payout frequency in the model the two can
// differ, and the explanation has to say which it means. A monthly lease is the
// case where they coincide.
checkTrue("the reason names the rate and the months", sevenMonths.because.includes("7 paid months"));
check("nothing is pending on a monthly lease", sevenMonths.monthsPending, 0);

/* ═══ The payout schedule ═════════════════════════════════════════════ */

section("a lease pays on completed periods, not on completed months");

/*
 * The distinction the whole feature turns on. Seven months into a
 * quarterly-paying lease the platform has credited two quarters; the seventh
 * month is earned in the ordinary-language sense and cannot be sold, spent or
 * leased again. A tracker that accrued it anyway would show grams that are not
 * there — and would then offer to lease them.
 */
const quarterly = lease({ payoutFrequency: "QUARTERLY" });
const quarterlyAt7 = quarterly.accrualOn(on("2026-08-15"));
check("six months are payable, not seven", quarterlyAt7.monthsCompleted, 6);
check("and one is pending", quarterlyAt7.monthsPending, 1);
check("the next payout is the ninth month", quarterlyAt7.nextPayoutOn?.toISO(), "2026-10-15");
checkTrue(
  "the grams are strictly less than the monthly lease's",
  sevenMonths.gross.isGreaterThan(quarterlyAt7.gross),
);

const annual = lease({ payoutFrequency: "ANNUAL" });
check("an annual lease has paid nothing at seven months", annual.accrualOn(on("2026-08-15")).monthsCompleted, 0);
checkTrue(
  "and says so rather than showing zero without a reason",
  annual.accrualOn(on("2026-08-15")).because.includes("yearly"),
);
check("and pays the full year at the close", annual.accrualOn(on("2027-01-15")).monthsCompleted, 12);

/*
 * `ON_MATURITY` is not "annual with a long period": an eighteen-month lease pays
 * at eighteen months and not at twelve, so the whole term has to be the period.
 */
const atMaturity = lease({ payoutFrequency: "ON_MATURITY", closesOn: on("2027-07-15") });
check("nothing at twelve months", atMaturity.accrualOn(on("2027-01-15")).monthsCompleted, 0);
check("and eighteen at the close", atMaturity.accrualOn(on("2027-07-15")).monthsCompleted, 18);
check("with nothing left pending", atMaturity.accrualOn(on("2027-07-15")).monthsPending, 0);

check("a lease defaults to paying monthly", lease().payoutFrequency, "MONTHLY");
check("and to paying in grams", lease().payoutMode, "GRAMS");

// A full year: 4.3989 × 4% = 0.175956g.
const fullYear = twelveMonth.accrualOn(on("2027-01-15"));
check("a full year's gross", fullYear.gross.toDecimalString(), "0.175956");
check("and its net", fullYear.net.toDecimalString(), "0.1583604");

section("a part month earns nothing");

const dayBefore = twelveMonth.accrualOn(on("2026-02-14"));
check("one day short of a month is zero months", dayBefore.monthsCompleted, 0);
check("so the interest is zero", dayBefore.gross.toDecimalString(), "0");
checkTrue("and it says why", dayBefore.because.includes("part month has earned nothing"));

const onTheDay = twelveMonth.accrualOn(on("2026-02-15"));
check("the day itself completes the month", onTheDay.monthsCompleted, 1);

const beforeItStarts = twelveMonth.accrualOn(on("2025-12-01"));
check("a date before the lease exists is zero, not negative", beforeItStarts.monthsCompleted, 0);

section("month arithmetic survives short months");

// A lease started on the 31st: 28 February completes the month, because there is
// no 31st to wait for. Clamping the other way would delay the accrual by a month
// every February.
const endOfMonth = lease({ startOn: on("2026-01-31"), closesOn: on("2027-01-31") });
check("31 Jan to 28 Feb is one completed month", endOfMonth.monthsCompletedOn(on("2026-02-28")), 1);
check("and 31 Jan to 27 Feb is none", endOfMonth.monthsCompletedOn(on("2026-02-27")), 0);

section("a matured lease stops accruing");

const matured = twelveMonth.accrualOn(on("2028-06-01"));
check("eighteen months later it has still earned twelve", matured.monthsCompleted, 12);
check("and the interest has not grown", matured.gross.toDecimalString(), "0.175956");
checkTrue("it reports as matured", twelveMonth.isMaturedOn(on("2027-01-15")));
checkTrue("but not before its closing date", !twelveMonth.isMaturedOn(on("2027-01-14")));

section("a lease cancelled early stops on the cancellation date");

const cancelled = lease({ endedOn: on("2026-04-15"), status: "CANCELLED" });
check("three months, not twelve", cancelled.monthsCompletedOn(on("2026-12-15")), 3);
check("the accrual stops there", cancelled.accruesUntil.toISO(), "2026-04-15");

const cancelledLate = lease({ endedOn: on("2027-06-15"), status: "CANCELLED" });
check(
  "closing late earns nothing extra",
  cancelledLate.accruesUntil.toISO(),
  "2027-01-15",
);

/* ═══ Valuation ═══════════════════════════════════════════════════════ */

section("grams become money only when a price is supplied");

const gold = perGram("16400");
// 4.4912769g × ₹16,400 = ₹73,656.94116, rounded once at the multiplication.
check(
  "principal plus net interest, valued",
  twelveMonth.valueOn(on("2026-08-15"), gold)?.toDecimalString(),
  "73656.94",
);
check(
  "the interest alone, for the income line",
  twelveMonth.interestValueOn(on("2026-08-15"), gold)?.toDecimalString(),
  "1514.98",
);
check(
  "a missing price gives no value, not zero",
  twelveMonth.valueOn(on("2026-08-15"), null),
  null,
);
check(
  "total grams owed by the platform",
  twelveMonth.totalGramsOn(on("2026-08-15")).toDecimalString(),
  "4.4912769",
);

/* ═══ What an accrual run books ═══════════════════════════════════════ */

section("only the uncredited grams are posted");

check(
  "nothing credited yet, so everything earned is unposted",
  twelveMonth.unpostedOn(on("2026-08-15")).toDecimalString(),
  "0.0923769",
);

const partlyCredited = lease({ creditedQuantity: grams("0.05") });
check(
  "already-credited grams are not booked twice",
  partlyCredited.unpostedOn(on("2026-08-15")).toDecimalString(),
  "0.0423769",
);

const fullyCredited = lease({ creditedQuantity: grams("0.0923769") });
check(
  "a second run on the same day books nothing",
  fullyCredited.unpostedOn(on("2026-08-15")).toDecimalString(),
  "0",
);

const overCredited = lease({ creditedQuantity: grams("0.2") });
check(
  "an over-credit never produces a negative posting",
  overCredited.unpostedOn(on("2026-08-15")).toDecimalString(),
  "0",
);

/* ═══ The schedule ════════════════════════════════════════════════════ */

section("the schedule is month by month and its last row is the whole year");

const schedule = twelveMonth.schedule();
check("twelve rows", schedule.length, 12);
check("the first row is one month's net", schedule[0].netInMonth.toDecimalString(), "0.0131967");
check("the last row's date", schedule[11].on.toISO(), "2027-01-15");
check("and its to-date net is the full year", schedule[11].netToDate.toDecimalString(), "0.1583604");
checkTrue(
  "every row's to-date figure is its predecessor plus its own month",
  schedule.every((row, index) =>
    index === 0
      ? row.netToDate.equals(row.netInMonth)
      : row.netToDate.equals(schedule[index - 1].netToDate.plus(row.netInMonth)),
  ),
);

/* ═══ The portfolio ═══════════════════════════════════════════════════ */

section("portfolio totals across several leases");

const first = lease({ quantity: grams("4.3989"), startOn: on("2026-01-15"), closesOn: on("2027-01-15") });
const second = lease({
  quantity: grams("2.5"),
  startOn: on("2026-02-15"),
  closesOn: on("2026-08-15"),
  annualRate: Percentage.of("5"),
});
const settled = lease({
  quantity: grams("1"),
  startOn: on("2025-01-15"),
  closesOn: on("2026-01-15"),
  status: "MATURED",
});

const portfolio = leasePortfolio([first, second, settled], on("2026-08-15"), gold);
// Only the two ACTIVE leases are still out: 4.3989 + 2.5.
check("grams on lease counts active leases only", portfolio.leasedGrams.toDecimalString(), "6.8989");
// 0.102641 + (2.5 × 5% × 6/12 = 0.0625) + (1 × 4% × 12/12 = 0.04)
check("gross interest across all three", portfolio.grossInterestGrams.toDecimalString(), "0.205141");
check("TDS across all three", portfolio.tdsGrams.toDecimalString(), "0.0205141");
check("net interest", portfolio.netInterestGrams.toDecimalString(), "0.1846269");
checkTrue("the value is priced", portfolio.value !== null);
check(
  "unpriced, the portfolio has no value rather than a zero one",
  leasePortfolio([first], on("2026-08-15"), null).value,
  null,
);

section("a lease past its closing date that nobody settled is named");

check("one lease is overdue for settlement", portfolio.matured.length, 1);
check("and it is the second one", portfolio.matured[0], second.reference);

section("the wallet balance is what is held but not leased");

const wallet = unleasedGrams(grams("4.7165"), [first, second, settled]);
// 4.7165 held, 6.8989 on lease — which cannot be true, and is reported.
checkTrue("more on lease than held is reported, not clamped silently", wallet.overLeased);
check("and the reported balance is zero rather than negative", wallet.grams.toDecimalString(), "0");

const honest = unleasedGrams(grams("4.7165"), [first]);
check("held less leased", honest.grams.toDecimalString(), "0.3176");
checkTrue("and nothing is wrong", !honest.overLeased);

section("return over what the gold cost");

const vested = Money.fromRupees("75000", Currency.INR);
const result = leaseReturn(leasePortfolio([first], on("2026-08-15"), gold), vested);
checkTrue("a return is computable", result !== null);
// ₹73,656.94 against ₹75,000 vested — a loss, because the interest has not yet
// made up the buy-sell spread the platform charged on the way in.
check("the profit is the difference", result?.profit.toDecimalString(), "-1343.06");
checkTrue("and the percentage is negative", result?.percent.isNegative === true);
check(
  "with nothing vested there is no percentage to report",
  leaseReturn(leasePortfolio([first], on("2026-08-15"), gold), Money.zero(Currency.INR)),
  null,
);
check(
  "and with no price, no return",
  leaseReturn(leasePortfolio([first], on("2026-08-15"), null), vested),
  null,
);

/* ═══ Construction refuses nonsense ═══════════════════════════════════ */

section("a lease that cannot exist is refused at construction");

throws(
  "zero grams is not a lease",
  () => lease({ quantity: Quantity.ZERO }),
  "positive quantity of gold",
);
throws(
  "nor is a negative quantity",
  () => lease({ quantity: grams("1").negated() }),
  "positive quantity of gold",
);
throws(
  "a closing date on the start date is a term of nothing",
  () => lease({ startOn: on("2026-01-15"), closesOn: on("2026-01-15") }),
  "not after the start date",
);
throws(
  "a closing date before the start date",
  () => lease({ startOn: on("2026-01-15"), closesOn: on("2025-01-15") }),
  "not after the start date",
);
throws(
  "paying to lend gold is not a lease",
  () => lease({ annualRate: Percentage.of("0").plus(Percentage.of("-4")) }),
  "cannot be negative",
);
throws(
  "a withholding rate above 100%",
  () => lease({ tdsRate: Percentage.of("110") }),
  "not a rate between 0 and 100",
);
throws(
  "ending before it started",
  () => lease({ endedOn: on("2025-06-01") }),
  "before it started",
);
throws(
  "a negative credit is a reversal, not a credit",
  () => lease({ creditedQuantity: grams("1").negated() }),
  "cannot be negative",
);

section("a zero rate is legal — some platforms lease at nothing during a lock-in");

const free = lease({ annualRate: Percentage.of("0") });
check("it accrues nothing", free.accrualOn(on("2026-08-15")).gross.toDecimalString(), "0");
check("and is still worth its principal", free.totalGramsOn(on("2026-08-15")).toDecimalString(), "4.3989");

done();

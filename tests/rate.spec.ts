import { Money, ROUNDING } from "@/core/money";
import { Rate } from "@/core/numeric";
import { check, throws, section, done } from "./harness";

/**
 * `Rate` — an annualised rate that carries its day count.
 *
 * The property under test throughout: no float appears anywhere on the path from
 * an annual percentage to an accrued amount. `accrualFactor` returns an exact
 * bigint ratio, and `Money.timesRatio` consumes it directly.
 */

section("construction agrees across the three entry points");

check("annual('7.1')", Rate.annual("7.1").percent.toFixed(4), "7.1000");
check("fromFraction('0.071') is the same rate", Rate.fromFraction("0.071").percent.toFixed(4), "7.1000");
check("fromBasisPoints(710) is the same rate", Rate.fromBasisPoints(710).percent.toFixed(4), "7.1000");
check(
  "all three are equal",
  Rate.annual("7.1").equals(Rate.fromFraction("0.071")) &&
    Rate.annual("7.1").equals(Rate.fromBasisPoints(710)),
  true,
);
check("zero is zero", Rate.zero().isZero, true);
check("a negative rate is representable", Rate.annual("-2.5").isNegative, true);

section("the day count is part of the identity");

check("ACT/365F has a 365-day year", Rate.annual("7").daysInYear(), 365);
check("ACT/360 has a 360-day year", Rate.annual("7", "ACT_360").daysInYear(), 360);
check("30/360 has a 360-day year", Rate.annual("7", "THIRTY_360").daysInYear(), 360);
check(
  "the same number under two conventions is not the same rate",
  Rate.annual("7").equals(Rate.annual("7", "ACT_360")),
  false,
);
throws(
  "mixing conventions throws rather than picking one",
  () => Rate.annual("7").plus(Rate.annual("1", "ACT_360")),
  "Cannot combine a ACT_365F rate with a ACT_360 one",
);

section("accrual is exact — the ratio is bigint, never a float");

// ₹1,00,000 at 7.30% for exactly 365 days under ACT/365F is ₹7,300.00 to the paisa.
const principal = Money.fromRupees("100000.00");
const yearAt730 = Rate.annual("7.30").accrualFactor(365);
check(
  "a full year at 7.30% ACT/365F",
  principal.timesRatio(yearAt730.numerator, yearAt730.denominator, ROUNDING.interest).toDecimalString(),
  "7300.00",
);

// The classic off-by-a-year-length: 30 days at 7.30% differs by convention.
const thirtyAct365 = Rate.annual("7.30").accrualFactor(30);
const thirtyAct360 = Rate.annual("7.30", "ACT_360").accrualFactor(30);
check(
  "30 days ACT/365F",
  principal.timesRatio(thirtyAct365.numerator, thirtyAct365.denominator, ROUNDING.interest).toDecimalString(),
  "600.00",
);
check(
  "30 days ACT/360 accrues more",
  principal.timesRatio(thirtyAct360.numerator, thirtyAct360.denominator, ROUNDING.interest).toDecimalString(),
  "608.33",
);

// A rate with more precision than Percentage can hold must still accrue exactly.
const precise = Rate.annual("6.7285");
const preciseYear = precise.accrualFactor(365);
check(
  "a four-decimal rate accrues to the paisa",
  Money.fromRupees("250000.00")
    .timesRatio(preciseYear.numerator, preciseYear.denominator, ROUNDING.interest)
    .toDecimalString(),
  "16821.25",
);

check("zero days accrues nothing", Rate.annual("7").accrualFactor(0).numerator, 0n);
throws("a negative period is rejected", () => Rate.annual("7").accrualFactor(-1), "non-negative");
throws("a fractional period is rejected", () => Rate.annual("7").accrualFactor(1.5), "whole number");

section("day counting follows the convention, not the caller");

const jan31 = { year: 2026, month: 1, day: 31 };
const feb28 = { year: 2026, month: 2, day: 28 };

// ACT counts real elapsed days; 30/360 counts months as 30 days regardless.
check("ACT/365F Jan 31 -> Feb 28 is 28 actual days", Rate.annual("7").daysBetween(jan31, feb28), 28);
check(
  "30/360 caps the day-of-month at 30, giving 28",
  Rate.annual("7", "THIRTY_360").daysBetween(jan31, feb28),
  28,
);
check(
  "30/360 makes a full year exactly 360",
  Rate.annual("7", "THIRTY_360").daysBetween(
    { year: 2026, month: 1, day: 15 },
    { year: 2027, month: 1, day: 15 },
  ),
  360,
);
check(
  "ACT makes the same year 365",
  Rate.annual("7").daysBetween({ year: 2026, month: 1, day: 15 }, { year: 2027, month: 1, day: 15 }),
  365,
);

section("perPeriod — the r in an EMI formula");

// A 12% annual rate over monthly periods is 1% a month.
check("12% over 12 periods", Rate.annual("12").perPeriod(12).percent.toFixed(4), "1.0000");
check("the day count survives", Rate.annual("12").perPeriod(12).dayCount, "ACT_365F");
throws("zero periods is rejected", () => Rate.annual("12").perPeriod(0), "positive whole number");

section("display names the convention, because the number alone is ambiguous");

check("toString", Rate.annual("7.1").toString(), "7.1000% p.a. ACT/365F");
check("default convention is named too", Rate.annual("9").toString(), "9.0000% p.a. ACT/365F");
check("ACT/360 label", Rate.annual("9", "ACT_360").toString(), "9.0000% p.a. ACT/360");
check("30/360 label", Rate.annual("9", "THIRTY_360").toString(), "9.0000% p.a. 30/360");

section("the rounding registry names the reason, not the mode");

check("interest accrual rounds half-even", ROUNDING.interest, "HALF_EVEN");
check("tax rounds half-up", ROUNDING.tax, "HALF_UP");
check("statutory charges round half-up", ROUNDING.charge, "HALF_UP");
check("valuation rounds half-even", ROUNDING.valuation, "HALF_EVEN");

section("Money.isLessThanOrEqual");

// Present so lot consumption can say "while remaining <= available" rather than
// inverting a strict comparison, which is where boundary bugs live.
const ten = Money.fromRupees("10.00");
check("10 <= 10", ten.isLessThanOrEqual(Money.fromRupees("10.00")), true);
check("10 <= 10.01", ten.isLessThanOrEqual(Money.fromRupees("10.01")), true);
check("10 <= 9.99 is false", ten.isLessThanOrEqual(Money.fromRupees("9.99")), false);

done();

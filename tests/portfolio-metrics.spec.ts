/**
 * Task 3.6 gap coverage (2026-11-04). The headline fixtures live in
 * `metrics-portfolio.spec.ts` (2026-10-30); this file adds only what that spec
 * did not pin: the remaining refusals, the exact-ratio CAGR path, HHI rounding,
 * the emergency-fund currency refusal, and the XIRR variant used when dated
 * cash flows exist. All figures are made-up fixtures, hand-computed below.
 */
import { Currency, Money } from "@/core/money";
import { CalendarDate } from "@/core/time";
import { Years } from "@/core/units";
import { cagr, hhi, xirr } from "@/domain/portfolio";
import { emergencyFundMonths } from "@/domain/reports";
import { check, checkTrue, done, section, throws } from "./harness";

const rs = (value: string) => Money.fromRupees(value);
const usd = Currency.of("USD");

section("CAGR — refusals and exact ratio");
// 1,00,000 -> 0 over 1 year: (0 / 1,00,000)^(1/1) - 1 = -1 -> -100%.
check("total loss in one year is -100%", cagr(rs("100000"), rs("0"), Years(1)).toFixed(6), "-100.000000");
// 50,000 -> 1,12,500 over 2 years: 112500/50000 = 2.25; sqrt(2.25) = 1.5; 1.5 - 1 = 50%.
check("2.25x in 2 years is 50%", cagr(rs("50000"), rs("112500"), Years(2)).toFixed(6), "50.000000");
// 1,000 -> 1,100 over half a year: 1.1^(1/0.5) = 1.21; 1.21 - 1 = 21%.
check("10% in half a year annualises to 21%", cagr(rs("1000"), rs("1100"), Years(0.5)).toFixed(6), "21.000000");
// Past 2^53 minor units: 9,00,00,00,00,00,001.23 rupees doubled. The quotient is exactly 2
// in BigInt (exactRatio), so one year is exactly 100%; a Number(minor) division could not
// promise that because neither operand is representable as a double.
const huge = 90_000_000_000_000_123n; // minor units (paise), > 2^53 ≈ 9.007e15
check(
  "ratio beyond 2^53 paise is taken exactly: doubling in 1 year is 100%",
  cagr(Money.fromMinor(huge, Currency.of("INR")), Money.fromMinor(huge * 2n, Currency.of("INR")), Years(1)).toFixed(6),
  "100.000000",
);
throws("mixed currency refused", () => cagr(rs("100"), Money.fromRupees("200", usd), Years(1)), "CAGR refused");
throws("negative end refused", () => cagr(rs("100"), rs("-1"), Years(1)), "negative ending value");

section("HHI — rounding and refusals");
// 1 : 2 -> weights 1/3, 2/3 -> 1/9 + 4/9 = 5/9 = 0.5555... -> 55.555556% (half-up at 6 dp).
check("1:2 split is 55.555556%", hhi([rs("1"), rs("2")]).toFixed(6), "55.555556");
// 75,000 : 25,000 -> 0.75^2 + 0.25^2 = 0.5625 + 0.0625 = 0.625 -> 62.5%.
check("75/25 is 62.5%", hhi([rs("75000"), rs("25000")]).toFixed(6), "62.500000");
// A zero holding adds 0 to both sums: 50/50/0 -> 0.25 + 0.25 = 50%.
check("a zero-value holding does not dilute", hhi([rs("10"), rs("10"), rs("0")]).toFixed(6), "50.000000");
throws("negative holding refused", () => hhi([rs("100"), rs("-1")]), "negative");
throws("zero total refused", () => hhi([rs("0"), rs("0")]), "total zero");

section("Emergency fund — definition edges");
// 1,00,000 / 30,000 = 3.3333... -> truncated to 3.33 (never rounds cover up).
check("1,00,000 against 30,000 is 3.33", emergencyFundMonths(rs("100000"), rs("30000")), 3.33);
// 59,999 / 10,000 = 5.9999 -> truncated 5.99, not rounded to 6.00.
check("5.9999 truncates to 5.99", emergencyFundMonths(rs("59999"), rs("10000")), 5.99);
check("negative monthly spend is null, not a negative runway", emergencyFundMonths(rs("100000"), rs("-1")), null);
throws("mixed currency refused", () => emergencyFundMonths(rs("100000"), Money.fromRupees("1000", usd)), "different currencies");

section("XIRR — the money-weighted variant when dated flows exist");
// -1,00,000 on 2025-01-01, +1,10,000 on 2026-01-01 (365 days, ACT/365F = 1.0 year):
// 100000 = 110000 / (1 + r)^1  ->  r = 10%.
const flows = [
  { on: CalendarDate.of(2025, 1, 1), amount: rs("-100000") },
  { on: CalendarDate.of(2026, 1, 1), amount: rs("110000") },
];
const result = xirr(flows);
checkTrue("one year +10% solves", result.ok);
if (result.ok) check("rate is 10% p.a.", (Number(result.rate.scaled) / 1e10).toFixed(4), "10.0000");
// Only outflows: no sign change, so no rate exists — refused with a typed reason.
const refused = xirr([flows[0]!, { on: CalendarDate.of(2026, 1, 1), amount: rs("-5") }]);
check("no sign change is refused, not 0%", refused.ok ? "ok" : refused.reason, "NO_SIGN_CHANGE");

done();

/** Task 3.6 acceptance: CAGR, HHI, emergency-fund months, stored target allocation — hand-computed fixtures. */
import { Currency, Money } from "@/core/money";
import { Percentage } from "@/core/numeric";
import { Years } from "@/core/units";
import { cagr, hhi, targetAllocation } from "@/domain/portfolio";
import { emergencyFundMonths } from "@/domain/reports";
import { check, checkDeep, done, section, throws } from "./harness";

const rs = (value: string) => Money.fromRupees(value);
const pct = (value: string) => Percentage.of(value);
const usd = Currency.of("USD");

section("CAGR");
// 1,00,000 -> 1,21,000 over 2 years: sqrt(1.21) - 1 = 10%.
check("1,00,000 to 1,21,000 in 2 years is 10%", cagr(rs("100000"), rs("121000"), Years(2)).toFixed(6), "10.000000");
// Doubling in 3 years: 2^(1/3) - 1 = 0.2599210498... -> 25.992105%.
check("doubling in 3 years is 25.992105%", cagr(rs("100000"), rs("200000"), Years(3)).toFixed(6), "25.992105");
// 1,00,000 -> 81,000 over 2 years: sqrt(0.81) - 1 = -10%.
check("a loss is negative", cagr(rs("100000"), rs("81000"), Years(2)).toFixed(6), "-10.000000");
throws("zero start refused", () => cagr(rs("0"), rs("100"), Years(1)), "starting value must be positive");
throws("negative start refused", () => cagr(rs("-10"), rs("100"), Years(1)), "starting value must be positive");
throws("zero years refused", () => cagr(rs("100"), rs("200"), Years(0)), "longer than zero years");

section("HHI concentration (exact)");
// 50/30/20: 0.25 + 0.09 + 0.04 = 0.38 -> 38%.
check("50/30/20 is exactly 38%", hhi([rs("50000"), rs("30000"), rs("20000")]).scaled, 38_000_000n);
check("one holding is 100%", hhi([rs("1234.56")]).scaled, 100_000_000n);
// Three equal holdings: 1/3 -> 33.333333% (half-up at six places).
check("three equal holdings are 33.333333%", hhi([rs("1"), rs("1"), rs("1")]).scaled, 33_333_333n);
throws("mixed currency refused", () => hhi([rs("100"), Money.fromRupees("100", usd)]), "more than one currency");
throws("empty refused", () => hhi([]), "no holdings");

section("emergency fund months");
check("3,00,000 against 50,000 a month is 6 months", emergencyFundMonths(rs("300000"), rs("50000")), 6);
check("1,25,000 against 40,000 is 3.12 (truncated)", emergencyFundMonths(rs("125000"), rs("40000")), 3.12);
check("unknown expenses are null, not zero-filled", emergencyFundMonths(rs("300000"), null), null);
check("zero expenses are null", emergencyFundMonths(rs("300000"), rs("0")), null);
check("a negative fund covers zero months", emergencyFundMonths(rs("-5000"), rs("50000")), 0);

section("stored target allocation");
const target = targetAllocation([{ id: "equity", share: pct("60") }, { id: "debt", share: pct("30.5") }, { id: "gold", share: pct("9.5") }]);
checkDeep("keeps ids in order", target.shares.map((s) => s.id), ["equity", "debt", "gold"]);
check("is frozen", Object.isFrozen(target.shares), true);
throws("99.999999% refused", () => targetAllocation([{ id: "a", share: pct("50") }, { id: "b", share: pct("49.999999") }]), "not 100%");
throws("over 100% refused", () => targetAllocation([{ id: "a", share: pct("60") }, { id: "b", share: pct("41") }]), "not 100%");
throws("duplicate id refused", () => targetAllocation([{ id: "a", share: pct("50") }, { id: "a", share: pct("50") }]), "appears twice");
throws("zero share refused", () => targetAllocation([{ id: "a", share: pct("100") }, { id: "b", share: pct("0") }]), "positive share");
throws("empty refused", () => targetAllocation([]), "no sleeves");

done();

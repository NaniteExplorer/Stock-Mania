import { Count, Days, Minutes, Ratio } from "@/core/units";
import { Money } from "@/core/money";
import { CalendarDate } from "@/core/time";
import { Rate } from "@/core/numeric";
import { dailyReturns, maxDrawdown, sharpe, volatility } from "@/domain/portfolio";
import { rsi, sma } from "@/domain/analysis";
import { STALENESS_DAYS, type ProviderCapabilities } from "@/domain/pricing";
import type { RiskLimits } from "@/domain/risk";
import { check, checkTrue, done, section } from "./harness";

section("boundary units retain the existing numerical meaning");
const returns = dailyReturns([
  { on: CalendarDate.parse("2026-01-01"), value: Money.fromRupees("100") },
  { on: CalendarDate.parse("2026-01-02"), value: Money.fromRupees("110") },
  { on: CalendarDate.parse("2026-01-03"), value: Money.fromRupees("132") },
]);
checkTrue("daily returns remain fractions rather than percentages", Math.abs(returns[0]! - 0.1) < 1e-12 && Math.abs(returns[1]! - 0.2) < 1e-12);
check("empty-return Sharpe remains unavailable", sharpe([], { annual: Rate.annual("6") }), null);
check("empty drawdown has zero elapsed days", maxDrawdown([]).durationDays, Days(0));
check("pricing threshold keeps four calendar days", STALENESS_DAYS.EQUITY, Days(4));
check("an unavailable moving average keeps its requested bar count", sma([], Count(20)).window, Count(20));
check("default RSI requires fifteen observations", rsi([]).window, Count(15));
check("non-unitless order limit remains a count", Count(3), 3);

// Compile-only probes: the runtime function bodies remain unchanged, while the
// signatures reject accidentally crossing count, timing and ratio boundaries.
if (false) {
  // @ts-expect-error A price or arbitrary number is not a return fraction.
  volatility([0.05]);
  // @ts-expect-error Bar counts must be labelled at the caller boundary.
  sma([], 20);
  const minutes: RiskLimits["windowMinutes"] = Minutes(5);
  const count: RiskLimits["maxOrdersPerWindow"] = Count(5);
  // @ts-expect-error An order count cannot stand in for an operational time span.
  const wrongMinutes: RiskLimits["windowMinutes"] = count;
  // @ts-expect-error Provider delay is minutes, not calendar days.
  const wrongDelay: ProviderCapabilities["quoteDelayMinutes"] = Days(5);
  const fraction = Ratio(0.05);
  void [minutes, count, wrongMinutes, wrongDelay, fraction];
}
done();

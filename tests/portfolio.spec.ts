/**
 * Returns and risk.
 *
 * XIRR is tested by the property that defines it rather than against remembered
 * numbers: **the NPV at the returned rate is zero to the stated tolerance.** That
 * is self-verifying — a wrong rate fails it — and it is checked over generated
 * flow sets as well as the analytic cases whose answers are known exactly (money
 * doubling in a year is 100%; a flat holding is 0%).
 *
 * The extreme case the plan names is here too: a fortnight-long holding that
 * doubled has an annualised return in the thousands of percent, and it is a real
 * number a portfolio screen must be able to show. v1's Newton-from-a-guess either
 * missed it or returned a plausible wrong root; bracketing first finds it.
 *
 * TWR is tested by **invariance to cashflow timing** — the property that makes it
 * the manager's number rather than the depositor's — and the same fixture is run
 * through XIRR to show that a money-weighted return is *not* invariant, which is
 * why both exist.
 */

import { Money } from "@/core/money";
import { Percentage, Quantity, Rate } from "@/core/numeric";
import { CalendarDate } from "@/core/time";
import {
  TRADING_DAYS,
  allocation,
  alpha,
  beta,
  correlation,
  dailyReturns,
  dividendYield,
  historicalVar,
  maxDrawdown,
  modifiedDietz,
  sharpe,
  sortino,
  stdDev,
  subPeriodsFrom,
  summarise,
  trueTwr,
  volatility,
  xirr,
  yieldOnCost,
  type Cashflow,
  type ValuationPoint,
} from "@/domain/portfolio";
import { assertProperty, check, checkDeep, checkTrue, done, genInt, section } from "./harness";

const rupees = (value: string) => Money.fromRupees(value);
const on = (value: string) => CalendarDate.parse(value);
const flow = (date: string, amount: string, note?: string): Cashflow => ({
  on: on(date),
  amount: rupees(amount),
  note,
});
const value = (date: string, amount: string): ValuationPoint => ({ on: on(date), value: rupees(amount) });

/** The percentage a successful XIRR reports, as a readable string. */
const rateOf = (result: ReturnType<typeof xirr>): string =>
  result.ok ? result.rate.percent.toFixed(4) : `undefined:${result.reason}`;

/* ═══ XIRR: the analytic cases ════════════════════════════════════════ */

section("XIRR — cases whose answers are known exactly");

// ₹1,00,000 in, ₹2,00,000 out exactly 365 days later: 100% a year.
check(
  "money doubling in a year is 100%",
  rateOf(xirr([flow("2025-04-01", "-100000"), flow("2026-04-01", "200000")])),
  "100.0000",
);
// Same amount back: no return.
check(
  "money returned unchanged is 0%",
  rateOf(xirr([flow("2025-04-01", "-100000"), flow("2026-04-01", "100000")])),
  "0.0000",
);
// Halving in a year.
check(
  "losing half in a year is −50%",
  rateOf(xirr([flow("2025-04-01", "-100000"), flow("2026-04-01", "50000")])),
  "-50.0000",
);
// 10% over two years compounds: (1.21)^(1/2) − 1 = 10%.
check(
  "21% over two years is 10% a year",
  rateOf(xirr([flow("2024-04-01", "-100000"), flow("2026-04-01", "121000")])),
  "10.0000",
);

section("XIRR — the extreme case");

/*
 * A fortnight-long holding that doubled. Annualising a 100% gain over 14 days
 * gives 2^(365/14) − 1 ≈ 2982.94x — the case the plan names, and the one that
 * makes Newton-from-a-guess return either nothing or the wrong root.
 */
const extreme = xirr([flow("2025-04-01", "-100000"), flow("2025-04-15", "200000")]);
checkTrue("it converges", extreme.ok);
checkTrue(
  "to a rate in the hundreds of thousands of percent",
  extreme.ok && extreme.rate.percent.toApproximateNumber() > 200_000,
);
// Self-verifying: whatever the number, the NPV at that rate must be ~0.
checkTrue("with a residual at the tolerance", extreme.ok && Math.abs(extreme.residual) < 1e-3);
checkTrue("in a handful of iterations", extreme.ok && extreme.iterations < 300);

section("XIRR — a real SIP");

/*
 * Twelve monthly contributions of ₹10,000 and a closing value of ₹1,32,000. The
 * money-weighted return is well above the 10% simple gain, because the average
 * rupee was invested for about half the year.
 */
const sip: Cashflow[] = [
  ...Array.from({ length: 12 }, (_unused, index) =>
    flow(on("2025-04-01").plusMonths(index).toISO(), "-10000", `instalment ${index + 1}`),
  ),
  flow("2026-04-01", "132000", "closing value"),
];
const sipResult = xirr(sip);
checkTrue("it converges", sipResult.ok);
checkTrue(
  "and the annualised return exceeds the 10% total gain",
  sipResult.ok && sipResult.rate.percent.toApproximateNumber() > 15,
);
check("the flows are carried back for provenance", sipResult.ok && sipResult.flows.length, 13);

section("XIRR — the typed failures, never a bare zero");

const tooFew = xirr([flow("2025-04-01", "-100000")]);
check("one flow", tooFew.ok === false && tooFew.reason, "TOO_FEW_FLOWS");

const noSignChange = xirr([flow("2025-04-01", "-100000"), flow("2026-04-01", "-50000")]);
check("no sign change", noSignChange.ok === false && noSignChange.reason, "NO_SIGN_CHANGE");
checkTrue(
  "and the reason says why 0% would be a lie",
  noSignChange.ok === false && noSignChange.because.includes("0% would be a claim"),
);

const sameDay = xirr([flow("2025-04-01", "-100000"), flow("2025-04-01", "120000")]);
check("everything on one day", sameDay.ok === false && sameDay.reason, "ALL_SAME_DAY");

section("XIRR — the property that defines it");

assertProperty(
  "the NPV at the returned rate is zero to the tolerance",
  (rng) => {
    const count = genInt(2, 8)(rng);
    const flows: Cashflow[] = [];
    let date = on("2024-01-01");
    for (let index = 0; index < count - 1; index += 1) {
      date = date.plusDays(genInt(1, 400)(rng));
      flows.push({ on: date, amount: Money.fromMinor(BigInt(-genInt(1, 500_000)(rng)) * 100n) });
    }
    // One closing inflow big enough that a root exists.
    const outflow = flows.reduce((sum, entry) => sum + Math.abs(entry.amount.toApproximateNumber()), 0);
    flows.push({
      on: date.plusDays(genInt(1, 800)(rng)),
      amount: Money.fromRupees((outflow * (0.2 + rng() * 4)).toFixed(2)),
    });
    return flows;
  },
  (flows) => {
    const result = xirr(flows);
    if (!result.ok) return result.reason === "NO_BRACKET" || result.reason === "NO_CONVERGENCE";

    /*
     * Read the rate from `Rate.scaled`, not from `.percent`.
     *
     * `.percent` converts to `Percentage`, which holds six decimals — a resolution
     * of 1e-8 in the rate. Where the NPV's slope is in the hundreds of thousands
     * that is a residual of ~0.002, which looks like a solver failure and is not:
     * it is display precision. `Rate` itself keeps ten decimals, and that is what a
     * recomputation must use.
     */
    const rate = Number(result.rate.scaled) / 1e10 / 100;
    const first = [...flows].sort((a, b) => a.on.compareTo(b.on))[0].on;
    let npv = 0;
    let slope = 0;
    for (const entry of flows) {
      const years = first.daysUntil(entry.on) / 365;
      const amount = entry.amount.toApproximateNumber();
      npv += amount / (1 + rate) ** years;
      slope += (-years * amount) / (1 + rate) ** (years + 1);
    }

    /*
     * Two tolerances, and both are the problem's rather than a convenience.
     *
     * The first is the solver's declared one: **relative 1e-9 on the NPV residual**,
     * as the plan specifies — relative to the largest flow, because an absolute
     * tolerance is meaningless when the flows are crores.
     *
     * The second is the *sensitivity* of the NPV to the rounding of the returned
     * rate. `Rate` keeps ten decimals of a percent, so the answer is within 1e-12 of
     * the root; near a rate of −99% the slope of the NPV is astronomical (a
     * denominator of `(1+r)^t` with `1+r` close to zero), and a rate that is right to
     * 1e-12 can still leave a large residual. A flat tolerance would fail a correct
     * answer there.
     */
    const scale = flows.reduce(
      (max, entry) => Math.max(max, Math.abs(entry.amount.toApproximateNumber())),
      0,
    );
    const bound = Math.max(1e-3, scale * 1e-9, Math.abs(slope) * 1e-11);
    return Math.abs(npv) < bound && Math.abs(result.residual) < bound;
  },
  1500,
);

assertProperty(
  "a longer holding of the same gain always annualises lower",
  (rng) => genInt(30, 2000)(rng),
  (days) => {
    const shorter = xirr([flow("2025-01-01", "-100000"), { on: on("2025-01-01").plusDays(days), amount: rupees("150000") }]);
    const longer = xirr([flow("2025-01-01", "-100000"), { on: on("2025-01-01").plusDays(days + 30), amount: rupees("150000") }]);
    if (!shorter.ok || !longer.ok) return false;
    return shorter.rate.scaled > longer.rate.scaled;
  },
  500,
);

/* ═══ TWR ═════════════════════════════════════════════════════════════ */

section("time-weighted return");

/*
 * Two sub-periods: +10% then +10%. The TWR is 21% whatever money moved between
 * them — that is the definition, and the point of the metric.
 */
const twoPeriods = [
  {
    openingValue: rupees("100000"),
    closingValue: rupees("110000"),
    flow: rupees("500000"),
    from: on("2025-04-01"),
    to: on("2025-10-01"),
  },
  {
    openingValue: rupees("610000"),
    closingValue: rupees("671000"),
    flow: rupees("0"),
    from: on("2025-10-01"),
    to: on("2026-04-01"),
  },
];
check("two 10% periods compound to 21%", trueTwr(twoPeriods)?.toFixed(2), "21.00");

section("TWR is invariant to cashflow timing — and XIRR is not");

/*
 * The same two 10% sub-periods, with a ₹5,00,000 contribution in one case and
 * ₹50,000 in the other. TWR must not move; XIRR must.
 */
const smallFlow = [
  { ...twoPeriods[0], flow: rupees("50000") },
  {
    openingValue: rupees("160000"),
    closingValue: rupees("176000"),
    flow: rupees("0"),
    from: on("2025-10-01"),
    to: on("2026-04-01"),
  },
];
check("TWR with a small contribution", trueTwr(smallFlow)?.toFixed(2), "21.00");
check("TWR with a large one", trueTwr(twoPeriods)?.toFixed(2), "21.00");

const bigMoneyWeighted = xirr([
  flow("2025-04-01", "-100000"),
  flow("2025-10-01", "-500000"),
  flow("2026-04-01", "671000"),
]);
const smallMoneyWeighted = xirr([
  flow("2025-04-01", "-100000"),
  flow("2025-10-01", "-50000"),
  flow("2026-04-01", "176000"),
]);
checkTrue(
  "but the money-weighted return moves with the contribution",
  bigMoneyWeighted.ok &&
    smallMoneyWeighted.ok &&
    bigMoneyWeighted.rate.scaled !== smallMoneyWeighted.rate.scaled,
);

assertProperty(
  "TWR depends only on the sub-period returns, never on the flows between them",
  (rng) => ({
    returns: Array.from({ length: genInt(2, 6)(rng) }, () => genInt(-20, 30)(rng)),
    flowSize: genInt(0, 10_000_000)(rng),
  }),
  ({ returns, flowSize }) => {
    const build = (flowAmount: number) => {
      let opening = 100000;
      return returns.map((percent, index) => {
        const closing = Math.round(opening * (1 + percent / 100));
        const period = {
          openingValue: rupees(String(opening)),
          closingValue: rupees(String(closing)),
          flow: rupees(String(flowAmount)),
          from: on("2025-01-01").plusMonths(index),
          to: on("2025-01-01").plusMonths(index + 1),
        };
        opening = closing + flowAmount;
        return period;
      });
    };
    const withFlows = trueTwr(build(flowSize));
    const withNone = trueTwr(build(0));
    if (withFlows === null || withNone === null) return false;
    /*
     * Compared within a hundredth of a percentage point rather than exactly.
     *
     * The fixture rounds each sub-period's closing value to whole rupees, so a
     * ₹92-lakh contribution makes the *rounded* ratios differ from the unrounded
     * ones in the far decimals. That is the fixture's rounding, not the metric's —
     * the invariance claim is about the sub-period returns, and it holds to well
     * inside any figure a screen would show.
     */
    return (
      Math.abs(withFlows.toApproximateNumber() - withNone.toApproximateNumber()) < 0.01
    );
  },
  1000,
);

section("Modified Dietz");

/*
 * ₹1,00,000 to ₹1,20,000 over 364 days with a ₹10,000 contribution on 1 July.
 * The flow was invested for 183 of the 364 days, so it counts as ₹5,027 of average
 * capital: a ₹10,000 gain over ₹1,05,027 is 9.52%. Weighting the flow by time is
 * the whole difference between this and a naive gain-over-opening figure, which
 * would have said 10%.
 */
check(
  "one period, one mid-period flow",
  modifiedDietz(
    rupees("100000"),
    rupees("120000"),
    [flow("2025-07-01", "10000")],
    on("2025-01-01"),
    on("2025-12-31"),
  )?.toFixed(2),
  "9.52",
);
check(
  "a zero-length period has no answer",
  modifiedDietz(rupees("100000"), rupees("120000"), [], on("2025-01-01"), on("2025-01-01")),
  null,
);

section("sub-periods from a valuation series");

const valuations = [
  value("2025-04-01", "100000"),
  value("2025-07-01", "110000"),
  value("2025-10-01", "120000"),
];
const periods = subPeriodsFrom(valuations, [flow("2025-07-01", "20000")]);
check("one flow breaks the series into two periods", periods.length, 2);
check("the first closes at the valuation before the flow", periods[0].closingValue.toDecimalString(), "110000.00");
check("and the second opens after it", periods[1].openingValue.toDecimalString(), "130000.00");

/* ═══ Risk ════════════════════════════════════════════════════════════ */

section("drawdown");

const drawdownSeries = [
  value("2025-01-01", "100000"),
  value("2025-02-01", "120000"),
  value("2025-03-01", "90000"),
  value("2025-04-01", "95000"),
  value("2025-05-01", "130000"),
];
const drawdown = maxDrawdown(drawdownSeries);
check("the worst fall is from 120,000 to 90,000", drawdown.maxDrawdown.toFixed(2), "-25.00");
check("peaking on", drawdown.peakOn?.toISO(), "2025-02-01");
check("troughing on", drawdown.troughOn?.toISO(), "2025-03-01");
check("over 28 days", drawdown.durationDays, 28);
check("and it recovered", drawdown.recovered, true);

const stillDown = maxDrawdown([
  value("2025-01-01", "100000"),
  value("2025-02-01", "60000"),
]);
check("a portfolio still under water", stillDown.maxDrawdown.toFixed(2), "-40.00");
check("has not recovered", stillDown.recovered, false);

const monotonic = maxDrawdown([value("2025-01-01", "100"), value("2025-02-01", "200")]);
check("a series that only rises has no drawdown", monotonic.maxDrawdown.toFixed(2), "0.00");

assertProperty(
  "max drawdown is never positive and never below −100%",
  (rng) =>
    Array.from({ length: genInt(2, 40)(rng) }, (_unused, index) =>
      value(on("2025-01-01").plusDays(index).toISO(), String(genInt(1, 1_000_000)(rng))),
    ),
  (series) => {
    const result = maxDrawdown(series);
    const percent = result.maxDrawdown.toApproximateNumber();
    return percent <= 0 && percent >= -100;
  },
  1000,
);

section("volatility, Sharpe and Sortino");

const returns = dailyReturns([
  value("2025-01-01", "100000"),
  value("2025-01-02", "101000"),
  value("2025-01-03", "100500"),
  value("2025-01-06", "102000"),
  value("2025-01-07", "101500"),
]);
check("four daily returns", returns.length, 4);
check("the first is +1%", (returns[0] * 100).toFixed(4), "1.0000");

check("sample standard deviation, not population", stdDev([1, 2, 3, 4]).toFixed(6), "1.290994");
check("a single observation has no deviation", stdDev([5]), 0);
check("annualised over 252 trading days", TRADING_DAYS, 252);
checkTrue("volatility is positive for a varying series", volatility(returns).toApproximateNumber() > 0);
check("and zero for a flat one", volatility([0, 0, 0, 0]).toFixed(2), "0.00");

const riskFree = { annual: Rate.annual("6.5") };
checkTrue("Sharpe is a number for a varying series", sharpe(returns, riskFree) !== null);
check("but undefined when there is no volatility", sharpe([0.01, 0.01, 0.01], riskFree), null);
checkTrue("Sortino ignores upside volatility", sortino(returns, riskFree) !== null);
check("and is undefined when nothing went down", sortino([0.01, 0.02, 0.03], riskFree), null);

section("beta, alpha and correlation");

// A portfolio that moves exactly with the benchmark: beta 1, correlation 1.
const benchmark = [0.01, -0.005, 0.02, -0.01, 0.015];
const identical = [...benchmark];
check("beta against itself is 1", beta(identical, benchmark)?.toFixed(4), "1.0000");
check("and correlation is 1", correlation(identical, benchmark)?.toFixed(4), "1.0000");

// Twice the benchmark's moves: beta 2, still perfectly correlated.
const levered = benchmark.map((value) => value * 2);
check("a doubled portfolio has beta 2", beta(levered, benchmark)?.toFixed(4), "2.0000");
check("and correlation still 1", correlation(levered, benchmark)?.toFixed(4), "1.0000");

// The mirror image: perfectly negatively correlated.
const inverse = benchmark.map((value) => -value);
check("an inverse portfolio has beta −1", beta(inverse, benchmark)?.toFixed(4), "-1.0000");
check("and correlation −1", correlation(inverse, benchmark)?.toFixed(4), "-1.0000");

check("a constant benchmark gives no beta", beta(benchmark, [0.01, 0.01, 0.01, 0.01, 0.01]), null);
checkTrue("alpha is defined where beta is", alpha(levered, benchmark, riskFree) !== null);

section("value at risk — historical, not parametric");

const twentyDays = Array.from({ length: 40 }, (_unused, index) => (index === 0 ? -0.08 : index / 1000 - 0.02));
checkTrue("VaR is a loss", (historicalVar(twentyDays)?.toApproximateNumber() ?? 1) < 0);
check("a short series has no VaR rather than a made-up one", historicalVar([0.01, -0.02]), null);

/* ═══ Income and allocation ═══════════════════════════════════════════ */

section("yield");

check("yield on cost", yieldOnCost(rupees("4500"), rupees("150000"))?.toFixed(2), "3.00");
check("dividend yield on today's value", dividendYield(rupees("4500"), rupees("225000"))?.toFixed(2), "2.00");
check("no cost, no yield", yieldOnCost(rupees("100"), rupees("0")), null);

section("allocation and drift");

const rows = allocation([
  { label: "Equity", value: rupees("700000"), targetWeight: Percentage.of("60") },
  { label: "Debt", value: rupees("200000"), targetWeight: Percentage.of("30") },
  { label: "Gold", value: rupees("100000"), targetWeight: Percentage.of("10") },
]);
check("equity is 70% of a 10 lakh portfolio", rows[0].weight.toFixed(2), "70.00");
check("ten points overweight", rows[0].drift?.toFixed(2), "10.00");
// The action, not just the risk statement: ₹1,00,000 to sell.
check("which is a lakh to sell", rows[0].rebalanceAmount?.toDecimalString(), "100000.00");
check("debt is ten points underweight", rows[1].drift?.toFixed(2), "-10.00");
check("so a lakh to buy", rows[1].rebalanceAmount?.toDecimalString(), "-100000.00");
check("gold is on target", rows[2].drift?.toFixed(2), "0.00");
checkTrue(
  "and the rebalance amounts net to zero",
  Money.total(rows.map((row) => row.rebalanceAmount!)).isZero,
);

const noTargets = allocation([{ label: "Everything", value: rupees("100000") }]);
check("without a target there is no drift", noTargets[0].drift, null);
check("an empty portfolio has zero weights, not NaN", allocation([{ label: "X", value: rupees("0") }])[0].weight.toFixed(2), "0.00");

/* ═══ Portfolio summary ═══════════════════════════════════════════════ */

section("a portfolio total is null when any holding is unpriced");

const summary = summarise([
  {
    label: "INFY",
    quantity: Quantity.fromString("100"),
    costBasis: rupees("150000"),
    marketValue: rupees("180000"),
    realisedGain: rupees("5000"),
    income: rupees("2000"),
    isStale: false,
  },
  {
    label: "Unlisted Co",
    quantity: Quantity.fromString("50"),
    costBasis: rupees("50000"),
    marketValue: null,
    realisedGain: rupees("0"),
    income: rupees("0"),
    isStale: true,
  },
]);
check("cost is known", summary.totalCost.toDecimalString(), "200000.00");
check("market value is not", summary.totalMarketValue, null);
check("nor is the unrealised gain", summary.unrealisedGain, null);
check("nor the absolute return", summary.absoluteReturn, null);
checkDeep("and the unpriced holding is named", summary.unpricedPositions, ["Unlisted Co"]);
check("realised gain is still known", summary.realisedGain.toDecimalString(), "5000.00");

const fullyPriced = summarise([
  {
    label: "INFY",
    quantity: Quantity.fromString("100"),
    costBasis: rupees("150000"),
    marketValue: rupees("180000"),
    realisedGain: rupees("5000"),
    income: rupees("2000"),
    isStale: true,
  },
]);
check("with every price known, the total is", fullyPriced.totalMarketValue?.toDecimalString(), "180000.00");
check("unrealised gain", fullyPriced.unrealisedGain?.toDecimalString(), "30000.00");
// (180000 + 5000 + 2000 − 150000) / 150000
check("absolute return", fullyPriced.absoluteReturn?.toFixed(2), "24.67");
checkDeep("and a stale price is flagged rather than hidden", fullyPriced.stalePositions, ["INFY"]);

done();

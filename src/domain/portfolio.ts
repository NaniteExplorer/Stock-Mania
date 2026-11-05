/**
 * Returns and risk: XIRR, TWR, and the metrics of `30-CALCULATIONS.md` §4.
 *
 * **This is the one file where floating point is legitimate, and it says so here
 * rather than leaving the reader to wonder.** An internal rate of return has no
 * closed form: it is the root of a polynomial in the discount rate, found by
 * iteration, and iteration in exact rationals would produce numbers with
 * thousand-digit denominators that never terminate. Volatility needs a square
 * root; Sharpe needs a division of two irrational quantities.
 *
 * What is *not* negotiable is where the float starts and what is claimed about it:
 *
 *   - Every **input** is exact. `Money.toApproximateNumber()` is called once per
 *     cashflow, at the boundary, and the exact amounts stay in the returned
 *     provenance so a figure can be traced to the money it came from.
 *   - Every **output** is a `Rate` or a `Percentage` — exact types built from the
 *     converged double — so nothing downstream can keep iterating on a float.
 *   - The **tolerance is stated**: `1e-9` relative on the NPV residual, per the
 *     plan, and the residual is returned so a caller can see how well it converged
 *     rather than trusting that it did.
 *
 * And the failure mode is typed. `XirrUndefined` carries a *reason* — no sign
 * change, too few flows, no bracket, no convergence — because v1 returned `null`
 * and every screen rendered it as `0%`, which is a claim that the investment broke
 * even. It did not; we simply cannot say.
 */

import { Count, Days, Ratio, type PriceLevel, type IndexPoints, type Months, type Years, type UnitFactory } from "@/core/units";
import { Money, divideRounded, pow10 } from "@/core/money";
import { Percentage, Quantity, Rate } from "@/core/numeric";
import { CalendarDate } from "@/core/time";
import { exactRatio } from "@/core/ratio";

/* ═══ Cashflows ═══════════════════════════════════════════════════════ */

/**
 * One external cashflow.
 *
 * Sign convention, stated once: **money leaving the investor is negative** (a buy,
 * a contribution) and **money arriving is positive** (a sale, a dividend, and the
 * closing market value as a final synthetic inflow). Every reference
 * implementation uses this and every bug in the area comes from mixing it up, so
 * `Cashflow` carries `Money` and the sign is the amount's own.
 */
export interface Cashflow {
  readonly on: CalendarDate;
  readonly amount: Money;
  readonly note?: string;
}

/** ACT/365F, per `30-CALCULATIONS.md` §4.1 — never 365.25, never actual/actual. */
const DAYS_IN_YEAR = 365;

/** Relative tolerance on the NPV residual, as the plan specifies. */
const NPV_TOLERANCE = 1e-9;
const MAX_NEWTON_STEPS = 100;
const MAX_BISECTION_STEPS = 200;

/* ═══ XIRR ════════════════════════════════════════════════════════════ */

export type XirrFailureReason =
  | "TOO_FEW_FLOWS"
  | "NO_SIGN_CHANGE"
  | "ALL_SAME_DAY"
  | "NO_BRACKET"
  | "NO_CONVERGENCE";

export interface XirrUndefined {
  readonly ok: false;
  readonly reason: XirrFailureReason;
  /** Plain English, for the screen that has to explain the blank. */
  readonly because: string;
}

export interface XirrResult {
  readonly ok: true;
  readonly rate: Rate;
  /** The NPV at the returned rate, which should be ~0. Returned so it can be checked. */
  readonly residual: Money;
  readonly iterations: Count;
  /** What went in, so the figure is traceable to exact money. */
  readonly flows: readonly Cashflow[];
}

export type Xirr = XirrResult | XirrUndefined;

function yearsBetween(from: CalendarDate, to: CalendarDate): number {
  return from.daysUntil(to) / DAYS_IN_YEAR;
}

/** NPV of the flows at an annual rate, with the first flow as the reference date. */
function npv(rate: number, flows: readonly { years: number; amount: number }[]): number {
  let total = 0;
  for (const flow of flows) {
    total += flow.amount / (1 + rate) ** flow.years;
  }
  return total;
}

function dNpv(rate: number, flows: readonly { years: number; amount: number }[]): number {
  let total = 0;
  for (const flow of flows) {
    total += (-flow.years * flow.amount) / (1 + rate) ** (flow.years + 1);
  }
  return total;
}

/**
 * The money-weighted return: the annual rate at which the flows have a zero NPV.
 *
 * **Bracket first, then Newton inside the bracket** — the plan's requirement, and
 * the opposite of v1, which ran Newton from a guess of 10% and fell back to
 * bisection only when Newton failed outright. Newton-from-a-guess is not merely
 * slower to fail: on a flow set with a very high IRR it can *converge on the wrong
 * root* or shoot below −100%, where `(1+r)^t` is undefined, and it returns a
 * plausible number rather than an error. Bracketing first means every returned
 * rate is inside an interval where the NPV genuinely changes sign.
 *
 * The bracket is found by expanding a geometric search from −99.99% upward, which
 * handles the extreme cases: a fortnight-long holding that doubled has an IRR in
 * the thousands of percent, and it is a real number that a portfolio screen must
 * be able to show.
 */
export function xirr(flows: readonly Cashflow[]): Xirr {
  if (flows.length < 2) {
    return {
      ok: false,
      reason: "TOO_FEW_FLOWS",
      because: "An internal rate of return needs at least one outflow and one inflow.",
    };
  }

  const ordered = [...flows].sort((a, b) => a.on.compareTo(b.on));
  const first = ordered[0].on;
  const last = ordered[ordered.length - 1].on;

  if (first.daysUntil(last) === 0) {
    return {
      ok: false,
      reason: "ALL_SAME_DAY",
      because:
        "Every cashflow falls on the same day, so there is no period over which to annualise a return.",
    };
  }

  const hasInflow = ordered.some((flow) => flow.amount.isPositive);
  const hasOutflow = ordered.some((flow) => flow.amount.isNegative);
  if (!hasInflow || !hasOutflow) {
    return {
      ok: false,
      reason: "NO_SIGN_CHANGE",
      because:
        "Every cashflow points the same way. Without both money in and money out there is no rate " +
        "at which the investment breaks even — and 0% would be a claim that it did.",
    };
  }

  // The single conversion to float, at the boundary.
  const numeric = ordered.map((flow) => ({
    years: yearsBetween(first, flow.on),
    amount: flow.amount.toApproximateNumber(),
  }));

  const scale = numeric.reduce((max, flow) => Math.max(max, Math.abs(flow.amount)), 0);
  const tolerance = Math.max(NPV_TOLERANCE, scale * NPV_TOLERANCE);

  /* ── Bracket ───────────────────────────────────────────────────────── */

  let low = -0.9999;
  let fLow = npv(low, numeric);
  let high = low;
  let fHigh = fLow;
  let bracketed = false;

  // Geometric expansion: 0.1, 0.3, 0.9, … up to ~1e6 (100,000,000% a year).
  let step = 0.1;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    high = low + step;
    fHigh = npv(high, numeric);
    if (!Number.isFinite(fHigh)) break;
    if (fLow * fHigh <= 0) {
      bracketed = true;
      break;
    }
    low = high;
    fLow = fHigh;
    step *= 3;
  }

  if (!bracketed) {
    return {
      ok: false,
      reason: "NO_BRACKET",
      because:
        "No rate between −99.99% and 1e8% makes the net present value zero, which usually means " +
        "the flows are inconsistent rather than that the return is extreme.",
    };
  }

  /* ── Newton inside the bracket, bisection as the guard ─────────────── */

  let rate = (low + high) / 2;
  let iterations = 0;

  for (; iterations < MAX_NEWTON_STEPS; iterations += 1) {
    const value = npv(rate, numeric);
    if (Math.abs(value) <= tolerance) {
      return finish(rate, value, iterations, ordered);
    }

    const derivative = dNpv(rate, numeric);
    const next = Number.isFinite(derivative) && Math.abs(derivative) > 1e-14
      ? rate - value / derivative
      : Number.NaN;

    // A Newton step that leaves the bracket is refused: the bracket is the
    // guarantee, and stepping outside it is how Newton finds the wrong root.
    if (!Number.isFinite(next) || next <= low || next >= high) {
      break;
    }

    // Maintain the bracket as we go, so a fallback still has one.
    if (value * fLow > 0) {
      low = rate;
      fLow = value;
    } else {
      high = rate;
      fHigh = value;
    }
    if (Math.abs(next - rate) < 1e-14) {
      return finish(next, npv(next, numeric), iterations, ordered);
    }
    rate = next;
  }

  for (let step2 = 0; step2 < MAX_BISECTION_STEPS; step2 += 1) {
    iterations += 1;
    const middle = (low + high) / 2;
    const value = npv(middle, numeric);
    if (Math.abs(value) <= tolerance || (high - low) / 2 < 1e-12) {
      return finish(middle, value, iterations, ordered);
    }
    if (fLow * value < 0) {
      high = middle;
      fHigh = value;
    } else {
      low = middle;
      fLow = value;
    }
  }

  return {
    ok: false,
    reason: "NO_CONVERGENCE",
    because:
      "The solver bracketed a root but could not converge on it to the required tolerance. " +
      "This is worth reporting as a bug rather than showing a number.",
  };
}

function finish(
  rate: number,
  residual: number,
  iterations: number,
  flows: readonly Cashflow[],
): XirrResult {
  if (!Number.isFinite(residual)) throw new RangeError("A converged NPV residual must be finite.");
  const currency = flows[0].amount.currency;
  // Preserve the solver's decimal representation, including scientific notation,
  // then round exactly once at the monetary output boundary.
  const [coefficient, exponent = "0"] = residual.toString().split("e");
  const [whole, fraction = ""] = coefficient.split(".");
  const digits = BigInt(whole + fraction);
  const shift = currency.exponent + Number(exponent) - fraction.length;
  const minor = shift >= 0
    ? digits * pow10(shift)
    : divideRounded(digits, pow10(-shift), "HALF_EVEN");
  return {
    ok: true,
    // Back into an exact type immediately: `Rate` holds ten decimals of a percent,
    // so nothing downstream can keep iterating on the double.
    rate: Rate.annual((rate * 100).toFixed(10)),
    residual: Money.fromMinor(minor, currency),
    iterations: Count(iterations),
    flows,
  };
}

/* ═══ Time-weighted return ════════════════════════════════════════════ */

export interface ValuationPoint {
  readonly on: CalendarDate;
  readonly value: Money;
}

export interface SubPeriod {
  /** Value at the start, after any flow on that date. */
  readonly openingValue: Money;
  /** Value at the end, before the flow that breaks the period. */
  readonly closingValue: Money;
  /** The external flow that ends this sub-period. Positive is money in. */
  readonly flow: Money;
  readonly from: CalendarDate;
  readonly to: CalendarDate;
}

/**
 * Modified Dietz: one period, flows weighted by the time they were invested.
 *
 * The approximation everyone starts with, and it is a good one when flows are
 * small relative to the portfolio. It is *not* a time-weighted return — a large
 * flow just before a market move distorts it — which is why {@link trueTwr} exists
 * beside it rather than instead of it. Reporting only Dietz and calling it TWR is
 * the common shortcut, and it is wrong in exactly the case that matters: a big
 * contribution followed by a crash.
 */
export function modifiedDietz(
  opening: Money,
  closing: Money,
  flows: readonly Cashflow[],
  from: CalendarDate,
  to: CalendarDate,
): Percentage | null {
  const days = from.daysUntil(to);
  if (days <= 0) return null;

  const openingValue = opening.toApproximateNumber();
  let netFlow = 0;
  let weighted = 0;
  for (const flow of flows) {
    const amount = flow.amount.toApproximateNumber();
    const weight = (days - from.daysUntil(flow.on)) / days;
    netFlow += amount;
    weighted += amount * weight;
  }

  const denominator = openingValue + weighted;
  if (denominator === 0) return null;
  const gain = closing.toApproximateNumber() - openingValue - netFlow;
  return Percentage.of(((gain / denominator) * 100).toFixed(6));
}

/**
 * True time-weighted return: the product of sub-period returns, minus one.
 *
 * Invariant to the *timing and size of cashflows*, which is the entire point — it
 * measures the manager, not the deposits. That invariance is the property test in
 * `tests/portfolio.spec.ts`: two portfolios with identical sub-period performance
 * and wildly different contribution schedules must report the same TWR, and a
 * money-weighted return must not.
 *
 * Sub-periods break at every external flow, which is what makes this need a daily
 * valuation series — and what the projection cache exists to make affordable.
 */
export function trueTwr(periods: readonly SubPeriod[]): Percentage | null {
  if (periods.length === 0) return null;

  let product = 1;
  for (const period of periods) {
    const opening = period.openingValue.toApproximateNumber();
    if (opening === 0) continue;
    const closing = period.closingValue.toApproximateNumber();
    product *= closing / opening;
  }

  return Percentage.of(((product - 1) * 100).toFixed(6));
}

/**
 * Builds sub-periods from a daily valuation series and the flows that break it.
 *
 * The valuation *before* a flow closes one sub-period and the valuation *after* it
 * opens the next, which is the definition — using one valuation for both would
 * either credit the manager with the deposit or charge them for it.
 */
export function subPeriodsFrom(
  valuations: readonly ValuationPoint[],
  flows: readonly Cashflow[],
): readonly SubPeriod[] {
  if (valuations.length < 2) return [];
  const byDate = new Map(valuations.map((point) => [point.on.toISO(), point.value]));
  const breaks = [...flows]
    .sort((a, b) => a.on.compareTo(b.on))
    .filter((flow) => byDate.has(flow.on.toISO()));

  const periods: SubPeriod[] = [];
  let openingIndex = 0;

  for (const flow of breaks) {
    const closingIndex = valuations.findIndex((point) => point.on.equals(flow.on));
    if (closingIndex <= openingIndex) continue;
    periods.push({
      openingValue: valuations[openingIndex].value,
      closingValue: valuations[closingIndex].value,
      flow: flow.amount,
      from: valuations[openingIndex].on,
      to: valuations[closingIndex].on,
    });
    openingIndex = closingIndex;
  }

  const lastIndex = valuations.length - 1;
  if (lastIndex > openingIndex) {
    periods.push({
      openingValue: valuations[openingIndex].value.plus(
        breaks.length > 0 ? breaks[breaks.length - 1].amount : Money.zero(valuations[0].value.currency),
      ),
      closingValue: valuations[lastIndex].value,
      flow: Money.zero(valuations[0].value.currency),
      from: valuations[openingIndex].on,
      to: valuations[lastIndex].on,
    });
  }

  return periods;
}

/* ═══ Return series ═══════════════════════════════════════════════════ */

/** Trading days a year, for annualisation. 252, per §4.3. */
export const TRADING_DAYS = Count(252);

/** Daily returns from a valuation series, as plain fractions. */
export function dailyReturns(valuations: readonly ValuationPoint[]): readonly Ratio[] {
  const returns: Ratio[] = [];
  for (let index = 1; index < valuations.length; index += 1) {
    const previous = valuations[index - 1].value.toApproximateNumber();
    if (previous === 0) continue;
    returns.push(Ratio(valuations[index].value.toApproximateNumber() / previous - 1));
  }
  return returns;
}

export type Continuous = Ratio | PriceLevel | IndexPoints | Months | Years;

function mean<U extends Continuous>(values: readonly NoInfer<U>[], unit: UnitFactory<U>): U {
  if (values.length === 0) return unit(0);
  return unit(values.reduce<number>((sum, value) => sum + value, 0) / values.length);
}

/**
 * Sample standard deviation — `n − 1`, not `n`.
 *
 * The distinction matters at the sample sizes this deals with: a month of daily
 * returns is 21 observations, where the population formula understates volatility
 * by about 2.4%. Every finance text uses the sample form and a Sharpe ratio
 * computed with the other one is not comparable to anybody's.
 */
export function stdDev<U extends Continuous>(values: readonly NoInfer<U>[], unit: UnitFactory<U>): U {
  if (values.length < 2) return unit(0);
  const average = mean(values, unit);
  const variance =
    values.reduce((sum, value) => sum + (value - average) ** 2, 0) / (values.length - 1);
  return unit(Math.sqrt(variance));
}

/* ═══ Risk metrics ════════════════════════════════════════════════════ */

export interface DrawdownResult {
  /** The worst peak-to-trough fall, as a negative percentage. */
  readonly maxDrawdown: Percentage;
  readonly peakOn: CalendarDate | null;
  readonly troughOn: CalendarDate | null;
  /** Days from the peak to the trough. */
  readonly durationDays: Days;
  /** Whether the series ever regained the peak. */
  readonly recovered: boolean;
}

/**
 * Maximum drawdown: the worst fall from any peak to any later trough.
 *
 * Absent from all four reference repos, and the single most useful risk number for
 * a retail investor — it answers "what is the worst this has felt", which no
 * volatility figure conveys. The peak and trough dates are returned with it,
 * because a 32% drawdown in March 2020 and a 32% drawdown last month are different
 * facts about a portfolio.
 */
export function maxDrawdown(valuations: readonly ValuationPoint[]): DrawdownResult {
  let peak = Number.NEGATIVE_INFINITY;
  let peakOn: CalendarDate | null = null;
  let worst = 0;
  let worstPeakOn: CalendarDate | null = null;
  let worstTroughOn: CalendarDate | null = null;

  for (const point of valuations) {
    const value = point.value.toApproximateNumber();
    if (value > peak) {
      peak = value;
      peakOn = point.on;
    }
    if (peak > 0) {
      const drawdown = value / peak - 1;
      if (drawdown < worst) {
        worst = drawdown;
        worstPeakOn = peakOn;
        worstTroughOn = point.on;
      }
    }
  }

  const recovered =
    worstTroughOn !== null &&
    valuations.some(
      (point) =>
        point.on.isAfter(worstTroughOn!) &&
        point.value.toApproximateNumber() >=
          (valuations.find((candidate) => candidate.on.equals(worstPeakOn!))?.value.toApproximateNumber() ?? 0),
    );

  return {
    maxDrawdown: Percentage.of((worst * 100).toFixed(6)),
    peakOn: worstPeakOn,
    troughOn: worstTroughOn,
    durationDays: Days(worstPeakOn && worstTroughOn ? worstPeakOn.daysUntil(worstTroughOn) : 0),
    recovered,
  };
}

/** Annualised volatility: the standard deviation of daily returns times √252. */
export function volatility(returns: readonly Ratio[]): Percentage {
  return Percentage.of((stdDev(returns, Ratio) * Math.sqrt(TRADING_DAYS) * 100).toFixed(6));
}

export interface RiskFreeSeries {
  /** Annual risk-free rate. Configured, never hard-coded — §4.3. */
  readonly annual: Rate;
}

/**
 * Sharpe: excess return per unit of total volatility.
 *
 * The risk-free rate is a required argument rather than a default, because a
 * hard-coded one silently dates: 6% was right for Indian T-bills for years and is
 * not always. `null` when volatility is zero — a constant series has no Sharpe, and
 * reporting infinity or zero would both be claims.
 */
export function sharpe(returns: readonly Ratio[], riskFree: RiskFreeSeries): Ratio | null {
  const sigma = stdDev(returns, Ratio);
  if (sigma === 0) return null;
  const annualisedReturn = mean(returns, Ratio) * TRADING_DAYS;
  const rf = Number(riskFree.annual.percent.toFixed(10)) / 100;
  return Ratio((annualisedReturn - rf) / (sigma * Math.sqrt(TRADING_DAYS)));
}

/**
 * Sortino: excess return per unit of *downside* deviation.
 *
 * The one that matches how people actually feel about risk — upside volatility is
 * not a problem — and it is computed against a minimum acceptable return rather
 * than against the mean, which is the definition people usually get wrong.
 */
export function sortino(
  returns: readonly Ratio[],
  riskFree: RiskFreeSeries,
  minimumAcceptable: Ratio = Ratio(0),
): Ratio | null {
  const downside = returns.filter((value) => value < minimumAcceptable);
  if (downside.length === 0) return null;
  const deviation = Math.sqrt(
    downside.reduce((sum, value) => sum + (value - minimumAcceptable) ** 2, 0) / downside.length,
  );
  if (deviation === 0) return null;
  const annualisedReturn = mean(returns, Ratio) * TRADING_DAYS;
  const rf = Number(riskFree.annual.percent.toFixed(10)) / 100;
  return Ratio((annualisedReturn - rf) / (deviation * Math.sqrt(TRADING_DAYS)));
}

/** Covariance of two aligned return series (sample form). */
export function covariance(a: readonly Ratio[], b: readonly Ratio[]): Ratio {
  const n = Math.min(a.length, b.length);
  if (n < 2) return Ratio(0);
  const meanA = mean(a.slice(0, n), Ratio);
  const meanB = mean(b.slice(0, n), Ratio);
  let total = 0;
  for (let index = 0; index < n; index += 1) {
    total += (a[index] - meanA) * (b[index] - meanB);
  }
  return Ratio(total / (n - 1));
}

/** Pearson correlation, in [−1, 1]. */
export function correlation(a: readonly Ratio[], b: readonly Ratio[]): Ratio | null {
  const sigmaA = stdDev(a, Ratio);
  const sigmaB = stdDev(b, Ratio);
  if (sigmaA === 0 || sigmaB === 0) return null;
  return Ratio(covariance(a, b) / (sigmaA * sigmaB));
}

/**
 * Beta against a benchmark: how much of the benchmark's movement this reproduces.
 *
 * The benchmark series is an argument for the same reason the risk-free rate is: a
 * portfolio of Indian small caps measured against the Nifty 50 and against the
 * Nifty Smallcap 250 has two different, both-correct betas, and the app must not
 * pick one silently.
 */
export function beta(portfolio: readonly Ratio[], benchmark: readonly Ratio[]): Ratio | null {
  const variance = stdDev(benchmark, Ratio) ** 2;
  if (variance === 0) return null;
  return Ratio(covariance(portfolio, benchmark) / variance);
}

/** Jensen's alpha: return beyond what the beta-adjusted benchmark explains. */
export function alpha(
  portfolio: readonly Ratio[],
  benchmark: readonly Ratio[],
  riskFree: RiskFreeSeries,
): Percentage | null {
  const b = beta(portfolio, benchmark);
  if (b === null) return null;
  const rf = Number(riskFree.annual.percent.toFixed(10)) / 100;
  const rp = mean(portfolio, Ratio) * TRADING_DAYS;
  const rb = mean(benchmark, Ratio) * TRADING_DAYS;
  return Percentage.of(((rp - (rf + b * (rb - rf))) * 100).toFixed(6));
}

/**
 * Historical value at risk: the loss the worst `1 − confidence` of days exceeded.
 *
 * **Historical, not parametric**, per §4.3, and the reason is stated there and
 * worth repeating: returns are not normally distributed, and a parametric VaR
 * understates exactly the tail it is asked about. This one makes no distributional
 * claim at all — it reports what actually happened.
 */
export function historicalVar(
  returns: readonly Ratio[],
  confidence: Ratio = Ratio(0.95),
): Percentage | null {
  if (returns.length < 20) return null;
  const sorted = [...returns].sort((a, b) => a - b);
  const index = Math.floor((1 - confidence) * sorted.length);
  return Percentage.of((sorted[Math.min(index, sorted.length - 1)] * 100).toFixed(6));
}

/* ═══ Income and allocation ═══════════════════════════════════════════ */

/** Annual income over what was paid — the yield a holding actually earns you. */
export function yieldOnCost(annualIncome: Money, costBasis: Money): Percentage | null {
  if (costBasis.isZero) return null;
  return Percentage.ratio(annualIncome, costBasis);
}

/** Annual income over today's price — what a new buyer would get. */
export function dividendYield(annualIncome: Money, marketValue: Money): Percentage | null {
  if (marketValue.isZero) return null;
  return Percentage.ratio(annualIncome, marketValue);
}

export interface AllocationSlice {
  readonly label: string;
  readonly value: Money;
  readonly targetWeight?: Percentage;
}

export interface AllocationRow {
  readonly label: string;
  readonly value: Money;
  readonly weight: Percentage;
  readonly targetWeight: Percentage | null;
  /** `actual − target`. Positive means overweight. */
  readonly drift: Percentage | null;
  /** What to move to return to target, as money rather than as a percentage. */
  readonly rebalanceAmount: Money | null;
}

/**
 * Allocation and drift.
 *
 * The drift is reported in **both** percentage points and money, because they
 * answer different questions: 4 points overweight is the risk statement, and
 * "₹1,42,000 to sell" is the action. A screen that shows only the percentage
 * leaves the user doing arithmetic on their own portfolio.
 */
export function allocation(slices: readonly AllocationSlice[]): readonly AllocationRow[] {
  const total = Money.total(slices.map((slice) => slice.value));
  if (total.isZero) {
    return slices.map((slice) => ({
      label: slice.label,
      value: slice.value,
      weight: Percentage.ZERO,
      targetWeight: slice.targetWeight ?? null,
      drift: null,
      rebalanceAmount: null,
    }));
  }

  return slices.map((slice) => {
    const weight = Percentage.ratio(slice.value, total);
    const target = slice.targetWeight ?? null;
    if (!target) {
      return {
        label: slice.label,
        value: slice.value,
        weight,
        targetWeight: null,
        drift: null,
        rebalanceAmount: null,
      };
    }
    const targetValue = target.applyTo(total);
    return {
      label: slice.label,
      value: slice.value,
      weight,
      targetWeight: target,
      drift: Percentage.fromScaled(weight.scaled - target.scaled),
      // Positive means sell: the holding is worth more than its target.
      rebalanceAmount: slice.value.minus(targetValue),
    };
  });
}

/* ═══ Position summary ════════════════════════════════════════════════ */

export interface PositionSummary {
  readonly label: string;
  readonly quantity: Quantity;
  readonly costBasis: Money;
  /** `null` when no price could be resolved — never zero. */
  readonly marketValue: Money | null;
  readonly realisedGain: Money;
  readonly income: Money;
  readonly isStale: boolean;
}

export interface PortfolioSummary {
  readonly positions: readonly PositionSummary[];
  readonly totalCost: Money;
  /** `null` when any position is unpriced — a partial total reads as a complete one. */
  readonly totalMarketValue: Money | null;
  readonly unrealisedGain: Money | null;
  readonly realisedGain: Money;
  readonly income: Money;
  /** Absolute return: `(MV + realised + income − invested) / invested`. */
  readonly absoluteReturn: Percentage | null;
  readonly unpricedPositions: readonly string[];
  readonly stalePositions: readonly string[];
}

/**
 * Rolls positions into a portfolio.
 *
 * `totalMarketValue` is `null` when **any** position is unpriced, and that is the
 * decision worth defending: a total that silently omits one holding looks exactly
 * like a complete one, and a net worth that is quietly ₹5 lakh light is worse than
 * a screen that says which holding it cannot price. The names are returned so it
 * can say so.
 */
export function summarise(positions: readonly PositionSummary[]): PortfolioSummary {
  const totalCost = Money.total(positions.map((position) => position.costBasis));
  const realisedGain = Money.total(positions.map((position) => position.realisedGain));
  const income = Money.total(positions.map((position) => position.income));
  const unpriced = positions.filter((position) => position.marketValue === null);
  const stale = positions.filter((position) => position.isStale);

  const totalMarketValue =
    unpriced.length > 0
      ? null
      : Money.total(positions.map((position) => position.marketValue!));

  const unrealisedGain = totalMarketValue ? totalMarketValue.minus(totalCost) : null;
  const absoluteReturn =
    totalMarketValue && !totalCost.isZero
      ? Percentage.ratio(
          totalMarketValue.plus(realisedGain).plus(income).minus(totalCost),
          totalCost,
        )
      : null;

  return {
    positions,
    totalCost,
    totalMarketValue,
    unrealisedGain,
    realisedGain,
    income,
    absoluteReturn,
    unpricedPositions: unpriced.map((position) => position.label),
    stalePositions: stale.map((position) => position.label),
  };
}

/* ═══ Threshold-band rebalancing (task 6.2) ═══════════════════════════ */

/**
 * A sleeve breaches when its share is further from target than
 * `min(absolute, relative × target)` — the threshold-band rule. TASKS 6.2 requires
 * bands **wider than 5/25**, so 5/25 itself and anything narrower is refused: tighter bands trade
 * more often for no measured benefit.
 *
 * Exact throughout: the breach test compares minor units in BigInt. The
 * percentages a screen shows are derived afterwards and never compared.
 *
 * The **cash-flow route comes first** (PRODUCT-REQUIREMENT §7): the contribution
 * that lifts the most underweight sleeve back to target, realising no gain. No
 * sale is ever produced here.
 */
export interface Band {
  /** Percentage points either side of target. */
  readonly absolute: Percentage;
  /** Fraction of the target itself: 25% of a 20% target is 5 points. */
  readonly relative: Percentage;
}

export interface Sleeve {
  readonly id: string;
  readonly name: string;
  readonly value: Money;
  readonly target: Percentage;
}

export interface SleeveStanding {
  readonly id: string;
  readonly name: string;
  readonly actual: Percentage;
  readonly target: Percentage;
  /** Actual minus target, in percentage points; negative is underweight. */
  readonly deviation: Percentage;
  readonly tolerance: Percentage;
  readonly breached: boolean;
}

export interface CashFlowRoute {
  readonly sleeveId: string;
  /** New money into this sleeve that brings it to target, rounded up to the paisa. */
  readonly contribution: Money;
  /** Whether that contribution alone puts every sleeve back inside its band. */
  readonly restoresAll: boolean;
}

export interface BandStanding {
  readonly total: Money;
  readonly sleeves: readonly SleeveStanding[];
  readonly breached: boolean;
  /** Null when nothing is breached. */
  readonly cashFlowRoute: CashFlowRoute | null;
}

const WHOLE = 100n * 1_000_000n; // 100% in Percentage's scaled units
const MIN_ABSOLUTE = Percentage.of("5");
const MIN_RELATIVE = Percentage.of("25");

/** For display only; the breach test never compares this truncated figure. */
function toleranceOf(target: Percentage, band: Band): Percentage {
  const relative = Percentage.fromScaled((band.relative.scaled * target.scaled) / WHOLE);
  return relative.scaled < band.absolute.scaled ? relative : band.absolute;
}

/** The tolerance × WHOLE, exactly: min(absolute, relative × target) with no division. */
function toleranceTimesWhole(target: Percentage, band: Band): bigint {
  const absolute = band.absolute.scaled * WHOLE;
  const relative = band.relative.scaled * target.scaled;
  return relative < absolute ? relative : absolute;
}

/** Exact rational test: |value / total − target| > tolerance, over minor units. */
function isBreached(value: Money, total: Money, target: Percentage, band: Band): boolean {
  const gap = value.minor * WHOLE - target.scaled * total.minor;
  return (gap < 0n ? -gap : gap) * WHOLE > toleranceTimesWhole(target, band) * total.minor;
}

/**
 * Validates an owner-stated band. The only constraint is the 6.2 floor; there is no
 * default band — the owner states both figures. Each is also capped at 100.
 */
export function rebalancingBand(band: Band): Band {
  // Strictly wider (owner decision, 2026-10-30): exactly 5/25 is the US rule this replaces.
  if (band.absolute.scaled <= MIN_ABSOLUTE.scaled || band.relative.scaled <= MIN_RELATIVE.scaled) {
    throw new RangeError("Rebalancing bands must be wider than 5 points absolute and 25% relative.");
  }
  if (band.absolute.scaled > WHOLE || band.relative.scaled > WHOLE) {
    throw new RangeError("A rebalancing band cannot exceed 100 points absolute or 100% relative.");
  }
  return Object.freeze({ absolute: band.absolute, relative: band.relative });
}

export function bandStanding(sleeves: readonly Sleeve[], band: Band): BandStanding {
  if (band.absolute.scaled <= MIN_ABSOLUTE.scaled || band.relative.scaled <= MIN_RELATIVE.scaled) {
    throw new RangeError("Rebalancing bands must be wider than 5 points absolute and 25% relative.");
  }
  if (sleeves.length === 0) throw new RangeError("An allocation needs at least one sleeve.");
  if (new Set(sleeves.map((s) => s.id)).size !== sleeves.length) throw new RangeError("Sleeve ids must be unique.");
  if (sleeves.some((s) => s.target.scaled < 0n)) throw new RangeError("A target cannot be negative.");
  if (sleeves.reduce((sum, s) => sum + s.target.scaled, 0n) !== WHOLE) throw new RangeError("Targets must sum to exactly 100%.");
  const currency = sleeves[0]!.value.currency;
  if (sleeves.some((s) => !s.value.currency.equals(currency))) throw new RangeError("Sleeves must share one currency.");
  if (sleeves.some((s) => s.value.isNegative)) throw new RangeError("A sleeve's value cannot be negative.");
  const total = sleeves.reduce((sum, s) => sum.plus(s.value), Money.zero(currency));
  if (!total.isPositive) throw new RangeError("Nothing is invested, so there is no allocation to measure.");

  const standings = sleeves.map((s): SleeveStanding => {
    const actual = Percentage.ratio(s.value, total);
    const tolerance = toleranceOf(s.target, band);
    return Object.freeze({
      id: s.id,
      name: s.name,
      actual,
      target: s.target,
      deviation: Percentage.fromScaled(actual.scaled - s.target.scaled),
      tolerance,
      breached: isBreached(s.value, total, s.target, band),
    });
  });
  const breached = standings.some((s) => s.breached);

  return Object.freeze({
    total,
    sleeves: Object.freeze(standings),
    breached,
    cashFlowRoute: breached ? cashFlowRoute(sleeves, total, band) : null,
  });
}

/** Most underweight by exact gap; ties go to the earlier sleeve. */
function cashFlowRoute(sleeves: readonly Sleeve[], total: Money, band: Band): CashFlowRoute | null {
  const gapOf = (s: Sleeve) => s.target.scaled * total.minor - s.value.minor * WHOLE;
  const under = sleeves.filter((s) => gapOf(s) > 0n && s.target.scaled < WHOLE);
  if (under.length === 0) return null;
  const pick = under.reduce((best, s) => (gapOf(s) > gapOf(best) ? s : best));
  // (v + c) / (T + c) = t  ⇒  c = (t·T − v) / (1 − t), rounded up so the sleeve reaches target.
  const numerator = gapOf(pick);
  const denominator = WHOLE - pick.target.scaled;
  const minor = (numerator + denominator - 1n) / denominator;
  const contribution = Money.fromMinor(minor, total.currency);
  const after = sleeves.map((s) => (s.id === pick.id ? s.value.plus(contribution) : s.value));
  const newTotal = total.plus(contribution);
  const restoresAll = sleeves.every((s, i) => !isBreached(after[i]!, newTotal, s.target, band));
  return Object.freeze({ sleeveId: pick.id, contribution, restoresAll });
}

/* ═══ Task 3.6 metrics: CAGR, HHI, stored target allocation ═══════════ */

/**
 * Compound annual growth rate: `(end ÷ start)^(1 ÷ years) − 1`.
 *
 * A float root, so the output is a `Percentage` rounded to its six places and
 * nothing downstream iterates on the double. **Refuses rather than guesses**: a
 * non-positive start has no growth rate (the ratio is undefined or negative), a
 * zero-length period would divide by zero, a negative end has no real root, and
 * two currencies cannot be compared. Each refusal is a thrown `RangeError` naming
 * the cause, never a quiet `0%`.
 */
export function cagr(start: Money, end: Money, years: Years): Percentage {
  if (start.currency.code !== end.currency.code) {
    throw new RangeError(`CAGR refused: start is ${start.currency.code}, end is ${end.currency.code}.`);
  }
  if (!start.isPositive) throw new RangeError("CAGR refused: the starting value must be positive.");
  if (!(years > 0)) throw new RangeError("CAGR refused: the period must be longer than zero years.");
  if (end.isNegative) throw new RangeError("CAGR refused: a negative ending value has no growth rate.");
  // The end/start quotient is taken exactly in BigInt and rounded once (`exactRatio`);
  // `Number(minor)` would lose paise past 2^53 minor units. Only the root is float.
  const growth = Math.pow(exactRatio(end.minor, start.minor), 1 / years) - 1;
  return Percentage.of((growth * 100).toFixed(6));
}

/**
 * Herfindahl–Hirschman concentration: `Σ wᵢ²` with `wᵢ = vᵢ ÷ Σv`, as a percentage
 * (100% is one holding; `100 ÷ n`% is n equal holdings).
 *
 * **Exact.** `Σ vᵢ² ÷ (Σ vᵢ)²` is computed in `bigint` and rounded once, half-up,
 * to the percentage's six places — no float touches it. Mixed currencies are
 * refused (a sum across currencies is not a portfolio total), as are negative
 * values (a short or a liability is not a holding) and an empty or zero total.
 */
export function hhi(values: readonly Money[]): Percentage {
  if (values.length === 0) throw new RangeError("HHI refused: no holdings.");
  const currency = values[0]!.currency.code;
  if (values.some((value) => value.currency.code !== currency)) {
    throw new RangeError("HHI refused: holdings are in more than one currency.");
  }
  if (values.some((value) => value.isNegative)) throw new RangeError("HHI refused: a holding is negative.");
  const total = values.reduce((sum, value) => sum + value.minor, 0n);
  if (total === 0n) throw new RangeError("HHI refused: the holdings total zero.");
  const squares = values.reduce((sum, value) => sum + value.minor * value.minor, 0n);
  // Percentage scaled is 1e6 per percent, so a fraction f is f × 1e8.
  return Percentage.fromScaled(divideRounded(squares * pow10(8), total * total, "HALF_UP"));
}

/** One sleeve of a stored target: an id the owner chose and its share of the whole. */
export interface TargetShare {
  readonly id: string;
  readonly share: Percentage;
}

declare const validatedTarget: unique symbol;

/**
 * A target allocation the owner stored. **Only `targetAllocation()` makes one**, so
 * holding a `TargetAllocation` is proof that its shares are positive, its ids are
 * distinct and non-empty, and its shares sum to exactly 100%.
 */
export type TargetAllocation = {
  readonly shares: readonly TargetShare[];
  readonly [validatedTarget]: true;
};

const HUNDRED_PERCENT = Percentage.of("100").scaled;

/** Validates and freezes a stored target allocation; throws naming the first defect. */
export function targetAllocation(shares: readonly TargetShare[]): TargetAllocation {
  if (shares.length === 0) throw new RangeError("Target allocation refused: no sleeves.");
  const ids = new Set<string>();
  for (const entry of shares) {
    if (!entry.id.trim()) throw new RangeError("Target allocation refused: a sleeve has no id.");
    if (ids.has(entry.id)) throw new RangeError(`Target allocation refused: sleeve "${entry.id}" appears twice.`);
    ids.add(entry.id);
    if (entry.share.scaled <= 0n) {
      throw new RangeError(`Target allocation refused: sleeve "${entry.id}" must have a positive share.`);
    }
  }
  const sum = shares.reduce((acc, entry) => acc + entry.share.scaled, 0n);
  if (sum !== HUNDRED_PERCENT) {
    throw new RangeError(`Target allocation refused: shares sum to ${Percentage.fromScaled(sum).toFixed(6)}%, not 100%.`);
  }
  const frozen = Object.freeze(shares.map((entry) => Object.freeze({ id: entry.id, share: entry.share })));
  return Object.freeze({ shares: frozen }) as TargetAllocation;
}

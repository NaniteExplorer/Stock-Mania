/**
 * Stationary block bootstrap over annual returns (task 5.1).
 *
 * `PRODUCT-REQUIREMENT.md` §6: the projection is **a distribution, not a line**.
 * Each path replays history in blocks: a block starts at a random year and runs
 * on for a random, geometrically distributed number of years with mean
 * `blockYears` (Politis & Romano 1994), wrapping round the end of the series.
 * Blocks keep multi-year runs — a bear market followed by its recovery — intact,
 * which an independent draw per year would shred.
 *
 * **Equity, debt and inflation are resampled jointly**: one drawn year supplies all
 * three. Whatever correlation history had is preserved exactly, and no
 * correlation matrix is invented.
 *
 * Like `portfolio.ts`, **this is floating point, and says so**. A projection is an
 * illustration, never posted. Money crosses into floats once, at the start, via
 * `toApproximateNumber()`, and back once per figure, rounded to the paisa.
 * Everything is computed in **real** terms: each year's return is deflated by
 * that same year's inflation, so the headline is in today's rupees.
 */

import { Money } from "@/core/money";
import { Count, Ratio, Years } from "@/core/units";

/** A uniform draw in [0, 1). */
export type Random = () => Ratio;

export interface AnnualReturns {
  readonly year: Count;
  /** Nominal total return for the year, as a fraction. */
  readonly equity: Ratio;
  readonly debt: Ratio;
  readonly inflation: Ratio;
}

export interface Plan {
  /** Today's wealth: the starting point of every path. */
  readonly startWealth: Money;
  readonly currentAge: Years;
  readonly retirementAge: Years;
  readonly horizonAge: Years;
  /** Added at the start of each year before retirement, in today's rupees. */
  readonly annualContribution: Money;
  /**
   * Whether the contribution rises with inflation each year. Stated, never assumed:
   * a fixed nominal SIP loses real value every year, and treating it as indexed
   * would overstate the corpus.
   */
  readonly contributionIndexed: boolean;
  /** Rebalanced to this each year. */
  readonly equityShare: Ratio;
  /** Applied to wealth at retirement; the rupee amount then stays constant in real terms. */
  readonly withdrawalRate: Ratio;
  /** Contributions paused from `fromAge` until `untilAge`, or for good when that is null (task 5.2). */
  readonly suspension?: { readonly fromAge: Years; readonly untilAge: Years | null };
}

export interface Path {
  /** Real wealth at the start of each simulated year, index 0 being today. */
  readonly wealth: readonly Money[];
  /** The age the money ran out, or null if it lasted to the horizon. */
  readonly depletedAt: Years | null;
}

export interface Run {
  readonly paths: Count;
  readonly seed: Count;
}

/** A small, fast, seedable PRNG (mulberry32): the same seed gives the same paths. */
export function mulberry32(seed: Count): Random {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return Ratio(((t ^ (t >>> 14)) >>> 0) / 4294967296);
  };
}

/** Indices into `series` for `years` simulated years, drawn as stationary blocks. */
export function resampleYears(seriesLength: Count, years: Count, meanBlock: Count, random: Random): readonly Count[] {
  if (meanBlock < 1) throw new RangeError("A mean block length must be at least one year.");
  if (seriesLength < 2 * meanBlock) {
    throw new RangeError(`${seriesLength} years of returns cannot support blocks of ${meanBlock}; needs at least ${2 * meanBlock}.`);
  }
  const continueBlock = 1 - 1 / meanBlock;
  const picks: Count[] = [];
  let index = Math.floor(random() * seriesLength);
  for (let i = 0; i < years; i += 1) {
    if (i > 0) index = random() < continueBlock ? (index + 1) % seriesLength : Math.floor(random() * seriesLength);
    picks.push(Count(index));
  }
  return Object.freeze(picks);
}

function suspended(plan: Plan, age: number): boolean {
  const pause = plan.suspension;
  return pause !== undefined && age >= pause.fromAge && (pause.untilAge === null || age < pause.untilAge);
}

const toMoney = (rupees: number, like: Money): Money => Money.fromRupees((Math.round(rupees * 100) / 100).toFixed(2), like.currency);

export function simulatePaths(plan: Plan, series: readonly AnnualReturns[], meanBlock: Count, run: Run): readonly Path[] {
  if (!(plan.currentAge <= plan.retirementAge && plan.retirementAge < plan.horizonAge)) {
    throw new RangeError("Ages must run current ≤ retirement < horizon.");
  }
  if (run.paths < 1) throw new RangeError("A projection needs at least one path.");
  if (plan.startWealth.isNegative) {
    throw new RangeError("Starting wealth is negative; a projection from a debt is not modelled, so it refuses rather than erase the debt.");
  }
  if (!plan.annualContribution.currency.equals(plan.startWealth.currency)) {
    throw new RangeError("The contribution and starting wealth must be in one currency.");
  }
  if (plan.suspension && plan.suspension.untilAge !== null && plan.suspension.untilAge <= plan.suspension.fromAge) {
    throw new RangeError("A suspension must end after it starts.");
  }
  // A generic Ratio permits any finite value; the financial meaning is enforced here,
  // at the public boundary, rather than by clamping the money that comes out.
  if (plan.annualContribution.isNegative) {
    throw new RangeError("The annual contribution is negative; a withdrawal before retirement is not a contribution, so it refuses.");
  }
  if (!(plan.equityShare >= 0 && plan.equityShare <= 1)) {
    throw new RangeError(`The equity share ${plan.equityShare} is outside 0 to 1; leverage and short positions are not modelled.`);
  }
  if (!(plan.withdrawalRate >= 0 && plan.withdrawalRate <= 1)) {
    throw new RangeError(`The withdrawal rate ${plan.withdrawalRate} is outside 0 to 1.`);
  }
  for (const y of series) {
    if (!(y.equity >= -1 && y.debt >= -1)) {
      throw new RangeError(`The ${y.year} return is below -100%; an unlevered holding cannot lose more than everything.`);
    }
    if (!(y.inflation > -1)) throw new RangeError(`The ${y.year} inflation of ${y.inflation} would make prices zero or negative.`);
  }
  const years = Count(Math.ceil(plan.horizonAge - plan.currentAge));
  const retireAfter = Math.ceil(plan.retirementAge - plan.currentAge);
  const random = mulberry32(run.seed);
  const contribution = plan.annualContribution.toApproximateNumber();
  const realReturns = series.map((y) => {
    const nominal = plan.equityShare * y.equity + (1 - plan.equityShare) * y.debt;
    return (1 + nominal) / (1 + y.inflation) - 1;
  });

  const paths: Path[] = [];
  for (let p = 0; p < run.paths; p += 1) {
    const picks = resampleYears(Count(series.length), years, meanBlock, random);
    let wealth = plan.startWealth.toApproximateNumber();
    let withdrawal = 0;
    let depletedAt: Years | null = null;
    let priceLevel = 1; // cumulative inflation since today, for a non-indexed contribution
    const trail: Money[] = [toMoney(wealth, plan.startWealth)];
    for (let i = 0; i < years; i += 1) {
      if (i < retireAfter) {
        if (!suspended(plan, plan.currentAge + i)) wealth += plan.contributionIndexed ? contribution : contribution / priceLevel;
      } else {
        if (i === retireAfter) withdrawal = wealth * plan.withdrawalRate;
        wealth -= withdrawal;
      }
      // Only a retirement-phase shortfall is running out; a zero balance while saving is not.
      // Exhausted by the start-of-year withdrawal: gone at this age.
      if (i >= retireAfter && wealth <= 0 && depletedAt === null) {
        depletedAt = Years(plan.currentAge + i);
      }
      wealth = wealth <= 0 ? 0 : wealth * (1 + realReturns[picks[i]!]!);
      // A return can also exhaust the money, including in the final simulated year:
      // the owner then reaches the next age with nothing. Below half a paisa the
      // recorded figure is 0.00, so it counts as gone.
      if (i >= retireAfter && wealth < 0.005 && depletedAt === null) {
        depletedAt = Years(plan.currentAge + i + 1);
      }
      priceLevel *= 1 + series[picks[i]!]!.inflation;
      trail.push(toMoney(wealth, plan.startWealth));
    }
    paths.push(Object.freeze({ wealth: Object.freeze(trail), depletedAt }));
  }
  return Object.freeze(paths);
}

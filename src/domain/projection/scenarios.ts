/**
 * Reading a path set: fan bands, scenario counts, and what a SIP pause costs
 * (tasks 5.4 and 5.2).
 *
 * `PRODUCT-REQUIREMENT.md` §6: **a count of historical scenarios, never a
 * probability.** "63 of 100" is a frequency of past stretches replayed; "63%
 * likely" is a forecast the evidence cannot support, and is read regressively.
 * Nothing here returns a probability, and the headline copy carries its caveat.
 *
 * Percentiles are exact: nearest-rank over the paths' Money, compared in BigInt.
 *
 * The SIP-suspension cost is compared at the **10th percentile** as well as the
 * median (DESIGN §8.2), because a pause hurts most in the bad stretches, and an
 * averaged comparison hides precisely that.
 */

import type { Money } from "@/core/money";
import { Count, Ordinal, Years } from "@/core/units";
import type { Path } from "./bootstrap";

const BAND_PERCENTILES = Object.freeze([5, 10, 25, 50, 75, 90, 95] as const);
export type BandPercentile = (typeof BAND_PERCENTILES)[number];

export type YearBands = { readonly [P in BandPercentile]: Money };

export const SCENARIO_CAVEAT = "These are past stretches replayed, not a forecast.";

function checkPaths(paths: readonly Path[]): void {
  if (paths.length === 0) throw new RangeError("No paths to read.");
  const length = paths[0]!.wealth.length;
  if (paths.some((p) => p.wealth.length !== length)) throw new RangeError("Paths must all cover the same years.");
}

/** Nearest-rank percentile: the smallest value with at least p% of paths at or below it. */
function percentile(sorted: readonly Money[], p: BandPercentile): Money {
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[rank - 1]!;
}

/** Bands for every simulated year, index 0 being today. */
export function fanBands(paths: readonly Path[]): readonly YearBands[] {
  checkPaths(paths);
  const years = paths[0]!.wealth.length;
  const bands: YearBands[] = [];
  for (let i = 0; i < years; i += 1) {
    const sorted = paths.map((p) => p.wealth[i]!).sort((a, b) => a.compareTo(b));
    const entries = BAND_PERCENTILES.map((p) => [p, percentile(sorted, p)] as const);
    bands.push(Object.freeze(Object.fromEntries(entries)) as YearBands);
  }
  return Object.freeze(bands);
}

export interface ScenarioCount {
  readonly reached: Count;
  readonly of: Count;
}

/** Paths whose real wealth reaches `target` at any year up to and including `byYear`. */
export function reachedTarget(paths: readonly Path[], target: Money, byYear: Ordinal): ScenarioCount {
  checkPaths(paths);
  if (byYear >= paths[0]!.wealth.length) throw new RangeError("The target year is past the end of the paths.");
  const reached = paths.filter((p) => p.wealth.slice(0, byYear + 1).some((w) => w.isGreaterThanOrEqual(target))).length;
  return Object.freeze({ reached: Count(reached), of: Count(paths.length) });
}

/** Paths whose money lasted to the horizon. */
export function lastedToHorizon(paths: readonly Path[]): ScenarioCount {
  checkPaths(paths);
  return Object.freeze({ reached: Count(paths.filter((p) => p.depletedAt === null).length), of: Count(paths.length) });
}

/** The headline sentence (DESIGN §8.2). A count with its real denominator; never a percentage. */
export function headline(count: ScenarioCount, targetAge: Years): string {
  return `In ${count.reached} of ${count.of} scenarios replayed from Indian market history, the corpus reached your target by ${targetAge}.`;
}

export interface SuspensionCost {
  /** Real wealth lost at the comparison year, in the bad stretches (10th percentile) and at the median. */
  readonly rupeesAtTenth: Money;
  readonly rupeesAtMedian: Money;
  /**
   * Extra years to first reach `target`, at each percentile. Null when the
   * suspended band never reaches it within the paths — not a number of years.
   */
  readonly yearsAtTenth: Years | null;
  readonly yearsAtMedian: Years | null;
}

function firstReach(bands: readonly YearBands[], p: BandPercentile, target: Money): number | null {
  const index = bands.findIndex((b) => b[p].isGreaterThanOrEqual(target));
  return index === -1 ? null : index;
}

function delay(original: number | null, suspended: number | null): Years | null {
  if (original === null || suspended === null) return null;
  return Years(Math.max(0, suspended - original));
}

/**
 * What a pause costs, comparing two runs of the **full** path set made with the
 * same seed — the original plan and the suspended one — so the difference is
 * the pause, not the draw.
 */
export function suspensionCost(
  original: readonly Path[],
  suspended: readonly Path[],
  target: Money,
  atYear: Ordinal,
): SuspensionCost {
  if (original.length !== suspended.length) throw new RangeError("Compare runs with the same number of paths and seed.");
  const before = fanBands(original);
  const after = fanBands(suspended);
  if (atYear >= before.length || before.length !== after.length) throw new RangeError("The comparison year is outside the paths.");
  return Object.freeze({
    rupeesAtTenth: before[atYear]![10].minus(after[atYear]![10]),
    rupeesAtMedian: before[atYear]![50].minus(after[atYear]![50]),
    yearsAtTenth: delay(firstReach(before, 10, target), firstReach(after, 10, target)),
    yearsAtMedian: delay(firstReach(before, 50, target), firstReach(after, 50, target)),
  });
}

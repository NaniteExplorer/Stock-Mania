/**
 * Coverage and the sensitivity range (task 3.5).
 *
 * A score is a point estimate of a judgement, and the judgement depends on
 * benchmarks that reasonable people set differently: 3 or 6 months of runway,
 * 20% or 30% debt service, 33× or 25× expenses. So every score travels with the
 * **range** it would take under each indicator's stated alternatives, and with
 * its **coverage** — the share of indicators actually measured. A narrow range
 * says the benchmark choice does not matter here; a wide one says it does.
 */

import { Ratio } from "@/core/units";
import { composite, type Measurement } from "./composite";
import { INDICATORS, indicator, type Indicator } from "./indicators";

export interface Sensitivity {
  /** Share of registry indicators with a measurement (declared absence counts: it was measured). */
  readonly coverage: Ratio;
  /** Lowest and highest composite across every alternative benchmark, or null when refused. */
  readonly range: { readonly low: Ratio; readonly high: Ratio } | null;
}

/** The registry with one indicator's benchmark swapped for an alternative value. */
function withBenchmark(target: Indicator, value: Indicator["alternatives"][number]): readonly Indicator[] {
  return INDICATORS.map((candidate) => {
    if (candidate.id !== target.id) return candidate;
    const benchmark = candidate.benchmark;
    // Only valued benchmarks have alternatives; PRESENT/OWN_BAND keep theirs.
    if (!("value" in benchmark)) return candidate;
    return indicator({ ...candidate, benchmark: { ...benchmark, value } });
  });
}

export function sensitivity(measurements: ReadonlyMap<string, Measurement>): Sensitivity {
  const measured = INDICATORS.filter((i) => {
    const m = measurements.get(i.id);
    return m !== undefined && m.state !== "unknown";
  }).length;
  const coverage = Ratio(measured / INDICATORS.length);

  const base = composite(measurements);
  if (base.state !== "scored") return Object.freeze({ coverage, range: null });

  const scores: number[] = [base.score];
  for (const target of INDICATORS) {
    for (const value of target.alternatives) {
      const variant = composite(measurements, withBenchmark(target, value));
      if (variant.state === "scored") scores.push(variant.score);
    }
  }
  return Object.freeze({ coverage, range: Object.freeze({ low: Ratio(Math.min(...scores)), high: Ratio(Math.max(...scores)) }) });
}

/**
 * The named benchmark disagreements the plan requires every score to be tested
 * against (product §5): 3 vs 6 months of runway, 3% vs 4% safe withdrawal (33× vs
 * 25× expenses), and 10× vs 15×. Each axis names the registry indicator that
 * carries it, or `null` with the reason when no scored indicator does.
 *
 * **10× vs 15× has no carrier** (QA repair 2026-11-03). It is the term-cover
 * sizing rule — cover of 10× or 15× annual income. The registry scores cover as
 * presence (product §4.1), and the owner has refused an income-multiple
 * insurance score, so there is no honest indicator to recompute it on and none
 * is invented. The axis is still listed and still returned by `axisRanges`, as
 * **not computable**, with that reason — so the screen shows the gap rather than
 * a range that silently leaves it out. Task 3.5 stays open on it.
 */
export interface SensitivityAxis {
  readonly id: string;
  readonly label: string;
  readonly indicatorId: string | null;
  readonly values: readonly Indicator["alternatives"][number][];
  readonly note: string;
}

const alternativesOf = (id: string) => INDICATORS.find((candidate) => candidate.id === id)?.alternatives ?? [];

export const SENSITIVITY_AXES: readonly SensitivityAxis[] = Object.freeze([
  Object.freeze({ id: "runway-3-vs-6", label: "3 vs 6 months of runway", indicatorId: "runway-months", values: alternativesOf("runway-months"), note: "Both are convention; neither is a standard." }),
  Object.freeze({ id: "swr-3-vs-4", label: "3% vs 4% safe withdrawal (33× vs 25× expenses)", indicatorId: "independence-multiple", values: alternativesOf("independence-multiple"), note: "3% is the Indian-market finding; 4% is the US-derived rule." }),
  Object.freeze({
    id: "multiple-10-vs-15",
    label: "10× vs 15× income (term cover sizing)",
    indicatorId: null,
    values: [],
    note: "Pending an owner/product decision, unscored: no indicator carries an income multiple, and no insurance income score is made (cover is scored as presence, product §4.1).",
  }),
]);

/**
 * Why an axis has, or has not, a range: `ranged` it was recomputed under each
 * of its values; `refused` the composite is refused, so there is nothing to
 * vary; `pending-decision` the axis awaits an owner/product decision and is unscored (its `note` says so).
 */
export type AxisStatus = "ranged" | "refused" | "pending-decision";

export interface AxisRange {
  readonly axis: SensitivityAxis;
  readonly status: AxisStatus;
  /** The composite under each of the axis's values; null unless `status` is `ranged`. */
  readonly range: { readonly low: Ratio; readonly high: Ratio } | null;
}

/** The composite's range along each named axis, so the screen can say which disagreement moves it. */
export function axisRanges(measurements: ReadonlyMap<string, Measurement>): readonly AxisRange[] {
  return Object.freeze(
    SENSITIVITY_AXES.map((axis) => {
      const target = INDICATORS.find((candidate) => candidate.id === axis.indicatorId);
      if (target === undefined || axis.values.length === 0) return Object.freeze({ axis, status: "pending-decision" as const, range: null });
      const scores = axis.values.flatMap((value) => {
        const variant = composite(measurements, withBenchmark(target, value));
        return variant.state === "scored" ? [variant.score] : [];
      });
      if (scores.length === 0) return Object.freeze({ axis, status: "refused" as const, range: null });
      return Object.freeze({ axis, status: "ranged" as const, range: Object.freeze({ low: Ratio(Math.min(...scores)), high: Ratio(Math.max(...scores)) }) });
    }),
  );
}

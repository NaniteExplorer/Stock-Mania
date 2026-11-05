/**
 * Measurement and the composite (tasks 3.1 and 3.2).
 *
 * **Three states, never collapsed** (product §5): an indicator is *measured*,
 * *unknown* (nobody has said), or *not applicable* (it does not apply to this
 * household — term cover where nobody depends on the income, debt service with no
 * debt). A measurement may be *declared absent*: the owner has stated the thing
 * does not exist, a real measurement that scores zero honestly. An unknown is never
 * a zero, and a not-applicable is never a zero either: it leaves the mean. A pillar with any unknown is itself unknown, and the
 * composite **refuses** until every pillar is known, naming the ones that are not.
 *
 * **Normalisation** is distance to target, `min(1, actual / benchmark)` — the only
 * form defined for a single household with no reference distribution.
 * **Aggregation** is arithmetic within a pillar and **geometric across pillars**,
 * equal-weighted: an arithmetic composite is fully compensable and would let a
 * strong portfolio cancel out having no health cover. Geometric means a zero
 * pillar makes a zero composite, whatever else is true.
 */

import { Ratio } from "@/core/units";
import { INDICATORS, type BenchmarkValue, type Indicator, type Pillar } from "./indicators";

export type Measurement =
  /**
   * `value` in the benchmark's own unit (months, a fraction, a multiple); for
   * OWN_BAND, the 0–1 standing in your own history; for PRESENT, a count of policies.
   */
  | { readonly state: "measured"; readonly value: BenchmarkValue }
  | { readonly state: "declared-absent" }
  | { readonly state: "unknown"; readonly reason: string }
  | { readonly state: "not-applicable"; readonly reason: string };

/** What a pillar with any unknown shows in place of a number. */
export const UNKNOWN_MARK = "—";

/** An indicator's normalised score, 0 to 1, or why there is none. */
export type IndicatorScore =
  | { readonly state: "scored"; readonly indicator: Indicator; readonly score: Ratio }
  | { readonly state: "unknown"; readonly indicator: Indicator; readonly reason: string }
  | { readonly state: "not-applicable"; readonly indicator: Indicator; readonly reason: string };

export type PillarScore =
  | { readonly state: "scored"; readonly pillar: Pillar; readonly score: Ratio; readonly indicators: readonly IndicatorScore[] }
  | { readonly state: "unknown"; readonly pillar: Pillar; readonly missing: readonly string[]; readonly indicators: readonly IndicatorScore[] }
  /** Every indicator of the pillar is not applicable: the pillar leaves the geometric mean. */
  | { readonly state: "not-applicable"; readonly pillar: Pillar; readonly indicators: readonly IndicatorScore[] };

export type Composite =
  | { readonly state: "scored"; readonly score: Ratio; readonly pillars: readonly PillarScore[] }
  | { readonly state: "refused"; readonly missingPillars: readonly Pillar[]; readonly reason: string; readonly pillars: readonly PillarScore[] };

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

/** Distance to target, capped at 1. Declared absence scores zero; unknown and not-applicable do not score. */
export function scoreIndicator(indicator: Indicator, measurement: Measurement): IndicatorScore {
  return SCORE_BY_STATE[measurement.state](indicator, measurement as never);
}

type ByState<S extends Measurement["state"]> = (indicator: Indicator, measurement: Extract<Measurement, { state: S }>) => IndicatorScore;

/** Exhaustive over the measurement states: adding a state without a row does not compile. */
const SCORE_BY_STATE: { readonly [S in Measurement["state"]]: ByState<S> } = Object.freeze({
  measured: (indicator, measurement) => ({ state: "scored", indicator, score: Ratio(normalise(indicator, measurement.value)) }),
  "declared-absent": (indicator) => ({ state: "scored", indicator, score: Ratio(0) }),
  unknown: (indicator, measurement) => ({ state: "unknown", indicator, reason: measurement.reason }),
  "not-applicable": (indicator, measurement) => ({ state: "not-applicable", indicator, reason: measurement.reason }),
});

type Normaliser<D extends Indicator["benchmark"]["direction"]> = (benchmark: Extract<Indicator["benchmark"], { direction: D }>, value: number) => number;

/** Exhaustive over benchmark directions. */
const NORMALISE: { readonly [D in Indicator["benchmark"]["direction"]]: Normaliser<D> } = Object.freeze({
  AT_LEAST: (benchmark, value) => clamp01(value / benchmark.value),
  // At or under the ceiling is full marks; above it, the ceiling's share of the actual.
  AT_MOST: (benchmark, value) => (value <= benchmark.value ? 1 : clamp01(benchmark.value / value)),
  PRESENT: (_benchmark, value) => (value > 0 ? 1 : 0),
  OWN_BAND: (_benchmark, value) => clamp01(value),
});

function normalise(indicator: Indicator, value: BenchmarkValue): number {
  return NORMALISE[indicator.benchmark.direction](indicator.benchmark as never, value);
}

/**
 * Arithmetic mean within a pillar over the applicable indicators; unknown if any
 * indicator is; not-applicable only when every indicator is.
 */
export function scorePillar(pillar: Pillar, scores: readonly IndicatorScore[]): PillarScore {
  const mine = scores.filter((score) => score.indicator.pillar === pillar);
  if (mine.length === 0) return { state: "unknown", pillar, missing: ["no indicator measured"], indicators: mine };
  const unknown = mine.flatMap((score) => (score.state === "unknown" ? [`${score.indicator.name}: ${score.reason}`] : []));
  if (unknown.length > 0) return { state: "unknown", pillar, missing: unknown, indicators: mine };
  const values = mine.flatMap((score) => (score.state === "scored" ? [score.score] : []));
  if (values.length === 0) return { state: "not-applicable", pillar, indicators: mine };
  return { state: "scored", pillar, score: Ratio(values.reduce<number>((a, b) => a + b, 0) / values.length), indicators: mine };
}

/** A pillar as shown: its score to two places, or the em-dash when unknown. */
export function pillarDisplay(pillar: PillarScore): string {
  return PILLAR_DISPLAY[pillar.state](pillar as never);
}

const PILLAR_DISPLAY: { readonly [S in PillarScore["state"]]: (pillar: Extract<PillarScore, { state: S }>) => string } = Object.freeze({
  scored: (pillar) => pillar.score.toFixed(2),
  unknown: () => UNKNOWN_MARK,
  "not-applicable": () => "n/a",
});

export const ALL_PILLARS: readonly Pillar[] = ["RUNWAY", "SAVINGS", "DEBT", "STABILITY", "PROTECT", "RETIREMENT"];

/**
 * The composite, from a measurement per registry indicator. An indicator with no
 * entry in `measurements` is unknown — absence of data is never absence of the thing.
 */
export function composite(measurements: ReadonlyMap<string, Measurement>, registry: readonly Indicator[] = INDICATORS): Composite {
  const scores = registry.map((indicator) =>
    scoreIndicator(indicator, measurements.get(indicator.id) ?? { state: "unknown", reason: "not measured yet" }),
  );
  const pillars = ALL_PILLARS.map((pillar) => scorePillar(pillar, scores));
  const missing = pillars.flatMap((pillar) => (pillar.state === "unknown" ? [pillar.pillar] : []));
  if (missing.length > 0) {
    return {
      state: "refused",
      missingPillars: missing,
      reason: `${pillars.length - missing.length} of ${pillars.length} pillars computable. Missing: ${missing.join(", ")}.`,
      pillars,
    };
  }
  const values = pillars.flatMap((pillar) => (pillar.state === "scored" ? [pillar.score] : []));
  if (values.length === 0) {
    return { state: "refused", missingPillars: [], reason: "No pillar applies to this household, so there is nothing to score.", pillars };
  }
  // Geometric mean, equal weights: one zero pillar is a zero composite.
  const geometric = values.some((value) => value === 0) ? 0 : Math.exp(values.reduce<number>((sum, value) => sum + Math.log(value), 0) / values.length);
  return { state: "scored", score: Ratio(geometric), pillars };
}

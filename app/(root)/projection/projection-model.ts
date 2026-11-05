/**
 * The /projection view model (DESIGN §8.2): pure, no I/O, no clock.
 *
 * It decides which of the screen's states applies and, on a pass, turns the
 * path set into SVG geometry. It never draws a fan with a default substituted:
 * any missing input — an assumption, a measurement, a returns series, a target —
 * becomes a named refusal reason.
 */
import { compact } from "@/core/format";
import type { Money } from "@/core/money";
import { Count, Ordinal, Years } from "@/core/units";
import type { AssumptionSet } from "@/domain/projection/assumptions";
import { simulatePaths, type AnnualReturns, type Path, type Plan } from "@/domain/projection/bootstrap";
import { projectionGate, type GateInputs } from "@/domain/projection/gate";
import { fanBands, headline, reachedTarget, SCENARIO_CAVEAT, type YearBands } from "@/domain/projection/scenarios";

export { SCENARIO_CAVEAT };

export const PROJECTION_TITLE = "Corpus against age";
export const PATH_COUNT = Count(100);
export const SEED = Count(20261030);

export interface ProjectionTarget {
  readonly amount: Money;
  readonly age: Years;
  /** Its stated basis, e.g. "33× expenses at 60". */
  readonly basis: string;
}

export interface ProjectionInputs {
  readonly assumptions: AssumptionSet;
  /** Whether the assumptions came from storage; false means AssumptionSet.initial() was used. */
  readonly assumptionsSaved: boolean;
  /** Measured gate inputs, or null when they are not measured yet. */
  readonly gate: GateInputs | null;
  readonly hasInvestments: boolean;
  /** Current corpus, or null when unknown. */
  readonly startWealth: Money | null;
  readonly returns: readonly AnnualReturns[];
  readonly target: ProjectionTarget | null;
  /** True when the assumptions were edited since the last run. */
  readonly assumptionsChanged: boolean;
}

export interface FanGeometry {
  readonly width: number;
  readonly height: number;
  /** SVG path data for each band and the median. */
  readonly outer: string;
  readonly middle: string;
  readonly inner: string;
  readonly median: string;
  readonly targetY: number;
  readonly targetLabel: string;
  readonly ageTicks: readonly { readonly x: number; readonly label: string }[];
  /** Right-margin labels, from the inner band outwards. */
  readonly bandLabels: readonly { readonly y: number; readonly text: string }[];
}

export type ProjectionView =
  | { readonly kind: "refused"; readonly summary: string; readonly reasons: readonly string[] }
  | { readonly kind: "empty"; readonly summary: string; readonly reason: string }
  | {
      readonly kind: "ready" | "stale";
      readonly summary: string;
      readonly headline: string;
      readonly caveat: string;
      readonly description: string;
      readonly fan: FanGeometry;
      readonly staleReason: string | null;
    };

export const BAND_LABELS = Object.freeze(["half of scenarios", "8 in 10", "9 in 10 — and beyond"]);
export const NO_SAVED_ASSUMPTIONS = "Your projection assumptions have not been saved yet, so none of them can be used.";
export const NOT_MEASURED = "History length, categorisation coverage and asset mix have not been measured for the projection yet.";
export const NO_RETURNS = "No Indian market returns series is recorded, so there is no history to replay.";
export const NO_TARGET = "No target corpus is set: it needs 12 months of expenses to state one.";
export const CORPUS_UNKNOWN = "Your current corpus is unknown, so no path has a starting point.";

const REFUSED_SUMMARY = "No fan is drawn until every cause below is fixed.";

function refusalReasons(input: ProjectionInputs): string[] {
  const reasons: string[] = [];
  if (!input.assumptionsSaved) reasons.push(NO_SAVED_ASSUMPTIONS);
  if (input.gate === null) {
    reasons.push(NOT_MEASURED);
    reasons.push(...input.assumptions.blockers({ holdsNps: false }));
  } else {
    const gate = projectionGate(input.gate, input.assumptions);
    if (gate.state === "refused") reasons.push(...gate.reasons);
  }
  if (input.startWealth === null) reasons.push(CORPUS_UNKNOWN);
  if (input.returns.length === 0) reasons.push(NO_RETURNS);
  if (input.target === null) reasons.push(NO_TARGET);
  return reasons;
}

export function buildProjectionView(input: ProjectionInputs): ProjectionView {
  if (!input.hasInvestments) {
    return Object.freeze({ kind: "empty", summary: "No investments are recorded yet.", reason: "Record an investment and the fan of replayed scenarios appears here." });
  }
  const reasons = refusalReasons(input);
  if (reasons.length > 0) return Object.freeze({ kind: "refused", summary: REFUSED_SUMMARY, reasons: Object.freeze(reasons) });

  // Every value below was checked non-null by the gate (blockers) and refusalReasons.
  const a = input.assumptions;
  const target = input.target!;
  const plan: Plan = {
    startWealth: input.startWealth!,
    currentAge: a.get("currentAge").value!,
    retirementAge: a.get("retirementAge").value!,
    horizonAge: a.get("horizonAge").value!,
    annualContribution: a.get("monthlyContribution").value!.times(12),
    contributionIndexed: false,
    equityShare: a.get("equityShare").value!,
    withdrawalRate: a.get("withdrawalRate").value!,
  };
  return readPaths(simulatePaths(plan, input.returns, a.get("blockYears").value!, { paths: PATH_COUNT, seed: SEED }), plan, target, input.assumptionsChanged);
}

/** Reads a path set into the ready view. Exported so a spec can feed hand-made paths. */
export function readPaths(paths: readonly Path[], plan: Pick<Plan, "currentAge">, target: ProjectionTarget, stale: boolean): ProjectionView {
  const bands = fanBands(paths);
  const byYear = Ordinal(Math.min(bands.length - 1, Math.max(0, Math.ceil(target.age - plan.currentAge))));
  const count = reachedTarget(paths, target.amount, byYear);
  const at = bands[byYear]!;
  const summary =
    `Real corpus at ${target.age}: middle half of scenarios between ${compact(at[25])} and ${compact(at[75])}; ` +
    `${count.reached} of ${count.of} reach the ${compact(target.amount)} target.`;
  return Object.freeze({
    kind: stale ? "stale" : "ready",
    summary,
    headline: headline(count, target.age),
    caveat: SCENARIO_CAVEAT,
    description: "In today's rupees. Each band is a share of scenarios replayed from history; the outer band has no edge because history does not bound the future.",
    fan: fanGeometry(bands, plan.currentAge, target),
    staleReason: stale ? "Assumptions were edited since this run. Re-run to replay with them." : null,
  });
}

const W = 640;
const H = 280;
const PAD = { left: 8, right: 128, top: 12, bottom: 28 };

export function fanGeometry(bands: readonly YearBands[], currentAge: Years, target: ProjectionTarget): FanGeometry {
  const n = bands.length;
  const top = Math.max(target.amount.toApproximateNumber(), ...bands.map((b) => b[95].toApproximateNumber()), 1);
  const x = (i: number) => PAD.left + (n === 1 ? 0 : (i / (n - 1)) * (W - PAD.left - PAD.right));
  const y = (m: Money) => {
    const v = Math.max(0, m.toApproximateNumber());
    return PAD.top + (1 - v / top) * (H - PAD.top - PAD.bottom);
  };
  const r = (v: number) => Math.round(v * 10) / 10;
  const line = (p: 5 | 10 | 25 | 50 | 75 | 90 | 95) => bands.map((b, i) => `${r(x(i))},${r(y(b[p]))}`);
  const area = (lo: 5 | 10 | 25, hi: 75 | 90 | 95) => `M${line(hi).join("L")}L${line(lo).reverse().join("L")}Z`;
  const last = bands[n - 1]!;
  const step = n > 20 ? 10 : 5;
  const ageTicks = bands.flatMap((_, i) => (i % step === 0 || i === n - 1 ? [{ x: r(x(i)), label: String(Math.round(currentAge + i)) }] : []));
  return Object.freeze({
    width: W,
    height: H,
    outer: area(5, 95),
    middle: area(10, 90),
    inner: area(25, 75),
    median: `M${line(50).join("L")}`,
    targetY: r(y(target.amount)),
    targetLabel: `${compact(target.amount)} — ${target.basis}`,
    ageTicks: Object.freeze(ageTicks),
    bandLabels: Object.freeze([
      { y: r((y(last[25]) + y(last[75])) / 2), text: BAND_LABELS[0]! },
      { y: r(y(last[90])), text: BAND_LABELS[1]! },
      { y: r(y(last[95])), text: BAND_LABELS[2]! },
    ]),
  });
}

/** Every user-visible string in a view, for the copy test. */
export function viewCopy(view: ProjectionView): readonly string[] {
  if (view.kind === "refused") return [view.summary, ...view.reasons];
  if (view.kind === "empty") return [view.summary, view.reason];
  return [view.summary, view.headline, view.caveat, view.description, view.fan.targetLabel, ...view.fan.bandLabels.map((l) => l.text), ...(view.staleReason ? [view.staleReason] : [])];
}

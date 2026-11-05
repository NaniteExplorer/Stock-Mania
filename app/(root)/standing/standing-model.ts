/**
 * The /standing view model (DESIGN §9f, 3.11.s/3.11.b): pure, no I/O, no clock.
 *
 * It only arranges what `scoreCard()` computed — it never computes a score of its
 * own and never invents a measurement. An indicator with no wired measurement is
 * `unknown` with a reason naming that it is not yet derived, so the composite
 * refuses and names the pillars, which is the honest result until wiring lands.
 */
import { unknown, type Figure, type FigureValue } from "@/core/format";
import type { CalendarDate } from "@/core/time";
import type { Measurement, PillarScore } from "@/domain/scoring/composite";
import { INDICATORS, type Citation, type Indicator, type Pillar } from "@/domain/scoring/indicators";
import type { Provenance } from "@/domain/scoring/provenance";
import type { ScoreCard } from "@/domain/scoring/score-card";
import type { AxisStatus } from "@/domain/scoring/sensitivity";
import { TIER_LABEL, type Tier } from "@/domain/scoring/tiers";

export const PILLAR_LABEL: Readonly<Record<Pillar, string>> = Object.freeze({
  RUNWAY: "Runway", SAVINGS: "Savings", DEBT: "Debt", STABILITY: "Income stability", PROTECT: "Protection", RETIREMENT: "Retirement funding",
});

/** Underlying figures older than this are stale (DESIGN §9f states). */
export const STALE_AFTER_DAYS = 45;

/**
 * Every registry indicator as unknown, with the reason it is: no ledger-derived
 * measurement is wired to the score yet. Never a zero, never a guess.
 */
export function unwiredMeasurements(): ReadonlyMap<string, Measurement> {
  return new Map(INDICATORS.map((indicator) => [indicator.id, {
    state: "unknown" as const,
    reason: `${indicator.name} is not yet derived from your records, so it is not measured.`,
  }]));
}

export type DataState = "measured" | "declared-absent" | "unknown" | "not-applicable";
export const DATA_STATE_LABEL: Readonly<Record<DataState, string>> = Object.freeze({
  measured: "Measured", "declared-absent": "Declared absent", unknown: "Unknown", "not-applicable": "Not applicable",
});

export interface IndicatorRow {
  readonly id: string;
  readonly pillar: string;
  readonly name: string;
  readonly formula: string;
  readonly state: DataState;
  readonly score: FigureValue;
  readonly threshold: string;
  readonly source: string;
  readonly sourceUrl: string | null;
}

export interface PillarRow {
  readonly pillar: Pillar;
  readonly label: string;
  readonly score: FigureValue;
}

export type ProvenanceStatus = "cited" | "owner-confirmed" | "owner-pending";
export const PROVENANCE_STATUS_LABEL: Readonly<Record<ProvenanceStatus, string>> = Object.freeze({
  cited: "Cited", "owner-confirmed": "Owner decision — confirmed", "owner-pending": "Pending owner decision — not confirmed",
});

/** One tier threshold as shown, with where it comes from (QA repair 2026-11-03: none is dropped). */
export interface ThresholdRow {
  readonly id: string;
  readonly name: string;
  readonly shown: string;
  readonly status: ProvenanceStatus;
  readonly source: string;
  readonly sourceUrl: string | null;
}

export const AXIS_STATUS_LABEL: Readonly<Record<AxisStatus, string>> = Object.freeze({
  ranged: "Recomputed", refused: "Refused", "pending-decision": "Pending owner decision — unscored",
});

export type Composite =
  | {
    readonly state: "scored"; readonly hero: Figure; readonly tier: Tier; readonly tierLabel: string; readonly next: string;
    /** Set when only the owner-confirmed demotion margin kept the tier: says so plainly. */
    readonly held: string | null;
  }
  | { readonly state: "refused"; readonly hero: FigureValue; readonly reason: string; readonly missing: readonly string[]; readonly action: string };

export interface StandingView {
  readonly composite: Composite;
  /** Always present: share of indicators measured. */
  readonly coverage: Figure;
  /** Always present: the sensitivity range, or an em-dash saying why there is none. */
  readonly range: FigureValue;
  /** What the range was recomputed under, naming any axis it could not include. */
  readonly rangeDetail: string;
  readonly axes: readonly { readonly label: string; readonly status: AxisStatus; readonly range: FigureValue; readonly note: string }[];
  /** Every tier threshold, with its provenance; shown on refused and scored screens alike. */
  readonly thresholds: readonly ThresholdRow[];
  /** Owner decisions in use but not confirmed: shown at the top, never silent. */
  readonly pending: readonly string[];
  /** What the measurements knowingly leave out (e.g. foreign cash), stated as limitations. */
  readonly limitations: readonly string[];
  readonly pillars: readonly PillarRow[];
  readonly indicators: readonly IndicatorRow[];
  /** One neutral sentence when the tier moved since it was last shown, else null. */
  readonly change: string | null;
  /** Amber notice naming the stale input, else null. */
  readonly stale: string | null;
  /** The tiers the owner may guess between, before anything is revealed. */
  readonly guessOptions: readonly { readonly tier: Tier; readonly label: string }[];
}

const points = (ratio: number): Figure => String(Math.round(ratio * 100)) as Figure;
const percent = (ratio: number): Figure => `${Math.round(ratio * 100)}%` as Figure;

function citationText(citation: Citation): { source: string; url: string | null } {
  switch (citation.kind) {
    case "PRIMARY": return { source: `${citation.title} (${citation.published})`, url: citation.url };
    case "CONVENTION": return { source: `Convention, used by ${citation.usedBy}: ${citation.title}`, url: null };
    case "OWN_HISTORY": return { source: `Against your own history: ${citation.method}`, url: null };
  }
}

function provenanceRow(provenance: Provenance): Pick<ThresholdRow, "status" | "source" | "sourceUrl"> {
  if (provenance.kind === "CITED") {
    const cite = citationText(provenance.citation);
    return { status: "cited", source: cite.source, sourceUrl: cite.url };
  }
  return provenance.confirmed
    ? { status: "owner-confirmed", source: `Owner decision, confirmed: ${provenance.decision}`, sourceUrl: null }
    : { status: "owner-pending", source: `Pending owner decision, not confirmed: ${provenance.decision}`, sourceUrl: null };
}

function thresholdText(indicator: Indicator): string {
  const b = indicator.benchmark;
  switch (b.direction) {
    case "AT_LEAST": return `At least ${b.value} ${b.unit}`;
    case "AT_MOST": return `At most ${b.value} ${b.unit}`;
    case "PRESENT": return "Held";
    case "OWN_BAND": return "Your own range";
  }
}

function pillarScore(pillar: PillarScore): FigureValue {
  switch (pillar.state) {
    case "scored": return points(pillar.score);
    case "not-applicable": return "n/a" as Figure;
    case "unknown": return unknown(`Not computable: ${pillar.missing.join("; ")}`);
  }
}

export interface StandingInput {
  readonly card: ScoreCard;
  readonly measurements: ReadonlyMap<string, Measurement>;
  /** The tier shown last time, for the change sentence; null the first time. */
  readonly previous: Tier | null;
  /** The oldest underlying figure's date, or null when nothing is measured. */
  readonly oldestInput: { readonly name: string; readonly on: CalendarDate } | null;
  readonly today: CalendarDate;
  /** The measurements' stated scope limits (`StandingMeasurementsOutput.limitations`). */
  readonly limitations?: readonly string[];
}

export function buildStandingView({ card, measurements, previous, oldestInput, today, limitations = [] }: StandingInput): StandingView {
  const c = card.composite;
  const composite: Composite = c.state === "scored" && card.tier !== null
    ? {
      state: "scored", hero: points(c.score), tier: card.tier.tier, tierLabel: card.tier.label,
      next: card.tier.ceilings.length > 0
        ? card.tier.ceilings.map((ceiling) => ceiling.reason).join(" ")
        : card.tier.toNext === null ? "This is the top tier." : `${Math.ceil(card.tier.toNext * 100)} points to the next tier.`,
      held: card.tier.heldByMargin
        ? `The score is below the floor of ${card.tier.label}; the tier is kept by the owner-confirmed demotion margin of 3 points.`
        : null,
    }
    : {
      state: "refused",
      hero: unknown("The composite is not computed until every pillar is measured."),
      reason: c.state === "refused" ? `The composite is not computed. ${c.reason}` : "The composite is not computed.",
      missing: c.state === "refused" ? c.missingPillars.map((pillar) => PILLAR_LABEL[pillar]) : [],
      action: c.state === "refused" && c.missingPillars.length > 0
        ? `Measure ${c.missingPillars.map((pillar) => PILLAR_LABEL[pillar]).join(", ")} to compute it.`
        : "Nothing applies to this household yet.",
    };

  const range: FigureValue = card.range === null
    ? unknown("No range: the composite is refused, so there is nothing to vary.")
    : `${points(card.range.low)}–${points(card.range.high)}` as Figure;

  const indicators = c.pillars.flatMap((pillar) => pillar.indicators).map((score): IndicatorRow => {
    const measurement = measurements.get(score.indicator.id);
    const state: DataState = measurement?.state ?? "unknown";
    const cite = citationText(score.indicator.citation);
    return {
      id: score.indicator.id, pillar: PILLAR_LABEL[score.indicator.pillar], name: score.indicator.name, formula: score.indicator.formula, state,
      score: score.state === "scored" ? points(score.score)
        : score.state === "not-applicable" ? "n/a" as Figure
        : unknown(score.reason),
      threshold: thresholdText(score.indicator), source: cite.source, sourceUrl: cite.url,
    };
  });

  const tierNow = card.tier?.tier ?? null;
  const change = previous !== null && tierNow !== null && previous !== tierNow
    ? `Tier moved from ${TIER_LABEL[previous]} to ${TIER_LABEL[tierNow]}.`
    : null;

  const age = oldestInput === null ? null : oldestInput.on.daysUntil(today);
  const stale = oldestInput !== null && age !== null && age > STALE_AFTER_DAYS
    ? `${oldestInput.name} was last measured ${age} days ago; the score may not be current.`
    : null;

  const uncomputable = card.axes.filter((axis) => axis.status === "pending-decision").map((axis) => axis.axis.label);

  return Object.freeze({
    composite,
    coverage: percent(card.coverage),
    range,
    rangeDetail: uncomputable.length === 0
      ? "Under other reasonable benchmarks"
      : `Under other reasonable benchmarks; pending a decision, unscored: ${uncomputable.join(", ")}`,
    axes: card.axes.map((axis) => ({
      label: axis.axis.label,
      status: axis.status,
      range: axis.status === "ranged" && axis.range !== null
        ? `${points(axis.range.low)}–${points(axis.range.high)}` as Figure
        : unknown(axis.status === "pending-decision" ? axis.axis.note : "No range: the composite is refused."),
      note: axis.axis.note,
    })),
    thresholds: card.thresholds.map((entry): ThresholdRow => ({ id: entry.id, name: entry.name, shown: entry.shown, ...provenanceRow(entry.threshold.provenance) })),
    pending: card.pending,
    limitations,
    pillars: c.pillars.map((pillar) => ({ pillar: pillar.pillar, label: PILLAR_LABEL[pillar.pillar], score: pillarScore(pillar) })),
    indicators,
    change,
    stale,
    guessOptions: (["LOWER", "MIDDLE", "UPPER"] as const).map((tier) => ({ tier, label: TIER_LABEL[tier] })),
  });
}

/** The reveal after a guess: a plain comparison, never praise or consolation. */
export function revealSentence(guess: Tier, actual: Tier): string {
  return guess === actual
    ? `You guessed ${TIER_LABEL[guess]}. The score places you in ${TIER_LABEL[actual]}, as you guessed.`
    : `You guessed ${TIER_LABEL[guess]}. The score places you in ${TIER_LABEL[actual]}.`;
}

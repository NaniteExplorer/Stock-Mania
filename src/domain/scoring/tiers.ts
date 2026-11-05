/**
 * Tiers — ceilings first, then the label, then hysteresis (tasks 3.3 and 3.4).
 *
 * **Three tiers**, boundaries at 0.40 and 0.80 of the composite. The three-tier,
 * 40/80 structure follows the FinHealth Score's published architecture; the
 * names are **placeholders** (`Tier 1/2/3`) until the owner settles them —
 * the FinHealth names and wording are a registered trademark (research: "imitate
 * the structure, never the name"), and no other naming has been decided.
 *
 * **Ceilings are non-compensatory and apply before the label is derived** (3.3):
 * with no health cover the tier cannot exceed MIDDLE, and with fixed obligations
 * above 50% of income it cannot reach UPPER — however strong the rest is. The
 * owner is told which ceiling applied; a capped tier never looks like an earned one.
 *
 * **Hysteresis on demotion** (3.4): moving up happens the moment a boundary is
 * crossed; moving down needs the score to fall a margin *below* the boundary, so
 * noise around a boundary does not flicker the tier. A drop is reported as a
 * fact — what fell and by how much — and nothing about it is celebratory.
 *
 * **The margin is owner-confirmed** (owner decision 2026-11-03 16:11). It is still
 * never applied silently: every tier
 * result says when the margin held it (`heldByMargin`), and `TIER_THRESHOLDS`
 * carries the margin's provenance — OWNER_SET, `confirmed: true` — for the score
 * card and the screen to show.
 */

import { Ratio } from "@/core/units";
import { INDICATORS } from "./indicators";
import { threshold, type Threshold } from "./provenance";

export type Tier = "LOWER" | "MIDDLE" | "UPPER";

const ORDER: Record<Tier, number> = { LOWER: 0, MIDDLE: 1, UPPER: 2 };
const BY_ORDER: readonly Tier[] = ["LOWER", "MIDDLE", "UPPER"];
/** Neutral placeholders: the owner has not named the tiers (owner item, plan §3.3). */
export const TIER_LABEL: Readonly<Record<Tier, string>> = Object.freeze({ LOWER: "Tier 1", MIDDLE: "Tier 2", UPPER: "Tier 3" });

const FINHEALTH_STRUCTURE = {
  kind: "CITED",
  citation: {
    kind: "CONVENTION",
    title: "Three tiers with boundaries at 40 and 80 of 100",
    usedBy: "Financial Health Network FinHealth Score tier architecture; structure imitated, names and wording not used",
  },
} as const;

/** The score at which each tier begins, each with where the boundary comes from. */
export const TIER_FLOOR_SOURCE: Readonly<Record<Tier, Threshold<Ratio>>> = Object.freeze({
  LOWER: threshold(Ratio(0), FINHEALTH_STRUCTURE),
  MIDDLE: threshold(Ratio(0.4), FINHEALTH_STRUCTURE),
  UPPER: threshold(Ratio(0.8), FINHEALTH_STRUCTURE),
});
export const TIER_FLOOR: Readonly<Record<Tier, Ratio>> = Object.freeze({
  LOWER: TIER_FLOOR_SOURCE.LOWER.value,
  MIDDLE: TIER_FLOOR_SOURCE.MIDDLE.value,
  UPPER: TIER_FLOOR_SOURCE.UPPER.value,
});

/**
 * How far below a boundary a score must fall before a held tier is lost. No
 * published source sets a demotion band for a household score, so this is an
 * **owner-set** value awaiting confirmation — not an empirical default.
 */
export const DEMOTION_MARGIN_SOURCE: Threshold<Ratio> = threshold(Ratio(0.03), {
  kind: "OWNER_SET",
  decision: "Demotion margin for tier hysteresis: 0.03 of the composite (3 points of 100), approved by the owner 2026-11-03",
  confirmed: true,
});
export const DEMOTION_MARGIN: Ratio = DEMOTION_MARGIN_SOURCE.value;

const foirIndicator = INDICATORS.find((candidate) => candidate.id === "foir-ceiling")!;
const foirBenchmark = foirIndicator.benchmark;

/** FOIR above this bars the top tier; the value and citation are the registry's `foir-ceiling`. */
export const FOIR_CEILING: Threshold<Ratio> = threshold(
  Ratio("value" in foirBenchmark ? foirBenchmark.value : Number.NaN),
  { kind: "CITED", citation: foirIndicator.citation },
);

/** The no-health-cover ceiling is a product rule, not an empirical threshold. */
export const HEALTH_CEILING: Threshold<Tier> = threshold<Tier>("MIDDLE", {
  kind: "OWNER_SET",
  decision: "No health cover caps the tier at the middle tier (PRODUCT-REQUIREMENT.md §5, non-compensatory ceilings)",
  confirmed: true,
});

/** One threshold the tier rule reads, named for the screen, with its provenance. */
export interface TierThreshold {
  readonly id: "tier-2-floor" | "tier-3-floor" | "demotion-margin" | "foir-ceiling" | "health-ceiling";
  readonly name: string;
  /** The value as a person reads it: "40 of 100", "3 points of 100", "50% of net income". */
  readonly shown: string;
  readonly threshold: Threshold<unknown>;
}

/**
 * Every threshold `tierFor` reads, in the order the rule applies them. A score
 * card carries this list so no threshold's provenance is dropped on the way to
 * the screen — including the owner-confirmed demotion margin.
 */
export const TIER_THRESHOLDS: readonly TierThreshold[] = Object.freeze([
  Object.freeze({ id: "tier-2-floor", name: `${TIER_LABEL.MIDDLE} begins`, shown: `${Math.round(TIER_FLOOR.MIDDLE * 100)} of 100`, threshold: TIER_FLOOR_SOURCE.MIDDLE }),
  Object.freeze({ id: "tier-3-floor", name: `${TIER_LABEL.UPPER} begins`, shown: `${Math.round(TIER_FLOOR.UPPER * 100)} of 100`, threshold: TIER_FLOOR_SOURCE.UPPER }),
  Object.freeze({ id: "demotion-margin", name: "Demotion margin", shown: `${Math.round(DEMOTION_MARGIN * 100)} points of 100 below a held tier's floor`, threshold: DEMOTION_MARGIN_SOURCE }),
  Object.freeze({ id: "foir-ceiling", name: "Fixed obligations ceiling", shown: `Above ${Math.round(FOIR_CEILING.value * 100)}% of net income bars ${TIER_LABEL.UPPER}`, threshold: FOIR_CEILING }),
  Object.freeze({ id: "health-ceiling", name: "No health cover ceiling", shown: `Caps the tier at ${TIER_LABEL[HEALTH_CEILING.value]}`, threshold: HEALTH_CEILING }),
]);

export interface CeilingFacts {
  /** Health cover presence: only "declared-absent" caps; "unknown" already refuses the composite. */
  readonly healthCover: "covered" | "declared-absent";
  /** Fixed obligations ÷ net income, or null when not measurable. */
  readonly foir: Ratio | null;
}

export interface Ceiling {
  readonly cap: Tier;
  readonly reason: string;
}

export function ceilingsFor(facts: CeilingFacts): readonly Ceiling[] {
  const ceilings: Ceiling[] = [];
  if (facts.healthCover === "declared-absent") {
    ceilings.push({ cap: HEALTH_CEILING.value, reason: `No health cover: the tier cannot go above ${TIER_LABEL.MIDDLE}, whatever else is strong.` });
  }
  if (facts.foir !== null && facts.foir > FOIR_CEILING.value) {
    ceilings.push({
      cap: "MIDDLE",
      reason: `Fixed obligations are ${Math.round(facts.foir * 100)}% of income, above ${Math.round(FOIR_CEILING.value * 100)}%: ${TIER_LABEL.UPPER} is out of reach until they fall.`,
    });
  }
  return ceilings;
}

const lower = (a: Tier, b: Tier): Tier => (ORDER[a] <= ORDER[b] ? a : b);

/** The tier the score alone earns, with no history. */
function rawTier(score: Ratio): Tier {
  return [...BY_ORDER].reverse().find((tier) => score >= TIER_FLOOR[tier])!;
}

export interface TierResult {
  readonly tier: Tier;
  readonly label: string;
  /** The tier the score earned before any ceiling. Equal to `tier` unless capped. */
  readonly earned: Tier;
  readonly ceilings: readonly Ceiling[];
  /** Score still needed for the next tier, or null at the top or when a ceiling blocks it. */
  readonly toNext: Ratio | null;
  /** Set when the tier fell since `previous`: what it was. Reported plainly, never celebrated. */
  readonly droppedFrom: Tier | null;
  /**
   * True when the score alone would have earned a lower tier and only the
   * (owner-confirmed) demotion margin kept the previous one. The screen says so.
   */
  readonly heldByMargin: boolean;
}

/**
 * The tier for `score`, given the tier previously shown (null the first time).
 * Order: earn the tier with hysteresis → apply ceilings → derive the label.
 */
export function tierFor(score: Ratio, facts: CeilingFacts, previous: Tier | null): TierResult {
  let earned = rawTier(score);
  // Hysteresis: a previously held higher tier survives until the score falls the margin below its floor.
  const heldByMargin = previous !== null && ORDER[previous] > ORDER[earned] && score >= TIER_FLOOR[previous] - DEMOTION_MARGIN;
  if (heldByMargin && previous !== null) earned = previous;

  const ceilings = ceilingsFor(facts);
  const tier = ceilings.reduce((current, ceiling) => lower(current, ceiling.cap), earned);
  const capped = ceilings.some((ceiling) => ORDER[ceiling.cap] <= ORDER[tier]) && tier !== earned;
  const next = BY_ORDER[ORDER[tier] + 1];
  const blocked = next !== undefined && ceilings.some((ceiling) => ORDER[ceiling.cap] < ORDER[next]);

  return Object.freeze({
    tier,
    label: TIER_LABEL[tier],
    earned,
    ceilings: Object.freeze(capped || blocked ? ceilings : []),
    toNext: next === undefined || blocked ? null : Ratio(Math.max(0, TIER_FLOOR[next] - score)),
    droppedFrom: previous !== null && ORDER[tier] < ORDER[previous] ? previous : null,
    heldByMargin,
  });
}

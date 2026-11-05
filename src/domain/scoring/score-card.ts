/**
 * The score as it leaves the domain (task 3.5): never a bare point. Every card
 * carries its coverage, its sensitivity range overall and per named axis, and —
 * when the composite is computable — its tier with ceilings applied first and
 * hysteresis against the tier previously shown. A refused composite carries the
 * refusal and the missing pillars instead of a score, a range or a tier.
 *
 * It also carries **every tier threshold with its provenance**, and the owner
 * decisions among them that are still unconfirmed, if any. The 0.03 demotion
 * margin was approved by the owner on 2026-11-03 and is shown as confirmed.
 */

import type { Ratio } from "@/core/units";
import { composite, type Composite, type Measurement } from "./composite";
import { pendingOwnerDecisions } from "./provenance";
import { axisRanges, sensitivity, type AxisRange, type Sensitivity } from "./sensitivity";
import { TIER_THRESHOLDS, tierFor, type CeilingFacts, type Tier, type TierResult, type TierThreshold } from "./tiers";

export interface ScoreCard {
  readonly composite: Composite;
  readonly coverage: Ratio;
  readonly range: Sensitivity["range"];
  readonly axes: readonly AxisRange[];
  /** Null exactly when the composite is refused. */
  readonly tier: TierResult | null;
  /** Every threshold the tier rule reads, with where it comes from. */
  readonly thresholds: readonly TierThreshold[];
  /** Owner-set thresholds in use that the owner has not confirmed: shown as pending, never as settled. */
  readonly pending: readonly string[];
}

export function scoreCard(measurements: ReadonlyMap<string, Measurement>, facts: CeilingFacts, previous: Tier | null): ScoreCard {
  const result = composite(measurements);
  const spread = sensitivity(measurements);
  return Object.freeze({
    composite: result,
    coverage: spread.coverage,
    range: spread.range,
    axes: axisRanges(measurements),
    tier: result.state === "scored" ? tierFor(result.score, facts, previous) : null,
    thresholds: TIER_THRESHOLDS,
    pending: Object.freeze([...pendingOwnerDecisions(TIER_THRESHOLDS.map((entry) => entry.threshold))]),
  });
}

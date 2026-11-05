/**
 * Tier history — the tier shown on a day, remembered so demotion hysteresis
 * (`tierFor(score, facts, previous)`, task 3.4) has a real previous tier.
 *
 * Without it `previous` is always null and the hysteresis never runs: a score
 * oscillating across a boundary would flicker the tier on every visit.
 *
 * Three rules, each the reason for a choice in the ports below:
 * - **What is remembered is the tier shown** (after ceilings), because that is
 *   what `tierFor` documents its argument as. The earned tier and the score are
 *   kept beside it for provenance — what fell, and by how much.
 * - **"Previous" is the latest record strictly before today.** Reading or
 *   recording any number of times today gives the same answer, because today's
 *   own record never feeds today's hysteresis.
 * - **A refusal is not a tier.** A composite that refuses records nothing; the
 *   last real tier stays the previous one.
 *
 * Recording is an explicit use case, never a side effect of rendering a page.
 */

import type { UserId } from "@/core/kernel";
import type { CalendarDate } from "@/core/time";
import type { Ratio } from "@/core/units";
import type { Tier, TierResult } from "./tiers";

export interface TierRecord {
  readonly on: CalendarDate;
  /** The tier shown, after ceilings — what the next day's hysteresis starts from. */
  readonly tier: Tier;
  /** The tier the score earned before ceilings. */
  readonly earned: Tier;
  /** The composite score, a fraction in [0, 1]. */
  readonly score: Ratio;
}

/** The record to keep for a scored composite on `on`. */
export function tierRecord(on: CalendarDate, result: TierResult, score: Ratio): TierRecord {
  if (!(score >= 0 && score <= 1)) throw new RangeError(`A composite score is a fraction in [0, 1], got ${score}.`);
  return Object.freeze({ on, tier: result.tier, earned: result.earned, score });
}

export interface TierHistoryReader {
  /** The latest record dated strictly before `before`, or null when none exists. */
  latestBefore(userId: UserId, before: CalendarDate): Promise<TierRecord | null>;
}

export interface TierHistoryWriter {
  /** Stores the day's record; a second record on the same day replaces it (at most one row per day). */
  record(userId: UserId, record: TierRecord): Promise<void>;
}

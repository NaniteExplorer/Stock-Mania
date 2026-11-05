/**
 * Recording the tier shown (tier history, support for task 3.4 hysteresis).
 *
 * `RecordStandingTier` is the **only** write path into tier history, and it is an
 * explicit call: rendering `/standing` reads the previous tier but never records
 * one. It is server-action-free — it takes the owner id as input, so a system
 * caller (the cron route's per-user loop) can run it; the container builds it as
 * `services().standing.recordTier(userId)`.
 *
 * It scores exactly as the page does — `StandingMeasurements` (whose `previous`
 * is the latest record strictly before today) into `scoreCard` — so the tier it
 * remembers is the tier the screen shows that day. A refused composite records
 * nothing: a refusal is not a tier.
 *
 * Trigger status (2026-11-03): **not called yet.** See
 * `_architecture/requirements/standing-screen.md` § "Tier history".
 */

import { Ok, type AppError, type Result, type UseCase, type UserId } from "@/core/kernel";
import type { CalendarDate } from "@/core/time";
import { scoreCard } from "@/domain/scoring/score-card";
import { tierRecord, type TierHistoryWriter, type TierRecord } from "@/domain/scoring/tier-history";
import type { StandingMeasurements } from "./standing.usecases";

export interface RecordStandingTierInput {
  readonly userId: UserId;
  readonly today: CalendarDate;
}

export type RecordStandingTierOutput =
  | { readonly state: "recorded"; readonly record: TierRecord }
  | { readonly state: "not-recorded"; readonly reason: string };

export class RecordStandingTier implements UseCase<RecordStandingTierInput, RecordStandingTierOutput> {
  constructor(
    private readonly measurements: Pick<StandingMeasurements, "execute">,
    private readonly writer: TierHistoryWriter,
  ) {}

  async execute({ userId, today }: RecordStandingTierInput): Promise<Result<RecordStandingTierOutput, AppError>> {
    const result = await this.measurements.execute({ userId, today });
    if (!result.ok) return result;
    const { measurements, facts, previous } = result.value;
    const card = scoreCard(measurements, facts, previous);
    if (card.composite.state !== "scored" || card.tier === null) {
      return Ok(Object.freeze({ state: "not-recorded" as const, reason: "The composite is refused, so there is no tier to remember." }));
    }
    const record = tierRecord(today, card.tier, card.composite.score);
    await this.writer.record(userId, record);
    return Ok(Object.freeze({ state: "recorded" as const, record }));
  }
}

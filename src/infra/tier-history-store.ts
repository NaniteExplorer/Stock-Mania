/**
 * Drizzle adapters for tier history (`tier_history`, class C).
 *
 * At most one row per user per day: the unique `(user_id, recorded_on)` index
 * makes a second record that day an upsert of the same row. Reads ignore
 * tombstoned rows (A03; class C, so only a system repair sets `deleted_at`). Every write goes
 * through `UnitOfWork.mutateAtomic`, so the row, its audit event and its ledger
 * event commit together. Nothing is hard-deleted.
 *
 * The score is stored as an integer, the composite × 1 000 000 (the schema has no
 * float column), and read back as the same fraction to six places.
 */
import { and, desc, eq, isNull, lt } from "drizzle-orm";
import { newUuid, type UserId } from "@/core/kernel";
import { CalendarDate } from "@/core/time";
import { Ratio } from "@/core/units";
import type { TierHistoryReader, TierHistoryWriter, TierRecord } from "@/domain/scoring/tier-history";
import type { Database } from "./db/client";
import { tierHistory } from "./db/schema";
import { UnitOfWork, type RequestContext } from "./unit-of-work";

const SCORE_SCALE = 1_000_000;

export class DrizzleTierHistoryReader implements TierHistoryReader {
  constructor(private readonly db: Database) {}

  async latestBefore(userId: UserId, before: CalendarDate): Promise<TierRecord | null> {
    const [row] = await this.db
      .select()
      .from(tierHistory)
      .where(and(eq(tierHistory.userId, userId.value), lt(tierHistory.recordedOn, before.toISO()), isNull(tierHistory.deletedAt)))
      .orderBy(desc(tierHistory.recordedOn))
      .limit(1);
    if (!row) return null;
    return Object.freeze({
      on: CalendarDate.parse(row.recordedOn),
      tier: row.tier,
      earned: row.earnedTier,
      score: Ratio(row.scoreScaled / SCORE_SCALE),
    });
  }
}

/** Context is supplied by the composition root (the session, or a system caller naming the owner). */
export class DrizzleTierHistoryWriter implements TierHistoryWriter {
  constructor(
    private readonly db: Database,
    private readonly context: RequestContext,
  ) {}

  async record(userId: UserId, record: TierRecord): Promise<void> {
    if (this.context.userId !== userId.value) throw new Error("Tier history owner does not match the request context.");
    if (!Number.isFinite(record.score) || record.score < 0 || record.score > 1) {
      throw new RangeError(`A composite score is a fraction in [0, 1], got ${record.score}.`);
    }
    const scoreScaled = Math.round(record.score * SCORE_SCALE);
    if (!Number.isSafeInteger(scoreScaled) || scoreScaled < 0 || scoreScaled > SCORE_SCALE) {
      throw new RangeError(`A composite score is a fraction in [0, 1], got ${record.score}.`);
    }
    const day = record.on.toISO();
    const [existing] = await this.db
      .select()
      .from(tierHistory)
      .where(and(eq(tierHistory.userId, userId.value), eq(tierHistory.recordedOn, day)))
      .limit(1);
    const id = existing?.id ?? newUuid();
    const fields = { recordedOn: day, tier: record.tier, earnedTier: record.earned, scoreScaled };
    const now = this.context.clock.now();

    await new UnitOfWork(this.db, this.context).mutateAtomic({
      action: existing ? "UPDATE" : "CREATE",
      entityType: "tier_history",
      entityId: id,
      before: existing
        ? { recordedOn: existing.recordedOn, tier: existing.tier, earnedTier: existing.earnedTier, scoreScaled: existing.scoreScaled }
        : null,
      touchedAccountIds: [],
      event: { type: "tier_history.recorded", aggregateType: "tier_history", aggregateId: id, payload: fields, effectiveOn: null },
      apply: async (tx) => {
        await tx
          .insert(tierHistory)
          .values({ id, userId: userId.value, ...fields, createdAt: now, updatedAt: now })
          .onConflictDoUpdate({
            target: [tierHistory.userId, tierHistory.recordedOn],
            // A tombstoned row for the day (a system repair) is revived: the row stays one per day.
            set: { tier: fields.tier, earnedTier: fields.earnedTier, scoreScaled, deletedAt: null, updatedAt: now },
          });
        return { result: undefined, after: fields };
      },
    });
  }
}

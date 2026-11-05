/**
 * Drizzle stores for the projection assumptions and the owner profile.
 *
 * A03: nothing is hard-deleted. Replacing a value tombstones the live row and
 * inserts a new one, so the history of what the owner stated survives. Every
 * query is scoped by `user_id` and every read filters tombstones.
 */
import { and, eq, inArray, isNull } from "drizzle-orm";
import { newUuid, type UserId } from "@/core/kernel";
import { CalendarDate } from "@/core/time";
import type { AssumptionKey } from "@/domain/projection/assumptions";
import type { OwnerProfileStore, ProjectionAssumptionStore, StoredAssumption } from "@/app/projection.usecases";
import type { Database } from "@/infra/db/client";
import { ownerProfiles, projectionAssumptions } from "@/infra/db/schema";

export class DrizzleProjectionAssumptionStore implements ProjectionAssumptionStore {
  constructor(private readonly db: Database) {}

  async load(userId: UserId): Promise<readonly StoredAssumption[]> {
    const rows = await this.db
      .select()
      .from(projectionAssumptions)
      .where(and(eq(projectionAssumptions.userId, userId.value), isNull(projectionAssumptions.deletedAt)));
    return rows.map((row) => ({
      key: row.assumptionKey as AssumptionKey,
      stated: row.statedJson,
      source: row.sourceJson,
      verifiedOn: row.verifiedOn,
    }));
  }

  async save(userId: UserId, rows: readonly StoredAssumption[]): Promise<void> {
    if (rows.length === 0) return;
    const now = new Date();
    await this.db.transaction(async (tx) => {
      await tx
        .update(projectionAssumptions)
        .set({ deletedAt: now, updatedAt: now })
        .where(
          and(
            eq(projectionAssumptions.userId, userId.value),
            inArray(projectionAssumptions.assumptionKey, rows.map((r) => r.key)),
            isNull(projectionAssumptions.deletedAt),
          ),
        );
      await tx.insert(projectionAssumptions).values(
        rows.map((row) => ({
          id: newUuid(),
          userId: userId.value,
          assumptionKey: row.key,
          statedJson: row.stated,
          sourceJson: row.source,
          verifiedOn: row.verifiedOn,
          createdAt: now,
          updatedAt: now,
        })),
      );
    });
  }
}

export class DrizzleOwnerProfileStore implements OwnerProfileStore {
  constructor(private readonly db: Database) {}

  async bornOn(userId: UserId): Promise<CalendarDate | null> {
    const [row] = await this.db
      .select({ bornOn: ownerProfiles.bornOn })
      .from(ownerProfiles)
      .where(and(eq(ownerProfiles.userId, userId.value), isNull(ownerProfiles.deletedAt)))
      .limit(1);
    return row?.bornOn ? CalendarDate.parse(row.bornOn) : null;
  }

  async setBornOn(userId: UserId, bornOn: CalendarDate | null): Promise<void> {
    const now = new Date();
    const value = bornOn === null ? null : bornOn.toString();
    await this.db.transaction(async (tx) => {
      await tx
        .update(ownerProfiles)
        .set({ deletedAt: now, updatedAt: now })
        .where(and(eq(ownerProfiles.userId, userId.value), isNull(ownerProfiles.deletedAt)));
      await tx.insert(ownerProfiles).values({ id: newUuid(), userId: userId.value, bornOn: value, createdAt: now, updatedAt: now });
    });
  }
}

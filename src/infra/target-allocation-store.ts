/**
 * Drizzle adapters for the stored target allocation (`target_allocations`, class B).
 *
 * One row per user per sleeve (unique index). `replace` writes the whole allocation
 * in one `mutateAtomic`: sleeves in the new allocation are upserted (reviving a
 * tombstone), live sleeves not in it are tombstoned, and the audit and ledger events
 * commit with the rows. Removal tombstones every live sleeve (A03); nothing is
 * deleted. Reads are user-scoped, skip tombstones and re-run the domain validator.
 */
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { newUuid, type UserId } from "@/core/kernel";
import { Percentage } from "@/core/numeric";
import { rebalancingBand, targetAllocation, type Band, type TargetAllocation } from "@/domain/portfolio";
import type { RebalancingBandReader, RebalancingBandWriter, TargetAllocationReader, TargetAllocationWriter } from "@/domain/target-allocation";
import type { Database } from "./db/client";
import { rebalancingBands, targetAllocations } from "./db/schema";
import { UnitOfWork, type RequestContext } from "./unit-of-work";

type Row = typeof targetAllocations.$inferSelect;

const imageOf = (rows: readonly Row[]) => rows.map((row) => ({ sleeveId: row.sleeveId, shareScaled: row.shareScaled }));

export class DrizzleTargetAllocationReader implements TargetAllocationReader {
  constructor(private readonly db: Database) {}

  async load(userId: Pick<UserId, "value">): Promise<TargetAllocation | null> {
    const rows = await this.db
      .select()
      .from(targetAllocations)
      .where(and(eq(targetAllocations.userId, userId.value), isNull(targetAllocations.deletedAt)))
      .orderBy(asc(targetAllocations.sleeveId));
    if (rows.length === 0) return null;
    // Throws if the stored rows do not form a valid whole; never silently "fixed".
    return targetAllocation(rows.map((row) => ({ id: row.sleeveId, share: Percentage.fromScaled(row.shareScaled) })));
  }
}

export class DrizzleTargetAllocationWriter implements TargetAllocationWriter {
  constructor(
    private readonly db: Database,
    private readonly context: RequestContext,
  ) {}

  private assertOwner(userId: Pick<UserId, "value">): void {
    if (this.context.userId !== userId.value) throw new Error("Target allocation owner does not match the request context.");
  }

  private all(userId: string): Promise<Row[]> {
    return this.db.select().from(targetAllocations).where(eq(targetAllocations.userId, userId));
  }

  async replace(userId: Pick<UserId, "value">, allocation: TargetAllocation): Promise<void> {
    this.assertOwner(userId);
    // Re-validate: an object cast to TargetAllocation cannot bypass the 100% rule.
    const valid = targetAllocation(allocation.shares);
    const sleeves = valid.shares.map((s) => ({ sleeveId: s.id, shareScaled: s.share.toScaledNumber() }));
    const keep = new Set(sleeves.map((s) => s.sleeveId));
    const now = this.context.clock.now();
    await new UnitOfWork(this.db, this.context).mutateAtomic({
      // Provisional; the authoritative action and before-image are read inside the
      // transaction below (QA FAIL 2026-11-05: a pre-transaction read went stale under
      // two interleaved replaces and left 200% live).
      action: "UPDATE",
      entityType: "target_allocations",
      entityId: userId.value,
      before: null,
      touchedAccountIds: [],
      event: { type: "target_allocation.replaced", aggregateType: "target_allocations", aggregateId: userId.value, payload: { sleeves }, effectiveOn: null },
      apply: async (tx) => {
        const existing = await tx.select().from(targetAllocations).where(eq(targetAllocations.userId, userId.value));
        const live = existing.filter((row) => row.deletedAt === null);
        // Tombstone every live sleeve not in the new set, by the user, not by a stale id list.
        const stale = live.filter((row) => !keep.has(row.sleeveId)).map((row) => row.sleeveId);
        if (stale.length > 0) {
          await tx
            .update(targetAllocations)
            .set({ deletedAt: now, updatedAt: now })
            .where(and(eq(targetAllocations.userId, userId.value), isNull(targetAllocations.deletedAt), inArray(targetAllocations.sleeveId, stale)));
        }
        for (const sleeve of sleeves) {
          await tx
            .insert(targetAllocations)
            .values({ id: newUuid(), userId: userId.value, ...sleeve, createdAt: now, updatedAt: now })
            .onConflictDoUpdate({
              target: [targetAllocations.userId, targetAllocations.sleeveId],
              set: { shareScaled: sleeve.shareScaled, deletedAt: null, updatedAt: now },
            });
        }
        return {
          result: undefined,
          after: sleeves,
          before: live.length === 0 ? null : imageOf(live),
          action: live.length > 0 ? "UPDATE" : existing.length > 0 ? "RESTORE" : "CREATE",
        };
      },
    });
  }

  async remove(userId: Pick<UserId, "value">): Promise<void> {
    this.assertOwner(userId);
    const live = (await this.all(userId.value)).filter((row) => row.deletedAt === null);
    if (live.length === 0) throw new Error("No target allocation is stored.");
    const now = this.context.clock.now();
    await new UnitOfWork(this.db, this.context).mutateAtomic({
      action: "SOFT_DELETE",
      entityType: "target_allocations",
      entityId: userId.value,
      before: imageOf(live),
      touchedAccountIds: [],
      event: { type: "target_allocation.tombstoned", aggregateType: "target_allocations", aggregateId: userId.value, payload: {}, effectiveOn: null },
      apply: async (tx) => {
        await tx
          .update(targetAllocations)
          .set({ deletedAt: now, updatedAt: now })
          .where(and(eq(targetAllocations.userId, userId.value), isNull(targetAllocations.deletedAt)));
        return { result: undefined, after: null };
      },
    });
  }
}

/* ═══ Rebalancing band (`rebalancing_bands`, class B) ═══════════════════ */

type BandRow = typeof rebalancingBands.$inferSelect;
const bandImage = (row: BandRow) => ({ absoluteScaled: row.absoluteScaled, relativeScaled: row.relativeScaled });

export class DrizzleRebalancingBandReader implements RebalancingBandReader {
  constructor(private readonly db: Database) {}

  async load(userId: Pick<UserId, "value">): Promise<Band | null> {
    const [row] = await this.db
      .select()
      .from(rebalancingBands)
      .where(and(eq(rebalancingBands.userId, userId.value), isNull(rebalancingBands.deletedAt)))
      .limit(1);
    if (!row) return null;
    // Throws if the stored row is no longer a valid band; never silently "fixed".
    return rebalancingBand({ absolute: Percentage.fromScaled(row.absoluteScaled), relative: Percentage.fromScaled(row.relativeScaled) });
  }
}

/** One row per user (unique index): replace upserts it (reviving a tombstone); remove tombstones it. */
export class DrizzleRebalancingBandWriter implements RebalancingBandWriter {
  constructor(
    private readonly db: Database,
    private readonly context: RequestContext,
  ) {}

  private assertOwner(userId: Pick<UserId, "value">): void {
    if (this.context.userId !== userId.value) throw new Error("Rebalancing band owner does not match the request context.");
  }

  private async existing(userId: string): Promise<BandRow | undefined> {
    const [row] = await this.db.select().from(rebalancingBands).where(eq(rebalancingBands.userId, userId)).limit(1);
    return row;
  }

  async replace(userId: Pick<UserId, "value">, band: Band): Promise<void> {
    this.assertOwner(userId);
    const valid = rebalancingBand(band);
    const values = { absoluteScaled: valid.absolute.toScaledNumber(), relativeScaled: valid.relative.toScaledNumber() };
    const existing = await this.existing(userId.value);
    const live = existing && existing.deletedAt === null ? existing : null;
    const now = this.context.clock.now();
    await new UnitOfWork(this.db, this.context).mutateAtomic({
      action: live ? "UPDATE" : existing ? "RESTORE" : "CREATE",
      entityType: "rebalancing_bands",
      entityId: userId.value,
      before: live ? bandImage(live) : null,
      touchedAccountIds: [],
      event: { type: "rebalancing_band.replaced", aggregateType: "rebalancing_bands", aggregateId: userId.value, payload: values, effectiveOn: null },
      apply: async (tx) => {
        await tx
          .insert(rebalancingBands)
          .values({ id: newUuid(), userId: userId.value, ...values, createdAt: now, updatedAt: now })
          .onConflictDoUpdate({ target: rebalancingBands.userId, set: { ...values, deletedAt: null, updatedAt: now } });
        return { result: undefined, after: values };
      },
    });
  }

  async remove(userId: Pick<UserId, "value">): Promise<void> {
    this.assertOwner(userId);
    const existing = await this.existing(userId.value);
    if (!existing || existing.deletedAt !== null) throw new Error("No rebalancing band is stored.");
    const now = this.context.clock.now();
    await new UnitOfWork(this.db, this.context).mutateAtomic({
      action: "SOFT_DELETE",
      entityType: "rebalancing_bands",
      entityId: userId.value,
      before: bandImage(existing),
      touchedAccountIds: [],
      event: { type: "rebalancing_band.tombstoned", aggregateType: "rebalancing_bands", aggregateId: userId.value, payload: {}, effectiveOn: null },
      apply: async (tx) => {
        await tx.update(rebalancingBands).set({ deletedAt: now, updatedAt: now }).where(eq(rebalancingBands.id, existing.id));
        return { result: undefined, after: null };
      },
    });
  }
}

/**
 * Drizzle adapters for the owner-entered CPI Urban series (`cpi_series`, class B).
 *
 * One row per user per month (unique index): recording a month again updates it
 * in place, and revives a tombstoned row. Removal is a tombstone (A03), never a
 * delete. Every write goes through `UnitOfWork.mutateAtomic`, so the row, its
 * audit event and its ledger event commit together. Reads are user-scoped and
 * skip tombstones.
 */
import { and, asc, eq, isNull } from "drizzle-orm";
import { newUuid, type UserId } from "@/core/kernel";
import { cpiPoint, isCpiMonth, type CpiPoint, type CpiSeriesReader, type CpiSeriesWriter } from "@/domain/cpi-series";
import type { Database } from "./db/client";
import { cpiSeries } from "./db/schema";
import { UnitOfWork, type RequestContext } from "./unit-of-work";

type Row = typeof cpiSeries.$inferSelect;

const toPoint = (row: Row): CpiPoint => cpiPoint({ month: row.month, base: row.base, index: BigInt(row.indexScaled), source: row.source });
const image = (row: Pick<Row, "month" | "base" | "indexScaled" | "source">) => ({ month: row.month, base: row.base, indexScaled: row.indexScaled, source: row.source });

export class DrizzleCpiSeriesReader implements CpiSeriesReader {
  constructor(private readonly db: Database) {}

  async list(userId: Pick<UserId, "value">): Promise<readonly CpiPoint[]> {
    const rows = await this.db
      .select()
      .from(cpiSeries)
      .where(and(eq(cpiSeries.userId, userId.value), isNull(cpiSeries.deletedAt)))
      .orderBy(asc(cpiSeries.month));
    return rows.map(toPoint);
  }
}

export class DrizzleCpiSeriesWriter implements CpiSeriesWriter {
  constructor(
    private readonly db: Database,
    private readonly context: RequestContext,
  ) {}

  private assertOwner(userId: Pick<UserId, "value">): void {
    if (this.context.userId !== userId.value) throw new Error("CPI series owner does not match the request context.");
  }

  private async find(userId: string, month: string): Promise<Row | undefined> {
    const [row] = await this.db
      .select()
      .from(cpiSeries)
      .where(and(eq(cpiSeries.userId, userId), eq(cpiSeries.month, month)))
      .limit(1);
    return row;
  }

  async record(userId: Pick<UserId, "value">, point: CpiPoint): Promise<void> {
    this.assertOwner(userId);
    const valid = cpiPoint({ month: point.month, base: point.base, index: point.indexScaled, source: point.source });
    if (valid.indexScaled > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError("A CPI index is too large to store.");
    const fields = { month: valid.month, base: valid.base, indexScaled: Number(valid.indexScaled), source: valid.source };
    const existing = await this.find(userId.value, valid.month);
    const live = existing !== undefined && existing.deletedAt === null;
    const id = existing?.id ?? newUuid();
    const now = this.context.clock.now();
    await new UnitOfWork(this.db, this.context).mutateAtomic({
      action: existing === undefined ? "CREATE" : live ? "UPDATE" : "RESTORE",
      entityType: "cpi_series",
      entityId: id,
      before: existing ? image(existing) : null,
      touchedAccountIds: [],
      event: { type: "cpi_series.recorded", aggregateType: "cpi_series", aggregateId: id, payload: fields, effectiveOn: null },
      apply: async (tx) => {
        await tx
          .insert(cpiSeries)
          .values({ id, userId: userId.value, ...fields, createdAt: now, updatedAt: now })
          .onConflictDoUpdate({
            target: [cpiSeries.userId, cpiSeries.month],
            set: { base: fields.base, indexScaled: fields.indexScaled, source: fields.source, deletedAt: null, updatedAt: now },
          });
        return { result: undefined, after: fields };
      },
    });
  }

  async remove(userId: Pick<UserId, "value">, month: string): Promise<void> {
    this.assertOwner(userId);
    if (!isCpiMonth(month)) throw new RangeError(`A CPI month is yyyy-mm, got "${month}".`);
    const existing = await this.find(userId.value, month);
    if (!existing || existing.deletedAt !== null) throw new Error(`No CPI figure is recorded for ${month}.`);
    const now = this.context.clock.now();
    await new UnitOfWork(this.db, this.context).mutateAtomic({
      action: "SOFT_DELETE",
      entityType: "cpi_series",
      entityId: existing.id,
      before: image(existing),
      touchedAccountIds: [],
      event: { type: "cpi_series.tombstoned", aggregateType: "cpi_series", aggregateId: existing.id, payload: { month }, effectiveOn: null },
      apply: async (tx) => {
        await tx.update(cpiSeries).set({ deletedAt: now, updatedAt: now }).where(eq(cpiSeries.id, existing.id));
        return { result: undefined, after: null };
      },
    });
  }
}

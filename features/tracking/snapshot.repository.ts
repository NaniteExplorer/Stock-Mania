import { connectToDatabase } from "@/core/db/connection";
import { NetWorthSnapshot, type NetWorthSnapshotDoc } from "./snapshot.model";
import type {
  NetWorthSnapshot as SnapshotEntity,
  SnapshotBreakdown,
} from "./tracking.types";

type Row = NetWorthSnapshotDoc & { _id: unknown };

const EMPTY_BREAKDOWN: SnapshotBreakdown = {
  accounts: 0,
  investments: 0,
  brokerage: 0,
  esops: 0,
  assets: 0,
  liabilities: 0,
  creditCard: 0,
};

const toEntity = (row: Row): SnapshotEntity => ({
  id: String(row._id),
  userId: row.userId,
  capturedAt: row.capturedAt,
  periodKey: row.periodKey,
  currency: row.currency,
  totalAssets: row.totalAssets,
  totalLiabilities: row.totalLiabilities,
  netWorth: row.netWorth,
  breakdown: { ...EMPTY_BREAKDOWN, ...(row.breakdown ?? {}) },
  contributions: row.contributions ?? 0,
  withdrawals: row.withdrawals ?? 0,
  marketMovement: row.marketMovement ?? 0,
  income: row.income ?? 0,
  debtReduction: row.debtReduction ?? 0,
  source: row.source,
  note: row.note ?? null,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

/** The persistable body of a snapshot (everything except identity/timestamps). */
export type SnapshotWrite = Omit<
  NetWorthSnapshotDoc,
  "userId" | "createdAt" | "updatedAt"
>;

export const snapshotRepository = {
  /**
   * Insert or refresh the snapshot for a user's month bucket. When `overwrite`
   * is false, an existing row's core figures are preserved (auto-capture never
   * clobbers a manual correction) and only timestamps advance.
   */
  async upsertByPeriod(
    userId: string,
    write: SnapshotWrite,
    overwrite: boolean,
  ): Promise<"inserted" | "updated" | "kept"> {
    await connectToDatabase();
    const existing = await NetWorthSnapshot.findOne({ userId, periodKey: write.periodKey })
      .select("_id source")
      .lean<{ _id: unknown; source: string } | null>();

    if (!existing) {
      await NetWorthSnapshot.create({ userId, ...write });
      return "inserted";
    }
    // Preserve corrected/manual rows against automatic re-capture.
    if (!overwrite && (existing.source === "MANUAL" || existing.source === "EDITED")) {
      return "kept";
    }
    await NetWorthSnapshot.updateOne({ _id: existing._id, userId }, { $set: write });
    return "updated";
  },

  async listByUser(
    userId: string,
    opts: { from?: Date; to?: Date; limit?: number } = {},
  ): Promise<SnapshotEntity[]> {
    await connectToDatabase();
    const filter: Record<string, unknown> = { userId };
    if (opts.from || opts.to) {
      filter.capturedAt = {
        ...(opts.from ? { $gte: opts.from } : {}),
        ...(opts.to ? { $lte: opts.to } : {}),
      };
    }
    const rows = await NetWorthSnapshot.find(filter)
      .sort({ capturedAt: 1 })
      .limit(opts.limit ?? 600)
      .lean<Row[]>();
    return rows.map(toEntity);
  },

  async latest(userId: string): Promise<SnapshotEntity | null> {
    await connectToDatabase();
    const row = await NetWorthSnapshot.findOne({ userId }).sort({ capturedAt: -1 }).lean<Row | null>();
    return row ? toEntity(row) : null;
  },

  async getByPeriod(userId: string, periodKey: string): Promise<SnapshotEntity | null> {
    await connectToDatabase();
    const row = await NetWorthSnapshot.findOne({ userId, periodKey }).lean<Row | null>();
    return row ? toEntity(row) : null;
  },

  /** The snapshot with the largest capturedAt strictly before `before`. */
  async priorTo(userId: string, before: Date): Promise<SnapshotEntity | null> {
    await connectToDatabase();
    const row = await NetWorthSnapshot.findOne({ userId, capturedAt: { $lt: before } })
      .sort({ capturedAt: -1 })
      .lean<Row | null>();
    return row ? toEntity(row) : null;
  },

  /** The snapshot immediately after `after` (used to re-derive attribution on edit). */
  async nextAfter(userId: string, after: Date): Promise<SnapshotEntity | null> {
    await connectToDatabase();
    const row = await NetWorthSnapshot.findOne({ userId, capturedAt: { $gt: after } })
      .sort({ capturedAt: 1 })
      .lean<Row | null>();
    return row ? toEntity(row) : null;
  },

  async updateFields(id: string, userId: string, fields: Partial<NetWorthSnapshotDoc>): Promise<void> {
    await connectToDatabase();
    await NetWorthSnapshot.updateOne({ _id: id, userId }, { $set: fields });
  },

  async remove(id: string, userId: string): Promise<void> {
    await connectToDatabase();
    await NetWorthSnapshot.deleteOne({ _id: id, userId });
  },
};

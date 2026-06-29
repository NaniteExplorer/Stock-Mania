import { connectToDatabase } from "@/core/db/connection";
import { logger } from "@/core/logger";
import { priceService } from "@/features/prices/price.service";
import { GoldLease, type GoldLeaseDoc } from "./gold-lease.model";
import type { CreateGoldLeaseInput, GoldLease as GoldLeaseEntity } from "./gold-lease.types";

const MONTH_MS = 30 * 24 * 60 * 60 * 1000;

/** Whole months elapsed between two dates (approximate, calendar-month based). */
function monthsBetween(from: Date, to: Date): number {
  const months = (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth());
  // Only count a month once the day-of-month has been reached.
  return Math.max(0, to.getDate() < from.getDate() ? months - 1 : months);
}

const toEntity = (doc: GoldLeaseDoc & { _id: unknown }, pricePerGram: number | null): GoldLeaseEntity => {
  const totalGrams = doc.leasedGrams + doc.accruedGrams;
  return {
    id: String(doc._id),
    userId: doc.userId,
    name: doc.name,
    leasedGrams: doc.leasedGrams,
    annualRatePercent: doc.annualRatePercent,
    startDate: doc.startDate,
    termMonths: doc.termMonths ?? null,
    status: doc.status,
    accruedGrams: doc.accruedGrams,
    lastAccruedAt: doc.lastAccruedAt,
    accruals: doc.accruals ?? [],
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    totalGrams,
    valueInr: pricePerGram != null ? totalGrams * pricePerGram : 0,
  };
};

export const goldLeaseService = {
  async create(userId: string, input: CreateGoldLeaseInput): Promise<void> {
    await connectToDatabase();
    const start = new Date(input.startDate);
    await GoldLease.create({
      userId,
      name: input.name.trim(),
      leasedGrams: input.leasedGrams,
      annualRatePercent: input.annualRatePercent,
      startDate: start,
      termMonths: input.termMonths ?? null,
      status: "ACTIVE",
      accruedGrams: 0,
      lastAccruedAt: start,
      accruals: [],
    });
  },

  async listByUser(userId: string): Promise<GoldLeaseEntity[]> {
    await connectToDatabase();
    const [docs, pricePerGram] = await Promise.all([
      GoldLease.find({ userId }).sort({ createdAt: -1 }).lean<(GoldLeaseDoc & { _id: unknown })[]>(),
      priceService.goldInrPerGram(),
    ]);
    return docs.map((doc) => toEntity(doc, pricePerGram));
  },

  /** Total live value (₹) of a user's active+closed leased gold. */
  async totalValue(userId: string): Promise<number> {
    const leases = await this.listByUser(userId);
    return leases.reduce((sum, l) => sum + l.valueInr, 0);
  },

  async remove(id: string, userId: string): Promise<void> {
    await connectToDatabase();
    await GoldLease.deleteOne({ _id: id, userId });
  },

  async close(id: string, userId: string): Promise<void> {
    await connectToDatabase();
    await GoldLease.updateOne({ _id: id, userId }, { $set: { status: "CLOSED" } });
  },

  /**
   * Credit any whole months of lease yield due since each active lease was last
   * accrued. Idempotent per month — safe to run on a schedule (or catch up).
   * Monthly grams = leasedGrams × (annualRatePercent / 12) / 100.
   */
  async accrueDue(now: Date = new Date()): Promise<{ leasesAccrued: number; gramsCredited: number }> {
    await connectToDatabase();
    const active = await GoldLease.find({ status: "ACTIVE" });
    let leasesAccrued = 0;
    let gramsCredited = 0;

    for (const lease of active) {
      // Cap accruals at the fixed term, if any.
      const elapsedFromStart = monthsBetween(lease.startDate, now);
      const cappedMonths = lease.termMonths != null ? Math.min(elapsedFromStart, lease.termMonths) : elapsedFromStart;
      const alreadyAccruedMonths = monthsBetween(lease.startDate, lease.lastAccruedAt);
      const dueMonths = Math.max(0, cappedMonths - alreadyAccruedMonths);
      if (dueMonths === 0) continue;

      const monthlyGrams = (lease.leasedGrams * (lease.annualRatePercent / 12)) / 100;
      const credited = monthlyGrams * dueMonths;
      lease.accruedGrams += credited;
      lease.lastAccruedAt = new Date(lease.startDate.getTime() + (alreadyAccruedMonths + dueMonths) * MONTH_MS);
      lease.accruals.push({ date: now, grams: credited });
      // Auto-close once the term is fully accrued.
      if (lease.termMonths != null && cappedMonths >= lease.termMonths) lease.status = "CLOSED";
      await lease.save();
      leasesAccrued++;
      gramsCredited += credited;
    }

    logger.info("gold lease accrual run", { leasesAccrued, gramsCredited });
    return { leasesAccrued, gramsCredited };
  },
};

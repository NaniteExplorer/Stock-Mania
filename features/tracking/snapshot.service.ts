import { networthService } from "@/features/networth/networth.service";
import { accountService } from "@/features/accounts/account.service";
import { userPreferencesService } from "@/features/user/user.preferences";
import { tradeRepository } from "@/features/trades/trade.repository";
import { logger } from "@/core/logger";
import { snapshotRepository, type SnapshotWrite } from "./snapshot.repository";
import { periodKeyOf } from "./period";
import type {
  CaptureSnapshotInput,
  EditSnapshotInput,
  NetWorthSnapshot,
  SnapshotBreakdown,
  SnapshotCsvRow,
  SnapshotTimelinePoint,
} from "./tracking.types";

/** Investment-bearing classes whose value change we attribute to market vs. flows. */
function investedValue(b: SnapshotBreakdown): number {
  return b.investments + b.brokerage + b.esops + b.assets;
}

interface Attribution {
  contributions: number;
  withdrawals: number;
  marketMovement: number;
  income: number;
  debtReduction: number;
}

const ZERO_ATTRIBUTION: Attribution = {
  contributions: 0,
  withdrawals: 0,
  marketMovement: 0,
  income: 0,
  debtReduction: 0,
};

/**
 * Decompose the net-worth change between two snapshots into what we can derive
 * honestly. Net money moved into investments (net BUY notional) comes from the
 * trade ledger; the residual value change on invested assets is market movement;
 * debt reduction comes from the liabilities delta. Income is left 0 — it isn't
 * derivable from current data (documented gap) rather than fabricated.
 *
 * Only trades in the snapshot's own currency count toward flows; foreign-currency
 * trades fold into the market-movement residual (FX attribution is out of scope).
 */
async function deriveAttribution(
  userId: string,
  currency: string,
  prev: NetWorthSnapshot,
  curr: { breakdown: SnapshotBreakdown; totalLiabilities: number },
  windowStart: Date,
  windowEnd: Date,
): Promise<Attribution> {
  const trades = await tradeRepository.listByUser(userId);
  let buys = 0;
  let sells = 0;
  for (const t of trades) {
    if (t.currency.toUpperCase() !== currency.toUpperCase()) continue;
    if (t.date <= windowStart || t.date > windowEnd) continue;
    const notional = t.quantity * t.pricePerUnit;
    if (t.side === "BUY") buys += notional + t.chargesTotal;
    else sells += Math.max(0, notional - t.chargesTotal);
  }

  const netInvested = buys - sells;
  const deltaInvestValue = investedValue(curr.breakdown) - investedValue(prev.breakdown);
  const marketMovement = deltaInvestValue - netInvested;
  const debtReduction = prev.totalLiabilities - curr.totalLiabilities;

  return {
    contributions: Math.max(0, netInvested),
    withdrawals: Math.max(0, -netInvested),
    marketMovement,
    income: 0,
    debtReduction,
  };
}

async function buildWrite(
  userId: string,
  periodKey: string,
  capturedAt: Date,
  currency: string,
  breakdown: SnapshotBreakdown,
  totalAssets: number,
  totalLiabilities: number,
  netWorth: number,
  source: SnapshotWrite["source"],
  note: string | null,
): Promise<SnapshotWrite> {
  const prev = await snapshotRepository.priorTo(userId, capturedAt);
  const attribution: Attribution = prev
    ? await deriveAttribution(userId, currency, prev, { breakdown, totalLiabilities }, prev.capturedAt, capturedAt)
    : ZERO_ATTRIBUTION;

  return {
    capturedAt,
    periodKey,
    currency: currency.toUpperCase(),
    totalAssets,
    totalLiabilities,
    netWorth,
    breakdown,
    ...attribution,
    source,
    note,
  };
}

export const snapshotService = {
  /** Capture (or refresh) the current-value snapshot for a user's month bucket. */
  async capture(userId: string, input: CaptureSnapshotInput = {}): Promise<{ outcome: string; periodKey: string }> {
    const asOf = input.asOf ?? new Date();
    const periodKey = periodKeyOf(asOf);
    const [overview, prefs, creditCard] = await Promise.all([
      networthService.getOverview(userId),
      userPreferencesService.get(userId),
      accountService.creditCardDebt(userId),
    ]);
    const currency = prefs.displayCurrency || "INR";

    const breakdown: SnapshotBreakdown = {
      accounts: overview.totals.accounts,
      investments: overview.totals.investments,
      brokerage: overview.totals.brokerage,
      esops: overview.totals.esops,
      assets: overview.totals.assets,
      // Credit-card debt is folded into totalLiabilities; keep it broken out here.
      creditCard,
      liabilities: Math.max(0, overview.totalLiabilities - creditCard),
    };

    const write = await buildWrite(
      userId,
      periodKey,
      asOf,
      currency,
      breakdown,
      overview.totalAssets,
      overview.totalLiabilities,
      overview.netWorth,
      input.source ?? "AUTO",
      null,
    );
    const outcome = await snapshotRepository.upsertByPeriod(userId, write, input.overwrite ?? false);
    return { outcome, periodKey };
  },

  /** Capture the previous full month for every user — the monthly cron worker path. */
  async captureForUser(userId: string, asOf: Date): Promise<void> {
    await this.capture(userId, { asOf, source: "AUTO" });
  },

  list(userId: string): Promise<NetWorthSnapshot[]> {
    return snapshotRepository.listByUser(userId);
  },

  async timeline(userId: string): Promise<SnapshotTimelinePoint[]> {
    const rows = await snapshotRepository.listByUser(userId);
    return rows.map((r) => ({
      periodKey: r.periodKey,
      capturedAt: r.capturedAt,
      netWorth: r.netWorth,
      totalAssets: r.totalAssets,
      totalLiabilities: r.totalLiabilities,
    }));
  },

  latest(userId: string): Promise<NetWorthSnapshot | null> {
    return snapshotRepository.latest(userId);
  },

  /** Manual correction. Recomputes net worth and re-derives the next month's residual. */
  async edit(id: string, userId: string, input: EditSnapshotInput): Promise<void> {
    const rows = await snapshotRepository.listByUser(userId);
    const current = rows.find((r) => r.id === id);
    if (!current) throw new Error("Snapshot not found.");

    const breakdown: SnapshotBreakdown = { ...current.breakdown, ...(input.breakdown ?? {}) };
    const totalAssets = input.totalAssets ?? current.totalAssets;
    const totalLiabilities = input.totalLiabilities ?? current.totalLiabilities;
    const netWorth = totalAssets - totalLiabilities;

    await snapshotRepository.updateFields(id, userId, {
      breakdown,
      totalAssets,
      totalLiabilities,
      netWorth,
      source: "EDITED",
      note: input.note ?? current.note,
    });

    // Attribution of the FOLLOWING snapshot chains off this (now-changed) value.
    const next = await snapshotRepository.nextAfter(userId, current.capturedAt);
    if (next) {
      const refreshed = { ...current, breakdown, totalAssets, totalLiabilities, netWorth };
      const attribution = await deriveAttribution(
        userId,
        next.currency,
        refreshed,
        { breakdown: next.breakdown, totalLiabilities: next.totalLiabilities },
        current.capturedAt,
        next.capturedAt,
      );
      await snapshotRepository.updateFields(next.id, userId, attribution);
    }
  },

  remove(id: string, userId: string): Promise<void> {
    return snapshotRepository.remove(id, userId);
  },

  /** Persist parsed CSV backfill rows as IMPORTED snapshots (chronological order). */
  async persistImportedRows(
    userId: string,
    rows: SnapshotCsvRow[],
    overwrite: boolean,
  ): Promise<{ inserted: number; updated: number; kept: number }> {
    const prefs = await userPreferencesService.get(userId);
    const currency = prefs.displayCurrency || "INR";
    const ordered = [...rows].sort((a, b) => a.capturedAt.getTime() - b.capturedAt.getTime());

    let inserted = 0, updated = 0, kept = 0;
    for (const row of ordered) {
      try {
        const write = await buildWrite(
          userId,
          row.periodKey,
          row.capturedAt,
          currency,
          row.breakdown,
          row.totalAssets,
          row.totalLiabilities,
          row.netWorth,
          "IMPORTED",
          "backfilled",
        );
        const outcome = await snapshotRepository.upsertByPeriod(userId, write, overwrite);
        if (outcome === "inserted") inserted += 1;
        else if (outcome === "updated") updated += 1;
        else kept += 1;
      } catch (err) {
        logger.error("snapshot import row failed", err);
      }
    }
    return { inserted, updated, kept };
  },
};

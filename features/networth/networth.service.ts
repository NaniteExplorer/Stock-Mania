import { accountService } from "@/features/accounts/account.service";
import { investmentService } from "@/features/investments/investment.service";
import { esopService } from "@/features/esops/esop.service";
import { assetService } from "@/features/assets/asset.service";
import { liabilityService } from "@/features/liabilities/liability.service";
import { portfolioService } from "@/features/portfolio/portfolio.service";
import { logger } from "@/core/logger";
import type { NetWorthOverview, AllocationSlice } from "./networth.types";

async function safeBrokerage(
  userId: string,
): Promise<{ currentValue: number; dayPnl: number }> {
  try {
    const p = await portfolioService.getPortfolio(userId);
    if (!p) return { currentValue: 0, dayPnl: 0 };
    return { currentValue: p.currentValue || 0, dayPnl: p.dayPnl || 0 };
  } catch (err) {
    logger.warn("networth: brokerage fetch failed", { err });
    return { currentValue: 0, dayPnl: 0 };
  }
}

export const networthService = {
  async getOverview(userId: string): Promise<NetWorthOverview> {
    const [
      accountsTotal,
      investmentsTotal,
      esopsTotal,
      assetsTotal,
      liabilitiesTotal,
      brokerage,
      accounts,
      investments,
      esops,
      assets,
      liabilities,
    ] = await Promise.all([
      accountService.total(userId),
      investmentService.totalValue(userId),
      esopService.vestedValue(userId),
      assetService.total(userId),
      liabilityService.total(userId),
      safeBrokerage(userId),
      accountService.list(userId),
      investmentService.list(userId),
      esopService.list(userId),
      assetService.list(userId),
      liabilityService.list(userId),
    ]);

    const totals = {
      accounts: accountsTotal,
      investments: investmentsTotal,
      brokerage: brokerage.currentValue,
      esops: esopsTotal,
      assets: assetsTotal,
    };

    const totalAssets =
      totals.accounts + totals.investments + totals.brokerage + totals.esops + totals.assets;
    const totalLiabilities = liabilitiesTotal;
    const netWorth = totalAssets - totalLiabilities;

    const raw: Omit<AllocationSlice, "percent">[] = [
      { key: "accounts", label: "Cash & Bank", value: totals.accounts, color: "var(--chart-3)" },
      { key: "investments", label: "Investments", value: totals.investments, color: "var(--chart-1)" },
      { key: "brokerage", label: "Brokerage", value: totals.brokerage, color: "var(--chart-2)" },
      { key: "esops", label: "ESOPs", value: totals.esops, color: "var(--chart-4)" },
      { key: "assets", label: "Assets", value: totals.assets, color: "var(--chart-5)" },
    ];

    // Allocation is a breakdown of ASSETS (liabilities are shown separately).
    const allocation: AllocationSlice[] = raw
      .filter((s) => s.value > 0)
      .map((s) => ({ ...s, percent: totalAssets > 0 ? (s.value / totalAssets) * 100 : 0 }))
      .sort((a, b) => b.value - a.value);

    const dayChange = brokerage.dayPnl;
    const prev = netWorth - dayChange;
    const dayChangePercent = prev > 0 ? (dayChange / prev) * 100 : 0;

    return {
      netWorth,
      totalAssets,
      totalLiabilities,
      dayChange,
      dayChangePercent,
      allocation,
      totals,
      counts: {
        accounts: accounts.length,
        investments: investments.length,
        esops: esops.length,
        assets: assets.length,
        liabilities: liabilities.length,
      },
      hasData: totalAssets > 0 || totalLiabilities > 0,
    };
  },
};

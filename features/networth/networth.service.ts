import { accountService } from "@/features/accounts/account.service";
import { investmentService } from "@/features/investments/investment.service";
import { assetService } from "@/features/assets/asset.service";
import { liabilityService } from "@/features/liabilities/liability.service";
import type { AllocationSlice, NetWorthOverview } from "./networth.types";

export const networthService = {
  async getOverview(userId: string): Promise<NetWorthOverview> {
    const [accountsTotal, creditCardDebt, investmentsTotal, assetsTotal, liabilitiesTotal, accounts, investments, assets, liabilities] = await Promise.all([
      accountService.total(userId),
      accountService.creditCardDebt(userId),
      investmentService.totalValue(userId),
      assetService.total(userId),
      liabilityService.total(userId),
      accountService.list(userId),
      investmentService.list(userId),
      assetService.list(userId),
      liabilityService.list(userId),
    ]);

    const totals = { accounts: accountsTotal, investments: investmentsTotal, brokerage: 0, esops: 0, assets: assetsTotal };
    const totalAssets = accountsTotal + investmentsTotal + assetsTotal;
    const totalLiabilities = liabilitiesTotal + creditCardDebt;
    const raw: Omit<AllocationSlice, "percent">[] = [
      { key: "accounts", label: "Cash & Bank", value: totals.accounts, color: "var(--chart-3)" },
      { key: "investments", label: "Investments", value: totals.investments, color: "var(--chart-1)" },
      { key: "assets", label: "Assets", value: totals.assets, color: "var(--chart-5)" },
    ];
    const allocation = raw.filter((item) => item.value > 0).map((item) => ({ ...item, percent: totalAssets > 0 ? (item.value / totalAssets) * 100 : 0 })).sort((a, b) => b.value - a.value);

    return {
      netWorth: totalAssets - totalLiabilities,
      totalAssets,
      totalLiabilities,
      dayChange: 0,
      dayChangePercent: 0,
      allocation,
      totals,
      counts: { accounts: accounts.length, investments: investments.length, esops: 0, assets: assets.length, liabilities: liabilities.length },
      hasData: totalAssets > 0 || totalLiabilities > 0,
    };
  },
};

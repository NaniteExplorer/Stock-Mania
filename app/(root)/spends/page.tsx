import type { Metadata } from "next";
import { PieChart } from "lucide-react";
import { getCurrentSession } from "@/lib/better-auth/auth";
import { getSpendSummary, getSpendTrend, getMyBudgets } from "@/features/transactions/transaction.actions";
import { userPreferencesService } from "@/features/user/user.preferences";
import SpendSummary from "@/components/wealth/SpendSummary";
import SpendTrendChart from "@/components/wealth/SpendTrendChart";
import BudgetManager from "@/components/wealth/BudgetManager";

export const metadata: Metadata = { title: "Spends" };

export default async function SpendsPage() {
  const session = await getCurrentSession();
  const userId = session?.user?.id;

  const [summary, trend, budgets, preferences] = await Promise.all([
    getSpendSummary(90),
    getSpendTrend(6),
    getMyBudgets(),
    userId ? userPreferencesService.get(userId) : Promise.resolve({ displayCurrency: "INR" }),
  ]);
  const currency = preferences.displayCurrency || "INR";
  const actualsThisMonth = trend.length ? trend[trend.length - 1].byCategory : {};

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="page-title">Spending</h1>
        <p className="page-subtitle">
          Categorized spend from your imported statements — trends, breakdown and budgets.
        </p>
      </div>

      <section className="panel p-5">
        <div className="mb-4 flex items-center gap-2">
          <PieChart className="h-5 w-5 text-brand-500" />
          <h2 className="font-semibold text-gray-100">Monthly spend · last 6 months</h2>
        </div>
        <SpendTrendChart months={trend} />
      </section>

      {summary && <SpendSummary summary={summary} currency={currency} />}

      <BudgetManager budgets={budgets} actualsThisMonth={actualsThisMonth} currency={currency} />
    </div>
  );
}

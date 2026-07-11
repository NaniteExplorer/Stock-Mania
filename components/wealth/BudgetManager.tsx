"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Wallet } from "lucide-react";
import { toast } from "sonner";
import { setBudget } from "@/features/transactions/transaction.actions";
import { CATEGORY_META, categoryLabel, type TransactionCategory } from "@/features/transactions/transaction.categories";
import type { BudgetItem } from "@/features/transactions/budget.service";
import { formatCurrency } from "@/lib/currencies";

// Spend-eligible categories only (transfers/income/investment can't be budgeted).
const BUDGETABLE = (Object.keys(CATEGORY_META) as TransactionCategory[]).filter(
  (c) => !CATEGORY_META[c].excludeFromSpend,
);

export default function BudgetManager({
  budgets,
  actualsThisMonth,
  currency,
}: {
  budgets: BudgetItem[];
  actualsThisMonth: Record<string, number>;
  currency: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [drafts, setDrafts] = useState<Record<string, string>>(() =>
    Object.fromEntries(budgets.map((b) => [b.category, String(b.monthlyLimit)])),
  );

  const save = (category: string) =>
    startTransition(async () => {
      const value = Number(drafts[category] ?? 0);
      const result = await setBudget(category, Number.isFinite(value) ? value : 0);
      if (!result.success) {
        toast.error("Could not save", { description: result.error });
        return;
      }
      toast.success(`${categoryLabel(category)} budget saved`);
      router.refresh();
    });

  return (
    <section className="panel p-5">
      <div className="flex items-center gap-2">
        <Wallet className="h-5 w-5 text-brand-500" />
        <h2 className="font-semibold text-gray-100">Budgets · this month</h2>
      </div>
      <div className="mt-4 space-y-3">
        {BUDGETABLE.map((category) => {
          const limit = Number(drafts[category] ?? 0);
          const actual = actualsThisMonth[category] ?? 0;
          const pct = limit > 0 ? Math.min(100, (actual / limit) * 100) : 0;
          const over = limit > 0 && actual > limit;
          return (
            <div key={category} className="flex flex-wrap items-center gap-3">
              <span className="w-36 shrink-0 text-sm text-gray-300">{categoryLabel(category)}</span>
              <div className="h-2 min-w-[120px] flex-1 overflow-hidden rounded-full bg-gray-700">
                <div
                  className={`h-full rounded-full ${over ? "bg-red-500" : "bg-gradient-to-r from-brand-500 to-amber-400"}`}
                  style={{ width: `${limit > 0 ? Math.max(2, pct) : 0}%` }}
                />
              </div>
              <span className={`w-28 shrink-0 text-right text-xs tnum ${over ? "text-red-400" : "text-gray-400"}`}>
                {formatCurrency(actual, currency, true)}
                {limit > 0 && ` / ${formatCurrency(limit, currency, true)}`}
              </span>
              <div className="relative">
                <input
                  type="number"
                  inputMode="decimal"
                  value={drafts[category] ?? ""}
                  onChange={(e) => setDrafts((d) => ({ ...d, [category]: e.target.value }))}
                  placeholder="No cap"
                  className="form-input h-9 w-28 pr-8 text-sm"
                />
                <button
                  type="button"
                  onClick={() => save(category)}
                  disabled={pending}
                  className="absolute right-1 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-gray-500 hover:text-green-500 disabled:opacity-50"
                  aria-label={`Save ${categoryLabel(category)} budget`}
                >
                  <Check className="h-4 w-4" />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

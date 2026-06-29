import { PieChart } from "lucide-react";
import { formatCurrency } from "@/lib/currencies";
import type { SpendSummary as Summary } from "@/features/transactions/transaction.service";

/**
 * Compact spend breakdown. Outflow already EXCLUDES transfers/self/income/
 * investment (computed in transactionService.spendSummary), so this reflects
 * real spending only.
 */
export default function SpendSummary({ summary, currency }: { summary: Summary; currency: string }) {
  if (summary.outflow <= 0 && summary.inflow <= 0) return null;
  const max = Math.max(1, ...summary.byCategory.map((slice) => slice.total));

  return (
    <section className="panel p-5">
      <div className="flex items-center gap-2">
        <PieChart className="h-5 w-5 text-yellow-500" />
        <h2 className="font-semibold text-gray-100">Spending · last 90 days</h2>
        <span className="pill ml-auto">Transfers excluded</span>
      </div>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl bg-gray-700/40 p-4">
          <p className="text-xs text-gray-500">Total spent</p>
          <p className="mt-1 text-2xl font-bold tracking-tight text-gray-100 tnum">{formatCurrency(summary.outflow, currency)}</p>
        </div>
        <div className="rounded-xl bg-gray-700/40 p-4">
          <p className="text-xs text-gray-500">Money in</p>
          <p className="mt-1 text-2xl font-bold tracking-tight text-green-500 tnum">{formatCurrency(summary.inflow, currency)}</p>
        </div>
      </div>
      {summary.byCategory.length > 0 && (
        <div className="mt-4 space-y-2">
          {summary.byCategory.slice(0, 8).map((slice) => (
            <div key={slice.category} className="flex items-center gap-3">
              <span className="w-36 shrink-0 truncate text-xs text-gray-400">{slice.label}</span>
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-gray-700">
                <div className="h-full rounded-full bg-gradient-to-r from-yellow-500 to-amber-400" style={{ width: `${(slice.total / max) * 100}%` }} />
              </div>
              <span className="w-24 shrink-0 text-right text-xs font-semibold text-gray-200 tnum">{formatCurrency(slice.total, currency, false)}</span>
            </div>
          ))}
        </div>
      )}
      {summary.uncategorized > 0 && (
        <p className="mt-3 text-xs text-gray-500">{formatCurrency(summary.uncategorized, currency, false)} awaiting categorization (AI runs in the background after import).</p>
      )}
    </section>
  );
}

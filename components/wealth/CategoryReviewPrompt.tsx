"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, SkipForward, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { queryTransactions, setTransactionCategory } from "@/features/transactions/transaction.actions";
import { TRANSACTION_CATEGORIES, CATEGORY_META } from "@/features/transactions/transaction.categories";
import { formatCurrency } from "@/lib/currencies";
import type { AccountTransaction } from "@/features/transactions/transaction.types";

/**
 * Google-Photos-style review prompt: when statements leave transactions
 * uncategorized (the free rule engine can't always tell), this card surfaces
 * them one at a time with one-tap category chips. Entirely local + manual —
 * no AI required.
 */
export default function CategoryReviewPrompt({ currency = "INR" }: { currency?: string }) {
  const router = useRouter();
  const [queue, setQueue] = useState<AccountTransaction[]>([]);
  const [total, setTotal] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const [reviewed, setReviewed] = useState(0);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let cancelled = false;
    queryTransactions({ category: "UNCATEGORIZED", page: 1, pageSize: 25 })
      .then((result) => {
        if (cancelled) return;
        setQueue(result.transactions);
        setTotal(result.total);
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  const current = queue[0];
  if (dismissed || !current) return null;

  const advance = () => {
    setQueue((rest) => rest.slice(1));
    if (queue.length === 1) router.refresh();
  };

  const assign = (category: string) => startTransition(async () => {
    const result = await setTransactionCategory(current.id, category);
    if (!result.success) { toast.error("Could not save category", { description: result.error }); return; }
    setReviewed((count) => count + 1);
    setTotal((count) => Math.max(0, count - 1));
    advance();
  });

  return (
    <section className="panel border border-brand-600/40 bg-brand-500/5 p-5">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-brand-500" />
          <div>
            <h2 className="font-semibold text-gray-100">Review uncategorized spends</h2>
            <p className="text-xs text-gray-500">
              {total} transaction(s) need a category{reviewed > 0 ? ` · ${reviewed} done` : ""} — tap one to teach your ledger.
            </p>
          </div>
        </div>
        <button onClick={() => setDismissed(true)} className="text-gray-500 hover:text-gray-300" aria-label="Dismiss">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="mb-4 rounded-lg border border-gray-800 bg-gray-900/60 p-4">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-gray-200">{current.description}</p>
            <p className="text-xs text-gray-500">
              {new Date(current.transactionDate).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
              {current.reference ? ` · ${current.reference}` : ""}
            </p>
          </div>
          <span className={`shrink-0 text-sm font-semibold ${current.direction === "DEBIT" ? "text-red-400" : "text-green-400"}`}>
            {current.direction === "DEBIT" ? "−" : "+"}{formatCurrency(current.amount, current.currency || currency)}
          </span>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {TRANSACTION_CATEGORIES.map((category) => (
          <button
            key={category}
            disabled={pending}
            onClick={() => assign(category)}
            className="rounded-full border border-gray-700 bg-gray-800/70 px-3 py-1.5 text-xs font-medium text-gray-300 transition hover:border-brand-500 hover:bg-brand-500/15 hover:text-brand-300 disabled:opacity-50"
          >
            {CATEGORY_META[category].label}
          </button>
        ))}
        <button
          disabled={pending}
          onClick={advance}
          className="ml-auto flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-medium text-gray-500 hover:text-gray-300 disabled:opacity-50"
        >
          <SkipForward className="h-3.5 w-3.5" /> Skip
        </button>
      </div>

      {reviewed > 0 && queue.length === 0 && (
        <p className="mt-3 flex items-center gap-1.5 text-xs text-green-400">
          <CheckCircle2 className="h-4 w-4" /> All caught up!
        </p>
      )}
    </section>
  );
}

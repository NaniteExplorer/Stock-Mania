"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Search, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { deleteAllTransactions, deleteTransaction, queryTransactions, reprocessTransactions, setTransactionCategory } from "@/features/transactions/transaction.actions";
import { TRANSACTION_CATEGORIES, categoryLabel } from "@/features/transactions/transaction.categories";
import type { AccountTransaction } from "@/features/transactions/transaction.types";
import type { Account } from "@/features/accounts/account.types";
import { formatCurrency } from "@/lib/currencies";

const PAGE_SIZE = 50;

interface Props {
  initialTransactions: AccountTransaction[];
  initialTotal: number;
  grandTotal: number;
  accounts: Account[];
}

export default function TransactionsList({ initialTransactions, initialTotal, grandTotal, accounts }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [saving, startSaving] = useTransition();

  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [direction, setDirection] = useState("");
  const [accountId, setAccountId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(0);

  const [rows, setRows] = useState(initialTransactions);
  const [total, setTotal] = useState(initialTotal);
  const first = useRef(true);

  const accountName = useMemo(() => Object.fromEntries(accounts.map((a) => [a.id, a.name])), [accounts]);
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // Re-query the server whenever a filter or the page changes (search debounced).
  useEffect(() => {
    // Skip the very first run — initial data came from the server render.
    if (first.current) { first.current = false; return; }
    const handle = setTimeout(() => {
      startTransition(async () => {
        const result = await queryTransactions({ accountId, category, direction: direction as "CREDIT" | "DEBIT" | "", search: query, from, to, page, pageSize: PAGE_SIZE });
        setRows(result.transactions);
        setTotal(result.total);
      });
    }, 250);
    return () => clearTimeout(handle);
  }, [query, category, direction, accountId, from, to, page]);

  // Any filter change resets to the first page.
  const onFilter = <T,>(setter: (v: T) => void) => (v: T) => { setter(v); setPage(0); };

  const reprocess = () =>
    startSaving(async () => {
      const result = await reprocessTransactions();
      if (!result.success) { toast.error("Reprocess failed", { description: result.error }); return; }
      toast.success(`Recategorized ${result.recategorized ?? 0} · balances updated ${result.balancesUpdated ?? 0}`);
      router.refresh();
      // Refresh the current page from the server.
      startTransition(async () => {
        const r = await queryTransactions({ accountId, category, direction: direction as "CREDIT" | "DEBIT" | "", search: query, from, to, page, pageSize: PAGE_SIZE });
        setRows(r.transactions); setTotal(r.total);
      });
    });

  const refetch = () =>
    startTransition(async () => {
      const r = await queryTransactions({ accountId, category, direction: direction as "CREDIT" | "DEBIT" | "", search: query, from, to, page, pageSize: PAGE_SIZE });
      setRows(r.transactions); setTotal(r.total);
    });

  const removeOne = (id: string) =>
    startSaving(async () => {
      if (!window.confirm("Delete this transaction?")) return;
      const result = await deleteTransaction(id);
      if (!result.success) { toast.error("Delete failed", { description: result.error }); return; }
      setRows((prev) => prev.filter((t) => t.id !== id));
      setTotal((n) => Math.max(0, n - 1));
      toast.success("Transaction deleted");
      router.refresh();
    });

  const removeAll = () =>
    startSaving(async () => {
      const scopeName = accountId ? (accounts.find((a) => a.id === accountId)?.name ?? "this account") : "ALL accounts";
      if (!window.confirm(`Delete every transaction for ${scopeName}? This cannot be undone.`)) return;
      const result = await deleteAllTransactions(accountId || undefined);
      if (!result.success) { toast.error("Delete failed", { description: result.error }); return; }
      toast.success(`Deleted ${result.deleted ?? 0} transactions`);
      setPage(0);
      router.refresh();
      refetch();
    });

  const changeCategory = (id: string, value: string) =>
    startSaving(async () => {
      const result = await setTransactionCategory(id, value);
      if (!result.success) { toast.error("Could not update", { description: result.error }); return; }
      setRows((prev) => prev.map((t) => (t.id === id ? { ...t, category: value, categorySource: "MANUAL" } : t)));
      toast.success("Category updated");
      router.refresh();
    });

  return (
    <div className="flex flex-col gap-4">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-gray-600 bg-gray-800 p-3">
        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
          <input value={query} onChange={(e) => onFilter(setQuery)(e.target.value)} placeholder="Search description or reference" className="form-input h-10 w-full !pl-10" />
        </div>
        <select value={accountId} onChange={(e) => onFilter(setAccountId)(e.target.value)} className="select-trigger h-10 w-auto">
          <option value="">All accounts</option>
          {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        <select value={category} onChange={(e) => onFilter(setCategory)(e.target.value)} className="select-trigger h-10 w-auto">
          <option value="">All categories</option>
          <option value="UNCATEGORIZED">Uncategorized</option>
          {TRANSACTION_CATEGORIES.map((c) => <option key={c} value={c}>{categoryLabel(c)}</option>)}
        </select>
        <select value={direction} onChange={(e) => onFilter(setDirection)(e.target.value)} className="select-trigger h-10 w-auto">
          <option value="">In & out</option>
          <option value="CREDIT">Money in</option>
          <option value="DEBIT">Money out</option>
        </select>
        <label className="flex items-center gap-1 text-xs text-gray-500">From<input type="date" value={from} onChange={(e) => onFilter(setFrom)(e.target.value)} className="form-input h-10" /></label>
        <label className="flex items-center gap-1 text-xs text-gray-500">To<input type="date" value={to} onChange={(e) => onFilter(setTo)(e.target.value)} className="form-input h-10" /></label>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-gray-500">
          {pending ? "Loading…" : `${total.toLocaleString("en-IN")} matching`} · {grandTotal.toLocaleString("en-IN")} total transactions
        </p>
        <div className="flex items-center gap-2">
          <button type="button" onClick={reprocess} disabled={saving || pending} className="ghost-btn h-9 px-4 text-sm disabled:opacity-50">
            <Sparkles className="h-4 w-4" /> {saving ? "Reprocessing…" : "Auto-categorize & fix balances"}
          </button>
          <button type="button" onClick={removeAll} disabled={saving || pending || total === 0} className="ghost-btn h-9 px-4 text-sm text-red-400 hover:text-red-500 disabled:opacity-40">
            <Trash2 className="h-4 w-4" /> {accountId ? "Delete this account's" : "Delete all"}
          </button>
        </div>
      </div>

      <div className="panel overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-gray-600 text-xs text-gray-500">
              <tr>
                <th className="p-3">Date</th>
                <th className="p-3">Description</th>
                <th className="p-3">Account</th>
                <th className="p-3">Category</th>
                <th className="p-3 text-right">Amount</th>
                <th className="p-3" />
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => (
                <tr key={t.id} className="border-b border-gray-700/60">
                  <td className="whitespace-nowrap p-3 text-gray-400">{new Date(t.transactionDate).toLocaleDateString("en-IN")}</td>
                  <td className="max-w-md p-3"><span className="block truncate text-gray-200">{t.description}</span></td>
                  <td className="whitespace-nowrap p-3 text-xs text-gray-500">{accountName[t.accountId] ?? "—"}</td>
                  <td className="p-3">
                    <select
                      value={t.category ?? ""}
                      onChange={(e) => changeCategory(t.id, e.target.value)}
                      disabled={saving}
                      className="rounded-md border border-gray-600 bg-gray-800 px-2 py-1 text-xs text-gray-300"
                      title={t.categorySource ? `Set by ${t.categorySource.toLowerCase()}` : "Uncategorized"}
                    >
                      <option value="">{categoryLabel(null)}</option>
                      {TRANSACTION_CATEGORIES.map((c) => <option key={c} value={c}>{categoryLabel(c)}</option>)}
                    </select>
                  </td>
                  <td className={`whitespace-nowrap p-3 text-right font-semibold tnum ${t.direction === "CREDIT" ? "text-green-500" : "text-gray-200"}`}>
                    {t.direction === "CREDIT" ? "+" : "−"}{formatCurrency(t.amount, t.currency, false)}
                  </td>
                  <td className="p-3 text-right">
                    <button onClick={() => removeOne(t.id)} disabled={saving} className="flex h-8 w-8 items-center justify-center rounded-lg border border-gray-600 text-gray-500 hover:text-red-500 disabled:opacity-40" aria-label="Delete transaction">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={6} className="p-8 text-center text-sm text-gray-500">{pending ? "Loading…" : "No transactions match these filters."}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {pageCount > 1 && (
        <div className="flex items-center justify-center gap-3">
          <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0 || pending} className="ghost-btn h-9 px-4 disabled:opacity-40">Previous</button>
          <span className="text-sm text-gray-400 tnum">Page {page + 1} of {pageCount}</span>
          <button onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))} disabled={page >= pageCount - 1 || pending} className="ghost-btn h-9 px-4 disabled:opacity-40">Next</button>
        </div>
      )}
    </div>
  );
}

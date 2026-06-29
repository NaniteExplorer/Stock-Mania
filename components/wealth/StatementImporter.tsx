"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, FileSpreadsheet, LockKeyhole, Upload, XCircle } from "lucide-react";
import { toast } from "sonner";
import type { Account } from "@/features/accounts/account.types";
import type { AccountTransaction, ParsedStatementRow } from "@/features/transactions/transaction.types";
import { importAccountStatement } from "@/features/transactions/transaction.actions";
import { parseStatementFile } from "@/features/transactions/statement-parser";
import { formatCurrency } from "@/lib/currencies";
import ProviderMark from "./ProviderMark";

export default function StatementImporter({ accounts, transactions }: { accounts: Account[]; transactions: AccountTransaction[] }) {
  const router = useRouter(); const inputRef = useRef<HTMLInputElement>(null);
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [fileName, setFileName] = useState(""); const [rows, setRows] = useState<ParsedStatementRow[]>([]);
  const [error, setError] = useState(""); const [parsing, setParsing] = useState(false); const [pending, startTransition] = useTransition();
  const account = accounts.find((item) => item.id === accountId);

  const chooseFile = async (file?: File) => {
    if (!file || !account) return; setParsing(true); setError(""); setRows([]); setFileName(file.name);
    try {
      const parsed = await parseStatementFile(file, account.currency);
      if (!parsed.length) throw new Error("No valid transaction rows were found.");
      setRows(parsed);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not read this statement."); }
    finally { setParsing(false); }
  };

  const importRows = () => startTransition(async () => {
    const result = await importAccountStatement(accountId, fileName, rows);
    if (!result.success) { toast.error("Import failed", { description: result.error }); return; }
    toast.success(`${result.inserted} new transactions imported`, { description: `${result.skipped} overlapping rows safely skipped${result.balanceUpdated ? " · balance updated" : ""}.` });
    setRows([]); setFileName(""); if (inputRef.current) inputRef.current.value = ""; router.refresh();
  });

  return (
    <section className="panel overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-gray-600 p-5">
        <div><div className="flex items-center gap-2"><FileSpreadsheet className="h-5 w-5 text-yellow-500" /><h2 className="font-semibold text-gray-100">Statement import</h2><span className="pill pill-brand">Smart merge</span></div><p className="mt-1 text-sm text-gray-500">Convert bank exports into a clean ledger. Existing and manual transactions stay untouched.</p></div>
        <div className="flex items-center gap-1.5 text-xs text-green-500"><LockKeyhole className="h-3.5 w-3.5" /> Preview before import</div>
      </div>
      <div className="grid gap-4 p-5 lg:grid-cols-[260px_1fr]">
        <div className="space-y-3">
          <label className="form-label">Import into</label>
          <select value={accountId} onChange={(event) => { setAccountId(event.target.value); setRows([]); }} className="select-trigger" disabled={!accounts.length}>
            {accounts.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.currency}</option>)}
          </select>
          <input ref={inputRef} className="hidden" type="file" accept=".csv,.tsv,.txt,.xlsx,.ofx,.qfx" onChange={(event) => void chooseFile(event.target.files?.[0])} />
          <button type="button" onClick={() => inputRef.current?.click()} disabled={!accounts.length || parsing} className="yellow-btn w-full"><Upload className="h-4 w-4" /> {parsing ? "Reading statement…" : "Choose statement"}</button>
          <p className="text-xs leading-relaxed text-gray-500">CSV, TSV, XLSX, OFX and QFX · up to 5,000 rows. Columns are detected automatically across common Indian and international bank formats.</p>
        </div>
        <div className="min-h-36 rounded-xl border border-dashed border-gray-600 bg-gray-700/30 p-4">
          {error ? <div className="flex h-full items-center justify-center gap-2 text-sm text-red-400"><XCircle className="h-5 w-5" />{error}</div> : rows.length ? (
            <div className="space-y-3"><div className="flex flex-wrap items-center gap-2"><CheckCircle2 className="h-5 w-5 text-green-500" /><p className="text-sm font-semibold text-gray-100">{rows.length} transactions recognized</p><span className="pill ml-auto">{fileName}</span></div>
              <div className="max-h-48 overflow-auto rounded-lg border border-gray-600"><table className="w-full text-left text-xs"><thead className="sticky top-0 bg-gray-800 text-gray-500"><tr><th className="p-2">Date</th><th className="p-2">Description</th><th className="p-2 text-right">Amount</th></tr></thead><tbody>{rows.slice(0, 12).map((row, index) => <tr key={`${row.transactionDate}-${index}`} className="border-t border-gray-600"><td className="whitespace-nowrap p-2 text-gray-400">{new Date(row.transactionDate).toLocaleDateString("en-IN")}</td><td className="max-w-64 truncate p-2 text-gray-300">{row.description}</td><td className={`whitespace-nowrap p-2 text-right font-semibold ${row.direction === "CREDIT" ? "text-green-500" : "text-gray-200"}`}>{row.direction === "CREDIT" ? "+" : "−"}{formatCurrency(row.amount, row.currency, false)}</td></tr>)}</tbody></table></div>
              <button type="button" onClick={importRows} disabled={pending} className="yellow-btn ml-auto px-5">{pending ? "Merging…" : `Import ${rows.length} transactions`}</button>
            </div>
          ) : <div className="flex h-full min-h-28 flex-col items-center justify-center text-center"><Upload className="mb-2 h-7 w-7 text-gray-500" /><p className="text-sm text-gray-400">Your normalized transaction preview will appear here.</p><p className="mt-1 text-xs text-gray-500">Overlapping dates are safe—you can import June–September after already adding June.</p></div>}
        </div>
      </div>
      {transactions.length > 0 && <div className="border-t border-gray-600 p-5"><h3 className="mb-3 text-sm font-semibold text-gray-200">Recent imported transactions</h3><div className="grid gap-2 sm:grid-cols-2">{transactions.slice(0, 6).map((transaction) => { const owner = accounts.find((item) => item.id === transaction.accountId); return <div key={transaction.id} className="flex items-center gap-3 rounded-xl bg-gray-700/40 p-3"><ProviderMark providerId={owner?.providerId} institution={owner?.institution} className="h-9 w-9" /><div className="min-w-0"><p className="truncate text-xs font-medium text-gray-200">{transaction.description}</p><p className="text-[11px] text-gray-500">{new Date(transaction.transactionDate).toLocaleDateString("en-IN")} · {owner?.name}</p></div><span className={`ml-auto text-xs font-semibold ${transaction.direction === "CREDIT" ? "text-green-500" : "text-gray-300"}`}>{transaction.direction === "CREDIT" ? "+" : "−"}{formatCurrency(transaction.amount, transaction.currency, true)}</span></div>; })}</div></div>}
    </section>
  );
}

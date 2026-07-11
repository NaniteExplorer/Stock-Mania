"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, FileSpreadsheet, LockKeyhole, Upload, XCircle } from "lucide-react";
import { toast } from "sonner";
import type { Account } from "@/features/accounts/account.types";
import type { AccountTransaction, ParsedStatementRow } from "@/features/transactions/transaction.types";
import { importAccountStatement, parseStatementUpload, setTransactionCategory } from "@/features/transactions/transaction.actions";
import { parseStatementFile } from "@/features/transactions/statement-parser";
import { TRANSACTION_CATEGORIES, categoryLabel, CATEGORY_META } from "@/features/transactions/transaction.categories";
import { formatCurrency } from "@/lib/currencies";
import ProviderMark from "./ProviderMark";

export default function StatementImporter({ accounts, transactions }: { accounts: Account[]; transactions: AccountTransaction[] }) {
  const router = useRouter(); const inputRef = useRef<HTMLInputElement>(null);
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [fileName, setFileName] = useState(""); const [rows, setRows] = useState<ParsedStatementRow[]>([]);
  const [error, setError] = useState(""); const [parsing, setParsing] = useState(false); const [pending, startTransition] = useTransition();
  const [aiParsed, setAiParsed] = useState(false);
  const [password, setPassword] = useState(""); const [needsPassword, setNeedsPassword] = useState(false);
  const [pendingPdf, setPendingPdf] = useState<File | null>(null);
  const account = accounts.find((item) => item.id === accountId);

  const isPdf = (file: File) => file.name.toLowerCase().endsWith(".pdf");

  const parsePdf = async (file: File, pdfPassword: string) => {
    if (!account) return;
    setParsing(true); setError(""); setRows([]); setFileName(file.name);
    try {
      const form = new FormData();
      form.set("file", file); form.set("password", pdfPassword); form.set("currency", account.currency);
      const result = await parseStatementUpload(form);
      if (!result.success || !result.rows) {
        setNeedsPassword(Boolean(result.needsPassword));
        if (result.needsPassword) setPendingPdf(file);
        throw new Error(result.error ?? "Could not read this statement.");
      }
      setRows(result.rows); setAiParsed(true); setNeedsPassword(false); setPendingPdf(null); setPassword("");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not read this statement."); }
    finally { setParsing(false); }
  };

  const chooseFile = async (file?: File) => {
    if (!file || !account) return;
    setAiParsed(false); setNeedsPassword(false); setPendingPdf(null); setPassword("");
    if (isPdf(file)) { await parsePdf(file, ""); return; }
    setParsing(true); setError(""); setRows([]); setFileName(file.name);
    try {
      const parsed = await parseStatementFile(file, account.currency);
      if (!parsed.length) throw new Error("No valid transaction rows were found.");
      setRows(parsed);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not read this statement."); }
    finally { setParsing(false); }
  };

  const changeCategory = (id: string, category: string) => startTransition(async () => {
    const result = await setTransactionCategory(id, category);
    if (!result.success) { toast.error("Could not update category", { description: result.error }); return; }
    toast.success("Category updated"); router.refresh();
  });

  const importRows = () => startTransition(async () => {
    const result = await importAccountStatement(accountId, fileName, rows);
    if (!result.success) { toast.error("Import failed", { description: result.error }); return; }
    toast.success(`${result.inserted} new transactions imported`, { description: `${result.skipped} overlapping rows safely skipped${result.balanceUpdated ? " · balance updated" : ""}.` });
    setRows([]); setFileName(""); setAiParsed(false); if (inputRef.current) inputRef.current.value = ""; router.refresh();
  });

  return (
    <section className="panel overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-gray-600 p-5">
        <div><div className="flex items-center gap-2"><FileSpreadsheet className="h-5 w-5 text-brand-500" /><h2 className="font-semibold text-gray-100">Statement import</h2><span className="pill pill-brand">Smart merge</span></div><p className="mt-1 text-sm text-gray-500">Convert bank exports into a clean ledger. Existing and manual transactions stay untouched.</p></div>
        <div className="flex items-center gap-1.5 text-xs text-green-500"><LockKeyhole className="h-3.5 w-3.5" /> Preview before import</div>
      </div>
      <div className="grid gap-4 p-5 lg:grid-cols-[260px_1fr]">
        <div className="space-y-3">
          <label className="form-label">Import into</label>
          <select value={accountId} onChange={(event) => { setAccountId(event.target.value); setRows([]); }} className="select-trigger" disabled={!accounts.length}>
            {accounts.length
              ? accounts.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.currency}</option>)
              : <option value="">Add an account first</option>}
          </select>
          {!accounts.length && <p className="text-xs text-gray-500">Create an account below, then import its statement here.</p>}
          <input ref={inputRef} className="hidden" type="file" accept=".csv,.tsv,.txt,.xlsx,.ofx,.qfx,.pdf" onChange={(event) => void chooseFile(event.target.files?.[0])} />
          <button type="button" onClick={() => inputRef.current?.click()} disabled={!accounts.length || parsing} className="btn-brand w-full"><Upload className="h-4 w-4" /> {parsing ? "Reading statement…" : "Choose statement"}</button>
          {needsPassword && (
            <div className="space-y-2 rounded-lg border border-brand-600/40 bg-brand-500/5 p-3">
              <label className="form-label flex items-center gap-1.5 text-xs text-brand-500"><LockKeyhole className="h-3.5 w-3.5" /> This PDF is password protected</label>
              <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Statement password" className="form-input w-full" />
              <button type="button" onClick={() => pendingPdf && void parsePdf(pendingPdf, password)} disabled={!password || parsing} className="ghost-btn h-9 w-full text-sm">Unlock & read</button>
            </div>
          )}
          <p className="text-xs leading-relaxed text-gray-500">CSV, TSV, XLSX, OFX, QFX and PDF · up to 5,000 rows. PDFs are read with AI; columns in spreadsheet/CSV exports are detected automatically across common Indian and international bank formats.</p>
        </div>
        <div className="min-h-36 rounded-xl border border-dashed border-gray-600 bg-gray-700/30 p-4">
          {error ? <div className="flex h-full items-center justify-center gap-2 text-sm text-red-400"><XCircle className="h-5 w-5" />{error}</div> : rows.length ? (
            <div className="space-y-3"><div className="flex flex-wrap items-center gap-2"><CheckCircle2 className="h-5 w-5 text-green-500" /><p className="text-sm font-semibold text-gray-100">{rows.length} transactions recognized</p>{aiParsed && <span className="pill pill-brand">AI parsed · review before import</span>}<span className="pill ml-auto">{fileName}</span></div>
              <div className="max-h-48 overflow-auto rounded-lg border border-gray-600"><table className="w-full text-left text-xs"><thead className="sticky top-0 bg-gray-800 text-gray-500"><tr><th className="p-2">Date</th><th className="p-2">Description</th><th className="p-2 text-right">Amount</th></tr></thead><tbody>{rows.slice(0, 12).map((row, index) => <tr key={`${row.transactionDate}-${index}`} className="border-t border-gray-600"><td className="whitespace-nowrap p-2 text-gray-400">{new Date(row.transactionDate).toLocaleDateString("en-IN")}</td><td className="max-w-64 truncate p-2 text-gray-300">{row.description}</td><td className={`whitespace-nowrap p-2 text-right font-semibold ${row.direction === "CREDIT" ? "text-green-500" : "text-gray-200"}`}>{row.direction === "CREDIT" ? "+" : "−"}{formatCurrency(row.amount, row.currency, false)}</td></tr>)}</tbody></table></div>
              <button type="button" onClick={importRows} disabled={pending} className="btn-brand ml-auto px-5">{pending ? "Merging…" : `Import ${rows.length} transactions`}</button>
            </div>
          ) : <div className="flex h-full min-h-28 flex-col items-center justify-center text-center"><Upload className="mb-2 h-7 w-7 text-gray-500" /><p className="text-sm text-gray-400">Your normalized transaction preview will appear here.</p><p className="mt-1 text-xs text-gray-500">Overlapping dates are safe—you can import June–September after already adding June.</p></div>}
        </div>
      </div>
      {transactions.length > 0 && <div className="border-t border-gray-600 p-5"><h3 className="mb-3 text-sm font-semibold text-gray-200">Recent imported transactions</h3><div className="grid gap-2 sm:grid-cols-2">{transactions.slice(0, 6).map((transaction) => { const owner = accounts.find((item) => item.id === transaction.accountId); const excluded = transaction.category ? CATEGORY_META[transaction.category as keyof typeof CATEGORY_META]?.excludeFromSpend : false; return <div key={transaction.id} className="flex items-center gap-3 rounded-xl bg-gray-700/40 p-3"><ProviderMark providerId={owner?.providerId} institution={owner?.institution} className="h-9 w-9" /><div className="min-w-0 flex-1"><p className="truncate text-xs font-medium text-gray-200">{transaction.description}</p><div className="mt-1 flex items-center gap-2"><p className="text-[11px] text-gray-500">{new Date(transaction.transactionDate).toLocaleDateString("en-IN")} · {owner?.name}</p><select value={transaction.category ?? ""} onChange={(event) => changeCategory(transaction.id, event.target.value)} disabled={pending} className={`rounded-md border border-gray-600 bg-gray-800 px-1.5 py-0.5 text-[10px] ${excluded ? "text-gray-500" : "text-gray-300"}`} title={transaction.categorySource ? `Set by ${transaction.categorySource.toLowerCase()}` : "Uncategorized"}><option value="">{categoryLabel(null)}</option>{TRANSACTION_CATEGORIES.map((category) => <option key={category} value={category}>{categoryLabel(category)}</option>)}</select></div></div><span className={`text-xs font-semibold ${transaction.direction === "CREDIT" ? "text-green-500" : "text-gray-300"}`}>{transaction.direction === "CREDIT" ? "+" : "−"}{formatCurrency(transaction.amount, transaction.currency, true)}</span></div>; })}</div></div>}
    </section>
  );
}

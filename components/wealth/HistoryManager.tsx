"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Download, Pencil, Plus, Trash2, Upload, XCircle } from "lucide-react";
import { toast } from "sonner";
import { deleteSnapshot, importSnapshotsCsv, saveMonthlySnapshot } from "@/features/tracking/snapshot.actions";
import { parseSnapshotFile } from "@/features/tracking/snapshot-import.service";
import { calculateMonthlyWealth, EMPTY_MONTHLY_WEALTH } from "@/features/tracking/monthly-wealth";
import type { MonthlyWealthValues, NetWorthSnapshot, SnapshotCsvRow } from "@/features/tracking/tracking.types";
import { formatINRCompact } from "@/lib/utils";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const GROUPS: Array<{ title: string; fields: Array<[keyof MonthlyWealthValues, string]> }> = [
  { title: "Cash & banks", fields: [["cash", "Cash"], ["sbiBank", "SBI Bank"], ["jioPaymentsBank", "Jio Payments Bank"], ["axisBank", "Axis Bank"]] },
  { title: "Mid-term investments", fields: [["indianStocks", "Indian stocks"], ["usStocks", "US stocks"], ["cryptoCurrency", "Crypto currency"], ["etfs", "ETFs"], ["reits", "REITs"], ["digitalGold", "Digital gold"]] },
  { title: "Long-term investments", fields: [["mutualFunds", "Mutual funds"], ["ppf", "PPF"], ["rdFd", "RD / FD"], ["nps", "NPS"], ["epfo", "EPFO"]] },
  { title: "Debts & tracking", fields: [["creditCardLoans", "Credit-card loans"], ["loans", "Other loans"], ["equityCryptoPnl", "Equity & crypto P/L"], ["lifeInsurance", "Life insurance"], ["healthInsurance", "Health insurance"]] },
];

function inputDate(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

export default function HistoryManager({ snapshots }: { snapshots: NetWorthSnapshot[] }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(inputDate());
  const [values, setValues] = useState<MonthlyWealthValues>({ ...EMPTY_MONTHLY_WEALTH });
  const [note, setNote] = useState("");
  const [preview, setPreview] = useState<SnapshotCsvRow[]>([]);
  const [fileError, setFileError] = useState("");
  const metrics = calculateMonthlyWealth(values);

  const beginNew = () => {
    setDate(inputDate()); setValues({ ...EMPTY_MONTHLY_WEALTH }); setNote(""); setOpen(true);
  };
  const beginEdit = (snapshot: NetWorthSnapshot) => {
    if (!snapshot.values) { toast.error("This legacy row has no category detail. Re-import the spreadsheet to edit it."); return; }
    setDate(inputDate(snapshot.capturedAt)); setValues({ ...snapshot.values }); setNote(snapshot.note ?? ""); setOpen(true);
  };
  const save = () => startTransition(async () => {
    const result = await saveMonthlySnapshot({ capturedAt: new Date(`${date}T12:00:00Z`), values, note: note || null });
    if (!result.success) { toast.error("Save failed", { description: result.error }); return; }
    toast.success("Monthly entry saved"); setOpen(false); router.refresh();
  });
  const remove = (id: string) => startTransition(async () => {
    if (!window.confirm("Delete this monthly entry?")) return;
    const result = await deleteSnapshot(id);
    if (!result.success) { toast.error("Delete failed", { description: result.error }); return; }
    router.refresh();
  });
  const chooseFile = async (file?: File) => {
    if (!file) return;
    setFileError("");
    try { setPreview(await parseSnapshotFile(file)); }
    catch (error) { setFileError(error instanceof Error ? error.message : "Could not read the file."); }
  };
  const importRows = () => startTransition(async () => {
    const result = await importSnapshotsCsv(preview, true);
    if (!result.success) { toast.error("Import failed", { description: result.error }); return; }
    toast.success(`${(result.inserted ?? 0) + (result.updated ?? 0)} months imported`);
    setPreview([]); if (fileRef.current) fileRef.current.value = ""; router.refresh();
  });

  return (
    <div className="flex flex-col gap-6">
      <section className="panel flex flex-wrap items-center gap-3 p-5">
        <button type="button" onClick={beginNew} className="btn-brand px-5"><Plus className="h-4 w-4" /> Add monthly entry</button>
        <input ref={fileRef} type="file" accept=".csv,.tsv,.txt,.xlsx,.xls" className="hidden" onChange={(e) => void chooseFile(e.target.files?.[0])} />
        <button type="button" onClick={() => fileRef.current?.click()} className="ghost-btn h-10 px-4"><Upload className="h-4 w-4" /> Import spreadsheet</button>
        <a href="/data/monthly-wealth-history.csv" download className="ghost-btn h-10 px-4"><Download className="h-4 w-4" /> Prepared history CSV</a>
        <p className="text-xs text-gray-500">Nothing runs in the background. Add one entry at your chosen monthly interval.</p>
      </section>

      {fileError && <div className="panel flex items-center gap-2 p-4 text-sm text-red-400"><XCircle className="h-4 w-4" />{fileError}</div>}
      {preview.length > 0 && (
        <section className="panel flex flex-wrap items-center gap-4 p-5">
          <p className="text-sm text-gray-300"><strong className="text-gray-100">{preview.length}</strong> monthly rows recognized</p>
          <span className="text-xs text-gray-500">Existing months will be updated.</span>
          <button type="button" onClick={importRows} disabled={pending} className="btn-brand ml-auto px-5">{pending ? "Importing…" : "Confirm import"}</button>
        </section>
      )}

      {snapshots.length === 0 ? (
        <div className="panel py-16 text-center"><p className="font-semibold text-gray-100">No monthly entries yet</p><p className="mt-1 text-sm text-gray-500">Add one manually or import your existing workbook.</p></div>
      ) : (
        <div className="panel overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="border-b border-gray-600 text-xs text-gray-500"><tr><th className="p-3">Month</th><th className="p-3 text-right">In hand</th><th className="p-3 text-right">Mid term</th><th className="p-3 text-right">Long term</th><th className="p-3 text-right">Debt</th><th className="p-3 text-right">Total worth</th><th className="p-3" /></tr></thead>
            <tbody>{[...snapshots].reverse().map((s) => {
              const m = s.metrics;
              return <tr key={s.id} className="border-b border-gray-700/60"><td className="p-3 font-medium text-gray-200">{s.periodKey}</td><td className="p-3 text-right tnum">{formatINRCompact(m?.inHand ?? s.breakdown.accounts)}</td><td className="p-3 text-right tnum">{formatINRCompact(m?.midTerm ?? s.breakdown.investments)}</td><td className="p-3 text-right tnum">{formatINRCompact(m?.longTerm ?? 0)}</td><td className="p-3 text-right text-red-400 tnum">{formatINRCompact(m?.totalDebts ?? -s.totalLiabilities)}</td><td className="p-3 text-right font-semibold text-gray-100 tnum">{formatINRCompact(m?.totalWorth ?? s.netWorth)}</td><td className="p-3"><div className="flex justify-end gap-1"><button onClick={() => beginEdit(s)} className="ghost-btn h-8 w-8 p-0" aria-label="Edit"><Pencil className="h-3.5 w-3.5" /></button><button onClick={() => remove(s.id)} className="ghost-btn h-8 w-8 p-0 hover:text-red-500" aria-label="Delete"><Trash2 className="h-3.5 w-3.5" /></button></div></td></tr>;
            })}</tbody>
          </table>
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto border-gray-600 bg-gray-800 text-gray-400">
          <DialogHeader><DialogTitle className="text-gray-100">Monthly wealth entry</DialogTitle><DialogDescription>Enter closing values for the chosen date. All totals are calculated for you.</DialogDescription></DialogHeader>
          <div className="grid gap-5">
            <div><label className="form-label">Entry date</label><input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="form-input mt-1.5 w-full" /></div>
            {GROUPS.map((group) => <fieldset key={group.title} className="rounded-xl border border-gray-600 p-4"><legend className="px-2 text-sm font-semibold text-gray-200">{group.title}</legend><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{group.fields.map(([field, label]) => <label key={field} className="text-xs text-gray-500">{label}<input type="number" step="0.01" value={values[field]} onChange={(e) => setValues((current) => ({ ...current, [field]: Number(e.target.value) || 0 }))} className="form-input mt-1 w-full" /></label>)}</div></fieldset>)}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4"><Summary label="In hand" value={metrics.inHand} /><Summary label="Mid term" value={metrics.midTerm} /><Summary label="Long term" value={metrics.longTerm} /><Summary label="Total worth" value={metrics.totalWorth} /></div>
            <div><label className="form-label">Note (optional)</label><input value={note} onChange={(e) => setNote(e.target.value)} className="form-input mt-1.5 w-full" /></div>
            <div className="flex justify-end gap-2"><button onClick={() => setOpen(false)} className="ghost-btn h-11 px-5">Cancel</button><button onClick={save} disabled={pending || !date} className="btn-brand px-6">{pending ? "Saving…" : "Save month"}</button></div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Summary({ label, value }: { label: string; value: number }) {
  return <div className="stat-tile"><p className="text-xs text-gray-500">{label}</p><p className="mt-1 font-semibold text-gray-100 tnum">{formatINRCompact(value)}</p></div>;
}

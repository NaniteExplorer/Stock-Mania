"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, CheckCircle2, Pencil, Trash2, Upload, XCircle } from "lucide-react";
import { toast } from "sonner";
import {
  captureSnapshotNow,
  deleteSnapshot,
  editSnapshot,
  importSnapshotsCsv,
} from "@/features/tracking/snapshot.actions";
import { parseSnapshotFile } from "@/features/tracking/snapshot-import.service";
import type { NetWorthSnapshot, SnapshotCsvRow } from "@/features/tracking/tracking.types";
import { formatINRCompact, formatSignedINRCompact } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export default function HistoryManager({ snapshots }: { snapshots: NetWorthSnapshot[] }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();
  const [parsing, setParsing] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<SnapshotCsvRow[]>([]);
  const [fileName, setFileName] = useState("");
  const [editing, setEditing] = useState<NetWorthSnapshot | null>(null);
  const [form, setForm] = useState({ totalAssets: "", totalLiabilities: "", note: "" });

  const capture = () =>
    startTransition(async () => {
      const result = await captureSnapshotNow();
      if (!result.success) {
        toast.error("Capture failed", { description: result.error });
        return;
      }
      toast.success("Snapshot captured for this month");
      router.refresh();
    });

  const chooseFile = async (file?: File) => {
    if (!file) return;
    setParsing(true);
    setError("");
    setPreview([]);
    setFileName(file.name);
    try {
      const rows = await parseSnapshotFile(file);
      setPreview(rows);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not read this file.");
    } finally {
      setParsing(false);
    }
  };

  const runImport = () =>
    startTransition(async () => {
      const result = await importSnapshotsCsv(preview, true);
      if (!result.success) {
        toast.error("Import failed", { description: result.error });
        return;
      }
      toast.success(`Imported ${result.inserted ?? 0} months`, {
        description: `${result.updated ?? 0} updated · ${result.kept ?? 0} kept`,
      });
      setPreview([]);
      setFileName("");
      if (inputRef.current) inputRef.current.value = "";
      router.refresh();
    });

  const openEdit = (snapshot: NetWorthSnapshot) => {
    setEditing(snapshot);
    setForm({
      totalAssets: String(snapshot.totalAssets),
      totalLiabilities: String(snapshot.totalLiabilities),
      note: snapshot.note ?? "",
    });
  };

  const saveEdit = () =>
    startTransition(async () => {
      if (!editing) return;
      const result = await editSnapshot(editing.id, {
        totalAssets: Number(form.totalAssets),
        totalLiabilities: Number(form.totalLiabilities),
        note: form.note || null,
      });
      if (!result.success) {
        toast.error("Update failed", { description: result.error });
        return;
      }
      toast.success("Snapshot updated");
      setEditing(null);
      router.refresh();
    });

  const remove = (id: string) =>
    startTransition(async () => {
      if (!window.confirm("Delete this month's snapshot?")) return;
      const result = await deleteSnapshot(id);
      if (!result.success) {
        toast.error("Delete failed", { description: result.error });
        return;
      }
      toast.success("Snapshot deleted");
      router.refresh();
    });

  return (
    <div className="flex flex-col gap-6">
      {/* Actions */}
      <section className="panel flex flex-wrap items-center gap-4 p-5">
        <button type="button" onClick={capture} disabled={pending} className="btn-brand px-5">
          <CalendarClock className="h-4 w-4" /> {pending ? "Working…" : "Capture this month"}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept=".csv,.tsv,.txt,.xlsx,.xls"
          className="hidden"
          onChange={(event) => void chooseFile(event.target.files?.[0])}
        />
        <button type="button" onClick={() => inputRef.current?.click()} disabled={parsing} className="ghost-btn h-10 px-4">
          <Upload className="h-4 w-4" /> {parsing ? "Reading…" : "Import monthly sheet (CSV/XLSX)"}
        </button>
        <p className="text-xs text-gray-500">
          Auto-captured on the 1st of each month. Import backfills history; editing corrects a bad month.
        </p>
      </section>

      {/* Import preview */}
      {(error || preview.length > 0) && (
        <section className="panel p-5">
          {error ? (
            <div className="flex items-center gap-2 text-sm text-red-400"><XCircle className="h-5 w-5" /> {error}</div>
          ) : (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-green-500" />
                <p className="text-sm font-semibold text-gray-100">{preview.length} months recognized</p>
                <span className="pill ml-auto">{fileName}</span>
              </div>
              <div className="max-h-56 overflow-auto rounded-lg border border-gray-600">
                <table className="w-full text-left text-xs">
                  <thead className="sticky top-0 bg-gray-800 text-gray-500">
                    <tr><th className="p-2">Month</th><th className="p-2 text-right">Assets</th><th className="p-2 text-right">Liabilities</th><th className="p-2 text-right">Net worth</th></tr>
                  </thead>
                  <tbody>
                    {preview.map((row) => (
                      <tr key={row.periodKey} className="border-t border-gray-600">
                        <td className="p-2 text-gray-400">{row.periodKey}</td>
                        <td className="p-2 text-right text-gray-200 tnum">{formatINRCompact(row.totalAssets)}</td>
                        <td className="p-2 text-right text-red-400 tnum">{formatINRCompact(row.totalLiabilities)}</td>
                        <td className="p-2 text-right font-semibold text-gray-100 tnum">{formatINRCompact(row.netWorth)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <button type="button" onClick={runImport} disabled={pending} className="btn-brand ml-auto px-5">
                {pending ? "Importing…" : `Import ${preview.length} months`}
              </button>
            </div>
          )}
        </section>
      )}

      {/* Existing snapshots */}
      {snapshots.length === 0 ? (
        <div className="panel flex flex-col items-center justify-center gap-2 py-16 text-center">
          <p className="text-base font-semibold text-gray-100">No history yet</p>
          <p className="max-w-sm text-sm text-gray-500">Capture this month or import your monthly sheet to start the timeline.</p>
        </div>
      ) : (
        <div className="panel overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-gray-600 text-xs text-gray-500">
                <tr>
                  <th className="p-3">Month</th>
                  <th className="p-3 text-right">Net worth</th>
                  <th className="p-3 text-right">Assets</th>
                  <th className="p-3 text-right">Liabilities</th>
                  <th className="p-3 text-right">Market Δ</th>
                  <th className="p-3 text-center">Source</th>
                  <th className="p-3" />
                </tr>
              </thead>
              <tbody>
                {[...snapshots].reverse().map((s) => (
                  <tr key={s.id} className="border-b border-gray-700/60">
                    <td className="p-3 font-medium text-gray-200">{s.periodKey}</td>
                    <td className="p-3 text-right font-semibold text-gray-100 tnum">{formatINRCompact(s.netWorth)}</td>
                    <td className="p-3 text-right text-gray-300 tnum">{formatINRCompact(s.totalAssets)}</td>
                    <td className="p-3 text-right text-red-400 tnum">{formatINRCompact(s.totalLiabilities)}</td>
                    <td className={`p-3 text-right tnum ${s.marketMovement >= 0 ? "text-green-500" : "text-red-500"}`}>
                      {formatSignedINRCompact(s.marketMovement)}
                    </td>
                    <td className="p-3 text-center"><span className="pill text-[10px]">{s.source}</span></td>
                    <td className="p-3">
                      <div className="flex justify-end gap-1">
                        <button onClick={() => openEdit(s)} className="flex h-8 w-8 items-center justify-center rounded-lg border border-gray-600 text-gray-400 hover:text-brand-500" aria-label="Edit"><Pencil className="h-3.5 w-3.5" /></button>
                        <button onClick={() => remove(s.id)} disabled={pending} className="flex h-8 w-8 items-center justify-center rounded-lg border border-gray-600 text-gray-400 hover:text-red-500 disabled:opacity-50" aria-label="Delete"><Trash2 className="h-3.5 w-3.5" /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="border-gray-600 bg-gray-800 text-gray-400">
          <DialogHeader>
            <DialogTitle className="text-gray-100">Correct {editing?.periodKey}</DialogTitle>
            <DialogDescription>Adjust a month with misleading or wrong values. Net worth is recomputed as assets − liabilities.</DialogDescription>
          </DialogHeader>
          <div className="mt-1 grid gap-4">
            <div>
              <label className="form-label">Total assets</label>
              <input type="number" inputMode="decimal" value={form.totalAssets} onChange={(e) => setForm((f) => ({ ...f, totalAssets: e.target.value }))} className="form-input mt-1.5 w-full" />
            </div>
            <div>
              <label className="form-label">Total liabilities</label>
              <input type="number" inputMode="decimal" value={form.totalLiabilities} onChange={(e) => setForm((f) => ({ ...f, totalLiabilities: e.target.value }))} className="form-input mt-1.5 w-full" />
            </div>
            <div>
              <label className="form-label">Note (optional)</label>
              <input type="text" value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} className="form-input mt-1.5 w-full" placeholder="Why this was corrected" />
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setEditing(null)} className="ghost-btn h-11 px-5">Cancel</button>
              <button type="button" onClick={saveEdit} disabled={pending} className="btn-brand px-6">{pending ? "Saving…" : "Save"}</button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

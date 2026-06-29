"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Upload, LockKeyhole, FileSpreadsheet } from "lucide-react";
import { toast } from "sonner";
import { importBrokerHoldings } from "@/features/investments/investment.actions";

/**
 * Imports a broker holdings export (INDmoney / Groww / Zerodha · CSV/XLSX/PDF)
 * and upserts by symbol, so re-importing refreshes quantities/prices instead of
 * creating duplicates.
 */
export default function HoldingsImporter() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [password, setPassword] = useState("");
  const [pending, startTransition] = useTransition();

  const onFile = (file?: File) => {
    if (!file) return;
    startTransition(async () => {
      const form = new FormData();
      form.set("file", file);
      form.set("password", password);
      const result = await importBrokerHoldings(form);
      if (inputRef.current) inputRef.current.value = "";
      if (!result.success) {
        toast.error("Import failed", { description: result.error });
        return;
      }
      toast.success(`${result.inserted} added · ${result.updated} updated`, {
        description: result.rejected ? `${result.rejected} rows skipped.` : "Holdings synced from your broker export.",
      });
      setPassword("");
      router.refresh();
    });
  };

  return (
    <section className="panel overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-gray-600 p-5">
        <div>
          <div className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5 text-yellow-500" />
            <h2 className="font-semibold text-gray-100">Import holdings</h2>
            <span className="pill pill-brand">INDmoney · Groww · Zerodha</span>
          </div>
          <p className="mt-1 text-sm text-gray-500">Upload a holdings export (CSV, XLSX or PDF). Matched by symbol — re-imports just refresh quantities &amp; prices.</p>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-green-500"><LockKeyhole className="h-3.5 w-3.5" /> Stored privately</div>
      </div>
      <div className="grid gap-4 p-5 sm:grid-cols-[auto_1fr] sm:items-end">
        <input ref={inputRef} className="hidden" type="file" accept=".csv,.tsv,.txt,.xlsx,.xls,.pdf" onChange={(event) => onFile(event.target.files?.[0])} />
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={pending}
          className="yellow-btn h-11 w-full shrink-0 justify-center whitespace-nowrap px-5 sm:w-auto"
        >
          <Upload className="h-4 w-4" /> {pending ? "Importing…" : "Choose holdings file"}
        </button>
        <div className="min-w-0">
          <label className="form-label text-xs">PDF password (optional)</label>
          <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Only for protected PDFs" className="form-input mt-1.5 w-full" />
        </div>
      </div>
    </section>
  );
}

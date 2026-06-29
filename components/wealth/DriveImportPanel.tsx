"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CloudDownload, Check, X } from "lucide-react";
import { toast } from "sonner";
import { runDriveImportNow, type DriveImportStatus } from "@/features/imports/drive-import.actions";

export default function DriveImportPanel({ status }: { status: DriveImportStatus }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [runs, setRuns] = useState(status.runs);

  const runNow = () =>
    startTransition(async () => {
      const result = await runDriveImportNow();
      if (!result.success) {
        toast.error("Drive import failed", { description: result.error });
        return;
      }
      if (!result.configured) {
        toast.message("Drive not configured", { description: result.message });
        return;
      }
      toast.success(`Imported ${result.filesImported} file(s)`, {
        description: `${result.tradesBooked} trades booked · ${result.filesSkipped} already processed · ${result.errors} errors.`,
      });
      router.refresh();
    });

  return (
    <section className="cockpit-panel flex flex-col gap-4 p-6">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="icon-chip"><CloudDownload className="h-5 w-5" /></span>
          <div>
            <h2 className="text-base font-semibold text-gray-100">Drive auto-import</h2>
            <p className="text-xs text-gray-500">
              Drop purchase PDFs (e.g. <code className="text-yellow-600">stock_zerodha_2026-06.pdf</code>) in the shared folder; they&apos;re parsed into trades on a schedule.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${status.configured ? "bg-green-500/20 text-green-400" : "bg-gray-800 text-gray-500"}`}>
            {status.configured ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
            {status.configured ? "Configured" : "Not set"}
          </span>
          <button onClick={runNow} disabled={pending} className="rounded-md border border-yellow-600 bg-yellow-500/10 px-3 py-1.5 text-xs font-semibold text-yellow-400 hover:bg-yellow-500/20 disabled:opacity-50">
            {pending ? "Running…" : "Run now"}
          </button>
        </div>
      </div>

      {!status.configured && (
        <p className="text-xs text-gray-500">
          Set <code className="text-yellow-600">GOOGLE_SERVICE_ACCOUNT_JSON</code>,{" "}
          <code className="text-yellow-600">DRIVE_FOLDER_ID</code> and{" "}
          <code className="text-yellow-600">DRIVE_IMPORT_USER_ID</code>, then share the folder with the service-account email.
        </p>
      )}

      {runs.length > 0 && (
        <div className="max-h-56 overflow-auto rounded-lg border border-gray-700">
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 bg-gray-800 text-gray-500">
              <tr><th className="p-2">File</th><th className="p-2">Status</th><th className="p-2 text-right">Trades</th><th className="p-2">When</th></tr>
            </thead>
            <tbody>
              {runs.map((r, i) => (
                <tr key={i} className="border-t border-gray-700">
                  <td className="max-w-48 truncate p-2 text-gray-300">{r.fileName}</td>
                  <td className={`p-2 font-medium ${r.status === "IMPORTED" ? "text-green-500" : r.status === "ERROR" ? "text-red-400" : "text-gray-400"}`}>{r.status}</td>
                  <td className="p-2 text-right text-gray-200 tnum">{r.tradesBooked}</td>
                  <td className="whitespace-nowrap p-2 text-gray-500">{new Date(r.ranAt).toLocaleString("en-IN")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Receipt } from "lucide-react";
import { saveTaxSettings } from "@/features/tax/tax.actions";
import type { TaxSettings } from "@/features/tax/tax.settings.service";

const FIELDS: { key: keyof TaxSettings; label: string; suffix: string; step?: string }[] = [
  { key: "equityStcgPercent", label: "Equity STCG rate", suffix: "%", step: "0.5" },
  { key: "equityLtcgPercent", label: "Equity LTCG rate", suffix: "%", step: "0.5" },
  { key: "equityLtcgThresholdDays", label: "Equity LTCG after", suffix: "days" },
  { key: "cryptoRatePercent", label: "Crypto flat rate", suffix: "%", step: "0.5" },
  { key: "goldLtcgPercent", label: "Gold LTCG rate", suffix: "%", step: "0.5" },
  { key: "goldLtcgThresholdDays", label: "Gold LTCG after", suffix: "days" },
  { key: "slabPercent", label: "Income slab rate (debt/short-term gold)", suffix: "%", step: "0.5" },
  { key: "ltcgExemption", label: "Annual LTCG exemption", suffix: "₹" },
];

export default function TaxSettingsForm({ settings }: { settings: TaxSettings }) {
  const [values, setValues] = useState<TaxSettings>(settings);
  const [isPending, startTransition] = useTransition();

  const set = (key: keyof TaxSettings, raw: string) =>
    setValues((v) => ({ ...v, [key]: Number(raw) || 0 }));

  const save = () =>
    startTransition(async () => {
      const result = await saveTaxSettings(values);
      if (result.success) toast.success("Tax settings saved.", { description: "Net P&L recalculated." });
      else toast.error(result.error ?? "Failed to save.");
    });

  return (
    <section className="panel flex flex-col gap-4 p-6">
      <div className="flex items-center gap-3">
        <span className="icon-chip">
          <Receipt className="h-5 w-5" />
        </span>
        <div>
          <h2 className="text-base font-semibold text-gray-100">Tax settings</h2>
          <p className="text-xs text-gray-500">
            Used to estimate net realized/unrealized profit. Editable estimates for planning —
            <strong> not tax advice</strong>.
          </p>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {FIELDS.map((f) => (
          <div key={f.key}>
            <label className="form-label text-xs">{f.label} ({f.suffix})</label>
            <input
              type="number"
              inputMode="decimal"
              step={f.step ?? "1"}
              value={String(values[f.key])}
              onChange={(e) => set(f.key, e.target.value)}
              className="form-input mt-1.5 w-full"
              suppressHydrationWarning
            />
          </div>
        ))}
      </div>
      <button
        onClick={save}
        disabled={isPending}
        className="self-start rounded-md border border-brand-600 bg-brand-500/10 px-5 py-2.5 text-sm font-semibold text-brand-400 transition-colors hover:bg-brand-500/20 disabled:opacity-50"
        suppressHydrationWarning
      >
        {isPending ? "Saving…" : "Save tax settings"}
      </button>
    </section>
  );
}

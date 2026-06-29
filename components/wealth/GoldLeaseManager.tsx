"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Coins, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { createGoldLease, deleteGoldLease } from "@/features/gold-lease/gold-lease.actions";
import type { GoldLease } from "@/features/gold-lease/gold-lease.types";
import { formatINR } from "@/lib/utils";

const EMPTY = { name: "", leasedGrams: "", annualRatePercent: "", startDate: "", termMonths: "" };

const grams = (n: number) => `${n.toFixed(4)} g`;

export default function GoldLeaseManager({ leases }: { leases: GoldLease[] }) {
  const router = useRouter();
  const [values, setValues] = useState({ ...EMPTY });
  const [pending, startTransition] = useTransition();
  const set = (k: keyof typeof EMPTY, v: string) => setValues((s) => ({ ...s, [k]: v }));

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    startTransition(async () => {
      const result = await createGoldLease({
        name: values.name.trim(),
        leasedGrams: Number(values.leasedGrams) || 0,
        annualRatePercent: Number(values.annualRatePercent) || 0,
        startDate: values.startDate || new Date().toISOString().slice(0, 10),
        termMonths: values.termMonths ? Number(values.termMonths) : null,
      });
      if (!result.success) {
        toast.error("Couldn't create lease", { description: result.error });
        return;
      }
      toast.success("Gold lease added", { description: "Monthly yield accrues in grams." });
      setValues({ ...EMPTY });
      router.refresh();
    });
  };

  const onDelete = (lease: GoldLease) =>
    startTransition(async () => {
      const result = await deleteGoldLease(lease.id);
      if (!result.success) {
        toast.error("Couldn't delete lease", { description: result.error });
        return;
      }
      toast.success("Lease removed");
      router.refresh();
    });

  const totalValue = leases.reduce((s, l) => s + l.valueInr, 0);

  return (
    <section className="panel overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-gray-600 p-5">
        <div>
          <div className="flex items-center gap-2">
            <Coins className="h-5 w-5 text-yellow-500" />
            <h2 className="font-semibold text-gray-100">Gold lease</h2>
            <span className="pill pill-brand">Earns grams</span>
          </div>
          <p className="mt-1 text-sm text-gray-500">
            Lease gold and earn an annual yield paid in additional grams. Accrues monthly; valued live.
          </p>
        </div>
        {leases.length > 0 && (
          <div className="text-right">
            <p className="text-xs text-gray-500">Leased gold value</p>
            <p className="text-lg font-bold text-gray-100 tnum">{formatINR(totalValue)}</p>
          </div>
        )}
      </div>

      <form onSubmit={submit} className="grid gap-3 p-5 sm:grid-cols-2 lg:grid-cols-5">
        <div className="lg:col-span-1">
          <label className="form-label text-xs">Name</label>
          <input value={values.name} onChange={(e) => set("name", e.target.value)} required placeholder="SafeGold lease" className="form-input mt-1.5 w-full" />
        </div>
        <div>
          <label className="form-label text-xs">Leased (grams)</label>
          <input type="number" inputMode="decimal" step="0.0001" value={values.leasedGrams} onChange={(e) => set("leasedGrams", e.target.value)} required placeholder="10" className="form-input mt-1.5 w-full" />
        </div>
        <div>
          <label className="form-label text-xs">Annual rate (%)</label>
          <input type="number" inputMode="decimal" step="0.01" value={values.annualRatePercent} onChange={(e) => set("annualRatePercent", e.target.value)} required placeholder="4" className="form-input mt-1.5 w-full" />
        </div>
        <div>
          <label className="form-label text-xs">Start date</label>
          <input type="date" value={values.startDate} onChange={(e) => set("startDate", e.target.value)} className="form-input mt-1.5 w-full" />
        </div>
        <div>
          <label className="form-label text-xs">Term (months, optional)</label>
          <input type="number" inputMode="numeric" step="1" value={values.termMonths} onChange={(e) => set("termMonths", e.target.value)} placeholder="12" className="form-input mt-1.5 w-full" />
        </div>
        <div className="sm:col-span-2 lg:col-span-5 flex justify-end">
          <button type="submit" disabled={pending} className="yellow-btn px-6">{pending ? "Saving…" : "Add lease"}</button>
        </div>
      </form>

      {leases.length > 0 && (
        <div className="border-t border-gray-600 p-5">
          <div className="grid gap-2">
            {leases.map((lease) => (
              <div key={lease.id} className="flex flex-wrap items-center gap-3 rounded-xl bg-gray-700/40 p-3">
                <span className="icon-chip h-9 w-9"><Coins className="h-4 w-4" /></span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-gray-200">
                    {lease.name} {lease.status === "CLOSED" && <span className="pill ml-1">Closed</span>}
                  </p>
                  <p className="text-[11px] text-gray-500">
                    {grams(lease.leasedGrams)} leased · {lease.annualRatePercent}% p.a. · +{grams(lease.accruedGrams)} earned
                  </p>
                </div>
                <div className="ml-auto text-right">
                  <p className="text-sm font-bold text-gray-100 tnum">{formatINR(lease.valueInr)}</p>
                  <p className="text-[11px] text-gray-500 tnum">{grams(lease.totalGrams)} total</p>
                </div>
                <button type="button" onClick={() => onDelete(lease)} disabled={pending} className="text-gray-500 hover:text-red-400" aria-label="Delete lease">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

"use client";

import { CreditCard } from "lucide-react";
import WealthManager, { type WealthField } from "@/components/wealth/WealthManager";
import {
  createLiability,
  updateLiability,
  deleteLiability,
} from "@/features/liabilities/liability.actions";
import {
  LIABILITY_TYPE_LABELS,
  type Liability,
  type LiabilityType,
} from "@/features/liabilities/liability.types";
import { formatINRCompact } from "@/lib/utils";

const fields: WealthField[] = [
  { name: "name", label: "Name", type: "text", required: true, placeholder: "Home loan", half: true },
  { name: "lender", label: "Lender", type: "text", placeholder: "HDFC Bank", half: true },
  {
    name: "type",
    label: "Type",
    type: "select",
    half: true,
    options: Object.entries(LIABILITY_TYPE_LABELS).map(([value, label]) => ({ value, label })),
  },
  { name: "outstanding", label: "Outstanding", type: "number", prefix: "₹", step: "0.01", required: true, half: true },
  { name: "emi", label: "Monthly EMI (optional)", type: "number", prefix: "₹", step: "0.01", half: true },
  { name: "interestRate", label: "Interest rate % (optional)", type: "number", step: "0.01", half: true },
];

const numOrNull = (v: string) => (v.trim() === "" ? null : Number(v) || 0);

export default function LiabilitiesManager({ items }: { items: Liability[] }) {
  return (
    <WealthManager<Liability>
      items={items}
      fields={fields}
      addLabel="Add liability"
      dialogTitle="liability"
      emptyTitle="No liabilities yet"
      emptyDescription="Add loans and credit-card balances so your net worth reflects what you owe."
      toValues={(l) => ({
        name: l.name,
        lender: l.lender,
        type: l.type,
        outstanding: String(l.outstanding),
        emi: l.emi != null ? String(l.emi) : "",
        interestRate: l.interestRate != null ? String(l.interestRate) : "",
      })}
      onCreate={(v) =>
        createLiability({
          name: v.name,
          lender: v.lender,
          type: v.type as LiabilityType,
          outstanding: Number(v.outstanding) || 0,
          emi: numOrNull(v.emi),
          interestRate: numOrNull(v.interestRate),
        })
      }
      onUpdate={(id, v) =>
        updateLiability(id, {
          name: v.name,
          lender: v.lender,
          type: v.type as LiabilityType,
          outstanding: Number(v.outstanding) || 0,
          emi: numOrNull(v.emi),
          interestRate: numOrNull(v.interestRate),
        })
      }
      onDelete={deleteLiability}
      renderRow={(l) => (
        <div className="flex items-center gap-3">
          <span className="icon-chip">
            <CreditCard className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-gray-100">{l.name}</p>
            <p className="truncate text-xs text-gray-500">
              {l.lender || LIABILITY_TYPE_LABELS[l.type]}
              {l.emi ? ` · EMI ${formatINRCompact(l.emi)}` : ""}
              {l.interestRate ? ` · ${l.interestRate}%` : ""}
            </p>
          </div>
          <p className="ml-auto pr-2 text-sm font-bold text-red-500 tnum">
            −{formatINRCompact(l.outstanding)}
          </p>
        </div>
      )}
    />
  );
}

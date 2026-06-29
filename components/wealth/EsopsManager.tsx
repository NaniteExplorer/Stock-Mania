"use client";

import { Building2 } from "lucide-react";
import WealthManager, { type WealthField } from "@/components/wealth/WealthManager";
import { createEsop, updateEsop, deleteEsop } from "@/features/esops/esop.actions";
import type { EsopGrant } from "@/features/esops/esop.types";
import { formatINRCompact } from "@/lib/utils";

const fields: WealthField[] = [
  { name: "company", label: "Company", type: "text", required: true, placeholder: "Acme Inc.", half: true },
  { name: "grantDate", label: "Grant date", type: "date", required: true, half: true },
  { name: "totalOptions", label: "Total options", type: "number", required: true, half: true },
  { name: "vestedOptions", label: "Vested options", type: "number", required: true, half: true },
  { name: "strikePrice", label: "Strike price", type: "number", prefix: "₹", step: "0.01", required: true, half: true },
  { name: "currentFmv", label: "Current FMV / share", type: "number", prefix: "₹", step: "0.01", required: true, half: true },
];

const toISODate = (d: Date) => new Date(d).toISOString().slice(0, 10);

export default function EsopsManager({ items }: { items: EsopGrant[] }) {
  return (
    <WealthManager<EsopGrant>
      items={items}
      fields={fields}
      addLabel="Add grant"
      dialogTitle="ESOP grant"
      emptyTitle="No ESOP grants yet"
      emptyDescription="Add your equity grants to see the in-the-money value of your vested options."
      toValues={(g) => ({
        company: g.company,
        grantDate: toISODate(g.grantDate),
        totalOptions: String(g.totalOptions),
        vestedOptions: String(g.vestedOptions),
        strikePrice: String(g.strikePrice),
        currentFmv: String(g.currentFmv),
      })}
      onCreate={(v) =>
        createEsop({
          company: v.company,
          grantDate: v.grantDate,
          totalOptions: Number(v.totalOptions) || 0,
          vestedOptions: Number(v.vestedOptions) || 0,
          strikePrice: Number(v.strikePrice) || 0,
          currentFmv: Number(v.currentFmv) || 0,
        })
      }
      onUpdate={(id, v) =>
        updateEsop(id, {
          company: v.company,
          grantDate: v.grantDate,
          totalOptions: Number(v.totalOptions) || 0,
          vestedOptions: Number(v.vestedOptions) || 0,
          strikePrice: Number(v.strikePrice) || 0,
          currentFmv: Number(v.currentFmv) || 0,
        })
      }
      onDelete={deleteEsop}
      renderRow={(g) => (
        <div className="flex items-center gap-3">
          <span className="icon-chip">
            <Building2 className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-gray-100">{g.company}</p>
            <p className="truncate text-xs text-gray-500">
              {g.vestedOptions.toLocaleString("en-IN")} / {g.totalOptions.toLocaleString("en-IN")} vested ·{" "}
              {g.vestedPercent.toFixed(0)}%
            </p>
          </div>
          <div className="ml-auto pr-2 text-right">
            <p className="text-sm font-bold text-gray-100 tnum">{formatINRCompact(g.vestedValue)}</p>
            <p className="text-xs text-gray-500">vested value</p>
          </div>
        </div>
      )}
    />
  );
}

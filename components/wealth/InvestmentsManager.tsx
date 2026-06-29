"use client";

import { LineChart } from "lucide-react";
import WealthManager, { type WealthField } from "@/components/wealth/WealthManager";
import {
  createInvestment,
  updateInvestment,
  deleteInvestment,
} from "@/features/investments/investment.actions";
import {
  INVESTMENT_KIND_LABELS,
  type Investment,
  type InvestmentKind,
} from "@/features/investments/investment.types";
import { formatINRCompact, formatSignedPercent } from "@/lib/utils";

const fields: WealthField[] = [
  { name: "name", label: "Name", type: "text", required: true, placeholder: "Nippon Nifty 50 ETF", half: true },
  { name: "symbol", label: "Symbol", type: "text", placeholder: "NIFTYBEES", half: true },
  {
    name: "kind",
    label: "Type",
    type: "select",
    half: true,
    options: Object.entries(INVESTMENT_KIND_LABELS).map(([value, label]) => ({ value, label })),
  },
  { name: "units", label: "Units", type: "number", step: "0.0001", required: true, half: true },
  { name: "avgCost", label: "Avg cost / unit", type: "number", prefix: "₹", step: "0.01", required: true, half: true },
  { name: "currentPrice", label: "Current price / unit", type: "number", prefix: "₹", step: "0.01", required: true, half: true },
];

export default function InvestmentsManager({ items }: { items: Investment[] }) {
  return (
    <WealthManager<Investment>
      items={items}
      fields={fields}
      addLabel="Add investment"
      dialogTitle="investment"
      emptyTitle="No investments yet"
      emptyDescription="Add stocks, ETFs, mutual funds and more to track value and returns."
      toValues={(i) => ({
        name: i.name,
        symbol: i.symbol ?? "",
        kind: i.kind,
        units: String(i.units),
        avgCost: String(i.avgCost),
        currentPrice: String(i.currentPrice),
      })}
      onCreate={(v) =>
        createInvestment({
          name: v.name,
          symbol: v.symbol || null,
          kind: v.kind as InvestmentKind,
          units: Number(v.units) || 0,
          avgCost: Number(v.avgCost) || 0,
          currentPrice: Number(v.currentPrice) || 0,
        })
      }
      onUpdate={(id, v) =>
        updateInvestment(id, {
          name: v.name,
          symbol: v.symbol || null,
          kind: v.kind as InvestmentKind,
          units: Number(v.units) || 0,
          avgCost: Number(v.avgCost) || 0,
          currentPrice: Number(v.currentPrice) || 0,
        })
      }
      onDelete={deleteInvestment}
      renderRow={(i) => {
        const up = i.pnl >= 0;
        return (
          <div className="flex items-center gap-3">
            <span className="icon-chip">
              <LineChart className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-gray-100">
                {i.symbol || i.name}
              </p>
              <p className="truncate text-xs text-gray-500">
                {i.name} · {INVESTMENT_KIND_LABELS[i.kind]} · {i.units} units
              </p>
            </div>
            <div className="ml-auto pr-2 text-right">
              <p className="text-sm font-bold text-gray-100 tnum">
                {formatINRCompact(i.currentValue)}
              </p>
              <p className={`text-xs font-semibold tnum ${up ? "text-green-500" : "text-red-500"}`}>
                {formatSignedPercent(i.pnlPercent)}
              </p>
            </div>
          </div>
        );
      }}
    />
  );
}

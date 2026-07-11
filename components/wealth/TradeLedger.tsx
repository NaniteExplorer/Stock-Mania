"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowDownLeft, ArrowUpRight, Receipt, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { addTrade, deleteTrade } from "@/features/trades/trade.actions";
import { INVESTMENT_KIND_LABELS, type InvestmentKind } from "@/features/investments/investment.types";
import type { Trade, TradeSide } from "@/features/trades/trade.types";
import { formatINR } from "@/lib/utils";

const EMPTY = {
  side: "BUY" as TradeSide,
  name: "",
  symbol: "",
  kind: "STOCK" as InvestmentKind,
  date: "",
  quantity: "",
  pricePerUnit: "",
  charges: "",
};

export default function TradeLedger({ trades }: { trades: Trade[] }) {
  const router = useRouter();
  const [values, setValues] = useState({ ...EMPTY });
  const [pending, startTransition] = useTransition();
  const set = (key: keyof typeof EMPTY, value: string) => setValues((v) => ({ ...v, [key]: value }));

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    startTransition(async () => {
      const result = await addTrade({
        side: values.side,
        name: values.name.trim(),
        symbol: values.symbol.trim() || null,
        kind: values.kind,
        date: values.date || new Date().toISOString().slice(0, 10),
        quantity: Number(values.quantity) || 0,
        pricePerUnit: Number(values.pricePerUnit) || 0,
        charges: { other: Number(values.charges) || 0 },
        source: "MANUAL",
      });
      if (!result.success) {
        toast.error("Couldn't record trade", { description: result.error });
        return;
      }
      toast.success(`${values.side === "BUY" ? "Buy" : "Sell"} recorded`, {
        description: "Position and realized P&L recalculated.",
      });
      setValues({ ...EMPTY });
      router.refresh();
    });
  };

  const onDelete = (trade: Trade) =>
    startTransition(async () => {
      const result = await deleteTrade(trade.id, trade.symbol, trade.name, trade.kind);
      if (!result.success) {
        toast.error("Couldn't delete trade", { description: result.error });
        return;
      }
      toast.success("Trade removed", { description: "Position recalculated." });
      router.refresh();
    });

  return (
    <section className="panel overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-gray-600 p-5">
        <div>
          <div className="flex items-center gap-2">
            <Receipt className="h-5 w-5 text-brand-500" />
            <h2 className="font-semibold text-gray-100">Trade ledger</h2>
            <span className="pill pill-brand">FIFO</span>
          </div>
          <p className="mt-1 text-sm text-gray-500">
            Record buys &amp; sells with charges. Positions, holding period and realized P&amp;L are computed from the ledger.
          </p>
        </div>
      </div>

      <form onSubmit={submit} className="grid gap-3 p-5 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <label className="form-label text-xs">Side</label>
          <select value={values.side} onChange={(e) => set("side", e.target.value)} className="select-trigger mt-1.5">
            <option value="BUY">Buy</option>
            <option value="SELL">Sell</option>
          </select>
        </div>
        <div>
          <label className="form-label text-xs">Type</label>
          <select value={values.kind} onChange={(e) => set("kind", e.target.value)} className="select-trigger mt-1.5">
            {Object.entries(INVESTMENT_KIND_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="form-label text-xs">Name</label>
          <input value={values.name} onChange={(e) => set("name", e.target.value)} required placeholder="Reliance Industries" className="form-input mt-1.5 w-full" />
        </div>
        <div>
          <label className="form-label text-xs">Symbol</label>
          <input value={values.symbol} onChange={(e) => set("symbol", e.target.value)} placeholder="RELIANCE" className="form-input mt-1.5 w-full" />
        </div>
        <div>
          <label className="form-label text-xs">Date</label>
          <input type="date" value={values.date} onChange={(e) => set("date", e.target.value)} className="form-input mt-1.5 w-full" />
        </div>
        <div>
          <label className="form-label text-xs">Quantity</label>
          <input type="number" inputMode="decimal" step="0.0001" value={values.quantity} onChange={(e) => set("quantity", e.target.value)} required placeholder="10" className="form-input mt-1.5 w-full" />
        </div>
        <div>
          <label className="form-label text-xs">Price / unit</label>
          <input type="number" inputMode="decimal" step="0.01" value={values.pricePerUnit} onChange={(e) => set("pricePerUnit", e.target.value)} required placeholder="2900" className="form-input mt-1.5 w-full" />
        </div>
        <div>
          <label className="form-label text-xs">Charges (₹)</label>
          <input type="number" inputMode="decimal" step="0.01" value={values.charges} onChange={(e) => set("charges", e.target.value)} placeholder="20" className="form-input mt-1.5 w-full" />
        </div>
        <div className="sm:col-span-2 lg:col-span-4 flex justify-end">
          <button type="submit" disabled={pending} className="btn-brand px-6">
            {pending ? "Saving…" : "Record trade"}
          </button>
        </div>
      </form>

      {trades.length > 0 && (
        <div className="border-t border-gray-600 p-5">
          <h3 className="mb-3 text-sm font-semibold text-gray-200">Recent trades</h3>
          <div className="max-h-72 overflow-auto rounded-lg border border-gray-600">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 bg-gray-800 text-gray-500">
                <tr>
                  <th className="p-2">Side</th>
                  <th className="p-2">Holding</th>
                  <th className="p-2">Date</th>
                  <th className="p-2 text-right">Qty</th>
                  <th className="p-2 text-right">Price</th>
                  <th className="p-2 text-right">Charges</th>
                  <th className="p-2"></th>
                </tr>
              </thead>
              <tbody>
                {trades.map((trade) => (
                  <tr key={trade.id} className="border-t border-gray-600">
                    <td className="p-2">
                      <span className={`inline-flex items-center gap-1 font-semibold ${trade.side === "BUY" ? "text-green-500" : "text-red-400"}`}>
                        {trade.side === "BUY" ? <ArrowDownLeft className="h-3.5 w-3.5" /> : <ArrowUpRight className="h-3.5 w-3.5" />}
                        {trade.side}
                      </span>
                    </td>
                    <td className="max-w-40 truncate p-2 text-gray-300">{trade.symbol || trade.name}</td>
                    <td className="whitespace-nowrap p-2 text-gray-400">{new Date(trade.date).toLocaleDateString("en-IN")}</td>
                    <td className="p-2 text-right text-gray-200 tnum">{trade.quantity}</td>
                    <td className="p-2 text-right text-gray-200 tnum">{formatINR(trade.pricePerUnit, 2)}</td>
                    <td className="p-2 text-right text-gray-400 tnum">{formatINR(trade.chargesTotal, 2)}</td>
                    <td className="p-2 text-right">
                      <button type="button" onClick={() => onDelete(trade)} disabled={pending} className="text-gray-500 hover:text-red-400" aria-label="Delete trade">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}

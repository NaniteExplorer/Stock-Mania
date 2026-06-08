"use client";

import type { Holding, Position } from "@/features/portfolio/portfolio.types";

function pnlClass(v: number) {
  return v >= 0 ? "text-green-400" : "text-red-400";
}

function fmt(n: number, digits = 2) {
  return n.toLocaleString("en-IN", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

interface HoldingsTableProps {
  holdings: Holding[];
}

export function HoldingsTable({ holdings }: HoldingsTableProps) {
  if (!holdings.length) {
    return (
      <p className="py-8 text-center text-sm text-gray-500">
        No holdings found. Connect Zerodha or Alpaca to see your portfolio.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-gray-700">
      <table className="w-full text-sm">
        <thead className="bg-gray-800/80 text-gray-400">
          <tr>
            {["Symbol", "Qty", "Avg Price", "LTP", "Invested", "Value", "P&L", "Day Change", "Broker"].map((h) => (
              <th key={h} className="px-4 py-3 text-left font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-800">
          {holdings.map((h) => (
            <tr key={`${h.broker}-${h.symbol}`} className="hover:bg-gray-800/40 transition-colors">
              <td className="px-4 py-3 font-semibold text-gray-100">{h.symbol}</td>
              <td className="px-4 py-3 text-gray-300">{h.quantity}</td>
              <td className="px-4 py-3 text-gray-300">₹{fmt(h.avgPrice)}</td>
              <td className="px-4 py-3 text-gray-100">₹{fmt(h.currentPrice)}</td>
              <td className="px-4 py-3 text-gray-300">₹{fmt(h.investedValue)}</td>
              <td className="px-4 py-3 text-gray-100">₹{fmt(h.totalValue)}</td>
              <td className={`px-4 py-3 font-medium ${pnlClass(h.pnl)}`}>
                {h.pnl >= 0 ? "+" : ""}₹{fmt(h.pnl)}
                <span className="ml-1 text-xs">
                  ({h.pnlPercent >= 0 ? "+" : ""}{fmt(h.pnlPercent)}%)
                </span>
              </td>
              <td className={`px-4 py-3 ${pnlClass(h.dayChange)}`}>
                {h.dayChange >= 0 ? "+" : ""}{fmt(h.dayChangePercent)}%
              </td>
              <td className="px-4 py-3">
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                  h.broker === "ZERODHA"
                    ? "bg-blue-500/20 text-blue-400"
                    : "bg-purple-500/20 text-purple-400"
                }`}>
                  {h.broker}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface PositionsTableProps {
  positions: Position[];
}

export function PositionsTable({ positions }: PositionsTableProps) {
  if (!positions.length) {
    return (
      <p className="py-6 text-center text-sm text-gray-500">No open positions.</p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-gray-700">
      <table className="w-full text-sm">
        <thead className="bg-gray-800/80 text-gray-400">
          <tr>
            {["Symbol", "Side", "Qty", "Avg Price", "LTP", "Unrealised P&L", "Product"].map((h) => (
              <th key={h} className="px-4 py-3 text-left font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-800">
          {positions.map((p) => (
            <tr key={`${p.broker}-${p.symbol}`} className="hover:bg-gray-800/40 transition-colors">
              <td className="px-4 py-3 font-semibold text-gray-100">{p.symbol}</td>
              <td className={`px-4 py-3 font-medium ${p.side === "LONG" ? "text-green-400" : "text-red-400"}`}>
                {p.side}
              </td>
              <td className="px-4 py-3 text-gray-300">{p.quantity}</td>
              <td className="px-4 py-3 text-gray-300">₹{fmt(p.avgPrice)}</td>
              <td className="px-4 py-3 text-gray-100">₹{fmt(p.currentPrice)}</td>
              <td className={`px-4 py-3 font-medium ${pnlClass(p.unrealised)}`}>
                {p.unrealised >= 0 ? "+" : ""}₹{fmt(p.unrealised)}
              </td>
              <td className="px-4 py-3 text-gray-400">{p.product}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

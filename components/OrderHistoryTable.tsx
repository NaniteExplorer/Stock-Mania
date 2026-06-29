"use client";

import type { TradeOrder } from "@/features/orders/order.types";
import { formatMoney } from "@/lib/utils";

const STATUS_STYLE: Record<TradeOrder["status"], string> = {
  PLACED: "text-blue-400 bg-blue-500/10",
  COMPLETE: "text-green-400 bg-green-500/10",
  PENDING: "text-yellow-400 bg-yellow-500/10",
  REJECTED: "text-red-400 bg-red-500/10",
  CANCELLED: "text-gray-400 bg-gray-800",
};

interface OrderHistoryTableProps {
  orders: TradeOrder[];
}

export default function OrderHistoryTable({ orders }: OrderHistoryTableProps) {
  if (!orders.length) {
    return (
      <p className="py-10 text-center text-sm text-gray-500">
        No orders yet. Place your first trade from any stock page.
      </p>
    );
  }

  return (
    <div className="cockpit-table overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-gray-700/70 text-gray-400">
          <tr>
            {["Symbol", "Exchange", "Side", "Type", "Qty", "Price", "Status", "Broker", "Date"].map((h) => (
              <th key={h} className="px-4 py-3 text-left font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-800">
          {orders.map((o) => (
            <tr key={o.id} className="hover:bg-gray-800/40 transition-colors">
              <td className="px-4 py-3 font-semibold text-gray-100">{o.symbol}</td>
              <td className="px-4 py-3 text-gray-400 text-xs">{o.exchange}</td>
              <td className={`px-4 py-3 font-medium ${o.side === "BUY" ? "text-green-400" : "text-red-400"}`}>
                {o.side}
              </td>
              <td className="px-4 py-3 text-gray-300">{o.orderType}</td>
              <td className="px-4 py-3 text-gray-300">{o.quantity}</td>
              <td className="px-4 py-3 text-gray-300">
                {o.price ? formatMoney(o.price, ["NYSE", "NASDAQ", "ARCA"].includes(o.exchange) ? "USD" : "INR") : "MKT"}
              </td>
              <td className="px-4 py-3">
                <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLE[o.status]}`}>
                  {o.status}
                </span>
              </td>
              <td className="px-4 py-3">
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                  o.broker === "ZERODHA"
                    ? "bg-blue-500/20 text-blue-400"
                    : "bg-purple-500/20 text-purple-400"
                }`}>
                  {o.broker}
                </span>
              </td>
              <td className="px-4 py-3 text-gray-500 text-xs">
                {new Date(o.placedAt).toLocaleDateString("en-IN", {
                  day: "2-digit",
                  month: "short",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

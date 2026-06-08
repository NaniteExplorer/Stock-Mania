"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { createAlert, cancelAlert } from "@/features/alerts/alert.actions";
import type { PriceAlert, AlertType, AlertChannel } from "@/features/alerts/alert.types";
import { Bell, X } from "lucide-react";

interface AlertsPanelProps {
  symbol: string;
  currentPrice?: number;
  initialAlerts: PriceAlert[];
}

export default function AlertsPanel({ symbol, currentPrice, initialAlerts }: AlertsPanelProps) {
  const [alerts, setAlerts] = useState<PriceAlert[]>(initialAlerts);
  const [type, setType] = useState<AlertType>("PRICE_ABOVE");
  const [targetPrice, setTargetPrice] = useState(
    currentPrice ? String((currentPrice * 1.05).toFixed(2)) : "",
  );
  const [channel, setChannel] = useState<AlertChannel>("WHATSAPP");
  const [phone, setPhone] = useState("");
  const [isPending, startTransition] = useTransition();

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    startTransition(async () => {
      const result = await createAlert({
        symbol,
        type,
        targetPrice: parseFloat(targetPrice),
        channel,
        whatsappNumber: channel !== "EMAIL" ? phone : undefined,
      });

      if (result.success) {
        setAlerts((prev) => [result.alert, ...prev]);
        toast.success(`Alert set for ${symbol} at ₹${targetPrice}`);
      } else {
        toast.error(result.error);
      }
    });
  };

  const handleCancel = (id: string) => {
    startTransition(async () => {
      const result = await cancelAlert(id);
      if (result.success) {
        setAlerts((prev) => prev.map((a) => a.id === id ? { ...a, status: "CANCELLED" as const } : a));
        toast.success("Alert cancelled.");
      } else {
        toast.error(result.error ?? "Failed.");
      }
    });
  };

  return (
    <div className="rounded-xl border border-gray-700 bg-gray-800/60 p-5 flex flex-col gap-5">
      <div className="flex items-center gap-2">
        <Bell className="h-4 w-4 text-yellow-400" />
        <h3 className="text-sm font-semibold text-gray-100">Price Alerts</h3>
      </div>

      <form onSubmit={handleCreate} className="flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-2">
          {(["PRICE_ABOVE", "PRICE_BELOW"] as AlertType[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setType(t)}
              className={`rounded-md py-1.5 text-xs font-medium border transition-colors ${
                type === t
                  ? "border-yellow-500 text-yellow-400 bg-yellow-500/10"
                  : "border-gray-700 text-gray-500 hover:border-gray-500"
              }`}
            >
              {t === "PRICE_ABOVE" ? "Price Above" : "Price Below"}
            </button>
          ))}
        </div>

        <label className="flex flex-col gap-1 text-xs text-gray-400">
          Target Price (₹)
          <input
            type="number"
            step="0.05"
            min={0}
            required
            value={targetPrice}
            onChange={(e) => setTargetPrice(e.target.value)}
            className="rounded-md border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-yellow-500"
          />
        </label>

        <div className="grid grid-cols-3 gap-1">
          {(["EMAIL", "WHATSAPP", "BOTH"] as AlertChannel[]).map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setChannel(c)}
              className={`rounded-md py-1 text-xs font-medium border transition-colors ${
                channel === c
                  ? "border-yellow-500 text-yellow-400 bg-yellow-500/10"
                  : "border-gray-700 text-gray-500 hover:border-gray-500"
              }`}
            >
              {c}
            </button>
          ))}
        </div>

        {channel !== "EMAIL" && (
          <label className="flex flex-col gap-1 text-xs text-gray-400">
            WhatsApp Number (+91…)
            <input
              type="tel"
              required
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+919876543210"
              className="rounded-md border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-yellow-500"
            />
          </label>
        )}

        <button
          type="submit"
          disabled={isPending}
          className="rounded-md bg-yellow-500/10 border border-yellow-600 py-2 text-xs font-semibold text-yellow-400 hover:bg-yellow-500/20 transition-colors disabled:opacity-50"
        >
          {isPending ? "Setting…" : "Set Alert"}
        </button>
      </form>

      {alerts.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Your Alerts</p>
          {alerts.map((a) => (
            <div
              key={a.id}
              className={`flex items-center justify-between rounded-lg border px-3 py-2 text-xs ${
                a.status === "ACTIVE"
                  ? "border-gray-700 bg-gray-900/40"
                  : a.status === "TRIGGERED"
                  ? "border-green-800 bg-green-900/20"
                  : "border-gray-800 bg-gray-900/20 opacity-50"
              }`}
            >
              <div className="flex flex-col gap-0.5">
                <span className="text-gray-200">
                  {a.type === "PRICE_ABOVE" ? "▲" : "▼"} ₹{a.targetPrice.toFixed(2)}
                </span>
                <span className="text-gray-500">{a.channel} · {a.status}</span>
              </div>
              {a.status === "ACTIVE" && (
                <button
                  onClick={() => handleCancel(a.id)}
                  disabled={isPending}
                  className="text-gray-600 hover:text-red-400 transition-colors"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

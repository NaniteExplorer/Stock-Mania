"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { createAlert, cancelAlert } from "@/features/alerts/alert.actions";
import type {
  PriceAlert,
  AlertType,
  AlertChannel,
} from "@/features/alerts/alert.types";
import { Bell, X } from "lucide-react";
import { formatMoney } from "@/lib/utils";

interface AlertsPanelProps {
  symbol: string;
  currentPrice?: number;
  initialAlerts: PriceAlert[];
}

export default function AlertsPanel({
  symbol,
  currentPrice,
  initialAlerts,
}: AlertsPanelProps) {
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
        toast.success(`Alert set for ${symbol} at ${formatMoney(Number(targetPrice), "INR")}`);
      } else {
        toast.error(result.error);
      }
    });
  };

  const handleCancel = (id: string) => {
    startTransition(async () => {
      const result = await cancelAlert(id);
      if (result.success) {
        setAlerts((prev) =>
          prev.map((a) =>
            a.id === id ? { ...a, status: "CANCELLED" as const } : a,
          ),
        );
        toast.success("Alert cancelled.");
      } else {
        toast.error(result.error ?? "Failed.");
      }
    });
  };

  return (
    <div className="panel flex flex-col gap-5 p-5">
      <div className="flex items-center gap-2">
        <Bell className="h-4 w-4 text-brand-400" />
        <h3 className="text-sm font-semibold text-gray-100">Price Alerts</h3>
      </div>

      <form onSubmit={handleCreate} className="flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-2">
          {(["PRICE_ABOVE", "PRICE_BELOW"] as AlertType[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setType(t)}
              className={`rounded-md border py-1.5 text-xs font-medium transition-colors ${
                type === t
                  ? "border-brand-500 bg-brand-500/10 text-brand-400"
                  : "border-gray-600 text-gray-500 hover:border-gray-500"
              }`}
            >
              {t === "PRICE_ABOVE" ? "Price Above" : "Price Below"}
            </button>
          ))}
        </div>

        <label className="flex flex-col gap-1 text-xs text-gray-400">
          Target Price (Rs)
          <input
            type="number"
            step="0.05"
            min={0}
            required
            value={targetPrice}
            onChange={(e) => setTargetPrice(e.target.value)}
            className="rounded-md border border-gray-600 bg-gray-900 px-3 py-2 text-sm text-gray-100 focus:border-brand-500 focus:outline-none"
          />
        </label>

        <div className="grid grid-cols-3 gap-1">
          {(["EMAIL", "WHATSAPP", "BOTH"] as AlertChannel[]).map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setChannel(c)}
              className={`rounded-md border py-1 text-xs font-medium transition-colors ${
                channel === c
                  ? "border-brand-500 bg-brand-500/10 text-brand-400"
                  : "border-gray-600 text-gray-500 hover:border-gray-500"
              }`}
            >
              {c}
            </button>
          ))}
        </div>

        {channel !== "EMAIL" && (
          <label className="flex flex-col gap-1 text-xs text-gray-400">
            WhatsApp Number (+91...)
            <input
              type="tel"
              required
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+919876543210"
              className="rounded-md border border-gray-600 bg-gray-900 px-3 py-2 text-sm text-gray-100 focus:border-brand-500 focus:outline-none"
            />
          </label>
        )}

        <button
          type="submit"
          disabled={isPending}
          className="rounded-md border border-brand-600 bg-brand-500/10 py-2 text-xs font-semibold text-brand-400 transition-colors hover:bg-brand-500/20 disabled:opacity-50"
        >
          {isPending ? "Setting..." : "Set Alert"}
        </button>
      </form>

      {alerts.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
            Your Alerts
          </p>
          {alerts.map((a) => (
            <div
              key={a.id}
              className={`flex items-center justify-between rounded-lg border px-3 py-2 text-xs ${
                a.status === "ACTIVE"
                  ? "border-gray-600 bg-gray-900/40"
                  : a.status === "TRIGGERED"
                    ? "border-green-800 bg-green-900/20"
                    : "border-gray-800 bg-gray-900/20 opacity-50"
              }`}
            >
              <div className="flex flex-col gap-0.5">
                <span className="text-gray-200">
                  {a.type === "PRICE_ABOVE" ? "Above" : "Below"} {formatMoney(a.targetPrice, "INR")}
                </span>
                <span className="text-gray-500">
                  {a.channel} / {a.status}
                </span>
              </div>
              {a.status === "ACTIVE" && (
                <button
                  onClick={() => handleCancel(a.id)}
                  disabled={isPending}
                  className="text-gray-600 transition-colors hover:text-red-400"
                  aria-label="Cancel alert"
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

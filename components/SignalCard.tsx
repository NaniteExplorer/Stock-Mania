"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { requestSignal } from "@/features/signals/signal.actions";
import type { TradingSignal } from "@/features/signals/signal.types";

const DIRECTION_STYLES: Record<TradingSignal["direction"], string> = {
  BUY: "bg-green-500/20 text-green-400 border-green-500/40",
  SELL: "bg-red-500/20 text-red-400 border-red-500/40",
  HOLD: "bg-yellow-500/20 text-yellow-400 border-yellow-500/40",
};

const CONFIDENCE_DOTS: Record<TradingSignal["confidence"], number> = {
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
};

interface SignalCardProps {
  signal: TradingSignal;
}

export function SignalCard({ signal }: SignalCardProps) {
  const dots = CONFIDENCE_DOTS[signal.confidence];
  const ageMin = Math.round(
    (Date.now() - new Date(signal.generatedAt).getTime()) / 60_000,
  );

  return (
    <div className="rounded-xl border border-gray-700 bg-gray-800/60 p-5 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-base font-bold text-gray-100">{signal.symbol}</span>
          <span className={`rounded-full border px-2.5 py-0.5 text-xs font-bold ${DIRECTION_STYLES[signal.direction]}`}>
            {signal.direction}
          </span>
        </div>
        <div className="flex gap-1">
          {[1, 2, 3].map((i) => (
            <span
              key={i}
              className={`h-2 w-2 rounded-full ${i <= dots ? "bg-yellow-400" : "bg-gray-700"}`}
            />
          ))}
        </div>
      </div>

      <p className="text-sm text-gray-300 leading-relaxed">{signal.reasoning}</p>

      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="rounded-lg bg-gray-900/60 px-3 py-2">
          <p className="text-gray-500">Entry</p>
          <p className="font-mono text-gray-100">₹{signal.currentPrice.toFixed(2)}</p>
        </div>
        {signal.targetPrice && (
          <div className="rounded-lg bg-gray-900/60 px-3 py-2">
            <p className="text-gray-500">Target</p>
            <p className="font-mono text-green-400">₹{signal.targetPrice.toFixed(2)}</p>
          </div>
        )}
        {signal.stopLoss && (
          <div className="rounded-lg bg-gray-900/60 px-3 py-2">
            <p className="text-gray-500">Stop Loss</p>
            <p className="font-mono text-red-400">₹{signal.stopLoss.toFixed(2)}</p>
          </div>
        )}
        <div className="rounded-lg bg-gray-900/60 px-3 py-2">
          <p className="text-gray-500">Confidence</p>
          <p className="text-gray-100">{signal.confidence}</p>
        </div>
      </div>

      <p className="text-xs text-gray-600">
        Generated {ageMin < 60 ? `${ageMin}m ago` : `${Math.round(ageMin / 60)}h ago`}
        {" · "}Expires {new Date(signal.expiresAt).toLocaleTimeString()}
      </p>
    </div>
  );
}

interface RequestSignalButtonProps {
  symbol: string;
}

export function RequestSignalButton({ symbol }: RequestSignalButtonProps) {
  const [isPending, startTransition] = useTransition();

  const handle = () => {
    startTransition(async () => {
      const result = await requestSignal(symbol);
      if (result.success) {
        toast.success(result.message);
      } else {
        toast.error(result.message);
      }
    });
  };

  return (
    <button
      onClick={handle}
      disabled={isPending}
      className="rounded-md border border-yellow-600 px-3 py-1.5 text-xs font-medium text-yellow-400 hover:bg-yellow-500/10 transition-colors disabled:opacity-50"
    >
      {isPending ? "Queuing…" : "⚡ Get AI Signal"}
    </button>
  );
}

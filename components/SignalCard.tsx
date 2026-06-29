"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { requestSignal } from "@/features/signals/signal.actions";
import type { TradingSignal } from "@/features/signals/signal.types";
import { Sparkles } from "lucide-react";
import { formatMoney } from "@/lib/utils";

const DIRECTION_STYLES: Record<TradingSignal["direction"], string> = {
  BUY: "bg-green-500/15 text-green-400 border-green-500/40",
  SELL: "bg-red-500/15 text-red-400 border-red-500/40",
  HOLD: "bg-yellow-500/15 text-yellow-400 border-yellow-500/40",
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

  return (
    <div className="cockpit-panel flex flex-col gap-3 p-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-base font-bold text-gray-100">
            {signal.symbol}
          </span>
          <span
            className={`rounded-full border px-2.5 py-0.5 text-xs font-bold ${DIRECTION_STYLES[signal.direction]}`}
          >
            {signal.direction}
          </span>
        </div>
        <div className="flex gap-1">
          {[1, 2, 3].map((i) => (
            <span
              key={i}
              className={`h-2 w-2 rounded-full ${
                i <= dots ? "bg-yellow-400" : "bg-gray-700"
              }`}
            />
          ))}
        </div>
      </div>

      <p className="text-sm leading-relaxed text-gray-300">
        {signal.reasoning}
      </p>

      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="rounded-md border border-gray-600 bg-gray-900/60 px-3 py-2">
          <p className="text-gray-500">Entry</p>
          <p className="font-mono text-gray-100">
            {formatMoney(signal.currentPrice, "INR")}
          </p>
        </div>
        {signal.targetPrice && (
          <div className="rounded-md border border-gray-600 bg-gray-900/60 px-3 py-2">
            <p className="text-gray-500">Target</p>
            <p className="font-mono text-green-400">
              {formatMoney(signal.targetPrice, "INR")}
            </p>
          </div>
        )}
        {signal.stopLoss && (
          <div className="rounded-md border border-gray-600 bg-gray-900/60 px-3 py-2">
            <p className="text-gray-500">Stop Loss</p>
            <p className="font-mono text-red-400">
              {formatMoney(signal.stopLoss, "INR")}
            </p>
          </div>
        )}
        <div className="rounded-md border border-gray-600 bg-gray-900/60 px-3 py-2">
          <p className="text-gray-500">Confidence</p>
          <p className="text-gray-100">{signal.confidence}</p>
        </div>
      </div>

      <p className="text-xs text-gray-600">
        Generated {String(signal.generatedAt)} / Expires{" "}
        {String(signal.expiresAt)}
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
      className="inline-flex items-center gap-2 rounded-md border border-yellow-600 px-3 py-1.5 text-xs font-medium text-yellow-400 transition-colors hover:bg-yellow-500/10 disabled:opacity-50"
    >
      <Sparkles className="h-3.5 w-3.5" />
      {isPending ? "Queuing..." : "Get AI Signal"}
    </button>
  );
}

"use client";

import { useState, useTransition } from "react";
import { usePriceStream } from "@/hooks/usePriceStream";
import { placeOrder } from "@/features/orders/order.actions";
import type {
  OrderSide,
  OrderType,
  OrderExchange,
  OrderProduct,
} from "@/features/orders/order.types";
import { toast } from "sonner";

interface TradePanelProps {
  symbol: string;
  exchange?: OrderExchange;
  isZerodhaConnected: boolean;
}

export default function TradePanel({
  symbol,
  exchange = "NSE",
  isZerodhaConnected,
}: TradePanelProps) {
  const { quote, connected } = usePriceStream(symbol);
  const [side, setSide] = useState<OrderSide>("BUY");
  const [orderType, setOrderType] = useState<OrderType>("MARKET");
  const [product, setProduct] = useState<OrderProduct>("CNC");
  const [quantity, setQuantity] = useState(1);
  const [limitPrice, setLimitPrice] = useState<string>("");
  const [isPending, startTransition] = useTransition();

  const estimatedValue =
    quote?.c && quantity > 0 ? (quote.c * quantity).toFixed(2) : null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isZerodhaConnected) {
      toast.error("Connect your Zerodha account first.");
      return;
    }

    startTransition(async () => {
      const result = await placeOrder({
        symbol,
        exchange,
        side,
        orderType,
        product,
        quantity,
        price: orderType === "LIMIT" ? parseFloat(limitPrice) : undefined,
      });

      if (result.success) {
        toast.success(
          `${side} order placed — broker ID ${result.order.brokerId ?? "pending"}`,
        );
      } else {
        toast.error(result.error);
      }
    });
  };

  return (
    <div className="rounded-xl border border-gray-700 bg-gray-800/60 p-5 flex flex-col gap-4">
      {/* Live price header */}
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-gray-400">
          {symbol} · {exchange}
        </span>
        <span className="flex items-center gap-2">
          <span
            className={`h-2 w-2 rounded-full ${connected ? "bg-green-400" : "bg-gray-500"}`}
          />
          {quote ? (
            <span className="font-mono text-base font-semibold text-gray-100">
              ₹{quote.c.toFixed(2)}
              <span
                className={`ml-2 text-xs ${quote.d >= 0 ? "text-green-400" : "text-red-400"}`}
              >
                {quote.d >= 0 ? "+" : ""}
                {quote.dp.toFixed(2)}%
              </span>
            </span>
          ) : (
            <span className="text-xs text-gray-500">Loading…</span>
          )}
        </span>
      </div>

      {/* BUY / SELL toggle */}
      <div className="grid grid-cols-2 rounded-lg overflow-hidden border border-gray-700 text-sm font-semibold">
        {(["BUY", "SELL"] as OrderSide[]).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setSide(s)}
            className={`py-2 transition-colors ${
              side === s
                ? s === "BUY"
                  ? "bg-green-600 text-white"
                  : "bg-red-600 text-white"
                : "bg-transparent text-gray-400 hover:bg-gray-700"
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        {/* Order type */}
        <div className="flex gap-2">
          {(["MARKET", "LIMIT"] as OrderType[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setOrderType(t)}
              className={`flex-1 rounded-md py-1.5 text-xs font-medium border transition-colors ${
                orderType === t
                  ? "border-yellow-500 text-yellow-400 bg-yellow-500/10"
                  : "border-gray-700 text-gray-500 hover:border-gray-500"
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        {/* Product */}
        <div className="flex gap-2">
          {(["CNC", "MIS", "NRML"] as OrderProduct[]).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setProduct(p)}
              className={`flex-1 rounded-md py-1 text-xs font-medium border transition-colors ${
                product === p
                  ? "border-yellow-500 text-yellow-400 bg-yellow-500/10"
                  : "border-gray-700 text-gray-500 hover:border-gray-500"
              }`}
            >
              {p}
            </button>
          ))}
        </div>

        {/* Quantity */}
        <label className="flex flex-col gap-1 text-xs text-gray-400">
          Quantity
          <input
            type="number"
            min={1}
            value={quantity}
            onChange={(e) => setQuantity(Math.max(1, parseInt(e.target.value, 10) || 1))}
            className="rounded-md border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-yellow-500"
          />
        </label>

        {/* Limit price (shown only for LIMIT orders) */}
        {orderType === "LIMIT" && (
          <label className="flex flex-col gap-1 text-xs text-gray-400">
            Limit price (₹)
            <input
              type="number"
              step="0.05"
              min={0}
              value={limitPrice}
              onChange={(e) => setLimitPrice(e.target.value)}
              placeholder={quote ? String(quote.c.toFixed(2)) : "0.00"}
              className="rounded-md border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-yellow-500"
              required
            />
          </label>
        )}

        {estimatedValue && (
          <p className="text-xs text-gray-500">
            Est. value: ₹{estimatedValue}
          </p>
        )}

        {!isZerodhaConnected && (
          <a
            href="/api/zerodha/connect"
            className="text-center rounded-md border border-yellow-600 py-2 text-xs text-yellow-400 hover:bg-yellow-500/10 transition-colors"
          >
            Connect Zerodha to trade
          </a>
        )}

        {isZerodhaConnected && (
          <button
            type="submit"
            disabled={isPending}
            className={`rounded-md py-2.5 text-sm font-semibold transition-colors disabled:opacity-50 ${
              side === "BUY"
                ? "bg-green-600 hover:bg-green-500 text-white"
                : "bg-red-600 hover:bg-red-500 text-white"
            }`}
          >
            {isPending ? "Placing…" : `Place ${side} Order`}
          </button>
        )}
      </form>
    </div>
  );
}

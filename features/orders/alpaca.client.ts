/**
 * Alpaca REST API wrapper for US stock trading.
 * Defaults to paper-api.alpaca.markets for safety.
 * Set ALPACA_LIVE=true + ALPACA_BASE_URL=https://api.alpaca.markets for live trading.
 */
import { config } from "@/core/config/env";
import type { PlaceOrderInput } from "./order.types";
import type { Position } from "@/features/portfolio/portfolio.types";

interface AlpacaOrderResponse {
  id: string;
  symbol: string;
  qty: string;
  side: string;
  type: string;
  status: string;
  limit_price: string | null;
}

interface AlpacaPosition {
  symbol: string;
  qty: string;
  avg_entry_price: string;
  current_price: string;
  unrealized_pl: string;
  unrealized_plpc: string;
  market_value: string;
  cost_basis: string;
  side: string;
}

function getHeaders(): HeadersInit {
  const { apiKey, apiSecret } = config.alpaca();
  if (!apiKey || !apiSecret) throw new Error("Alpaca API credentials not configured.");
  return {
    "APCA-API-KEY-ID": apiKey,
    "APCA-API-SECRET-KEY": apiSecret,
    "Content-Type": "application/json",
  };
}

function baseUrl(): string {
  return config.alpaca().baseUrl;
}

export function isAlpacaConfigured(): boolean {
  const { apiKey, apiSecret } = config.alpaca();
  return Boolean(apiKey && apiSecret);
}

export async function placeAlpacaOrder(input: PlaceOrderInput): Promise<string> {
  const res = await fetch(`${baseUrl()}/v2/orders`, {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify({
      symbol: input.symbol,
      qty: String(input.quantity),
      side: input.side.toLowerCase(),
      type: input.orderType.toLowerCase(),
      time_in_force: "day",
      ...(input.orderType === "LIMIT" && input.price
        ? { limit_price: String(input.price) }
        : {}),
    }),
  });

  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { message?: string };
    throw new Error(`Alpaca order failed ${res.status}: ${err.message ?? res.statusText}`);
  }

  const order = (await res.json()) as AlpacaOrderResponse;
  return order.id;
}

export async function getAlpacaPositions(): Promise<Position[]> {
  if (!isAlpacaConfigured()) return [];

  const res = await fetch(`${baseUrl()}/v2/positions`, {
    headers: getHeaders(),
  });

  if (!res.ok) return [];

  const raw = (await res.json()) as AlpacaPosition[];
  return raw.map((p) => ({
    symbol: p.symbol,
    exchange: "NYSE",
    product: "US_EQUITY",
    quantity: Math.abs(parseFloat(p.qty)),
    avgPrice: parseFloat(p.avg_entry_price),
    currentPrice: parseFloat(p.current_price),
    pnl: parseFloat(p.unrealized_pl),
    unrealised: parseFloat(p.unrealized_pl),
    realised: 0,
    side: p.side === "long" ? "LONG" : "SHORT",
    broker: "ALPACA" as const,
  }));
}

/**
 * Thin wrapper around the KiteConnect SDK.
 *
 * One KiteConnect instance per process is enough; access tokens are stored in
 * the cache layer (Redis when available) keyed by userId with a 24-hour TTL
 * matching Zerodha's token expiry.
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { KiteConnect } = require("kiteconnect") as { KiteConnect: new (opts: { api_key: string }) => KiteInstance };

import { config } from "@/core/config/env";
import { cache } from "@/core/cache";

export interface ZerodhaHolding {
  tradingsymbol: string;
  exchange: string;
  quantity: number;
  average_price: number;
  last_price: number;
  pnl: number;
  day_change: number;
  day_change_percentage: number;
  t1_quantity: number;
  used_quantity: number;
}

export interface ZerodhaPosition {
  tradingsymbol: string;
  exchange: string;
  product: string;
  quantity: number;
  overnight_quantity: number;
  average_price: number;
  last_price: number;
  pnl: number;
  unrealised: number;
  realised: number;
}

interface ZerodhaPositions {
  net: ZerodhaPosition[];
  day: ZerodhaPosition[];
}

interface ZerodhaOrder {
  order_id: string;
  tradingsymbol: string;
  exchange: string;
  transaction_type: string;
  order_type: string;
  quantity: number;
  price: number;
  status: string;
  product: string;
  placed_by: string;
  order_timestamp: string;
}

interface KiteInstance {
  getLoginURL(): string;
  setAccessToken(token: string): void;
  generateSession(
    requestToken: string,
    apiSecret: string,
  ): Promise<{ access_token: string }>;
  placeOrder(
    variety: string,
    params: Record<string, unknown>,
  ): Promise<{ order_id: number | string }>;
  getHoldings(): Promise<ZerodhaHolding[]>;
  getPositions(): Promise<ZerodhaPositions>;
  getOrders(): Promise<ZerodhaOrder[]>;
}

function tokenKey(userId: string) {
  return `zerodha:token:${userId}`;
}

export function getKiteClient(): KiteInstance {
  return new KiteConnect({ api_key: config.zerodha().apiKey });
}

export function getLoginUrl(): string {
  return getKiteClient().getLoginURL();
}

export async function exchangeToken(requestToken: string): Promise<string> {
  const kite = getKiteClient();
  const session = await kite.generateSession(
    requestToken,
    config.zerodha().apiSecret,
  );
  return session.access_token;
}

export async function storeAccessToken(
  userId: string,
  accessToken: string,
): Promise<void> {
  await cache.set(tokenKey(userId), accessToken, 24 * 60 * 60);
}

export async function getAuthenticatedKite(userId: string): Promise<KiteInstance> {
  const token = await cache.get<string>(tokenKey(userId));
  if (!token) {
    throw new Error(
      "Zerodha not connected. Visit /api/zerodha/connect to authenticate.",
    );
  }
  const kite = getKiteClient();
  kite.setAccessToken(token);
  return kite;
}

export async function isConnected(userId: string): Promise<boolean> {
  const token = await cache.get<string>(tokenKey(userId));
  return token !== null;
}

export async function disconnectZerodha(userId: string): Promise<void> {
  await cache.delete(tokenKey(userId));
}

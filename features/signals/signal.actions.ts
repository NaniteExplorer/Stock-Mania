"use server";

import { getCurrentSession } from "@/lib/better-auth/auth";
import { signalService } from "./signal.service";
import type { TradingSignal } from "./signal.types";
import { inngest } from "@/lib/inngest/client";

export async function getLatestSignals(limit = 20): Promise<TradingSignal[]> {
  const session = await getCurrentSession();
  if (!session?.user) return [];
  return signalService.getLatest(limit);
}

export async function getSignalsForSymbol(symbol: string): Promise<TradingSignal[]> {
  const session = await getCurrentSession();
  if (!session?.user) return [];
  return signalService.getForSymbol(symbol);
}

export async function requestSignal(
  symbol: string,
): Promise<{ success: boolean; message: string }> {
  const session = await getCurrentSession();
  if (!session?.user) return { success: false, message: "Not authenticated." };

  await inngest.send({
    name: "app/signal.requested",
    data: { symbol: symbol.toUpperCase(), requestedBy: session.user.id },
  });

  return { success: true, message: `Signal generation queued for ${symbol}.` };
}

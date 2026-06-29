"use server";

import { revalidatePath } from "next/cache";
import { getCurrentSession } from "@/lib/better-auth/auth";
import { logger } from "@/core/logger";
import { parseInput } from "@/core/validation/parse";
import { tradeService } from "./trade.service";
import { createTradeSchema } from "./trade.schema";
import type { CreateTradeInput, Trade } from "./trade.types";

type ActionResult = { success: boolean; error?: string };

export async function addTrade(input: CreateTradeInput): Promise<ActionResult> {
  const session = await getCurrentSession();
  if (!session?.user?.id) return { success: false, error: "You must be signed in." };
  const parsed = parseInput(createTradeSchema, input);
  if (!parsed.success) return { success: false, error: parsed.error };
  try {
    await tradeService.add(session.user.id, parsed.data as CreateTradeInput);
    revalidatePath("/investments");
    revalidatePath("/dashboard");
    return { success: true };
  } catch (err) {
    logger.error("addTrade failed", err);
    return { success: false, error: "Failed to record the trade." };
  }
}

export async function getMyTrades(): Promise<Trade[]> {
  const session = await getCurrentSession();
  if (!session?.user?.id) return [];
  try {
    return await tradeService.listByUser(session.user.id);
  } catch (err) {
    logger.error("getMyTrades failed", err);
    return [];
  }
}

export async function getTradesForHolding(symbol: string | null, name: string): Promise<Trade[]> {
  const session = await getCurrentSession();
  if (!session?.user?.id) return [];
  try {
    return await tradeService.listForHolding(session.user.id, symbol, name);
  } catch (err) {
    logger.error("getTradesForHolding failed", err);
    return [];
  }
}

export async function deleteTrade(
  id: string,
  symbol: string | null,
  name: string,
  kind: Trade["kind"],
): Promise<ActionResult> {
  const session = await getCurrentSession();
  if (!session?.user?.id) return { success: false, error: "You must be signed in." };
  try {
    await tradeService.remove(id, session.user.id, symbol, name, kind);
    revalidatePath("/investments");
    revalidatePath("/dashboard");
    return { success: true };
  } catch (err) {
    logger.error("deleteTrade failed", err);
    return { success: false, error: "Failed to delete the trade." };
  }
}

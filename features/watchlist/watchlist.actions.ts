"use server";

import { revalidatePath } from "next/cache";
import { getCurrentSession } from "@/lib/better-auth/auth";
import { logger } from "@/core/logger";
import { watchlistService } from "@/features/watchlist/watchlist.service";

type ActionResult = { success: boolean; error?: string };

/** Read symbols by email — used by the daily news job and (legacy) watchlist page. */
export async function getWatchListSymbolsByEmail(
  email: string,
): Promise<string[]> {
  return watchlistService.getSymbolsByEmail(email);
}

/** Read the signed-in user's watchlist symbols. */
export async function getMyWatchlistSymbols(): Promise<string[]> {
  const session = await getCurrentSession();
  const userId = session?.user?.id;
  if (!userId) return [];
  return watchlistService.listSymbols(userId);
}

export async function addToWatchlist(
  symbol: string,
  company: string,
): Promise<ActionResult> {
  const session = await getCurrentSession();
  if (!session?.user?.id) return { success: false, error: "You must be signed in." };
  try {
    await watchlistService.add(session.user.id, symbol, company);
    revalidatePath("/watchlist");
    revalidatePath(`/stocks/${symbol.toUpperCase()}`);
    return { success: true };
  } catch (err) {
    logger.error("addToWatchlist failed", err, { symbol });
    return { success: false, error: "Failed to add to watchlist." };
  }
}

export async function removeFromWatchlist(
  symbol: string,
): Promise<ActionResult> {
  const session = await getCurrentSession();
  if (!session?.user?.id) return { success: false, error: "You must be signed in." };
  try {
    await watchlistService.remove(session.user.id, symbol);
    revalidatePath("/watchlist");
    revalidatePath(`/stocks/${symbol.toUpperCase()}`);
    return { success: true };
  } catch (err) {
    logger.error("removeFromWatchlist failed", err, { symbol });
    return { success: false, error: "Failed to remove from watchlist." };
  }
}

import { connectToDatabase } from "@/core/db/connection";
import { logger } from "@/core/logger";
import { watchlistRepository } from "@/features/watchlist/watchlist.repository";

/**
 * Resolve a Better-Auth user id from an email. Better-Auth stores users in the
 * `user` collection; the watchlist is keyed by that id.
 */
async function resolveUserIdByEmail(email: string): Promise<string | null> {
  const mongoose = await connectToDatabase();
  const db = mongoose.connection.db;
  if (!db) return null;
  const user = await db
    .collection("user")
    .findOne<{ _id?: unknown; id?: string; email?: string }>({ email });
  if (!user) return null;
  return user.id || String(user._id || "") || null;
}

export const watchlistService = {
  async getSymbolsByEmail(email: string): Promise<string[]> {
    if (!email) return [];
    try {
      const userId = await resolveUserIdByEmail(email);
      if (!userId) return [];
      return await watchlistRepository.listSymbols(userId);
    } catch (err) {
      logger.error("watchlistService.getSymbolsByEmail failed", err);
      return [];
    }
  },

  listSymbols(userId: string): Promise<string[]> {
    return watchlistRepository.listSymbols(userId);
  },

  add(userId: string, symbol: string, company: string): Promise<void> {
    return watchlistRepository.add(userId, symbol, company);
  },

  remove(userId: string, symbol: string): Promise<void> {
    return watchlistRepository.remove(userId, symbol);
  },

  has(userId: string, symbol: string): Promise<boolean> {
    return watchlistRepository.has(userId, symbol);
  },
};

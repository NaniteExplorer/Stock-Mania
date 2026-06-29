import { connectToDatabase } from "@/core/db/connection";
import { WatchList } from "@/features/watchlist/watchlist.model";

/**
 * Watchlist persistence. Implemented today with Mongoose; the interface is what
 * the service depends on, so a Postgres implementation can replace it next
 * session (see core/db/repository.ts) without touching the service or actions.
 */
export interface WatchlistRepository {
  listSymbols(userId: string): Promise<string[]>;
  add(userId: string, symbol: string, company: string): Promise<void>;
  remove(userId: string, symbol: string): Promise<void>;
  has(userId: string, symbol: string): Promise<boolean>;
}

class MongoWatchlistRepository implements WatchlistRepository {
  async listSymbols(userId: string): Promise<string[]> {
    await connectToDatabase();
    const items = await WatchList.find({ userId }, { symbol: 1 }).lean();
    return items.map((i) => String(i.symbol));
  }

  async add(userId: string, symbol: string, company: string): Promise<void> {
    await connectToDatabase();
    const sym = symbol.toUpperCase();
    // Idempotent: the unique (userId, symbol) index plus upsert avoids duplicates.
    await WatchList.updateOne(
      { userId, symbol: sym },
      { $setOnInsert: { userId, symbol: sym, company, addedAt: new Date() } },
      { upsert: true },
    );
  }

  async remove(userId: string, symbol: string): Promise<void> {
    await connectToDatabase();
    await WatchList.deleteOne({ userId, symbol: symbol.toUpperCase() });
  }

  async has(userId: string, symbol: string): Promise<boolean> {
    await connectToDatabase();
    const doc = await WatchList.exists({ userId, symbol: symbol.toUpperCase() });
    return Boolean(doc);
  }
}

export const watchlistRepository: WatchlistRepository =
  new MongoWatchlistRepository();

import { connectToDatabase } from "@/database/mongoose";
import { WatchList } from "@/database/models/watchlist.model";

export async function getWatchListSymbolsByEmail(
  email: string,
): Promise<string[]> {
  if (!email) return [];
  try {
    const mongoose = await connectToDatabase();
    const db = mongoose.connection.db;
    if (!db) throw new Error("MongoDB connection not found");

    //   Better Auth stores users in the 'user' collection
    const user = await db
      .collection("user")
      .findOne<{ _id?: unknown; id?: string; email?: string }>({ email });
    if (!user) return [];
    const userId = user.id || String(user._id || "");
    if (!userId) return [];

    const items = await WatchList.find({ userId }, { symbol: 1 }).lean();
    return items.map((i) => String(i.symbol));
  } catch (err) {
    console.log("getWatchListSymbolsByEmail error: ", err);
    return [];
  }
}

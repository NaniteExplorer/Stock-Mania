import { connectToDatabase } from "@/core/db/connection";
import { SignalModel } from "./signal.model";
import type { TradingSignal } from "./signal.types";

function toSignal(doc: Record<string, unknown>): TradingSignal {
  return {
    id: String(doc._id),
    symbol: doc.symbol as string,
    direction: doc.direction as TradingSignal["direction"],
    confidence: doc.confidence as TradingSignal["confidence"],
    reasoning: doc.reasoning as string,
    currentPrice: doc.currentPrice as number,
    targetPrice: (doc.targetPrice as number) ?? null,
    stopLoss: (doc.stopLoss as number) ?? null,
    generatedAt: doc.generatedAt as Date,
    expiresAt: doc.expiresAt as Date,
  };
}

export const signalRepository = {
  async save(data: Omit<TradingSignal, "id">): Promise<TradingSignal> {
    await connectToDatabase();
    const doc = await SignalModel.create(data);
    return toSignal(doc.toObject());
  },

  async findLatest(limit = 20): Promise<TradingSignal[]> {
    await connectToDatabase();
    const docs = await SignalModel.find({ expiresAt: { $gt: new Date() } })
      .sort({ generatedAt: -1 })
      .limit(limit)
      .lean();
    return docs.map(toSignal);
  },

  async findBySymbol(symbol: string, limit = 5): Promise<TradingSignal[]> {
    await connectToDatabase();
    const docs = await SignalModel.find({
      symbol: symbol.toUpperCase(),
      expiresAt: { $gt: new Date() },
    })
      .sort({ generatedAt: -1 })
      .limit(limit)
      .lean();
    return docs.map(toSignal);
  },
};

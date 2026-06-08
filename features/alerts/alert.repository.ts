import { connectToDatabase } from "@/core/db/connection";
import { AlertModel } from "./alert.model";
import type { PriceAlert, AlertStatus, CreateAlertInput } from "./alert.types";

function toAlert(doc: Record<string, unknown>): PriceAlert {
  return {
    id: String(doc._id),
    userId: doc.userId as string,
    symbol: doc.symbol as string,
    type: doc.type as PriceAlert["type"],
    targetPrice: doc.targetPrice as number,
    channel: doc.channel as PriceAlert["channel"],
    whatsappNumber: (doc.whatsappNumber as string) ?? null,
    status: doc.status as AlertStatus,
    triggeredAt: (doc.triggeredAt as Date) ?? null,
    createdAt: doc.createdAt as Date,
    updatedAt: doc.updatedAt as Date,
  };
}

export const alertRepository = {
  async create(userId: string, input: CreateAlertInput): Promise<PriceAlert> {
    await connectToDatabase();
    const doc = await AlertModel.create({
      userId,
      symbol: input.symbol.toUpperCase(),
      type: input.type,
      targetPrice: input.targetPrice,
      channel: input.channel,
      whatsappNumber: input.whatsappNumber ?? null,
    });
    return toAlert(doc.toObject());
  },

  async findByUser(userId: string): Promise<PriceAlert[]> {
    await connectToDatabase();
    const docs = await AlertModel.find({ userId })
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();
    return docs.map(toAlert);
  },

  async findActiveBySymbols(symbols: string[]): Promise<PriceAlert[]> {
    await connectToDatabase();
    const upper = symbols.map((s) => s.toUpperCase());
    const docs = await AlertModel.find({
      symbol: { $in: upper },
      status: "ACTIVE",
    }).lean();
    return docs.map(toAlert);
  },

  async findAllActive(): Promise<PriceAlert[]> {
    await connectToDatabase();
    const docs = await AlertModel.find({ status: "ACTIVE" }).lean();
    return docs.map(toAlert);
  },

  async markTriggered(id: string): Promise<void> {
    await connectToDatabase();
    await AlertModel.findByIdAndUpdate(id, {
      status: "TRIGGERED",
      triggeredAt: new Date(),
    });
  },

  async cancel(id: string, userId: string): Promise<void> {
    await connectToDatabase();
    await AlertModel.findOneAndUpdate({ _id: id, userId }, { status: "CANCELLED" });
  },
};

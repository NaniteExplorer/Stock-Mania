import { connectToDatabase } from "@/core/db/connection";
import { OrderModel } from "./order.model";
import type { TradeOrder, OrderStatus } from "./order.types";

export const orderRepository = {
  async create(data: Omit<TradeOrder, "id" | "placedAt" | "updatedAt">): Promise<TradeOrder> {
    await connectToDatabase();
    const doc = await OrderModel.create(data);
    return toTradeOrder(doc);
  },

  async findByUser(userId: string, limit = 50): Promise<TradeOrder[]> {
    await connectToDatabase();
    const docs = await OrderModel.find({ userId })
      .sort({ placedAt: -1 })
      .limit(limit)
      .lean();
    return docs.map(toTradeOrder);
  },

  async updateStatus(
    id: string,
    status: OrderStatus,
    brokerId?: string,
    errorMessage?: string,
  ): Promise<void> {
    await connectToDatabase();
    await OrderModel.findByIdAndUpdate(id, {
      status,
      ...(brokerId ? { brokerId } : {}),
      ...(errorMessage ? { errorMessage } : {}),
    });
  },
};

function toTradeOrder(doc: Record<string, unknown>): TradeOrder {
  return {
    id: String(doc._id),
    userId: doc.userId as string,
    symbol: doc.symbol as string,
    exchange: doc.exchange as TradeOrder["exchange"],
    broker: (doc.broker as TradeOrder["broker"]) ?? "ZERODHA",
    side: doc.side as TradeOrder["side"],
    orderType: doc.orderType as TradeOrder["orderType"],
    product: doc.product as TradeOrder["product"],
    quantity: doc.quantity as number,
    price: (doc.price as number) ?? null,
    status: doc.status as OrderStatus,
    brokerId: (doc.brokerId as string) ?? null,
    errorMessage: (doc.errorMessage as string) ?? null,
    placedAt: doc.placedAt as Date,
    updatedAt: doc.updatedAt as Date,
  };
}

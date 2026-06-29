import { Schema, model, models } from "mongoose";
import type { TradeOrder } from "./order.types";

const orderSchema = new Schema<TradeOrder>(
  {
    userId: { type: String, required: true, index: true },
    symbol: { type: String, required: true, uppercase: true },
    exchange: {
      type: String,
      enum: ["NSE", "BSE", "NFO", "MCX", "NYSE", "NASDAQ", "ARCA"],
      required: true,
    },
    broker: {
      type: String,
      enum: ["ZERODHA", "ALPACA"],
      required: true,
      default: "ZERODHA",
    },
    side: { type: String, enum: ["BUY", "SELL"], required: true },
    orderType: { type: String, enum: ["MARKET", "LIMIT"], required: true },
    product: { type: String, enum: ["CNC", "MIS", "NRML"], required: true },
    quantity: { type: Number, required: true, min: 1 },
    price: { type: Number, default: null },
    status: {
      type: String,
      enum: ["PENDING", "PLACED", "COMPLETE", "CANCELLED", "REJECTED"],
      default: "PENDING",
      index: true,
    },
    brokerId: { type: String, default: null },
    errorMessage: { type: String, default: null },
    placedAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
  },
  { timestamps: { createdAt: "placedAt", updatedAt: "updatedAt" } },
);

export const OrderModel =
  models.Order ?? model<TradeOrder>("Order", orderSchema);

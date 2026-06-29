import { Schema, model, models } from "mongoose";
import type { PriceAlert } from "./alert.types";

const alertSchema = new Schema<PriceAlert>(
  {
    userId: { type: String, required: true, index: true },
    symbol: { type: String, required: true, uppercase: true },
    type: { type: String, enum: ["PRICE_ABOVE", "PRICE_BELOW"], required: true },
    targetPrice: { type: Number, required: true },
    channel: { type: String, enum: ["EMAIL", "WHATSAPP", "BOTH"], required: true },
    whatsappNumber: { type: String, default: null },
    status: {
      type: String,
      enum: ["ACTIVE", "TRIGGERED", "CANCELLED"],
      default: "ACTIVE",
      index: true,
    },
    triggeredAt: { type: Date, default: null },
  },
  { timestamps: { createdAt: "createdAt", updatedAt: "updatedAt" } },
);

alertSchema.index({ userId: 1, status: 1 });
alertSchema.index({ symbol: 1, status: 1 });

export const AlertModel =
  models.PriceAlert ?? model<PriceAlert>("PriceAlert", alertSchema);

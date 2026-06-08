import { Schema, model, models } from "mongoose";
import type { TradingSignal } from "./signal.types";

const signalSchema = new Schema<TradingSignal>(
  {
    symbol: { type: String, required: true, uppercase: true, index: true },
    direction: { type: String, enum: ["BUY", "SELL", "HOLD"], required: true },
    confidence: { type: String, enum: ["LOW", "MEDIUM", "HIGH"], required: true },
    reasoning: { type: String, required: true },
    currentPrice: { type: Number, required: true },
    targetPrice: { type: Number, default: null },
    stopLoss: { type: Number, default: null },
    generatedAt: { type: Date, default: Date.now },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: false },
);

signalSchema.index({ symbol: 1, generatedAt: -1 });
signalSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const SignalModel =
  models.TradingSignal ?? model<TradingSignal>("TradingSignal", signalSchema);

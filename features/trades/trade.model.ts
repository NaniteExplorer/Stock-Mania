import { Model, Schema, model, models } from "mongoose";
import type { InvestmentKind } from "@/features/investments/investment.types";
import type { TradeSide, TradeSource } from "./trade.types";

export interface TradeDoc {
  userId: string;
  symbol: string | null;
  name: string;
  kind: InvestmentKind;
  side: TradeSide;
  date: Date;
  quantity: number;
  pricePerUnit: number;
  brokerage: number;
  taxes: number;
  other: number;
  currency: string;
  source: TradeSource;
  fingerprint: string;
  createdAt: Date;
  updatedAt: Date;
}

const TradeSchema = new Schema<TradeDoc>(
  {
    userId: { type: String, required: true, index: true },
    symbol: { type: String, default: null, uppercase: true, trim: true },
    name: { type: String, required: true, trim: true },
    kind: {
      type: String,
      required: true,
      enum: ["STOCK", "ETF", "MUTUAL_FUND", "BOND", "CRYPTO", "DIGITAL_GOLD", "COMMODITY"],
      default: "STOCK",
    },
    side: { type: String, required: true, enum: ["BUY", "SELL"] },
    date: { type: Date, required: true, index: true },
    quantity: { type: Number, required: true, min: 0 },
    pricePerUnit: { type: Number, required: true, min: 0 },
    brokerage: { type: Number, default: 0 },
    taxes: { type: Number, default: 0 },
    other: { type: Number, default: 0 },
    currency: { type: String, required: true, default: "INR", uppercase: true },
    source: { type: String, required: true, enum: ["MANUAL", "IMPORT", "DRIVE"], default: "MANUAL" },
    fingerprint: { type: String, required: true },
  },
  { timestamps: true },
);

// One trade per (user, fingerprint) — re-imports/re-polls never duplicate.
TradeSchema.index({ userId: 1, fingerprint: 1 }, { unique: true });
TradeSchema.index({ userId: 1, symbol: 1, name: 1 });

export const Trade: Model<TradeDoc> =
  (models?.trade as Model<TradeDoc>) || model<TradeDoc>("trade", TradeSchema);

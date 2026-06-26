import { Model, model, models, Schema } from "mongoose";
import type { InvestmentKind } from "./investment.types";

export interface InvestmentDoc {
  userId: string;
  name: string;
  symbol: string | null;
  kind: InvestmentKind;
  units: number;
  avgCost: number;
  currentPrice: number;
  createdAt: Date;
  updatedAt: Date;
}

const InvestmentSchema = new Schema<InvestmentDoc>(
  {
    userId: { type: String, required: true, index: true },
    name: { type: String, required: true, trim: true },
    symbol: { type: String, default: null, uppercase: true, trim: true },
    kind: {
      type: String,
      required: true,
      enum: ["STOCK", "ETF", "MUTUAL_FUND", "BOND", "CRYPTO"],
      default: "STOCK",
    },
    units: { type: Number, required: true, default: 0 },
    avgCost: { type: Number, required: true, default: 0 },
    currentPrice: { type: Number, required: true, default: 0 },
  },
  { timestamps: true },
);

export const Investment: Model<InvestmentDoc> =
  (models?.investment as Model<InvestmentDoc>) ||
  model<InvestmentDoc>("investment", InvestmentSchema);

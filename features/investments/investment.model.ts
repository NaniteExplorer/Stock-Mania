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
  // Ledger-derived (recomputed from the FIFO trade ledger; 0 for manual-only).
  holdingSince: Date | null;
  realizedGain: number; // pre-tax realized P&L (gross)
  realizedTax: number; // estimated tax on realized gains (Phase 2)
  totalCharges: number; // all-time buy+sell charges
  openBuyCharges: number; // buy charges still capitalized in open lots
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
      enum: ["STOCK", "ETF", "MUTUAL_FUND", "BOND", "CRYPTO", "DIGITAL_GOLD", "COMMODITY"],
      default: "STOCK",
    },
    units: { type: Number, required: true, default: 0 },
    avgCost: { type: Number, required: true, default: 0 },
    currentPrice: { type: Number, required: true, default: 0 },
    holdingSince: { type: Date, default: null },
    realizedGain: { type: Number, default: 0 },
    realizedTax: { type: Number, default: 0 },
    totalCharges: { type: Number, default: 0 },
    openBuyCharges: { type: Number, default: 0 },
  },
  { timestamps: true },
);

export const Investment: Model<InvestmentDoc> =
  (models?.investment as Model<InvestmentDoc>) ||
  model<InvestmentDoc>("investment", InvestmentSchema);

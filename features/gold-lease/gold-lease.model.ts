import { Model, Schema, model, models } from "mongoose";
import type { GoldLeaseStatus } from "./gold-lease.types";

export interface GoldLeaseDoc {
  userId: string;
  name: string;
  leasedGrams: number;
  annualRatePercent: number;
  startDate: Date;
  termMonths: number | null;
  status: GoldLeaseStatus;
  accruedGrams: number;
  lastAccruedAt: Date;
  accruals: { date: Date; grams: number }[];
  createdAt: Date;
  updatedAt: Date;
}

const AccrualSchema = new Schema(
  { date: { type: Date, required: true }, grams: { type: Number, required: true } },
  { _id: false },
);

const GoldLeaseSchema = new Schema<GoldLeaseDoc>(
  {
    userId: { type: String, required: true, index: true },
    name: { type: String, required: true, trim: true },
    leasedGrams: { type: Number, required: true, min: 0 },
    annualRatePercent: { type: Number, required: true, min: 0 },
    startDate: { type: Date, required: true },
    termMonths: { type: Number, default: null },
    status: { type: String, required: true, enum: ["ACTIVE", "CLOSED"], default: "ACTIVE" },
    accruedGrams: { type: Number, default: 0 },
    lastAccruedAt: { type: Date, required: true },
    accruals: { type: [AccrualSchema], default: [] },
  },
  { timestamps: true },
);

export const GoldLease: Model<GoldLeaseDoc> =
  (models?.goldlease as Model<GoldLeaseDoc>) || model<GoldLeaseDoc>("goldlease", GoldLeaseSchema);

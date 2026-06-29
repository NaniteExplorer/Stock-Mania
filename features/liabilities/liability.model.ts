import { Model, model, models, Schema } from "mongoose";
import type { LiabilityType } from "./liability.types";

export interface LiabilityDoc {
  userId: string;
  name: string;
  lender: string;
  type: LiabilityType;
  outstanding: number;
  emi: number | null;
  interestRate: number | null;
  createdAt: Date;
  updatedAt: Date;
}

const LiabilitySchema = new Schema<LiabilityDoc>(
  {
    userId: { type: String, required: true, index: true },
    name: { type: String, required: true, trim: true },
    lender: { type: String, default: "", trim: true },
    type: {
      type: String,
      required: true,
      enum: ["HOME_LOAN", "CAR_LOAN", "PERSONAL_LOAN", "EDUCATION_LOAN", "CREDIT_CARD", "OTHER"],
      default: "OTHER",
    },
    outstanding: { type: Number, required: true, default: 0 },
    emi: { type: Number, default: null },
    interestRate: { type: Number, default: null },
  },
  { timestamps: true },
);

export const Liability: Model<LiabilityDoc> =
  (models?.liability as Model<LiabilityDoc>) ||
  model<LiabilityDoc>("liability", LiabilitySchema);

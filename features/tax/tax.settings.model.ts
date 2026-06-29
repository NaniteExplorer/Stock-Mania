import { Model, Schema, model, models } from "mongoose";

/** Per-user editable tax rates (overrides onto DEFAULT_TAX_CONFIG). */
export interface TaxSettingsDoc {
  userId: string;
  slabPercent: number;
  ltcgExemption: number;
  equityStcgPercent: number;
  equityLtcgPercent: number;
  equityLtcgThresholdDays: number;
  cryptoRatePercent: number;
  goldLtcgPercent: number;
  goldLtcgThresholdDays: number;
  createdAt: Date;
  updatedAt: Date;
}

const TaxSettingsSchema = new Schema<TaxSettingsDoc>(
  {
    userId: { type: String, required: true, unique: true, index: true },
    slabPercent: { type: Number, default: 30 },
    ltcgExemption: { type: Number, default: 125000 },
    equityStcgPercent: { type: Number, default: 20 },
    equityLtcgPercent: { type: Number, default: 12.5 },
    equityLtcgThresholdDays: { type: Number, default: 365 },
    cryptoRatePercent: { type: Number, default: 30 },
    goldLtcgPercent: { type: Number, default: 12.5 },
    goldLtcgThresholdDays: { type: Number, default: 730 },
  },
  { timestamps: true },
);

export const TaxSettings: Model<TaxSettingsDoc> =
  (models?.taxsetting as Model<TaxSettingsDoc>) ||
  model<TaxSettingsDoc>("taxsetting", TaxSettingsSchema);

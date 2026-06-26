import { Model, model, models, Schema } from "mongoose";
import type { AssetCategory } from "./asset.types";

export interface AssetDoc {
  userId: string;
  name: string;
  category: AssetCategory;
  value: number;
  note: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const AssetSchema = new Schema<AssetDoc>(
  {
    userId: { type: String, required: true, index: true },
    name: { type: String, required: true, trim: true },
    category: {
      type: String,
      required: true,
      enum: ["REAL_ESTATE", "GOLD", "VEHICLE", "EPF", "PPF", "NPS", "CRYPTO", "OTHER"],
      default: "OTHER",
    },
    value: { type: Number, required: true, default: 0 },
    note: { type: String, default: null },
  },
  { timestamps: true },
);

export const Asset: Model<AssetDoc> =
  (models?.asset as Model<AssetDoc>) || model<AssetDoc>("asset", AssetSchema);

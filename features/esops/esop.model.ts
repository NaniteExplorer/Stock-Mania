import { Model, model, models, Schema } from "mongoose";

export interface EsopDoc {
  userId: string;
  company: string;
  grantDate: Date;
  totalOptions: number;
  vestedOptions: number;
  strikePrice: number;
  currentFmv: number;
  createdAt: Date;
  updatedAt: Date;
}

const EsopSchema = new Schema<EsopDoc>(
  {
    userId: { type: String, required: true, index: true },
    company: { type: String, required: true, trim: true },
    grantDate: { type: Date, required: true, default: Date.now },
    totalOptions: { type: Number, required: true, default: 0 },
    vestedOptions: { type: Number, required: true, default: 0 },
    strikePrice: { type: Number, required: true, default: 0 },
    currentFmv: { type: Number, required: true, default: 0 },
  },
  { timestamps: true },
);

export const Esop: Model<EsopDoc> =
  (models?.esop as Model<EsopDoc>) || model<EsopDoc>("esop", EsopSchema);

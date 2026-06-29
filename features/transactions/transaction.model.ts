import { Model, Schema, model, models } from "mongoose";
import type { TransactionDirection, TransactionSource } from "./transaction.types";

export interface TransactionDoc {
  accountId: Schema.Types.ObjectId;
  userId: string;
  transactionDate: Date;
  description: string;
  reference: string | null;
  amount: number;
  direction: TransactionDirection;
  balanceAfter: number | null;
  currency: string;
  category: string | null;
  source: TransactionSource;
  sourceFile: string | null;
  fingerprint: string;
  createdAt: Date;
  updatedAt: Date;
}

const TransactionSchema = new Schema<TransactionDoc>({
  accountId: { type: Schema.Types.ObjectId, required: true, index: true, ref: "account" },
  userId: { type: String, required: true, index: true },
  transactionDate: { type: Date, required: true, index: true },
  description: { type: String, required: true, trim: true },
  reference: { type: String, default: null, trim: true },
  amount: { type: Number, required: true, min: 0 },
  direction: { type: String, required: true, enum: ["CREDIT", "DEBIT"] },
  balanceAfter: { type: Number, default: null },
  currency: { type: String, required: true, default: "INR", uppercase: true },
  category: { type: String, default: null },
  source: { type: String, required: true, enum: ["MANUAL", "STATEMENT_IMPORT"], default: "MANUAL" },
  sourceFile: { type: String, default: null },
  fingerprint: { type: String, required: true },
}, { timestamps: true });

TransactionSchema.index({ accountId: 1, fingerprint: 1 }, { unique: true });

export const Transaction: Model<TransactionDoc> =
  (models?.accountTransaction as Model<TransactionDoc>) || model<TransactionDoc>("accountTransaction", TransactionSchema);

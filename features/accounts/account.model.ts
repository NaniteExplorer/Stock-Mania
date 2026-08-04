import { Model, model, models, Schema } from "mongoose";
import type { AccountType } from "./account.types";

export interface AccountDoc {
  userId: string;
  name: string;
  institution: string;
  providerId: string | null;
  currency: string;
  type: AccountType;
  balance: number;
  balanceAsOf: Date | null;
  last4: string | null;
  /** Annual interest %, for deposit-type accounts the accrual job grows. */
  interestRatePercent: number | null;
  /** Last day the accrual job compounded this account. */
  lastAccruedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const AccountSchema = new Schema<AccountDoc>(
  {
    userId: { type: String, required: true, index: true },
    name: { type: String, required: true, trim: true },
    institution: { type: String, default: "", trim: true },
    providerId: { type: String, default: null, trim: true },
    currency: { type: String, required: true, default: "INR", uppercase: true, trim: true },
    type: {
      type: String,
      required: true,
      enum: ["BANK", "CASH", "WALLET", "CREDIT_CARD", "FIXED_DEPOSIT", "RECURRING_DEPOSIT", "PPF", "NPS", "EPFO"],
      default: "BANK",
    },
    balance: { type: Number, required: true, default: 0 },
    balanceAsOf: { type: Date, default: null },
    last4: { type: String, default: null },
    interestRatePercent: { type: Number, default: null },
    lastAccruedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

export const Account: Model<AccountDoc> =
  (models?.account as Model<AccountDoc>) ||
  model<AccountDoc>("account", AccountSchema);

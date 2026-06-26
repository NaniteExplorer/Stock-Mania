import { Model, model, models, Schema } from "mongoose";
import type { AccountType } from "./account.types";

export interface AccountDoc {
  userId: string;
  name: string;
  institution: string;
  type: AccountType;
  balance: number;
  last4: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const AccountSchema = new Schema<AccountDoc>(
  {
    userId: { type: String, required: true, index: true },
    name: { type: String, required: true, trim: true },
    institution: { type: String, default: "", trim: true },
    type: {
      type: String,
      required: true,
      enum: ["BANK", "CASH", "WALLET", "FIXED_DEPOSIT", "RECURRING_DEPOSIT"],
      default: "BANK",
    },
    balance: { type: Number, required: true, default: 0 },
    last4: { type: String, default: null },
  },
  { timestamps: true },
);

export const Account: Model<AccountDoc> =
  (models?.account as Model<AccountDoc>) ||
  model<AccountDoc>("account", AccountSchema);

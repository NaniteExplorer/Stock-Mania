import { Model, Schema, model, models } from "mongoose";

export interface BudgetDoc {
  userId: string;
  /** A TransactionCategory value (e.g. "FOOD"). */
  category: string;
  /** Monthly cap in the user's display currency. */
  monthlyLimit: number;
  createdAt: Date;
  updatedAt: Date;
}

const BudgetSchema = new Schema<BudgetDoc>(
  {
    userId: { type: String, required: true, index: true },
    category: { type: String, required: true },
    monthlyLimit: { type: Number, required: true, min: 0 },
  },
  { timestamps: true },
);

// One budget per (user, category).
BudgetSchema.index({ userId: 1, category: 1 }, { unique: true });

export const Budget: Model<BudgetDoc> =
  (models?.budget as Model<BudgetDoc>) || model<BudgetDoc>("budget", BudgetSchema);

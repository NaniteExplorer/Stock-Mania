import { connectToDatabase } from "@/core/db/connection";
import { Budget } from "./budget.model";

export interface BudgetItem {
  category: string;
  monthlyLimit: number;
}

export const budgetService = {
  async list(userId: string): Promise<BudgetItem[]> {
    await connectToDatabase();
    const rows = await Budget.find({ userId }).lean();
    return rows.map((r) => ({ category: r.category, monthlyLimit: r.monthlyLimit }));
  },

  /** Set (or clear, when limit <= 0) a category's monthly cap. */
  async set(userId: string, category: string, monthlyLimit: number): Promise<void> {
    await connectToDatabase();
    if (!Number.isFinite(monthlyLimit) || monthlyLimit <= 0) {
      await Budget.deleteOne({ userId, category });
      return;
    }
    await Budget.updateOne({ userId, category }, { $set: { monthlyLimit } }, { upsert: true });
  },
};

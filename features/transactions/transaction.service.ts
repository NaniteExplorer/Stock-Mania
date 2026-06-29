import { createHash } from "node:crypto";
import { connectToDatabase } from "@/core/db/connection";
import { Account } from "@/features/accounts/account.model";
import { userPreferencesService } from "@/features/user/user.preferences";
import { transactionCategorizer } from "./categorizer";
import { isExcludedFromSpend } from "./transaction.categories";
import { Transaction } from "./transaction.model";
import type { AccountTransaction, ParsedStatementRow, StatementImportResult } from "./transaction.types";

const clean = (value: string) => value.trim().replace(/\s+/g, " ");
const fingerprint = (row: ParsedStatementRow) => {
  const reference = clean(row.reference || "").toLowerCase();
  const identity = reference ? `ref:${reference}` : `memo:${clean(row.description).toLowerCase()}|occ:${row.occurrence ?? 0}`;
  return createHash("sha256").update([row.transactionDate.slice(0, 10), row.direction, Math.abs(row.amount).toFixed(2), identity].join("|")).digest("hex");
};

export interface SpendCategorySlice {
  category: string;
  label: string;
  total: number;
}

export interface SpendSummary {
  outflow: number; // real spend (excludes transfers/self/income/investment)
  inflow: number;
  byCategory: SpendCategorySlice[];
  uncategorized: number;
}

export const transactionService = {
  async list(userId: string, accountId?: string): Promise<AccountTransaction[]> {
    await connectToDatabase();
    const rows = await Transaction.find({ userId, ...(accountId ? { accountId } : {}) }).sort({ transactionDate: -1, _id: -1 }).limit(500).lean();
    return rows.map((row) => ({
      id: String(row._id), accountId: String(row.accountId), userId: row.userId,
      transactionDate: row.transactionDate, description: row.description, reference: row.reference ?? null,
      amount: row.amount, direction: row.direction, balanceAfter: row.balanceAfter ?? null,
      currency: row.currency, category: row.category ?? null, categorySource: row.categorySource ?? null, source: row.source, sourceFile: row.sourceFile ?? null,
      createdAt: row.createdAt, updatedAt: row.updatedAt,
    }));
  },

  async importStatement(userId: string, accountId: string, fileName: string, rows: ParsedStatementRow[]): Promise<StatementImportResult> {
    await connectToDatabase();
    const account = await Account.findOne({ _id: accountId, userId });
    if (!account) return { success: false, inserted: 0, skipped: 0, rejected: rows.length, balanceUpdated: false, error: "Account not found." };
    if (!rows.length || rows.length > 5000) return { success: false, inserted: 0, skipped: 0, rejected: rows.length, balanceUpdated: false, error: "A statement must contain between 1 and 5,000 transactions." };

    const { selfPayees } = await userPreferencesService.get(userId);

    let inserted = 0, skipped = 0, rejected = 0;
    const validRows = rows.filter((row) => {
      const valid = Boolean(row.description && Number.isFinite(row.amount) && row.amount > 0 && !Number.isNaN(Date.parse(row.transactionDate)) && ["CREDIT", "DEBIT"].includes(row.direction));
      if (!valid) rejected += 1;
      return valid;
    });
    for (const row of validRows) {
      // Deterministic categorization at import; unmatched rows stay null for the
      // async AI fallback to fill in.
      const ruleCategory = transactionCategorizer.categorize(
        { description: row.description, reference: row.reference ?? null, direction: row.direction },
        { selfPayees },
      );
      const result = await Transaction.updateOne(
        { accountId: account._id, fingerprint: fingerprint(row) },
        { $setOnInsert: {
          accountId: account._id, userId, transactionDate: new Date(row.transactionDate), description: clean(row.description),
          reference: clean(row.reference || "") || null, amount: Math.abs(row.amount), direction: row.direction,
          balanceAfter: Number.isFinite(row.balanceAfter) ? row.balanceAfter : null, currency: (row.currency || account.currency || "INR").toUpperCase(),
          category: ruleCategory, categorySource: ruleCategory ? "RULE" : null, source: "STATEMENT_IMPORT", sourceFile: fileName.slice(0, 180), fingerprint: fingerprint(row),
        } }, { upsert: true },
      );
      if (result.upsertedCount) inserted += 1; else skipped += 1;
    }

    const withBalance = validRows.filter((row) => Number.isFinite(row.balanceAfter));
    const newestTime = Math.max(...withBalance.map((row) => Date.parse(row.transactionDate)));
    const newestRows = withBalance.filter((row) => Date.parse(row.transactionDate) === newestTime);
    const statementDescending = validRows.length > 1 && Date.parse(validRows[0].transactionDate) > Date.parse(validRows[validRows.length - 1].transactionDate);
    const latestWithBalance = statementDescending ? newestRows[0] : newestRows[newestRows.length - 1];
    let balanceUpdated = false;
    if (latestWithBalance?.balanceAfter != null) {
      account.balance = latestWithBalance.balanceAfter;
      await account.save();
      balanceUpdated = true;
    }
    return { success: true, inserted, skipped, rejected, balanceUpdated };
  },

  /** Spend analytics that EXCLUDE transfers/self/income/investment from outflow. */
  async spendSummary(userId: string, sinceDays = 90): Promise<SpendSummary> {
    await connectToDatabase();
    const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);
    const rows = await Transaction.find({ userId, transactionDate: { $gte: since } })
      .select("amount direction category")
      .lean();

    const byCategory = new Map<string, number>();
    let outflow = 0, inflow = 0, uncategorized = 0;
    for (const row of rows) {
      const excluded = isExcludedFromSpend(row.category ?? null);
      if (row.direction === "CREDIT") inflow += row.amount;
      else if (!excluded) {
        outflow += row.amount;
        if (!row.category) uncategorized += row.amount;
        else byCategory.set(row.category, (byCategory.get(row.category) ?? 0) + row.amount);
      }
    }

    const { categoryLabel } = await import("./transaction.categories");
    const slices: SpendCategorySlice[] = [...byCategory.entries()]
      .map(([category, total]) => ({ category, label: categoryLabel(category), total }))
      .sort((a, b) => b.total - a.total);

    return { outflow, inflow, byCategory: slices, uncategorized };
  },

  /** Manual category override — wins over rules/AI and is never overwritten later. */
  async setCategory(id: string, userId: string, category: string): Promise<void> {
    await connectToDatabase();
    await Transaction.updateOne({ _id: id, userId }, { $set: { category, categorySource: "MANUAL" } });
  },

  /** Fetch rows the rules engine couldn't classify (for the AI fallback). */
  async listUncategorized(userId: string, accountId: string, limit = 100) {
    await connectToDatabase();
    const rows = await Transaction.find({ userId, accountId, category: null })
      .select("description reference direction amount")
      .limit(limit)
      .lean();
    return rows.map((row) => ({
      id: String(row._id), description: row.description, reference: row.reference ?? null,
      direction: row.direction, amount: row.amount,
    }));
  },

  /** Persist an AI-assigned category, but never clobber a manual override. */
  async applyAiCategory(id: string, userId: string, category: string): Promise<void> {
    await connectToDatabase();
    await Transaction.updateOne(
      { _id: id, userId, categorySource: { $ne: "MANUAL" } },
      { $set: { category, categorySource: "AI" } },
    );
  },
};

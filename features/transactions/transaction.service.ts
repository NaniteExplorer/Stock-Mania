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

export interface TransactionQuery {
  accountId?: string;
  /** "" = all, "UNCATEGORIZED" = only uncategorized, else an exact category. */
  category?: string;
  direction?: "CREDIT" | "DEBIT" | "";
  search?: string;
  from?: string; // ISO date (inclusive)
  to?: string; // ISO date (inclusive)
  page?: number;
  pageSize?: number;
}

export interface SpendTrendMonth {
  periodKey: string; // "YYYY-MM"
  total: number; // real spend that month (transfers/income/investment excluded)
  byCategory: Record<string, number>;
}

export const transactionService = {
  async list(userId: string, accountId?: string, limit = 500): Promise<AccountTransaction[]> {
    await connectToDatabase();
    const rows = await Transaction.find({ userId, ...(accountId ? { accountId } : {}) }).sort({ transactionDate: -1, _id: -1 }).limit(Math.max(1, Math.min(limit, 20000))).lean();
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

    const { selfPayees, categoryRules } = await userPreferencesService.get(userId);

    let inserted = 0, skipped = 0, rejected = 0;
    const validRows = rows.filter((row) => {
      const valid = Boolean(row.description && Number.isFinite(row.amount) && row.amount > 0 && !Number.isNaN(Date.parse(row.transactionDate)) && ["CREDIT", "DEBIT"].includes(row.direction));
      if (!valid) rejected += 1;
      return valid;
    });
    const statementDescending = validRows.length > 1 && Date.parse(validRows[0].transactionDate) > Date.parse(validRows[validRows.length - 1].transactionDate);
    for (const [index, row] of validRows.entries()) {
      // Deterministic categorization at import; unmatched rows stay null for the
      // async AI fallback to fill in.
      const ruleCategory = transactionCategorizer.categorize(
        { description: row.description, reference: row.reference ?? null, direction: row.direction },
        { selfPayees, keywordRules: categoryRules },
      );
      const parsedBalance = Number.isFinite(row.balanceAfter) ? row.balanceAfter : null;
      // Bank exports commonly provide only a date. Preserve their row order so
      // multiple transactions on that date still have a deterministic close.
      const statementOrder = statementDescending ? validRows.length - index : index + 1;
      const result = await Transaction.updateOne(
        { accountId: account._id, fingerprint: fingerprint(row) },
        {
          // Refresh balanceAfter even on re-imports so older rows (imported
          // before balance parsing worked) get backfilled.
          $set: {
            statementOrder,
            ...(parsedBalance != null ? { balanceAfter: parsedBalance } : {}),
          },
          $setOnInsert: {
            accountId: account._id, userId, transactionDate: new Date(row.transactionDate), description: clean(row.description),
            reference: clean(row.reference || "") || null, amount: Math.abs(row.amount), direction: row.direction,
            currency: (row.currency || account.currency || "INR").toUpperCase(),
            category: ruleCategory, categorySource: ruleCategory ? "RULE" : null, source: "STATEMENT_IMPORT", sourceFile: fileName.slice(0, 180), fingerprint: fingerprint(row),
          },
        }, { upsert: true },
      );
      if (result.upsertedCount) inserted += 1; else skipped += 1;
    }

    const withBalance = validRows.filter((row) => Number.isFinite(row.balanceAfter));
    const newestTime = Math.max(...withBalance.map((row) => Date.parse(row.transactionDate)));
    const newestRows = withBalance.filter((row) => Date.parse(row.transactionDate) === newestTime);
    const latestWithBalance = statementDescending ? newestRows[0] : newestRows[newestRows.length - 1];
    const snapshot = validRows.find((row) => Number.isFinite(row.statementBalance) && !Number.isNaN(Date.parse(row.statementBalanceDate ?? "")));
    let balanceUpdated = false;
    if (snapshot?.statementBalance != null && snapshot.statementBalanceDate && Date.parse(snapshot.statementBalanceDate) >= newestTime) {
      account.balance = snapshot.statementBalance;
      account.balanceAsOf = new Date(snapshot.statementBalanceDate);
      await account.save();
      balanceUpdated = true;
    } else if (latestWithBalance?.balanceAfter != null) {
      account.balance = latestWithBalance.balanceAfter;
      account.balanceAsOf = new Date(newestTime);
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

    const { NON_CASHFLOW_CATEGORIES } = await import("./transaction.categories");
    const nonCashflow = new Set<string>(NON_CASHFLOW_CATEGORIES);
    const byCategory = new Map<string, number>();
    let outflow = 0, inflow = 0, uncategorized = 0;
    for (const row of rows) {
      const excluded = isExcludedFromSpend(row.category ?? null);
      // Internal movements (transfers/self/adjustments) are neither spend nor income.
      if (row.category && nonCashflow.has(row.category)) continue;
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

  /**
   * Month-by-month real-spend totals split by category, oldest→newest. Excludes
   * transfers/self/income/investment (same rule as spendSummary) so the trend
   * reflects actual spending.
   */
  async spendTrend(userId: string, months = 6): Promise<SpendTrendMonth[]> {
    await connectToDatabase();
    const since = new Date();
    since.setMonth(since.getMonth() - (months - 1), 1);
    since.setHours(0, 0, 0, 0);

    const rows = await Transaction.find({ userId, direction: "DEBIT", transactionDate: { $gte: since } })
      .select("amount category transactionDate")
      .lean();

    const buckets = new Map<string, SpendTrendMonth>();
    for (const row of rows) {
      if (isExcludedFromSpend(row.category ?? null)) continue;
      const d = new Date(row.transactionDate);
      const periodKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const bucket = buckets.get(periodKey) ?? { periodKey, total: 0, byCategory: {} };
      bucket.total += row.amount;
      const cat = row.category ?? "MISCELLANEOUS";
      bucket.byCategory[cat] = (bucket.byCategory[cat] ?? 0) + row.amount;
      buckets.set(periodKey, bucket);
    }

    return [...buckets.values()].sort((a, b) => a.periodKey.localeCompare(b.periodKey));
  },

  /**
   * Re-run the rule categorizer over existing transactions (skipping manual
   * overrides) — applies improved rules to already-imported data without a
   * re-import. Also recomputes each account's balance from its latest row.
   */
  async reprocess(userId: string): Promise<{ recategorized: number; balancesUpdated: number }> {
    await connectToDatabase();
    const { selfPayees, categoryRules } = await userPreferencesService.get(userId);

    // Re-categorize everything the user hasn't manually set.
    const rows = await Transaction.find({ userId, categorySource: { $ne: "MANUAL" } })
      .select("description reference direction category")
      .lean();
    const ops: Parameters<typeof Transaction.bulkWrite>[0] = [];
    for (const row of rows) {
      const category = transactionCategorizer.categorize(
        { description: row.description, reference: row.reference ?? null, direction: row.direction },
        { selfPayees, keywordRules: categoryRules },
      );
      if (category && category !== row.category) {
        ops.push({ updateOne: { filter: { _id: row._id }, update: { $set: { category, categorySource: "RULE" } } } });
      }
    }
    if (ops.length) await Transaction.bulkWrite(ops);

    // Remove orphaned transactions whose account was deleted.
    const accounts = await Account.find({ userId }).select("_id balanceAsOf").lean();
    await Transaction.deleteMany({ userId, accountId: { $nin: accounts.map((a) => a._id) } });

    // Recompute each account balance from its most recent row that carries one.
    let balancesUpdated = 0;
    for (const account of accounts) {
      const latest = await Transaction.findOne({ userId, accountId: account._id, balanceAfter: { $ne: null } })
        .sort({ transactionDate: -1, statementOrder: -1, _id: -1 })
        .select("balanceAfter transactionDate")
        .lean();
      if (latest?.balanceAfter != null) {
        if (!account.balanceAsOf || account.balanceAsOf < latest.transactionDate) {
          await Account.updateOne({ _id: account._id, userId }, { $set: { balance: latest.balanceAfter, balanceAsOf: latest.transactionDate } });
          balancesUpdated += 1;
        }
      }
    }
    return { recategorized: ops.length, balancesUpdated };
  },

  /** Total transaction count for the user (to show "showing X of Y"). */
  async count(userId: string): Promise<number> {
    await connectToDatabase();
    return Transaction.countDocuments({ userId });
  },

  /** Delete one transaction (only the owner's). */
  async remove(id: string, userId: string): Promise<void> {
    await connectToDatabase();
    await Transaction.deleteOne({ _id: id, userId });
  },

  /**
   * Bulk delete — all of a user's transactions, or just one account's. Returns
   * how many were removed. Account balances are left untouched (edit them or
   * re-import to reset).
   */
  async removeMany(userId: string, accountId?: string): Promise<number> {
    await connectToDatabase();
    const result = await Transaction.deleteMany({ userId, ...(accountId ? { accountId } : {}) });
    return result.deletedCount ?? 0;
  },

  /**
   * Server-side paginated + filtered query. Scales to any history size because
   * the database does the filtering/paging — the client never holds the full set.
   */
  async query(userId: string, opts: TransactionQuery): Promise<{ rows: AccountTransaction[]; total: number }> {
    await connectToDatabase();
    const filter: Record<string, unknown> = { userId };
    if (opts.accountId) filter.accountId = opts.accountId;
    if (opts.direction === "CREDIT" || opts.direction === "DEBIT") filter.direction = opts.direction;
    if (opts.category === "UNCATEGORIZED") filter.category = null;
    else if (opts.category) filter.category = opts.category;
    if (opts.from || opts.to) {
      const range: Record<string, Date> = {};
      if (opts.from && !Number.isNaN(Date.parse(opts.from))) range.$gte = new Date(opts.from);
      if (opts.to && !Number.isNaN(Date.parse(opts.to))) range.$lte = new Date(`${opts.to}T23:59:59.999Z`);
      if (Object.keys(range).length) filter.transactionDate = range;
    }
    const search = (opts.search ?? "").trim();
    if (search) {
      // Escape regex metacharacters so user text is matched literally.
      const safe = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const rx = new RegExp(safe, "i");
      filter.$or = [{ description: rx }, { reference: rx }];
    }

    const pageSize = Math.max(1, Math.min(opts.pageSize ?? 50, 200));
    const page = Math.max(0, opts.page ?? 0);

    const [rows, total] = await Promise.all([
      Transaction.find(filter).sort({ transactionDate: -1, _id: -1 }).skip(page * pageSize).limit(pageSize).lean(),
      Transaction.countDocuments(filter),
    ]);
    return {
      rows: rows.map((row) => ({
        id: String(row._id), accountId: String(row.accountId), userId: row.userId,
        transactionDate: row.transactionDate, description: row.description, reference: row.reference ?? null,
        amount: row.amount, direction: row.direction, balanceAfter: row.balanceAfter ?? null,
        currency: row.currency, category: row.category ?? null, categorySource: row.categorySource ?? null,
        source: row.source, sourceFile: row.sourceFile ?? null, createdAt: row.createdAt, updatedAt: row.updatedAt,
      })),
      total,
    };
  },

  /** Manual category override — wins over rules/AI and is never overwritten later. */
  async setCategory(id: string, userId: string, category: string): Promise<void> {
    await connectToDatabase();
    await Transaction.updateOne({ _id: id, userId }, { $set: { category, categorySource: "MANUAL" } });
  },

};

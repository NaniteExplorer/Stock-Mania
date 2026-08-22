import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { users } from "./auth";
import { ledgerAccounts } from "./ledger";
import { createdAt, moneyMinor, updatedAt } from "./columns";

/**
 * Keyword rules that map a transaction description to an account.
 *
 * Deliberately not AI. The user maintains these, so categorization is
 * deterministic, explainable and free — the same statement re-imported next month
 * categorizes identically, and a wrong category is fixed by editing one rule
 * rather than by hoping a model behaves differently.
 *
 * Rules are tried in `priority` order (highest first), then by longest keyword,
 * so a specific rule can override a general one without renumbering everything.
 */
export const categoryRules = sqliteTable(
  "category_rules",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Matched case-insensitively against the description. */
    pattern: text("pattern").notNull(),
    matchType: text("match_type", {
      enum: ["CONTAINS", "STARTS_WITH", "EXACT", "REGEX"],
    })
      .notNull()
      .default("CONTAINS"),
    /** The INCOME or EXPENSE account a match posts to. */
    accountId: text("account_id")
      .notNull()
      .references(() => ledgerAccounts.id, { onDelete: "cascade" }),
    /** Restricts the rule to one direction, for descriptions that occur in both. */
    appliesTo: text("applies_to", { enum: ["ANY", "DEBIT", "CREDIT"] })
      .notNull()
      .default("ANY"),
    priority: integer("priority").notNull().default(0),
    /** How often this rule has fired — surfaces dead rules for cleanup. */
    matchCount: integer("match_count").notNull().default(0),
    isEnabled: integer("is_enabled", { mode: "boolean" }).notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("category_rules_user_pattern_uq").on(table.userId, table.pattern, table.appliesTo),
    index("category_rules_user_priority_idx").on(table.userId, table.priority),
  ],
);

/**
 * A monthly spending limit on an expense account.
 *
 * `month` is null for a recurring limit that applies to every month; a row with a
 * specific `YYYY-MM` overrides the recurring one for that month, which is how a
 * one-off festive-season increase is expressed without editing the default.
 */
export const budgets = sqliteTable(
  "budgets",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accountId: text("account_id")
      .notNull()
      .references(() => ledgerAccounts.id, { onDelete: "cascade" }),
    /** `YYYY-MM`, or null for the recurring default. */
    month: text("month"),
    limitMinor: moneyMinor("limit_minor").notNull(),
    /** Warn at this fraction of the limit, in percent. */
    warnAtPercent: integer("warn_at_percent").notNull().default(80),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [uniqueIndex("budgets_user_account_month_uq").on(table.userId, table.accountId, table.month)],
);

import { sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { users } from "./auth";
import { moneyMinor, timestamp } from "./columns";

/**
 * Month-end net worth — a **cache**, not a source of truth.
 *
 * Every figure here is recomputable from the journal, and a rebuild is expected
 * to overwrite it. That distinction is the whole point: v1 stored balances *as*
 * the truth, so a mis-entered transaction left the stored total permanently
 * disagreeing with its own history. Deleting this table loses nothing.
 */
export const netWorthSnapshots = sqliteTable(
  "net_worth_snapshots",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** `YYYY-MM` — the month whose closing position this is. */
    month: text("month").notNull(),
    assetsMinor: moneyMinor("assets_minor").notNull(),
    liabilitiesMinor: moneyMinor("liabilities_minor").notNull(),
    netWorthMinor: moneyMinor("net_worth_minor").notNull(),
    /** Investment market value within `assetsMinor`, for the allocation chart. */
    investmentsMinor: moneyMinor("investments_minor").notNull().default(0),
    /** Income and expense totals for the month, for the savings-rate chart. */
    incomeMinor: moneyMinor("income_minor").notNull().default(0),
    expenseMinor: moneyMinor("expense_minor").notNull().default(0),
    computedAt: timestamp("computed_at").notNull(),
  },
  (table) => [uniqueIndex("net_worth_snapshots_user_month_uq").on(table.userId, table.month)],
);

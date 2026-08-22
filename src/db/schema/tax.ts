import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { users } from "./auth";
import { createdAt, moneyMinor, percentScaled, updatedAt } from "./columns";

/**
 * Per-user, per-financial-year tax inputs.
 *
 * Keyed by financial year rather than being a single settings row, because the
 * marginal slab and the regime choice change year to year — and last year's
 * realized-gain report must keep computing with last year's inputs.
 */
export const taxSettings = sqliteTable(
  "tax_settings",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** `2025-26`. */
    financialYear: text("financial_year").notNull(),
    /** Which statutory regime's rules to apply, e.g. `india-fy2025`. */
    regimeKey: text("regime_key").notNull().default("india-fy2025"),
    /** The user's marginal income-tax rate, used for slab-taxed income. */
    marginalSlabPercent: percentScaled("marginal_slab_percent").notNull(),
    /**
     * Annual long-term capital-gains exemption for the year (₹1.25 lakh under
     * the FY2025-26 rules). Stored rather than hardcoded so a budget change is a
     * data edit, and so the report shows how much was actually consumed.
     */
    ltcgExemptionMinor: moneyMinor("ltcg_exemption_minor").notNull(),
    /** Whether the user opted into the new (concessional) income-tax regime. */
    usesNewRegime: integer("uses_new_regime", { mode: "boolean" }).notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [uniqueIndex("tax_settings_user_fy_uq").on(table.userId, table.financialYear)],
);

/**
 * Spend-category taxonomy.
 *
 * `excludeFromSpend` flags money movements that are NOT real spending — e.g.
 * moving cash between your own accounts or to family. These are kept in the
 * ledger for completeness but excluded from spend analytics so they don't
 * inflate "what I spent".
 */
export type TransactionCategory =
  | "INCOME"
  | "FOOD"
  | "GROCERIES"
  | "HOUSEHOLD"
  | "TRANSPORT"
  | "UTILITIES"
  | "RENT"
  | "SHOPPING"
  | "ENTERTAINMENT"
  | "HEALTH"
  | "EDUCATION"
  | "INVESTMENT"
  | "FEES_CHARGES"
  | "MISCELLANEOUS"
  | "TRANSFER"
  | "SELF_TRANSFER"
  | "ADJUSTMENT";

export type CategorySource = "RULE" | "AI" | "MANUAL";

interface CategoryMeta {
  label: string;
  /** True for internal/self/family movements that must not count as spend. */
  excludeFromSpend: boolean;
}

export const CATEGORY_META: Record<TransactionCategory, CategoryMeta> = {
  INCOME: { label: "Income", excludeFromSpend: true },
  FOOD: { label: "Food & dining", excludeFromSpend: false },
  GROCERIES: { label: "Groceries", excludeFromSpend: false },
  HOUSEHOLD: { label: "Household", excludeFromSpend: false },
  TRANSPORT: { label: "Transport & fuel", excludeFromSpend: false },
  UTILITIES: { label: "Bills & utilities", excludeFromSpend: false },
  RENT: { label: "Rent & housing", excludeFromSpend: false },
  SHOPPING: { label: "Shopping", excludeFromSpend: false },
  ENTERTAINMENT: { label: "Entertainment", excludeFromSpend: false },
  HEALTH: { label: "Health", excludeFromSpend: false },
  EDUCATION: { label: "Education", excludeFromSpend: false },
  INVESTMENT: { label: "Investments & savings", excludeFromSpend: true },
  FEES_CHARGES: { label: "Fees & charges", excludeFromSpend: false },
  MISCELLANEOUS: { label: "Miscellaneous", excludeFromSpend: false },
  TRANSFER: { label: "Transfer", excludeFromSpend: true },
  SELF_TRANSFER: { label: "Self / family transfer", excludeFromSpend: true },
  ADJUSTMENT: { label: "Balance adjustment", excludeFromSpend: true },
};

/** Categories that are neither real spend NOR real income (internal movements). */
export const NON_CASHFLOW_CATEGORIES: TransactionCategory[] = ["TRANSFER", "SELF_TRANSFER", "ADJUSTMENT"];

export const TRANSACTION_CATEGORIES = Object.keys(CATEGORY_META) as TransactionCategory[];

export function isTransactionCategory(value: unknown): value is TransactionCategory {
  return typeof value === "string" && value in CATEGORY_META;
}

/** Whether a (possibly null/unknown) category should be excluded from spend totals. */
export function isExcludedFromSpend(category: string | null): boolean {
  return isTransactionCategory(category) ? CATEGORY_META[category].excludeFromSpend : false;
}

export function categoryLabel(category: string | null): string {
  return isTransactionCategory(category) ? CATEGORY_META[category].label : "Uncategorized";
}

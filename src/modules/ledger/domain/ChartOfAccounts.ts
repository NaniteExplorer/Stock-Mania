import type { AccountSubtype } from "./entities/Account";
import { AccountCode } from "./value-objects/AccountCode";
import { AccountType, type AccountTypeName } from "./value-objects/AccountType";

/**
 * Accounts the application itself depends on, referenced by code.
 *
 * Code needs to post to "the opening-balance account" or "the account investing
 * charges go to" without asking the user to nominate one. These are marked
 * `isSystem`, so they cannot be renamed out from under the code that looks them
 * up or deleted while entries point at them.
 */
export const SystemAccountCodes = {
  /** The counterweight for a starting balance — see `RecordOpeningBalance`. */
  openingBalances: "Equity:Opening Balances",
  /** Brokerage, STT, GST and the rest. Kept out of the cost basis of a holding. */
  investingCharges: "Expenses:Investing:Charges",
  /** Where an import puts a row no keyword rule matched. */
  uncategorizedExpense: "Expenses:Uncategorized",
  uncategorizedIncome: "Income:Uncategorized",
  dividends: "Income:Investing:Dividends",
  interestIncome: "Income:Investing:Interest",
  /** Parent of the per-holding asset accounts the investments module creates. */
  investments: "Assets:Investments",
} as const;

export type SystemAccountKey = keyof typeof SystemAccountCodes;

interface SeedAccount {
  code: string;
  name: string;
  type: AccountTypeName;
  subtype?: AccountSubtype;
  isSystem?: boolean;
}

/**
 * The chart of accounts a new user starts with.
 *
 * Opinionated toward Indian personal finance — the categories are the ones that
 * actually show up on an Indian bank statement (UPI, fuel, mobile recharge, rent,
 * insurance premiums) rather than a generic set the user would have to rewrite.
 * They are ordinary accounts, so anything unwanted can be renamed or closed.
 *
 * Parents come before children: the seeder relies on that ordering to resolve
 * `parentId` in one pass.
 */
export const DEFAULT_CHART: readonly SeedAccount[] = [
  // ── Assets ────────────────────────────────────────────────────────────────
  { code: "Assets", name: "Assets", type: "ASSET" },
  { code: "Assets:Bank", name: "Bank Accounts", type: "ASSET", subtype: "BANK" },
  { code: "Assets:Cash", name: "Cash in Hand", type: "ASSET", subtype: "CASH" },
  { code: "Assets:Wallets", name: "Wallets & UPI", type: "ASSET", subtype: "WALLET" },
  {
    code: SystemAccountCodes.investments,
    name: "Investments",
    type: "ASSET",
    subtype: "BROKERAGE",
    isSystem: true,
  },
  { code: "Assets:Retirement", name: "EPF, PPF & NPS", type: "ASSET", subtype: "RETIREMENT" },
  { code: "Assets:Property", name: "Property", type: "ASSET", subtype: "REAL_ESTATE" },
  { code: "Assets:Vehicles", name: "Vehicles", type: "ASSET", subtype: "VEHICLE" },
  { code: "Assets:Jewellery", name: "Jewellery & Metals", type: "ASSET", subtype: "PRECIOUS_METAL" },
  { code: "Assets:Receivables", name: "Money Owed to Me", type: "ASSET", subtype: "RECEIVABLE" },

  // ── Liabilities ───────────────────────────────────────────────────────────
  { code: "Liabilities", name: "Liabilities", type: "LIABILITY" },
  { code: "Liabilities:Credit Cards", name: "Credit Cards", type: "LIABILITY", subtype: "CREDIT_CARD" },
  { code: "Liabilities:Loans", name: "Loans", type: "LIABILITY", subtype: "LOAN" },
  { code: "Liabilities:Payables", name: "Money I Owe", type: "LIABILITY", subtype: "OTHER" },

  // ── Equity ────────────────────────────────────────────────────────────────
  { code: "Equity", name: "Equity", type: "EQUITY", isSystem: true },
  {
    code: SystemAccountCodes.openingBalances,
    name: "Opening Balances",
    type: "EQUITY",
    isSystem: true,
  },

  // ── Income ────────────────────────────────────────────────────────────────
  { code: "Income", name: "Income", type: "INCOME" },
  { code: "Income:Salary", name: "Salary", type: "INCOME" },
  { code: "Income:Business", name: "Business & Freelance", type: "INCOME" },
  { code: "Income:Rent", name: "Rental Income", type: "INCOME" },
  { code: "Income:Investing", name: "Investment Income", type: "INCOME" },
  { code: SystemAccountCodes.dividends, name: "Dividends", type: "INCOME", isSystem: true },
  { code: SystemAccountCodes.interestIncome, name: "Interest", type: "INCOME", isSystem: true },
  { code: "Income:Refunds", name: "Refunds & Cashback", type: "INCOME" },
  { code: "Income:Gifts", name: "Gifts Received", type: "INCOME" },
  {
    code: SystemAccountCodes.uncategorizedIncome,
    name: "Uncategorized Income",
    type: "INCOME",
    isSystem: true,
  },

  // ── Expenses ──────────────────────────────────────────────────────────────
  { code: "Expenses", name: "Expenses", type: "EXPENSE" },
  { code: "Expenses:Food", name: "Food", type: "EXPENSE" },
  { code: "Expenses:Food:Groceries", name: "Groceries", type: "EXPENSE" },
  { code: "Expenses:Food:Eating Out", name: "Eating Out & Delivery", type: "EXPENSE" },
  { code: "Expenses:Housing", name: "Housing", type: "EXPENSE" },
  { code: "Expenses:Housing:Rent", name: "Rent", type: "EXPENSE" },
  { code: "Expenses:Housing:Maintenance", name: "Society & Maintenance", type: "EXPENSE" },
  { code: "Expenses:Utilities", name: "Utilities", type: "EXPENSE" },
  { code: "Expenses:Utilities:Electricity", name: "Electricity", type: "EXPENSE" },
  { code: "Expenses:Utilities:Gas", name: "Gas", type: "EXPENSE" },
  { code: "Expenses:Utilities:Water", name: "Water", type: "EXPENSE" },
  { code: "Expenses:Utilities:Internet", name: "Internet & Broadband", type: "EXPENSE" },
  { code: "Expenses:Utilities:Mobile", name: "Mobile & Recharge", type: "EXPENSE" },
  { code: "Expenses:Transport", name: "Transport", type: "EXPENSE" },
  { code: "Expenses:Transport:Fuel", name: "Fuel", type: "EXPENSE" },
  { code: "Expenses:Transport:Cabs", name: "Cabs & Auto", type: "EXPENSE" },
  { code: "Expenses:Transport:Public", name: "Metro, Bus & Rail", type: "EXPENSE" },
  { code: "Expenses:Transport:Vehicle", name: "Servicing & Parking", type: "EXPENSE" },
  { code: "Expenses:Health", name: "Health", type: "EXPENSE" },
  { code: "Expenses:Health:Medical", name: "Doctor & Medicines", type: "EXPENSE" },
  { code: "Expenses:Health:Fitness", name: "Fitness", type: "EXPENSE" },
  { code: "Expenses:Insurance", name: "Insurance Premiums", type: "EXPENSE" },
  { code: "Expenses:Education", name: "Education", type: "EXPENSE" },
  { code: "Expenses:Shopping", name: "Shopping", type: "EXPENSE" },
  { code: "Expenses:Shopping:Clothing", name: "Clothing", type: "EXPENSE" },
  { code: "Expenses:Shopping:Electronics", name: "Electronics", type: "EXPENSE" },
  { code: "Expenses:Shopping:Home", name: "Home & Furniture", type: "EXPENSE" },
  { code: "Expenses:Entertainment", name: "Entertainment", type: "EXPENSE" },
  { code: "Expenses:Entertainment:Subscriptions", name: "Subscriptions", type: "EXPENSE" },
  { code: "Expenses:Travel", name: "Travel & Holidays", type: "EXPENSE" },
  { code: "Expenses:Personal", name: "Personal Care", type: "EXPENSE" },
  { code: "Expenses:Household Help", name: "Household Help", type: "EXPENSE" },
  { code: "Expenses:Gifts", name: "Gifts & Donations", type: "EXPENSE" },
  { code: "Expenses:Family", name: "Family Support", type: "EXPENSE" },
  { code: "Expenses:Fees", name: "Fees & Charges", type: "EXPENSE" },
  { code: "Expenses:Fees:Bank", name: "Bank Charges", type: "EXPENSE" },
  { code: "Expenses:Fees:Interest", name: "Interest Paid", type: "EXPENSE" },
  { code: "Expenses:Taxes", name: "Taxes", type: "EXPENSE" },
  { code: "Expenses:Taxes:Income Tax", name: "Income Tax & TDS", type: "EXPENSE" },
  { code: "Expenses:Investing", name: "Investing Costs", type: "EXPENSE" },
  {
    code: SystemAccountCodes.investingCharges,
    name: "Brokerage & Charges",
    type: "EXPENSE",
    isSystem: true,
  },
  {
    code: SystemAccountCodes.uncategorizedExpense,
    name: "Uncategorized",
    type: "EXPENSE",
    isSystem: true,
  },
];

/** A seed row with its strings turned into value objects. */
export interface ResolvedSeedAccount {
  code: AccountCode;
  name: string;
  type: AccountType;
  subtype: AccountSubtype | null;
  isSystem: boolean;
  sortOrder: number;
}

export function resolveDefaultChart(): ResolvedSeedAccount[] {
  return DEFAULT_CHART.map((seed, index) => ({
    code: AccountCode.parse(seed.code),
    name: seed.name,
    type: AccountType.of(seed.type),
    subtype: seed.subtype ?? null,
    isSystem: seed.isSystem ?? false,
    // Preserve the declaration order above as the display order.
    sortOrder: index,
  }));
}

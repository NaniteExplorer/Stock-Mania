import { relations } from "drizzle-orm";
import {
  check,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
  type AnySQLiteColumn,
} from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { users } from "./auth";
import {
  calendarDate,
  createdAt,
  currencyCode,
  moneyMinor,
  updatedAt,
} from "./columns";

/** The five account types. See ARCHITECTURE.md §4 for normal balances. */
export const ACCOUNT_TYPES = ["ASSET", "LIABILITY", "EQUITY", "INCOME", "EXPENSE"] as const;
export type AccountTypeName = (typeof ACCOUNT_TYPES)[number];

/**
 * What kind of real-world thing an asset/liability account represents. Purely
 * presentational — it drives grouping and iconography, never arithmetic, which
 * always keys off `type`.
 */
export const ACCOUNT_SUBTYPES = [
  "BANK",
  "CASH",
  "WALLET",
  "CREDIT_CARD",
  "LOAN",
  "BROKERAGE",
  "RETIREMENT",
  "REAL_ESTATE",
  "VEHICLE",
  "PRECIOUS_METAL",
  "RECEIVABLE",
  "OTHER",
] as const;

export const ENTRY_KINDS = [
  "OPENING",
  "EXPENSE",
  "INCOME",
  "TRANSFER",
  "TRADE",
  "ADJUSTMENT",
  "REVERSAL",
] as const;

export const ENTRY_SOURCES = ["MANUAL", "IMPORT", "TRADE"] as const;

/**
 * The chart of accounts, as a tree via `parentId`.
 *
 * `code` is the human-readable path (`Assets:Bank:HDFC`) and is unique per user,
 * so imports and seed data can reference an account without knowing its uuid.
 */
export const ledgerAccounts = sqliteTable(
  "ledger_accounts",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    name: text("name").notNull(),
    type: text("type", { enum: ACCOUNT_TYPES }).notNull(),
    subtype: text("subtype", { enum: ACCOUNT_SUBTYPES }),
    parentId: text("parent_id").references((): AnySQLiteColumn => ledgerAccounts.id, {
      onDelete: "restrict",
    }),
    currency: currencyCode(),
    /** Bank/broker name, for display and logo lookup. */
    institution: text("institution"),
    /** Last four digits of the account or card, when the user supplied them. */
    accountNumberSuffix: text("account_number_suffix", { length: 4 }),
    /** Closed accounts keep their history but are hidden from pickers. */
    isClosed: integer("is_closed", { mode: "boolean" }).notNull().default(false),
    /**
     * True for the handful of accounts the app creates and depends on by code
     * (Equity:OpeningBalances, Expenses:Investing:Charges). Not user-deletable.
     */
    isSystem: integer("is_system", { mode: "boolean" }).notNull().default(false),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("ledger_accounts_user_code_uq").on(table.userId, table.code),
    index("ledger_accounts_user_type_idx").on(table.userId, table.type),
    index("ledger_accounts_parent_idx").on(table.parentId),
  ],
);

/**
 * A journal entry: the atomic financial event. Its postings must balance, which
 * the domain enforces on construction — the database cannot express "the sum of
 * these child rows is zero", so the invariant lives in `JournalEntry`.
 *
 * Append-only. A mistake is corrected with a REVERSAL entry pointing at the
 * original via `reversesEntryId`, never by updating history.
 */
export const journalEntries = sqliteTable(
  "journal_entries",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** The date the money moved, not when the row was written. */
    postedOn: calendarDate("posted_on").notNull(),
    narration: text("narration").notNull(),
    kind: text("kind", { enum: ENTRY_KINDS }).notNull(),
    source: text("source", { enum: ENTRY_SOURCES }).notNull().default("MANUAL"),
    /** Bank reference / cheque number / UTR, when known. */
    reference: text("reference"),
    importBatchId: text("import_batch_id"),
    reversesEntryId: text("reverses_entry_id").references(
      (): AnySQLiteColumn => journalEntries.id,
      { onDelete: "restrict" },
    ),
    /**
     * Stable hash of (account, date, amount, description) for imported rows.
     * The unique index below is what makes re-importing an overlapping statement
     * idempotent instead of duplicating months of transactions.
     */
    fingerprint: text("fingerprint"),
    createdAt: createdAt(),
  },
  (table) => [
    index("journal_entries_user_date_idx").on(table.userId, table.postedOn),
    index("journal_entries_batch_idx").on(table.importBatchId),
    uniqueIndex("journal_entries_fingerprint_uq").on(table.userId, table.fingerprint),
  ],
);

/**
 * One leg of an entry. `amountMinor` is always positive; `direction` carries the
 * sign, which is what keeps "is this a negative expense or a positive refund?"
 * from ever being ambiguous.
 */
export const postings = sqliteTable(
  "postings",
  {
    id: text("id").primaryKey(),
    entryId: text("entry_id")
      .notNull()
      .references(() => journalEntries.id, { onDelete: "cascade" }),
    accountId: text("account_id")
      .notNull()
      .references(() => ledgerAccounts.id, { onDelete: "restrict" }),
    direction: text("direction", { enum: ["DEBIT", "CREDIT"] }).notNull(),
    amountMinor: moneyMinor("amount_minor").notNull(),
    currency: currencyCode(),
    /** Position within the entry, so a re-read renders the legs in written order. */
    seq: integer("seq").notNull().default(0),
    /** Per-leg detail, e.g. which line of a split bill this is. */
    memo: text("memo"),
  },
  (table) => [
    index("postings_account_idx").on(table.accountId),
    index("postings_entry_idx").on(table.entryId),
    check("postings_amount_positive", sql`${table.amountMinor} > 0`),
  ],
);

export const ledgerAccountRelations = relations(ledgerAccounts, ({ one, many }) => ({
  parent: one(ledgerAccounts, {
    fields: [ledgerAccounts.parentId],
    references: [ledgerAccounts.id],
    relationName: "accountTree",
  }),
  children: many(ledgerAccounts, { relationName: "accountTree" }),
  postings: many(postings),
}));

export const journalEntryRelations = relations(journalEntries, ({ many }) => ({
  postings: many(postings),
}));

export const postingRelations = relations(postings, ({ one }) => ({
  entry: one(journalEntries, {
    fields: [postings.entryId],
    references: [journalEntries.id],
  }),
  account: one(ledgerAccounts, {
    fields: [postings.accountId],
    references: [ledgerAccounts.id],
  }),
}));

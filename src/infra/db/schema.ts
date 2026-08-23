/**
 * The whole database schema, in one file.
 *
 * Consolidated from the eight files under `src/db/schema/`, in dependency order:
 * the shared column builders first, then auth (whose names better-auth dictates),
 * then the ledger every other section references.
 *
 * Money is an `INTEGER` count of minor units — never a float, never a decimal
 * string. `Money` already holds exactly that integer, so the value crosses the
 * driver boundary without conversion. `tests/schema-integrity.spec.ts` asserts no
 * floating-point column can appear here.
 *
 * Phase 1f widens this considerably: `deleted_at` on every user-facing table,
 * append-only `audit_events` and `ledger_events`, bitemporal quotes, and the
 * seeded legality / tax-rule / charge-rate tables.
 */

import { relations, sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  sqliteTable,
  text,
  type AnySQLiteColumn,
  uniqueIndex
} from "drizzle-orm/sqlite-core";

/* ═══ Shared column builders ════════════════════════════════════════════ */

/**
 * Shared column builders.
 *
 * Money is an `INTEGER` count of minor units (paise) — never a float, and never
 * a decimal string. `Money` already holds exactly this integer, so the value
 * crosses the driver boundary without conversion, which is the property the old
 * float column lacked.
 *
 * Every builder is a function because Drizzle column builders are stateful;
 * reusing one instance across tables corrupts the schema.
 */

/** Count of minor units. Suffix the field name `Minor` to keep call sites honest. */
export const moneyMinor = (name: string) => integer(name);

/** Unit count scaled by 1e8 — see `Quantity`. */
export const quantityScaled = (name: string) => integer(name);

/** Percentage scaled by 1e6 — see `Percentage`. */
export const percentScaled = (name: string) => integer(name);

/** A calendar date as `YYYY-MM-DD`, which sorts correctly as text in SQL. */
export const calendarDate = (name: string) => text(name);

/** An instant, in epoch milliseconds. */
export const timestamp = (name: string) => integer(name, { mode: "timestamp_ms" });

/** `createdAt` / `updatedAt`, defaulted by the database. */
export const createdAt = () =>
  timestamp("created_at")
    .notNull()
    .default(sql`(unixepoch() * 1000)`);

export const updatedAt = () =>
  timestamp("updated_at")
    .notNull()
    .default(sql`(unixepoch() * 1000)`);

/** ISO 4217 code. Stored per row so a foreign holding cannot lose its currency. */
export const currencyCode = () => text("currency", { length: 3 }).notNull().default("INR");

/**
 * Soft-delete tombstone. NULL means live.
 *
 * Invariant A03: nothing is hard-deleted. Every user-facing table carries this,
 * and every read goes through a `v_*` view that filters it, so a forgotten
 * `WHERE deleted_at IS NULL` cannot silently resurrect a deleted row.
 *
 * The append-only logs (`audit_events`, `ledger_events`, `price_quotes`) do NOT
 * carry it: a tombstone on an immutable log is a contradiction, and a corrected
 * quote is a new bitemporal row rather than a deletion.
 */
export const deletedAt = () => timestamp("deleted_at");

/* ═══ Auth (better-auth owns these names) ═══════════════════════════════ */

/**
 * better-auth's tables, in the shape its Drizzle adapter expects.
 *
 * Column and table names are dictated by the library, so they are the one place
 * in the schema that does not follow our own naming — do not "tidy" them.
 * `user.id` is the `userId` every other table scopes its rows by.
 */

export const users = sqliteTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: integer("emailVerified", { mode: "boolean" }).notNull().default(false),
  image: text("image"),
  createdAt: integer("createdAt", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
  updatedAt: integer("updatedAt", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

export const sessions = sqliteTable(
  "session",
  {
    id: text("id").primaryKey(),
    token: text("token").notNull().unique(),
    expiresAt: integer("expiresAt", { mode: "timestamp_ms" }).notNull(),
    ipAddress: text("ipAddress"),
    userAgent: text("userAgent"),
    userId: text("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: integer("createdAt", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updatedAt", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [index("session_user_idx").on(table.userId)],
);

/** OAuth links and the password hash for email/password sign-in. */
export const authAccounts = sqliteTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("accountId").notNull(),
    providerId: text("providerId").notNull(),
    userId: text("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accessToken: text("accessToken"),
    refreshToken: text("refreshToken"),
    idToken: text("idToken"),
    accessTokenExpiresAt: integer("accessTokenExpiresAt", { mode: "timestamp_ms" }),
    refreshTokenExpiresAt: integer("refreshTokenExpiresAt", { mode: "timestamp_ms" }),
    scope: text("scope"),
    password: text("password"),
    createdAt: integer("createdAt", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updatedAt", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [index("auth_account_user_idx").on(table.userId)],
);

/** Email-verification and password-reset tokens. */
export const verifications = sqliteTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: integer("expiresAt", { mode: "timestamp_ms" }).notNull(),
    createdAt: integer("createdAt", { mode: "timestamp_ms" }),
    updatedAt: integer("updatedAt", { mode: "timestamp_ms" }),
  },
  (table) => [index("verification_identifier_idx").on(table.identifier)],
);

/* ═══ Ledger — accounts, transactions, postings ═════════════════════════ */

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
  "SAVINGS",
  "CASH",
  "WALLET",
  "DEPOSIT",
  "CREDIT_CARD",
  "LOAN",
  "MORTGAGE",
  "BROKERAGE",
  "RETIREMENT",
  "REAL_ESTATE",
  "VEHICLE",
  "PRECIOUS_METAL",
  "RECEIVABLE",
  "OPENING",
  "ADJUSTMENT",
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
 * The remaining enum catalogue — `20-DOMAIN-MODEL.md` §2.
 *
 * Stored as TEXT with a Drizzle `enum` constraint rather than a native SQLite
 * type, so adding a value is a code change and not a table rebuild.
 */

/** §2.3, the 18 transaction types. Supersedes the 7 loose `ENTRY_KINDS`. */
export const TRANSACTION_KINDS = [
  "OPENING_BALANCE",
  "WITHDRAWAL",
  "DEPOSIT",
  "TRANSFER",
  "RECONCILIATION",
  "LIABILITY_CREDIT",
  "BUY",
  "SELL",
  "DIVIDEND",
  "INTEREST",
  "FEE",
  "TAX",
  "REFUND",
  "FX_CONVERSION",
  "CORPORATE_ACTION",
  "TRANSFER_IN_KIND",
  "VALUATION_ADJUSTMENT",
  "REVERSAL",
] as const;
export type TransactionKindName = (typeof TRANSACTION_KINDS)[number];

/** §2.6. A reconciled posting is immutable — invariant L10. */
export const POSTING_STATUSES = ["PENDING", "CLEARED", "RECONCILED", "VOID"] as const;
export type PostingStatusName = (typeof POSTING_STATUSES)[number];

/** §2.4. Absent from every reference implementation; see 40-MARKET-DATA.md §5. */
export const CORPORATE_ACTION_TYPES = [
  "SPLIT",
  "REVERSE_SPLIT",
  "BONUS",
  "RIGHTS",
  "MERGER",
  "DEMERGER",
  "SPINOFF",
  "DIVIDEND_CASH",
  "DIVIDEND_STOCK",
  "RETURN_OF_CAPITAL",
] as const;

export const CORPORATE_ACTION_STATUSES = ["PENDING", "APPLIED", "REJECTED"] as const;

/** §2.5. Set per account, overridable per disposal. */
export const LOT_METHODS = ["FIFO", "LIFO", "AVERAGE", "HIFO", "SPECIFIC_ID"] as const;
export type LotMethodName = (typeof LOT_METHODS)[number];

/** §2.6. `EXEMPT` and `SLAB` are outcomes, not holding periods. */
export const GAIN_TERMS = ["SHORT_TERM", "LONG_TERM", "EXEMPT", "SLAB"] as const;

/** §2.6, quote types. A NAV and a close are not interchangeable. */
export const QUOTE_TYPES = [
  "CLOSE",
  "ADJUSTED_CLOSE",
  "NAV",
  "BID",
  "ASK",
  "MID",
  "LAST",
  "SETTLEMENT",
  "MARK",
] as const;
export type QuoteTypeName = (typeof QUOTE_TYPES)[number];

/**
 * §2.6, where a price came from.
 *
 * `CARRIED_FORWARD` is a first-class source rather than a flag: a price carried
 * from an earlier date is a different claim from one observed on the date, and
 * conflating them is how a stale valuation looks fresh.
 */
export const PRICE_SOURCE_TYPES = [
  "PROVIDER",
  "MANUAL",
  "DERIVED",
  "BROKER",
  "CARRIED_FORWARD",
] as const;
export type PriceSourceTypeName = (typeof PRICE_SOURCE_TYPES)[number];

/** §2.6. Nothing enters the ledger before `CONFIRMED` — invariant I01. */
export const IMPORT_ROW_STATUSES = [
  "DRAFT",
  "PARSED",
  "MATCHED",
  "CONFIRMED",
  "REJECTED",
] as const;

/** §2.6. Flat quoting is common in Indian consumer lending and overstates nothing by accident. */
export const INTEREST_TYPES = ["SIMPLE", "COMPOUND", "FLAT", "REDUCING_BALANCE"] as const;

export const COMPOUNDING_FREQUENCIES = [
  "DAILY",
  "MONTHLY",
  "QUARTERLY",
  "HALF_YEARLY",
  "ANNUALLY",
  "AT_MATURITY",
] as const;

export const AMORTISATION_METHODS = [
  "EQUAL_INSTALMENT",
  "EQUAL_PRINCIPAL",
  "INTEREST_ONLY",
  "BULLET",
  "CUSTOM",
] as const;

/** What a charge does to taxable gain — a property of the charge, not a comment. */
export const CHARGE_DEDUCTIBILITY = ["DEDUCTIBLE", "NON_DEDUCTIBLE", "CAPITALISED"] as const;

export const CHARGE_TYPES = [
  "BROKERAGE",
  "STT",
  "EXCHANGE_TXN",
  "SEBI_TURNOVER",
  "STAMP_DUTY",
  "GST",
  "DP_CHARGES",
  "OTHER",
] as const;

export const TRADE_SEGMENTS = ["EQ_DELIVERY", "EQ_INTRADAY"] as const;

/** Which side a charge applies to. STT is sell-only intraday; stamp duty is buy-only. */
export const CHARGE_SIDES = ["BUY", "SELL", "BOTH"] as const;

/** A projection is scoped one of two ways, and they invalidate differently. */
export const PROJECTION_SCOPES = ["PERIOD", "CUMULATIVE"] as const;

/** What an audited action did. Append-only; see `auditEvents`. */
export const AUDIT_ACTIONS = ["CREATE", "UPDATE", "SOFT_DELETE", "REVERSE", "RESTORE"] as const;
export type AuditActionName = (typeof AUDIT_ACTIONS)[number];


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
    /**
     * Bumped on every mutation touching this account. A cached projection
     * records the revision vector it was computed from, so a stale row is
     * detectable rather than merely old — invariant B04.
     */
    revision: integer("revision").notNull().default(0),
    /**
     * The earliest accounting date any posting on this account affects. A
     * backdated write lowers it, which is what lets the cache invalidate
     * period-scoped projections precisely instead of dropping all of them.
     */
    minAffectedDate: calendarDate("min_affected_date"),
    deletedAt: deletedAt(),
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
    deletedAt: deletedAt(),
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

    /*
     * The commodity columns (20-DOMAIN-MODEL.md §3.4). Present only when this
     * posting moves an instrument rather than pure money, which is what lets one
     * postings table carry a grocery bill and an equity buy.
     */
    instrumentId: text("instrument_id").references(() => instruments.id, {
      onDelete: "restrict",
    }),
    /** Signed units — negative on a disposal. Scaled integer, never a float. */
    quantityScaled: quantityScaled("quantity_scaled"),
    /** Cost per unit in this posting's currency. */
    unitCostMinor: moneyMinor("unit_cost_minor"),

    /** Budget category. Mutually exclusive with `instrumentId` — invariant L12. */
    categoryId: text("category_id"),
    /** PENDING | CLEARED | RECONCILED | VOID. Reconciled postings are immutable (L10). */
    status: text("status", { enum: POSTING_STATUSES }).notNull().default("CLEARED"),

    deletedAt: deletedAt(),
  },
  (table) => [
    index("postings_account_idx").on(table.accountId),
    index("postings_entry_idx").on(table.entryId),
    index("postings_instrument_idx").on(table.instrumentId),
    check("postings_amount_positive", sql`${table.amountMinor} > 0`),
    /**
     * L04, commodity coherence: either all three commodity columns are absent, or
     * an instrument and a quantity are both present. A quantity with no
     * instrument is a unit count of nothing.
     */
    check(
      "postings_commodity_coherent",
      sql`(${table.instrumentId} IS NULL AND ${table.quantityScaled} IS NULL AND ${table.unitCostMinor} IS NULL)
          OR (${table.instrumentId} IS NOT NULL AND ${table.quantityScaled} IS NOT NULL)`,
    ),
    /** L12: a transfer or a trade leg carries no budget category. */
    check(
      "postings_no_category_on_commodity",
      sql`NOT (${table.categoryId} IS NOT NULL AND ${table.instrumentId} IS NOT NULL)`,
    ),
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

/* ═══ Investments — instruments, trades, lots, quotes ═══════════════════ */

export const INSTRUMENT_KINDS = [
  "EQUITY",
  "ETF",
  "MUTUAL_FUND",
  "BOND",
  "GOVT_SECURITY",
  "DIGITAL_GOLD",
  "DIGITAL_SILVER",
  "CRYPTO",
  "OTHER",
] as const;
export type InstrumentKindName = (typeof INSTRUMENT_KINDS)[number];

/**
 * Tax treatment class. Kept separate from `kind` because they genuinely diverge:
 * an equity *mutual fund* is taxed like equity, a debt fund is not, and gold ETFs
 * changed class in the 2023 budget. Storing the class explicitly means a past
 * trade keeps the treatment it was bought under.
 */
export const TAX_ASSET_CLASSES = [
  "LISTED_EQUITY",
  "EQUITY_MUTUAL_FUND",
  "DEBT",
  "GOLD",
  "CRYPTO",
  "UNLISTED",
  "OTHER",
] as const;

export const QUOTE_SOURCES = ["MANUAL", "AMFI", "NSE", "METALS"] as const;

export const instruments = sqliteTable(
  "instruments",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Ticker, scheme code, or whatever the user recognises it by. */
    symbol: text("symbol").notNull(),
    name: text("name").notNull(),
    kind: text("kind", { enum: INSTRUMENT_KINDS }).notNull(),
    taxAssetClass: text("tax_asset_class", { enum: TAX_ASSET_CLASSES }).notNull(),
    isin: text("isin", { length: 12 }),
    exchange: text("exchange"),
    currency: currencyCode(),
    /**
     * Where a price refresh comes from, and the identifier that source needs
     * (an AMFI scheme code is not the same string as an NSE symbol).
     */
    quoteSource: text("quote_source", { enum: QUOTE_SOURCES }).notNull().default("MANUAL"),
    quoteSourceRef: text("quote_source_ref"),
    /**
     * The ASSET account this holding's value lives in. Every trade posts to it,
     * which is what keeps the portfolio and the ledger from disagreeing.
     */
    assetAccountId: text("asset_account_id")
      .notNull()
      .references(() => ledgerAccounts.id, { onDelete: "restrict" }),
    isClosed: integer("is_closed", { mode: "boolean" }).notNull().default(false),
    deletedAt: deletedAt(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("instruments_user_symbol_uq").on(table.userId, table.symbol),
    index("instruments_user_kind_idx").on(table.userId, table.kind),
  ],
);

/**
 * A buy or sell, with each statutory charge in its own column.
 *
 * They are stored separately rather than as one "fees" total because they behave
 * differently: STT is not deductible against gains, brokerage and transaction
 * charges are, GST applies only to the brokerage-and-fees subtotal, and stamp
 * duty is buy-side only. A single lumped number cannot answer any of that later.
 */
export const trades = sqliteTable(
  "trades",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    instrumentId: text("instrument_id")
      .notNull()
      .references(() => instruments.id, { onDelete: "cascade" }),
    side: text("side", { enum: ["BUY", "SELL"] }).notNull(),
    tradedOn: calendarDate("traded_on").notNull(),
    quantity: quantityScaled("quantity").notNull(),
    pricePerUnitMinor: moneyMinor("price_per_unit_minor").notNull(),

    brokerageMinor: moneyMinor("brokerage_minor").notNull().default(0),
    /** Securities Transaction Tax — a cost, but never deductible against gains. */
    sttMinor: moneyMinor("stt_minor").notNull().default(0),
    exchangeTxnChargeMinor: moneyMinor("exchange_txn_charge_minor").notNull().default(0),
    sebiTurnoverFeeMinor: moneyMinor("sebi_turnover_fee_minor").notNull().default(0),
    /** Buy-side only. */
    stampDutyMinor: moneyMinor("stamp_duty_minor").notNull().default(0),
    /** GST on brokerage + exchange + SEBI fees. */
    gstMinor: moneyMinor("gst_minor").notNull().default(0),
    /** Depository charges, levied per sell scrip per day. */
    dpChargesMinor: moneyMinor("dp_charges_minor").notNull().default(0),
    otherChargesMinor: moneyMinor("other_charges_minor").notNull().default(0),

    /** The entry this trade wrote. Deleting a trade reverses that entry. */
    journalEntryId: text("journal_entry_id").references(() => journalEntries.id, {
      onDelete: "restrict",
    }),
    /** Which of the user's accounts the cash came from or went to. */
    settlementAccountId: text("settlement_account_id").references(() => ledgerAccounts.id, {
      onDelete: "restrict",
    }),
    notes: text("notes"),
    deletedAt: deletedAt(),
    createdAt: createdAt(),
  },
  (table) => [
    index("trades_user_instrument_idx").on(table.userId, table.instrumentId, table.tradedOn),
    index("trades_user_date_idx").on(table.userId, table.tradedOn),
    check("trades_quantity_positive", sql`${table.quantity} > 0`),
    check("trades_price_non_negative", sql`${table.pricePerUnitMinor} >= 0`),
  ],
);

/**
 * An open (or partly consumed) purchase lot.
 *
 * Cost basis is split into the price paid and the buy charges attributed to the
 * lot, because the two are reported differently: charges are capitalized into
 * "amount invested" for return purposes and deductible for tax purposes, and
 * conflating them overstates the gain.
 */
export const lots = sqliteTable(
  "lots",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    instrumentId: text("instrument_id")
      .notNull()
      .references(() => instruments.id, { onDelete: "cascade" }),
    buyTradeId: text("buy_trade_id")
      .notNull()
      .references(() => trades.id, { onDelete: "cascade" }),
    acquiredOn: calendarDate("acquired_on").notNull(),
    originalQuantity: quantityScaled("original_quantity").notNull(),
    /** Decremented as sells consume it; zero means fully realized. */
    remainingQuantity: quantityScaled("remaining_quantity").notNull(),
    costPerUnitMinor: moneyMinor("cost_per_unit_minor").notNull(),
    /** Buy charges apportioned to this lot, on the original quantity. */
    buyChargesMinor: moneyMinor("buy_charges_minor").notNull().default(0),
    currency: currencyCode(),
    deletedAt: deletedAt(),
    createdAt: createdAt(),
  },
  (table) => [
    // FIFO consumption reads open lots oldest-first; this index is that query.
    index("lots_open_fifo_idx").on(table.instrumentId, table.acquiredOn, table.remainingQuantity),
    index("lots_user_idx").on(table.userId),
    check("lots_remaining_within_original", sql`${table.remainingQuantity} >= 0`),
  ],
);

/**
 * The realized-gain record produced when a sell consumes a lot.
 *
 * Written once and never recomputed, so a past year's tax figure does not change
 * when this year's rules do. `holdingDays` is stored for the same reason: it
 * fixes the short/long-term determination at the moment of sale.
 */
export const lotMatches = sqliteTable(
  "lot_matches",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    sellTradeId: text("sell_trade_id")
      .notNull()
      .references(() => trades.id, { onDelete: "cascade" }),
    lotId: text("lot_id")
      .notNull()
      .references(() => lots.id, { onDelete: "cascade" }),
    quantity: quantityScaled("quantity").notNull(),
    /** Gross sale value of the matched units. */
    proceedsMinor: moneyMinor("proceeds_minor").notNull(),
    /** Purchase price of the matched units, excluding charges. */
    costBasisMinor: moneyMinor("cost_basis_minor").notNull(),
    buyChargesMinor: moneyMinor("buy_charges_minor").notNull().default(0),
    sellChargesMinor: moneyMinor("sell_charges_minor").notNull().default(0),
    /** proceeds − (cost basis + deductible buy + sell charges). */
    realizedGainMinor: moneyMinor("realized_gain_minor").notNull(),
    holdingDays: integer("holding_days").notNull(),
    taxTier: text("tax_tier", { enum: ["STCG", "LTCG", "SLAB", "EXEMPT"] }).notNull(),
    estimatedTaxMinor: moneyMinor("estimated_tax_minor").notNull().default(0),
    /** Financial year the gain is reported in, e.g. `2025-26`. */
    financialYear: text("financial_year").notNull(),
    currency: currencyCode(),
    deletedAt: deletedAt(),
    createdAt: createdAt(),
  },
  (table) => [
    index("lot_matches_user_fy_idx").on(table.userId, table.financialYear),
    index("lot_matches_sell_idx").on(table.sellTradeId),
  ],
);

/**
 * Observed prices. Append-only history rather than a single mutable
 * `currentPrice` column, so the net-worth timeline can be rebuilt at past dates
 * instead of being frozen at whatever the last refresh wrote.
 */
export const priceQuotes = sqliteTable(
  "price_quotes",
  {
    id: text("id").primaryKey(),
    instrumentId: text("instrument_id")
      .notNull()
      .references(() => instruments.id, { onDelete: "cascade" }),
    /** The date the price refers to. */
    asOf: calendarDate("as_of").notNull(),
    /**
     * Which kind of price. A NAV and a close are not interchangeable, and the old
     * schema could not tell them apart — a mutual fund and an equity both had one
     * "price" per day.
     */
    quoteType: text("quote_type", { enum: QUOTE_TYPES }).notNull().default("CLOSE"),
    priceMinor: moneyMinor("price_minor").notNull(),
    currency: currencyCode(),
    /** Which provider said so. Part of the key, so two may disagree on one date. */
    providerId: text("provider_id").notNull().default("manual"),
    sourceType: text("source_type", { enum: PRICE_SOURCE_TYPES }).notNull().default("MANUAL"),
    /**
     * When we learned it — the second time axis. Invariant Q02 requires
     * `ingestedAt >= as_of`: we cannot know a price before its date.
     */
    ingestedAt: timestamp("ingested_at").notNull(),
    /**
     * Set when a later row corrects this one. A vendor correction inserts and
     * points back; it never overwrites, which is what makes a backtest honest —
     * "what did we believe on the day" stays answerable.
     */
    supersededBy: text("superseded_by"),
    /** Hash of the raw provider payload, for diagnosing a suspect price. */
    rawPayloadHash: text("raw_payload_hash"),
  },
  (table) => [
    /**
     * Bitemporal. `ingestedAt` is deliberately part of the key: the four-column
     * key that `20-DOMAIN-MODEL.md` §3.8 specifies would force a correction to
     * overwrite the original, defeating the bitemporality the column exists for.
     */
    uniqueIndex("price_quotes_bitemporal_uq").on(
      table.instrumentId,
      table.asOf,
      table.quoteType,
      table.providerId,
      table.ingestedAt,
    ),
    /** The resolution-ladder query: newest belief for an instrument, walking back. */
    index("price_quotes_ladder_idx").on(table.instrumentId, table.quoteType, table.asOf),
    /** Scanning current beliefs only. */
    index("price_quotes_current_idx").on(table.instrumentId, table.asOf, table.supersededBy),
    /** Q01: a price is positive. Options and futures are the documented exception, and neither exists yet. */
    check("price_quotes_price_positive", sql`${table.priceMinor} > 0`),
  ],
);

/** Dividends, interest and other income received on a holding — XIRR inflows. */
export const instrumentIncomes = sqliteTable(
  "instrument_incomes",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    instrumentId: text("instrument_id")
      .notNull()
      .references(() => instruments.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["DIVIDEND", "INTEREST", "BONUS", "OTHER"] }).notNull(),
    receivedOn: calendarDate("received_on").notNull(),
    amountMinor: moneyMinor("amount_minor").notNull(),
    taxDeductedMinor: moneyMinor("tax_deducted_minor").notNull().default(0),
    currency: currencyCode(),
    journalEntryId: text("journal_entry_id").references(() => journalEntries.id, {
      onDelete: "restrict",
    }),
    deletedAt: deletedAt(),
    createdAt: createdAt(),
  },
  (table) => [index("instrument_incomes_idx").on(table.instrumentId, table.receivedOn)],
);

export const instrumentRelations = relations(instruments, ({ one, many }) => ({
  assetAccount: one(ledgerAccounts, {
    fields: [instruments.assetAccountId],
    references: [ledgerAccounts.id],
  }),
  trades: many(trades),
  lots: many(lots),
  quotes: many(priceQuotes),
  incomes: many(instrumentIncomes),
}));

export const tradeRelations = relations(trades, ({ one, many }) => ({
  instrument: one(instruments, {
    fields: [trades.instrumentId],
    references: [instruments.id],
  }),
  lots: many(lots),
  matches: many(lotMatches),
}));

export const lotRelations = relations(lots, ({ one, many }) => ({
  instrument: one(instruments, { fields: [lots.instrumentId], references: [instruments.id] }),
  buyTrade: one(trades, { fields: [lots.buyTradeId], references: [trades.id] }),
  matches: many(lotMatches),
}));

/* ═══ Budgeting — category rules and budgets ════════════════════════════ */

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
    deletedAt: deletedAt(),
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
    deletedAt: deletedAt(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [uniqueIndex("budgets_user_account_month_uq").on(table.userId, table.accountId, table.month)],
);

/* ═══ Tax settings ══════════════════════════════════════════════════════ */

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
    deletedAt: deletedAt(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [uniqueIndex("tax_settings_user_fy_uq").on(table.userId, table.financialYear)],
);

/* ═══ Import batches ════════════════════════════════════════════════════ */

/**
 * One import run.
 *
 * Recorded so an import is undoable: every entry it created carries this batch's
 * id, so "undo that import" is a delete by `importBatchId` rather than the user
 * hunting down 200 rows by hand. It also makes the skip counts explainable —
 * "142 rows, 138 imported, 4 already present" beats a silent partial success.
 */
export const importBatches = sqliteTable(
  "import_batches",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["BANK_STATEMENT", "TRADE_BOOK", "HOLDINGS"] }).notNull(),
    /** The account the rows were booked against, for a statement import. */
    accountId: text("account_id").references(() => ledgerAccounts.id, { onDelete: "set null" }),
    fileName: text("file_name").notNull(),
    /** Hash of the file's bytes — flags re-uploading the identical file. */
    fileHash: text("file_hash").notNull(),
    rowsRead: integer("rows_read").notNull().default(0),
    rowsImported: integer("rows_imported").notNull().default(0),
    /** Skipped as already-present duplicates. */
    rowsDuplicate: integer("rows_duplicate").notNull().default(0),
    rowsFailed: integer("rows_failed").notNull().default(0),
    /** Per-row failure messages, as JSON, so the user can fix and retry. */
    problemsJson: text("problems_json"),
    status: text("status", { enum: ["COMPLETED", "PARTIAL", "FAILED", "UNDONE"] }).notNull(),
    completedAt: timestamp("completed_at"),
    deletedAt: deletedAt(),
    createdAt: createdAt(),
  },
  (table) => [index("import_batches_user_idx").on(table.userId, table.createdAt)],
);

/* ═══ Analytics — cached projections ════════════════════════════════════ */

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

/* ═══ Audit and the event log (append-only) ═════════════════════════════ */

/**
 * One row per mutation — invariant A02.
 *
 * Append-only, and there is deliberately no repository method that updates or
 * deletes from it (A01). `tests/schema-guard.spec.ts` greps for one.
 *
 * `beforeJson` / `afterJson` hold the entity either side of the change. That is
 * what makes "why is this number what it is" answerable months later without
 * re-deriving it from a journal that has since moved on.
 */
export const auditEvents = sqliteTable(
  "audit_events",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Who acted. Equal to `userId` today; distinct once anything acts on a user's behalf. */
    actorId: text("actor_id").notNull(),
    action: text("action", { enum: AUDIT_ACTIONS }).notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    beforeJson: text("before_json"),
    afterJson: text("after_json"),
    /** Groups every event from one request, so a multi-aggregate change is one story. */
    requestId: text("request_id").notNull(),
    ipAddress: text("ip_address"),
    at: createdAt(),
  },
  (table) => [
    index("audit_events_user_at_idx").on(table.userId, table.at),
    index("audit_events_entity_idx").on(table.entityType, table.entityId),
    index("audit_events_request_idx").on(table.requestId),
  ],
);

/**
 * The event log the whole state can be rebuilt from — invariant B05.
 *
 * `seq` is the total order a replay follows, which is why it is an autoincrement
 * integer rather than a uuid: a uuid gives no ordering, and "replay in insertion
 * order" is the one property this table exists to provide.
 *
 * `effectiveOn` is the accounting date; `occurredAt` is when we learned. A
 * backdated entry has an old `effectiveOn` and a new `seq`, and keeping both is
 * what makes a correction distinguishable from an original.
 */
export const ledgerEvents = sqliteTable(
  "ledger_events",
  {
    seq: integer("seq").primaryKey({ autoIncrement: true }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    eventType: text("event_type").notNull(),
    aggregateType: text("aggregate_type").notNull(),
    aggregateId: text("aggregate_id").notNull(),
    payloadJson: text("payload_json").notNull(),
    effectiveOn: calendarDate("effective_on"),
    occurredAt: createdAt(),
    requestId: text("request_id").notNull(),
  },
  (table) => [
    index("ledger_events_user_seq_idx").on(table.userId, table.seq),
    index("ledger_events_aggregate_idx").on(table.aggregateType, table.aggregateId),
    index("ledger_events_effective_idx").on(table.userId, table.effectiveOn),
  ],
);

/* ═══ Institutions and counterparties ═══════════════════════════════════ */

/** The bank, broker or scheme an account belongs to — the "parent organisation". */
export const institutions = sqliteTable(
  "institutions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** Matches an id in `src/ui/providers.ts`, for the logo and display name. */
    providerId: text("provider_id"),
    kind: text("kind", { enum: ["BANK", "BROKER", "WALLET", "SCHEME", "LENDER", "OTHER"] }).notNull(),
    country: text("country", { length: 2 }).notNull().default("IN"),
    deletedAt: deletedAt(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [uniqueIndex("institutions_user_name_uq").on(table.userId, table.name)],
);

/**
 * Who a transaction was with.
 *
 * `normalisedName` is the matching key — statements render the same merchant a
 * dozen ways, and normalising once here is what lets the categoriser and the
 * duplicate matcher agree on identity.
 */
export const counterparties = sqliteTable(
  "counterparties",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    normalisedName: text("normalised_name").notNull(),
    /**
     * True for the user's own accounts and family. Moving your own money is not
     * spending, and v1's payee detection for this was a genuinely good idea worth
     * carrying over.
     */
    isSelf: integer("is_self", { mode: "boolean" }).notNull().default(false),
    defaultCategoryId: text("default_category_id"),
    deletedAt: deletedAt(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("counterparties_user_norm_uq").on(table.userId, table.normalisedName),
  ],
);

/* ═══ FX ════════════════════════════════════════════════════════════════ */

/**
 * Exchange rates, with the same bitemporal shape as quotes.
 *
 * `providerRateScaled` and `userRateScaled` are separate columns rather than one
 * rate plus a flag: a user assertion must override a provider for tax purposes
 * without destroying what the provider actually said. Firefly's `user_rate`
 * override is the right storage shape and this keeps it.
 *
 * Rates are scaled integers (1e10), never floats — an FX rate is a rate, and
 * `Rate` is the type that models one.
 */
export const fxRates = sqliteTable(
  "fx_rates",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").references(() => users.id, { onDelete: "cascade" }),
    base: text("base", { length: 3 }).notNull(),
    quote: text("quote", { length: 3 }).notNull(),
    asOf: calendarDate("as_of").notNull(),
    providerId: text("provider_id").notNull(),
    providerRateScaled: integer("provider_rate_scaled"),
    userRateScaled: integer("user_rate_scaled"),
    sourceType: text("source_type", { enum: PRICE_SOURCE_TYPES }).notNull(),
    /**
     * How a DERIVED rate was produced. ECB publishes EUR-based rates only, so
     * USD/INR is (EUR/INR)/(EUR/USD) — and invariant Q06, inverse consistency
     * within 0.1%, is only checkable if both legs are recorded.
     */
    derivation: text("derivation"),
    ingestedAt: createdAt(),
    supersededBy: text("superseded_by"),
  },
  (table) => [
    uniqueIndex("fx_rates_pair_uq").on(
      table.base,
      table.quote,
      table.asOf,
      table.providerId,
      table.ingestedAt,
    ),
    index("fx_rates_lookup_idx").on(table.base, table.quote, table.asOf),
  ],
);

/* ═══ Corporate actions ═════════════════════════════════════════════════ */

/**
 * The critical gap — absent from every reference implementation.
 *
 * Without this a 1:5 split makes a position look like it lost 80% of its value,
 * and cost basis is permanently wrong.
 *
 * Ratios are scaled integers, not floats: a 1:3 split is 1/3 exactly, and a
 * float ratio applied to a lot quantity leaks units. `appliedTransactionId`
 * points at the ledger transaction that effected it, because an action is
 * applied as a transaction and never as an in-place lot edit — that is what makes
 * it visible, auditable and reversible.
 */
export const corporateActions = sqliteTable(
  "corporate_actions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    instrumentId: text("instrument_id")
      .notNull()
      .references(() => instruments.id, { onDelete: "restrict" }),
    actionType: text("action_type", { enum: CORPORATE_ACTION_TYPES }).notNull(),
    exDate: calendarDate("ex_date").notNull(),
    recordDate: calendarDate("record_date"),
    payDate: calendarDate("pay_date"),
    /** A 1:5 split is ratioFrom 1, ratioTo 5. Scaled by 1e8, like a quantity. */
    ratioFromScaled: quantityScaled("ratio_from_scaled"),
    ratioToScaled: quantityScaled("ratio_to_scaled"),
    cashAmountMinor: moneyMinor("cash_amount_minor"),
    currency: currencyCode(),
    /** Mergers and spinoffs land units in a different instrument. */
    targetInstrumentId: text("target_instrument_id").references(() => instruments.id, {
      onDelete: "restrict",
    }),
    source: text("source").notNull(),
    status: text("status", { enum: CORPORATE_ACTION_STATUSES }).notNull().default("PENDING"),
    appliedTransactionId: text("applied_transaction_id"),
    appliedAt: timestamp("applied_at"),
    deletedAt: deletedAt(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("corporate_actions_uq").on(table.instrumentId, table.actionType, table.exDate),
    index("corporate_actions_instrument_idx").on(table.instrumentId, table.exDate),
  ],
);

/* ═══ Import staging ════════════════════════════════════════════════════ */

/**
 * Where an imported row waits — invariant I01.
 *
 * Nothing reaches the ledger before `CONFIRMED`. That is the whole point of the
 * table: a parser's guess about which account a statement line belongs to is a
 * proposal, and a proposal that posts itself is indistinguishable from a fact.
 */
export const importRows = sqliteTable(
  "import_rows",
  {
    id: text("id").primaryKey(),
    batchId: text("batch_id")
      .notNull()
      .references(() => importBatches.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    rowIndex: integer("row_index").notNull(),
    /** The source line, verbatim, so a re-parse never needs the original file. */
    rawJson: text("raw_json").notNull(),
    parsedJson: text("parsed_json"),
    status: text("status", { enum: IMPORT_ROW_STATUSES }).notNull().default("DRAFT"),
    /** Set when the 3-pass matcher claims this row duplicates an existing entry. */
    matchedTransactionId: text("matched_transaction_id"),
    /** Which of the three passes matched, so a bad match is diagnosable. */
    matchPass: integer("match_pass"),
    rejectedReason: text("rejected_reason"),
    deletedAt: deletedAt(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("import_rows_batch_row_uq").on(table.batchId, table.rowIndex),
    index("import_rows_status_idx").on(table.userId, table.status),
  ],
);

/** Uploaded files — contract notes, statements — content-addressed. */
export const documents = sqliteTable(
  "documents",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Invariant I02: re-importing the same bytes is a no-op, detected here. */
    sha256: text("sha256").notNull(),
    filename: text("filename").notNull(),
    mimeType: text("mime_type").notNull(),
    byteLength: integer("byte_length").notNull(),
    storageKey: text("storage_key").notNull(),
    entityType: text("entity_type"),
    entityId: text("entity_id"),
    deletedAt: deletedAt(),
    createdAt: createdAt(),
  },
  (table) => [uniqueIndex("documents_user_sha_uq").on(table.userId, table.sha256)],
);

/* ═══ Projection cache ══════════════════════════════════════════════════ */

/**
 * Cached projections, keyed by the revisions they were computed from.
 *
 * `scope` is load-bearing, and this is where the plan of record needed
 * correcting. Its Phase 1f item says a backdated 2019 entry must not invalidate
 * 2024 — true for a PERIOD projection (an income statement for FY2024-25 is
 * genuinely unaffected) and **false for a CUMULATIVE one** (a 2019 opening
 * balance certainly changes the 2024 closing balance). Erring toward "do not
 * invalidate" produces a silently wrong number, so the two families invalidate by
 * different rules:
 *
 *   PERIOD     — invalidate iff the write's effective date falls inside the period
 *   CUMULATIVE — invalidate iff the write's effective date is on or before `asOf`
 */
export const projectionCache = sqliteTable(
  "projection_cache",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** e.g. `net_worth`, `income_statement`, `allocation`. */
    projection: text("projection").notNull(),
    scope: text("scope", { enum: PROJECTION_SCOPES }).notNull(),
    /** CUMULATIVE: the as-of date. PERIOD: the period start. */
    periodStart: calendarDate("period_start"),
    periodEnd: calendarDate("period_end"),
    asOf: calendarDate("as_of"),
    /** Hash of the sorted (accountId, revision) pairs in scope — invariant B04. */
    revisionVectorHash: text("revision_vector_hash").notNull(),
    payloadJson: text("payload_json").notNull(),
    computedAt: createdAt(),
  },
  (table) => [
    uniqueIndex("projection_cache_key_uq").on(
      table.userId,
      table.projection,
      table.scope,
      table.periodStart,
      table.periodEnd,
      table.asOf,
    ),
    index("projection_cache_user_idx").on(table.userId, table.projection),
  ],
);

/* ═══ Provider bookkeeping ══════════════════════════════════════════════ */

/**
 * When each provider was last asked for what.
 *
 * This is the TTL bookkeeping that Redis would otherwise hold. `price_quotes` is
 * itself the cache — append-only and already keyed by instrument, date, type and
 * provider — so there is nothing to invalidate; all that is missing is a record
 * of when we last tried, which is this.
 */
export const providerFetchLog = sqliteTable(
  "provider_fetch_log",
  {
    id: text("id").primaryKey(),
    providerId: text("provider_id").notNull(),
    instrumentId: text("instrument_id").references(() => instruments.id, {
      onDelete: "cascade",
    }),
    quoteType: text("quote_type", { enum: QUOTE_TYPES }),
    /** The range already covered, so a backfill resumes instead of restarting. */
    coveredFrom: calendarDate("covered_from"),
    coveredThrough: calendarDate("covered_through"),
    lastAttemptAt: timestamp("last_attempt_at"),
    lastSuccessAt: timestamp("last_success_at"),
    lastError: text("last_error"),
    consecutiveFailures: integer("consecutive_failures").notNull().default(0),
  },
  (table) => [
    uniqueIndex("provider_fetch_log_uq").on(
      table.providerId,
      table.instrumentId,
      table.quoteType,
    ),
  ],
);

/**
 * Recorded disagreement between providers.
 *
 * A divergence above 1% is flagged and both rows are kept. Silently picking the
 * higher-priority provider is how bad upstream data becomes invisible.
 */
export const priceDivergences = sqliteTable(
  "price_divergences",
  {
    id: text("id").primaryKey(),
    instrumentId: text("instrument_id")
      .notNull()
      .references(() => instruments.id, { onDelete: "cascade" }),
    asOf: calendarDate("as_of").notNull(),
    quoteType: text("quote_type", { enum: QUOTE_TYPES }).notNull(),
    providerA: text("provider_a").notNull(),
    providerB: text("provider_b").notNull(),
    priceAMinor: moneyMinor("price_a_minor").notNull(),
    priceBMinor: moneyMinor("price_b_minor").notNull(),
    currency: currencyCode(),
    /** Scaled by 1e6, like every other percentage. */
    deltaPercentScaled: percentScaled("delta_percent_scaled").notNull(),
    detectedAt: createdAt(),
  },
  (table) => [
    index("price_divergences_instrument_idx").on(table.instrumentId, table.asOf),
  ],
);

/* ═══ Seeded reference data ═════════════════════════════════════════════ */

/**
 * The legality matrix, as data — `20-DOMAIN-MODEL.md` §3.6.
 *
 * Adopted from Firefly's matrix and extended for investments. Held as rows rather
 * than code so a rejection message can name the missing row, which makes the
 * error message double as the fix.
 *
 * `EXPENSE` never appears as a source. That is invariant L07, and it is L06's
 * data rather than a second check — there is simply no such row to find.
 */
export const txnTypeLegality = sqliteTable(
  "txn_type_legality",
  {
    txnType: text("txn_type", { enum: TRANSACTION_KINDS }).notNull(),
    sourceRole: text("source_role").notNull(),
    destinationRole: text("destination_role").notNull(),
  },
  (table) => [
    uniqueIndex("txn_type_legality_pk").on(
      table.txnType,
      table.sourceRole,
      table.destinationRole,
    ),
  ],
);

/**
 * Capital-gains rules per category and effective date — `30-CALCULATIONS.md` §6.
 *
 * A mirror of the constants frozen inside each shipped `TaxRegime`, so SQL
 * reporting can join against them. `tests/tax-regimes.spec.ts` asserts the mirror
 * matches, because two sources of truth that can disagree eventually do.
 *
 * A NULL `stcgRateScaled` means "taxed at slab", which is a different statement
 * from a zero rate.
 */
export const taxRules = sqliteTable(
  "tax_rules",
  {
    jurisdiction: text("jurisdiction").notNull().default("IN"),
    regime: text("regime").notNull(),
    taxCategory: text("tax_category").notNull(),
    effectiveFrom: calendarDate("effective_from").notNull(),
    effectiveTo: calendarDate("effective_to"),
    longTermDays: integer("long_term_days"),
    ltcgRateScaled: percentScaled("ltcg_rate_scaled"),
    stcgRateScaled: percentScaled("stcg_rate_scaled"),
    indexationAllowed: integer("indexation_allowed", { mode: "boolean" })
      .notNull()
      .default(false),
    grandfatherDate: calendarDate("grandfather_date"),
    exemptionLimitMinor: moneyMinor("exemption_limit_minor"),
    currency: currencyCode(),
  },
  (table) => [
    uniqueIndex("tax_rules_pk").on(
      table.jurisdiction,
      table.regime,
      table.taxCategory,
      table.effectiveFrom,
    ),
  ],
);

/**
 * The Cost Inflation Index, one value per financial year.
 *
 * Shipped as seed data on principle: it is roughly one number a year, published
 * by notification. Paisa fetches it from a personal domain, which is a network
 * dependency for a value that could be a constant.
 */
export const costInflationIndex = sqliteTable("cost_inflation_index", {
  financialYear: text("financial_year").primaryKey(),
  value: integer("value").notNull(),
});

/**
 * Broker charge rates, effective-dated — `30-CALCULATIONS.md` §1, `70` Phase 1d.
 *
 * The classes in `domain/charges.ts` hold the *structure* (which charges apply,
 * in what order, on what basis); this table holds the *numbers*. A broker
 * changing its brokerage is a new row with a later `effectiveFrom`, and a
 * contract note from last year still reproduces exactly.
 *
 * `roundingUnit` is not decoration. STT and stamp duty round to the whole rupee;
 * leaving them at paise precision is the usual reason a reproduction misses by a
 * few paise.
 */
export const chargeRates = sqliteTable(
  "charge_rates",
  {
    brokerId: text("broker_id").notNull(),
    segment: text("segment", { enum: TRADE_SEGMENTS }).notNull(),
    chargeType: text("charge_type", { enum: CHARGE_TYPES }).notNull(),
    side: text("side", { enum: CHARGE_SIDES }).notNull(),
    /** What the rate applies to: TURNOVER, BROKERAGE_PLUS_FEES, PER_SCRIP_DAY. */
    basis: text("basis").notNull(),
    rateScaled: percentScaled("rate_scaled"),
    flatMinor: moneyMinor("flat_minor"),
    capMinor: moneyMinor("cap_minor"),
    minMinor: moneyMinor("min_minor"),
    /** A cap or a flat fee is money, so it carries its currency like anything else. */
    currency: currencyCode(),
    deductibility: text("deductibility", { enum: CHARGE_DEDUCTIBILITY }).notNull(),
    rounding: text("rounding", { enum: ["DOWN", "UP", "HALF_UP", "HALF_EVEN"] })
      .notNull()
      .default("HALF_UP"),
    roundingUnit: text("rounding_unit", { enum: ["PAISE", "RUPEE"] }).notNull().default("PAISE"),
    effectiveFrom: calendarDate("effective_from").notNull(),
    effectiveTo: calendarDate("effective_to"),
  },
  (table) => [
    uniqueIndex("charge_rates_pk").on(
      table.brokerId,
      table.segment,
      table.chargeType,
      table.side,
      table.effectiveFrom,
    ),
  ],
);

/**
 * Exchange trading holidays, mirrored from `core/time.ts`.
 *
 * The domain never reads this — `MarketCalendar` owns the list, and one
 * transcription is the point. It exists so a SQL report can join on trading days
 * without re-implementing the calendar.
 */
export const marketHolidays = sqliteTable(
  "market_holidays",
  {
    mic: text("mic", { enum: ["XNSE", "XBOM"] }).notNull(),
    holidayDate: calendarDate("holiday_date").notNull(),
    description: text("description"),
  },
  (table) => [uniqueIndex("market_holidays_pk").on(table.mic, table.holidayDate)],
);

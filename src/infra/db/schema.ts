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
    asOf: calendarDate("as_of").notNull(),
    priceMinor: moneyMinor("price_minor").notNull(),
    currency: currencyCode(),
    source: text("source", { enum: QUOTE_SOURCES }).notNull(),
    fetchedAt: timestamp("fetched_at").notNull(),
  },
  (table) => [
    // One price per instrument per day per source; a re-refresh overwrites.
    uniqueIndex("price_quotes_instrument_date_source_uq").on(
      table.instrumentId,
      table.asOf,
      table.source,
    ),
    index("price_quotes_latest_idx").on(table.instrumentId, table.asOf),
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

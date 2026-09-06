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

/**
 * How a transaction reached the ledger.
 *
 * The old `ENTRY_KINDS` — seven loose labels on one `JournalEntry` — is gone
 * rather than widened: what kind of event a transaction is, is now the class that
 * built it, and `TRANSACTION_KINDS` below is the stored projection of that.
 */
export const TRANSACTION_SOURCES = ["MANUAL", "IMPORT", "TRADE"] as const;

/**
 * The remaining enum catalogue — `20-DOMAIN-MODEL.md` §2.
 *
 * Stored as TEXT with a Drizzle `enum` constraint rather than a native SQLite
 * type, so adding a value is a code change and not a table rebuild.
 */

/** §2.3, the 18 transaction types. Mirrored by `TRANSACTION_KIND_NAMES` in the domain. */
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
    /**
     * Bank/broker name, for display and logo lookup.
     *
     * Superseded by `institutionId` and kept because it is the only record of
     * what the user actually typed — which is what the backfill matches on.
     */
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
    uniqueIndex("ledger_accounts_user_code_uq")
      .on(table.userId, table.code)
      .where(sql`${table.deletedAt} IS NULL`),
    index("ledger_accounts_user_type_idx").on(table.userId, table.type),
    index("ledger_accounts_parent_idx").on(table.parentId),
  ],
);

/**
 * A transaction: the atomic financial event. Its postings must sum to zero **per
 * currency**, which the domain enforces on construction — the database cannot
 * express "the sum of these child rows is zero", so the invariant lives in
 * `Transaction`.
 *
 * Renamed from `journal_entries` with 1b. The rename is not cosmetic: the row no
 * longer carries a loose seven-value `kind` but the `txn_type` of
 * `20-DOMAIN-MODEL.md` §2.3, which is the projection of the class that wrote it,
 * and it gains the columns §3.4 specifies — a settlement date distinct from the
 * accounting date, the provider's own id, a forecast flag, and a version.
 *
 * Append-only. A mistake is corrected with a REVERSAL pointing at the original via
 * `reversesTransactionId`, never by updating history.
 */
export const transactions = sqliteTable(
  "transactions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    txnType: text("txn_type", { enum: TRANSACTION_KINDS }).notNull(),
    /** The accounting date: a day, never an instant (§3.4). */
    txnDate: calendarDate("txn_date").notNull(),
    /**
     * When the money actually settles — T+1 for Indian equities.
     *
     * Separate from `txnDate` because a trade on 31 March settling on 1 April falls
     * in one financial year for tax and the other for the bank statement, and one
     * column cannot answer both.
     */
    settlementDate: calendarDate("settlement_date"),
    description: text("description").notNull(),
    source: text("source", { enum: TRANSACTION_SOURCES }).notNull().default("MANUAL"),
    /** Bank reference / cheque number / UTR, when known. */
    reference: text("reference"),
    /** The provider's own id for this row — unique per user among live rows (L09). */
    externalId: text("external_id"),
    counterpartyId: text("counterparty_id"),
    importBatchId: text("import_batch_id"),
    reversesTransactionId: text("reverses_transaction_id").references(
      (): AnySQLiteColumn => transactions.id,
      { onDelete: "restrict" },
    ),
    /** A dated-ahead transaction is legitimate only when marked a forecast (L11). */
    isForecast: integer("is_forecast", { mode: "boolean" }).notNull().default(false),
    /** Bumped by any correction that produces a reversal pair, for optimistic reads. */
    version: integer("version").notNull().default(1),
    /**
     * Stable hash of (account, date, amount, description) for imported rows. The
     * unique index below is what makes re-importing an overlapping statement
     * idempotent instead of duplicating months of transactions.
     */
    fingerprint: text("fingerprint"),
    deletedAt: deletedAt(),
    createdAt: createdAt(),
  },
  (table) => [
    index("transactions_user_date_idx").on(table.userId, table.txnDate),
    index("transactions_batch_idx").on(table.importBatchId),
    uniqueIndex("transactions_fingerprint_uq")
      .on(table.userId, table.fingerprint)
      .where(sql`${table.fingerprint} IS NOT NULL AND ${table.deletedAt} IS NULL`),
    /** L09, among live rows only — a tombstoned import must not block a re-import. */
    uniqueIndex("transactions_external_id_uq")
      .on(table.userId, table.externalId)
      .where(sql`${table.externalId} IS NOT NULL AND ${table.deletedAt} IS NULL`),
  ],
);

/**
 * One leg of a transaction. `amountMinor` is never negative; `direction` carries
 * the sign, which is what keeps "is this a negative expense or a positive refund?"
 * from ever being ambiguous.
 */
export const postings = sqliteTable(
  "postings",
  {
    id: text("id").primaryKey(),
    transactionId: text("transaction_id")
      .notNull()
      .references(() => transactions.id, { onDelete: "restrict" }),
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
    index("postings_transaction_idx").on(table.transactionId),
    index("postings_instrument_idx").on(table.instrumentId),
    /**
     * L03. Zero is legal, negative is not: a bonus issue moves units and no money,
     * so the old `> 0` would have rejected it — but a posting with neither an
     * amount nor a quantity records nothing at all.
     */
    check("postings_amount_not_negative", sql`${table.amountMinor} >= 0`),
    check(
      "postings_moves_something",
      sql`${table.amountMinor} <> 0 OR (${table.quantityScaled} IS NOT NULL AND ${table.quantityScaled} <> 0)`,
    ),
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

export const transactionRelations = relations(transactions, ({ many }) => ({
  postings: many(postings),
}));

export const postingRelations = relations(postings, ({ one }) => ({
  transaction: one(transactions, {
    fields: [postings.transactionId],
    references: [transactions.id],
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
  /** Platinum has no coarse kind of its own; the metals feed treats bullion alike. */
  "DIGITAL_METAL",
  "REIT",
  "CRYPTO",
  /** Options and futures share one coarse kind: the price feed treats them alike. */
  "DERIVATIVE",
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
  /**
   * F&O. Not a capital-gains class at all — it is the business head, and it is
   * stored as a tax class so a past derivative trade keeps the treatment it was
   * filed under even if the statute changes.
   */
  "FNO_BUSINESS",
  "OTHER",
] as const;

export const QUOTE_SOURCES = ["MANUAL", "AMFI", "NSE", "METALS"] as const;

/** The seventeen leaves of `domain/instruments.ts`, as stored. */
export const INSTRUMENT_CLASSES = [
  "LISTED_EQUITY",
  "ETF",
  "INDEX_FUND",
  "MUTUAL_FUND",
  "LIQUID_FUND",
  "DEBT_FUND",
  "ELSS_FUND",
  "BOND",
  "GOVT_SECURITY",
  "SOVEREIGN_GOLD_BOND",
  "DIGITAL_GOLD",
  "DIGITAL_SILVER",
  "DIGITAL_PLATINUM",
  "REIT",
  "CRYPTO",
  "OPTION",
  "FUTURE",
] as const;

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
    /**
     * Which of the thirteen `MarketInstrument` leaves this is.
     *
     * Finer than `kind`, which groups every fund together: a liquid fund, an ELSS
     * and an index fund are all `MUTUAL_FUND` to a price feed and three different
     * things to the tax engine and the redemption rules. Added in Phase 5, when
     * the leaves arrived; `kind` stays because the price providers key on it.
     */
    instrumentClass: text("instrument_class", { enum: INSTRUMENT_CLASSES })
      .notNull()
      .default("LISTED_EQUITY"),
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
    /**
     * The facts that belong to this leaf and to no other, as JSON.
     *
     * An option's strike and expiry, an ETF's underlying, a bond's coupon terms.
     * One column rather than fifteen nullable ones, and validated by the leaf's
     * own Zod schema in its constructor — so a new asset class is a new class,
     * not a migration. Text, so nothing in here can be a float.
     */
    /**
     * The platform this holding sits on.
     *
     * Nullable: every row that predates the platform dimension has no answer,
     * and inventing one would be a guess. Unset means "unassigned", which the
     * per-platform rollup reports as its own group rather than hiding.
     */
    institutionId: text("institution_id").references(() => institutions.id),
    metadata: text("metadata"),
    isClosed: integer("is_closed", { mode: "boolean" }).notNull().default(false),
    deletedAt: deletedAt(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("instruments_user_symbol_uq").on(table.userId, table.symbol),
    index("instruments_user_kind_idx").on(table.userId, table.kind),
    index("instruments_user_institution_idx").on(table.userId, table.institutionId),
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

    /** The transaction this trade wrote. Deleting a trade reverses it. */
    transactionId: text("transaction_id").references(() => transactions.id, {
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
    /**
     * The price, scaled by 1e8 — a `UnitPrice`, not `Money`.
     *
     * Was `price_minor` (paise). That column could not hold a four-decimal NAV:
     * AMFI publishes ₹84.5612, paise rounds it to ₹84.56, and on a 10,000-unit
     * holding that is ₹12 of invented value introduced at ingestion where nothing
     * can see it. `20-DOMAIN-MODEL.md` §3.8 specifies `NUMERIC(38,18)` for exactly
     * this reason; 1e8 is the scale `Quantity` already uses, so `units × price` is
     * one exact integer multiplication.
     */
    priceScaled: quantityScaled("price_scaled").notNull(),
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
    check("price_quotes_price_positive", sql`${table.priceScaled} > 0`),
  ],
);

/* ═══ Gold leasing ══════════════════════════════════════════════════════ */

export const LEASE_STATUSES = ["ACTIVE", "MATURED", "CANCELLED"] as const;

/** How often a lease pays out, and in what. See `domain/leasing.ts`. */
export const PAYOUT_FREQUENCIES = [
  "MONTHLY",
  "QUARTERLY",
  "HALF_YEARLY",
  "ANNUAL",
  "ON_MATURITY",
] as const;

export const PAYOUT_MODES = ["GRAMS", "CASH"] as const;

/**
 * Gold leased to a platform for a yield **paid in grams**.
 *
 * Terms only, like every other product table here. The accrued interest, the TDS
 * and the current value are all computed by `domain/leasing.ts` from these
 * columns and a price — so there is no stored figure that can disagree with the
 * arithmetic behind it, and the source spreadsheet's `months_completed` column
 * (wrong every day until someone edits it) has no equivalent.
 *
 * The one figure that *is* stored is `credited_quantity_scaled`, and it is not a
 * derived number: it records how many grams an accrual posting has actually put
 * into the ledger, so a second run books the difference rather than the whole
 * thing again.
 *
 * Quantities are 1e8-scaled integers, as everywhere else. A gram is not money and
 * `moneyMinor` would round 0.0923769g to nothing.
 */
export const goldLeases = sqliteTable(
  "gold_leases",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** The user-facing reference, e.g. `LEASE-0001`. Unique per user. */
    reference: text("reference").notNull(),
    instrumentId: text("instrument_id")
      .notNull()
      .references(() => instruments.id, { onDelete: "restrict" }),
    /** The asset account holding the gold, so an accrual knows where to post. */
    holdingAccountId: text("holding_account_id")
      .notNull()
      .references(() => ledgerAccounts.id, { onDelete: "restrict" }),
    /** What the user typed. `institutionId` is the row it resolves to. */
    platform: text("platform").notNull(),
    /**
     * The platform this lease sits on.
     *
     * Nullable: every row that predates the platform dimension has no answer,
     * and inventing one would be a guess. Unset means "unassigned", which the
     * per-platform rollup reports as its own group rather than hiding.
     */
    institutionId: text("institution_id").references(() => institutions.id),

    quantityScaled: quantityScaled("quantity_scaled").notNull(),
    startOn: calendarDate("start_on").notNull(),
    closesOn: calendarDate("closes_on").notNull(),
    annualRateScaled: percentScaled("annual_rate_scaled").notNull(),
    /**
     * How often the platform pays out, and in what.
     *
     * `payoutFrequency` decides when a gram is *earned*, not merely how a screen
     * groups it: a quarterly lease has credited nothing in month two, and
     * accruing it anyway would show gold that has not arrived.
     */
    payoutFrequency: text("payout_frequency", { enum: PAYOUT_FREQUENCIES })
      .notNull()
      .default("MONTHLY"),
    payoutMode: text("payout_mode", { enum: PAYOUT_MODES }).notNull().default("GRAMS"),
    /** Where a cash payout lands. Null for a grams lease, which is most of them. */
    payoutAccountId: text("payout_account_id").references(() => ledgerAccounts.id),
    /** Withholding on the interest. Zero unless the platform says it withholds — see `DEFAULT_TDS_RATE`. */
    tdsRateScaled: percentScaled("tds_rate_scaled").notNull().default(0),
    status: text("status", { enum: LEASE_STATUSES }).notNull().default("ACTIVE"),
    /** Set when the lease ended early; the accrual stops here instead. */
    endedOn: calendarDate("ended_on"),
    /** The platform's own reference, for reconciliation against its statement. */
    sourceReference: text("source_reference"),
    /** Grams an accrual posting has actually credited, net of TDS. */
    creditedQuantityScaled: quantityScaled("credited_quantity_scaled").notNull().default(0),
    /** The last accrual posting, so a credit can be traced to its transaction. */
    lastAccrualTransactionId: text("last_accrual_transaction_id").references(
      () => transactions.id,
      { onDelete: "restrict" },
    ),
    notes: text("notes"),
    deletedAt: deletedAt(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("gold_leases_user_reference_uq").on(table.userId, table.reference),
    index("gold_leases_user_status_idx").on(table.userId, table.status),
    index("gold_leases_instrument_idx").on(table.instrumentId, table.startOn),
    /** A lease of no gold is not a lease. */
    check("gold_leases_quantity_positive", sql`${table.quantityScaled} > 0`),
    /** A term of nothing earns nothing; it is a data-entry error, not a lease. */
    check("gold_leases_term_positive", sql`${table.closesOn} > ${table.startOn}`),
    check("gold_leases_rate_not_negative", sql`${table.annualRateScaled} >= 0`),
    check(
      "gold_leases_tds_rate_in_range",
      sql`${table.tdsRateScaled} >= 0 AND ${table.tdsRateScaled} <= 100000000`,
    ),
    check("gold_leases_credited_not_negative", sql`${table.creditedQuantityScaled} >= 0`),
  ],
);

/* ═══ Bars — OHLCV series behind a repository ═══════════════════════════ */

export const BAR_GRANULARITIES = ["DAY", "WEEK", "MONTH"] as const;

/**
 * Open/high/low/close/volume series, for analysis rather than valuation.
 *
 * Separate from `price_quotes` deliberately, and not a widening of it: a quote is
 * *one number the app values a holding at*, resolved through a four-rung ladder
 * and cross-checked between providers. A bar is a shape — four prices and a
 * volume for a period — and nothing values a portfolio from one. Merging them
 * would mean either four nullable columns on the valuation path or a ladder that
 * has to decide which of four prices it is carrying forward.
 *
 * Prices are scaled by 1e8 like `price_quotes.price_scaled`, so a bar and a quote
 * are directly comparable, and volume is a plain integer count of units. Nothing
 * here is a float, and the check constraints make an impossible bar
 * unstorable — `high < low` is not a value to be validated in a caller, it is a
 * bar that does not exist.
 */
export const priceBars = sqliteTable(
  "price_bars",
  {
    id: text("id").primaryKey(),
    instrumentId: text("instrument_id")
      .notNull()
      .references(() => instruments.id, { onDelete: "cascade" }),
    granularity: text("granularity", { enum: BAR_GRANULARITIES }).notNull().default("DAY"),
    /** The period's date: the day, or the first day of the week or month. */
    asOf: calendarDate("as_of").notNull(),
    openScaled: quantityScaled("open_scaled").notNull(),
    highScaled: quantityScaled("high_scaled").notNull(),
    lowScaled: quantityScaled("low_scaled").notNull(),
    closeScaled: quantityScaled("close_scaled").notNull(),
    /** Units traded. Null when the source does not publish it — never zero for unknown. */
    volume: integer("volume"),
    currency: currencyCode(),
    providerId: text("provider_id").notNull().default("manual"),
    /** The second time axis, as on `price_quotes`: when we learned this bar. */
    ingestedAt: timestamp("ingested_at").notNull(),
    supersededBy: text("superseded_by"),
  },
  (table) => [
    uniqueIndex("price_bars_bitemporal_uq").on(
      table.instrumentId,
      table.granularity,
      table.asOf,
      table.providerId,
      table.ingestedAt,
    ),
    index("price_bars_series_idx").on(table.instrumentId, table.granularity, table.asOf),
    check("price_bars_positive", sql`${table.lowScaled} > 0`),
    check("price_bars_high_not_below_low", sql`${table.highScaled} >= ${table.lowScaled}`),
    check(
      "price_bars_open_close_within_range",
      sql`${table.openScaled} BETWEEN ${table.lowScaled} AND ${table.highScaled}
          AND ${table.closeScaled} BETWEEN ${table.lowScaled} AND ${table.highScaled}`,
    ),
    check("price_bars_volume_not_negative", sql`${table.volume} IS NULL OR ${table.volume} >= 0`),
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
    transactionId: text("transaction_id").references(() => transactions.id, {
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
    /**
     * Whether this category's leftover — or its overspend — rolls into next month.
     *
     * The flag that makes envelope budgeting expressible (`30-CALCULATIONS.md` §7).
     * With it off, an overspend is charged to next month's `to_budget` and the
     * category starts clean; with it on, the category carries its own debt, which
     * is the entire point of an envelope. One boolean, because the two behaviours
     * are the two branches of the same formula and a second column could disagree
     * with it.
     */
    carryover: integer("carryover", { mode: "boolean" }).notNull().default(false),
    deletedAt: deletedAt(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [uniqueIndex("budgets_user_account_month_uq").on(table.userId, table.accountId, table.month)],
);


/* ═══ Credit-card terms ═════════════════════════════════════════════════ */

/** A rate scaled by 1e10 — see `Rate`. Ten decimals, because 42%/365 needs them. */
export const rateScaled = (name: string) => integer(name);

/**
 * The issuer's terms for one card.
 *
 * A separate table rather than columns on `ledger_accounts`, because these apply
 * to exactly one subtype and nine nullable columns on the chart of accounts would
 * be nine columns that are meaningless for every bank account and every category.
 * One row per card account, enforced by the unique index.
 *
 * Nothing derived is stored: no statement, no minimum due, no interest figure.
 * Those are computed from these terms plus the postings, for the same reason no
 * balance is stored — the moment a saved statement can disagree with the postings
 * behind it, one of the two is wrong and nothing says which.
 */
export const creditCardTerms = sqliteTable(
  "credit_card_terms",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accountId: text("account_id")
      .notNull()
      .references(() => ledgerAccounts.id, { onDelete: "cascade" }),
    /**
     * The currency of every amount in this row.
     *
     * Present because `tests/schema-integrity.spec.ts` refuses a new table that
     * stores an amount without one — correctly: a card issued in USD whose limit
     * was read back as rupees is a wrong utilisation figure with no way to notice.
     */
    currency: currencyCode(),
    creditLimitMinor: moneyMinor("credit_limit_minor").notNull().default(0),
    /** Day of month the statement is generated; clamped per month by the domain. */
    statementDay: integer("statement_day").notNull().default(18),
    /** Days from the statement date to the due date. */
    graceDays: integer("grace_days").notNull().default(20),
    /** Annual finance rate on a revolved balance. */
    financeRateScaled: rateScaled("finance_rate_scaled").notNull().default(0),
    /**
     * The day-count convention the finance rate is quoted under.
     *
     * Named without "rate" in it deliberately: `tests/schema-integrity.spec.ts`
     * insists that any column whose name reads as numeric is INTEGER, and it is
     * right to — a TEXT column called `finance_rate_something` is exactly the
     * shape a decimal-string rate would sneak in as. The convention is a label,
     * so it gets a name that says so.
     */
    financeConvention: text("finance_convention", {
      enum: ["ACT_365F", "ACT_360", "THIRTY_360"],
    })
      .notNull()
      .default("ACT_365F"),
    minimumDuePercentScaled: percentScaled("minimum_due_percent_scaled").notNull().default(0),
    minimumDueFloorMinor: moneyMinor("minimum_due_floor_minor").notNull().default(0),
    lateFeeMinor: moneyMinor("late_fee_minor").notNull().default(0),
    annualFeeMinor: moneyMinor("annual_fee_minor").notNull().default(0),
    /** GST on interest and fees — 18% in India, charged on both. */
    gstOnChargesPercentScaled: percentScaled("gst_on_charges_percent_scaled").notNull().default(0),
    /** Reward points earned per hundred spent, scaled by 1e8 like any quantity. */
    pointsPerHundredScaled: quantityScaled("points_per_hundred_scaled").notNull().default(0),
    deletedAt: deletedAt(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("credit_card_terms_account_uq").on(table.accountId),
    index("credit_card_terms_user_idx").on(table.userId),
    /** A statement day outside 1–31 would generate a cycle no month contains. */
    check("credit_card_terms_statement_day", sql`${table.statementDay} BETWEEN 1 AND 31`),
    /** A bill due on or before its statement date has a negative grace period. */
    check("credit_card_terms_grace_days", sql`${table.graceDays} BETWEEN 1 AND 60`),
  ],
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


/* ═══ Deposits, retirement and loans ════════════════════════════════════ */

export const DEPOSIT_KINDS = ["FIXED_DEPOSIT", "RECURRING_DEPOSIT", "PPF", "EPF", "NPS"] as const;
export const DEPOSIT_PAYOUTS = ["CUMULATIVE", "PERIODIC_PAYOUT"] as const;
export const LOAN_KINDS = ["HOME", "VEHICLE", "PERSONAL", "EDUCATION", "GOLD", "OTHER"] as const;
export const PAYMENT_FREQUENCIES = ["MONTHLY", "QUARTERLY", "ANNUALLY"] as const;
export const NPS_SCHEMES = ["E", "C", "G", "A"] as const;

/**
 * A deposit's terms — one row per deposit account.
 *
 * Terms only. No accrued balance, no maturity value, no schedule: every one of
 * those is computed from this row by `domain/deposits.ts`, which is what makes
 * "deleting the accrual job changes no reported number" true rather than
 * aspirational.
 *
 * The nullable columns are the honest cost of one table for five products. An FD
 * has a principal and a maturity date; an RD has an instalment and a month count;
 * PPF and EPF have neither, because their money arrives year by year in
 * `deposit_contributions`. Five tables would repeat the account link, the currency
 * and the rate five times, and a query for "every deposit" would be a five-way
 * union.
 */
export const depositTerms = sqliteTable(
  "deposit_terms",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accountId: text("account_id")
      .notNull()
      .references(() => ledgerAccounts.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: DEPOSIT_KINDS }).notNull(),
    currency: currencyCode(),
    /** FD only: the lump sum placed. */
    principalMinor: moneyMinor("principal_minor"),
    /** RD only: the monthly instalment. */
    instalmentMinor: moneyMinor("instalment_minor"),
    /** RD only: how many instalments. */
    months: integer("months"),
    /** The stated rate. For PPF and EPF the per-year rates live in `scheme_rates`. */
    interestRateScaled: rateScaled("interest_rate_scaled"),
    /**
     * The day-count convention and the growth basis.
     *
     * Named without "interest" or "rate" in them: `tests/schema-integrity.spec.ts`
     * requires every numeric-sounding column to be INTEGER, and it is right to —
     * a TEXT column called `interest_something` is the shape a decimal-string rate
     * sneaks in as. These two are labels, so they read as labels.
     */
    dayCountConvention: text("day_count_convention", {
      enum: ["ACT_365F", "ACT_360", "THIRTY_360"],
    })
      .notNull()
      .default("ACT_365F"),
    accrualBasis: text("accrual_basis", { enum: INTEREST_TYPES }).notNull().default("COMPOUND"),
    compounding: text("compounding", { enum: COMPOUNDING_FREQUENCIES })
      .notNull()
      .default("QUARTERLY"),
    payout: text("payout", { enum: DEPOSIT_PAYOUTS }).notNull().default("CUMULATIVE"),
    openedOn: calendarDate("opened_on").notNull(),
    maturesOn: calendarDate("matures_on"),
    /** FD only: the rate reduction applied when the deposit is broken early. */
    prematurePenaltyPercentScaled: percentScaled("premature_penalty_percent_scaled"),
    /** NPS only. Tier I is locked to 60; Tier II is not. */
    npsTier: text("nps_tier", { enum: ["TIER_I", "TIER_II"] }),
    /** PPF only: five-year extension blocks taken after the initial fifteen years. */
    extensionBlocks: integer("extension_blocks"),
    deletedAt: deletedAt(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("deposit_terms_account_uq").on(table.accountId),
    index("deposit_terms_user_kind_idx").on(table.userId, table.kind),
  ],
);

/**
 * Money paid into a PPF, EPF or NPS account, by financial year.
 *
 * The three sub-columns exist for EPF, where the employee's share, the employer's
 * share and a voluntary top-up behave differently — interest on the employee's and
 * voluntary contributions above ₹2.5 lakh a year is taxable while the employer's is
 * not, and one combined figure cannot answer that at all. PPF uses `amountMinor`
 * alone.
 */
export const depositContributions = sqliteTable(
  "deposit_contributions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accountId: text("account_id")
      .notNull()
      .references(() => ledgerAccounts.id, { onDelete: "cascade" }),
    /** `2026-27`. */
    financialYear: text("financial_year").notNull(),
    /** PPF and the like: a single figure. */
    amountMinor: moneyMinor("amount_minor").notNull().default(0),
    employeeMinor: moneyMinor("employee_minor").notNull().default(0),
    employerMinor: moneyMinor("employer_minor").notNull().default(0),
    voluntaryMinor: moneyMinor("voluntary_minor").notNull().default(0),
    currency: currencyCode(),
    deletedAt: deletedAt(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("deposit_contributions_account_fy_uq").on(table.accountId, table.financialYear),
    index("deposit_contributions_user_idx").on(table.userId),
  ],
);

/**
 * Notified rates for a scheme, per financial year.
 *
 * Per user rather than global, and that is deliberate: the rate is a fact of the
 * scheme, but a user's passbook is the authority for what was actually credited to
 * *their* account, and an app that argued with a passbook would be wrong in the
 * only way that matters. Seeding the published rates and letting them be corrected
 * is the right shape.
 */
export const schemeRates = sqliteTable(
  "scheme_rates",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** `PPF`, `EPF`, or an account id for a rate that applies to one deposit. */
    schemeKey: text("scheme_key").notNull(),
    financialYear: text("financial_year").notNull(),
    rateScaled: rateScaled("rate_scaled").notNull(),
    deletedAt: deletedAt(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("scheme_rates_user_scheme_fy_uq").on(table.userId, table.schemeKey, table.financialYear),
  ],
);

/**
 * Units held in each NPS scheme fund.
 *
 * Units, not a value: NPS is priced from a NAV published daily, and storing a
 * value would be storing a guess about a market. The NAV comes through the
 * `PriceBook` like any other instrument's price.
 */
export const npsHoldings = sqliteTable(
  "nps_holdings",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accountId: text("account_id")
      .notNull()
      .references(() => ledgerAccounts.id, { onDelete: "cascade" }),
    scheme: text("scheme", { enum: NPS_SCHEMES }).notNull(),
    unitsScaled: quantityScaled("units_scaled").notNull().default(0),
    /** The PFM's own scheme code, for resolving a NAV. */
    schemeCode: text("scheme_code"),
    deletedAt: deletedAt(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("nps_holdings_account_scheme_uq").on(table.accountId, table.scheme),
    index("nps_holdings_user_idx").on(table.userId),
  ],
);

/**
 * A loan's terms — one row per loan account.
 *
 * As with deposits and cards: terms in, schedule computed. A stored amortisation
 * schedule would describe the loan as it was when the row was written, and a rate
 * revision or a prepayment makes that a different loan — with nothing to say which
 * of the two the borrower actually has.
 */
export const loanTerms = sqliteTable(
  "loan_terms",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accountId: text("account_id")
      .notNull()
      .references(() => ledgerAccounts.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: LOAN_KINDS }).notNull(),
    currency: currencyCode(),
    principalMinor: moneyMinor("principal_minor").notNull(),
    interestRateScaled: rateScaled("interest_rate_scaled").notNull(),
    dayCountConvention: text("day_count_convention", {
      enum: ["ACT_365F", "ACT_360", "THIRTY_360"],
    })
      .notNull()
      .default("ACT_365F"),
    /** Reducing balance, or flat — which materially overstates the true cost. */
    accrualBasis: text("accrual_basis", { enum: INTEREST_TYPES }).notNull().default("REDUCING_BALANCE"),
    periods: integer("periods").notNull(),
    paymentFrequency: text("payment_frequency", { enum: PAYMENT_FREQUENCIES })
      .notNull()
      .default("MONTHLY"),
    disbursedOn: calendarDate("disbursed_on").notNull(),
    firstPaymentOn: calendarDate("first_payment_on"),
    prepaymentPenaltyPercentScaled: percentScaled("prepayment_penalty_percent_scaled"),
    deletedAt: deletedAt(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("loan_terms_account_uq").on(table.accountId),
    index("loan_terms_user_kind_idx").on(table.userId, table.kind),
    /** A loan with no periods has no schedule, and its EMI would divide by zero. */
    check("loan_terms_periods_positive", sql`${table.periods} > 0`),
  ],
);

/**
 * A lump sum paid against a loan outside its schedule.
 *
 * `reduces` is stored because it is the borrower's decision and it changes the
 * arithmetic: shortening the term saves more interest, lowering the instalment
 * eases cashflow, and a schedule that guessed would show one while the lender did
 * the other.
 */
export const loanPrepayments = sqliteTable(
  "loan_prepayments",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accountId: text("account_id")
      .notNull()
      .references(() => ledgerAccounts.id, { onDelete: "cascade" }),
    paidOn: calendarDate("paid_on").notNull(),
    amountMinor: moneyMinor("amount_minor").notNull(),
    currency: currencyCode(),
    reduces: text("reduces", { enum: ["TERM", "INSTALMENT"] }).notNull().default("TERM"),
    deletedAt: deletedAt(),
    createdAt: createdAt(),
  },
  (table) => [index("loan_prepayments_account_idx").on(table.accountId, table.paidOn)],
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

/**
 * `BULLION` sits apart from `BROKER` because the businesses are: a vaulting
 * provider holds metal against your name and executes no trades, and it is the
 * only kind that offers a gold lease.
 */
export const INSTITUTION_KINDS = [
  "BANK",
  "BROKER",
  "BULLION",
  "WALLET",
  "SCHEME",
  "LENDER",
  "OTHER",
] as const;

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
    kind: text("kind", { enum: INSTITUTION_KINDS }).notNull(),
    country: text("country", { length: 2 }).notNull().default("IN"),
    /**
     * How far below the benchmark this platform buys back, as a percentage.
     *
     * Only bullion vaults normally set one: digital gold sells back at the
     * platform's own rate, a few percent under IBJA, and valuing a holding at the
     * benchmark overstates what it could actually be turned into. Zero means "not
     * told", not "no spread" — the app shows the benchmark and says so.
     */
    sellSpreadScaled: percentScaled("sell_spread_scaled").notNull().default(0),
    notes: text("notes"),
    /**
     * Archived, not deleted. A broker you have closed still owns every trade you
     * ever placed there, so it drops out of pickers and stays in reports.
     */
    isArchived: integer("is_archived", { mode: "boolean" }).notNull().default(false),
    deletedAt: deletedAt(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  /*
   * No CHECK on the spread, deliberately: SQLite cannot add a table-level
   * constraint through `ALTER TABLE ADD COLUMN`, so declaring one here would put
   * this file permanently out of step with the migration that created the column.
   * `Institution` refuses a spread outside 0-100% in its constructor instead.
   */
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
    /**
     * Units of `quote` per one unit of `base`, scaled by 1e8 — the same scale as
     * `Quantity` and `price_scaled`, because an FX rate is the same kind of number
     * as a price: a ratio, not an amount.
     */
    providerRateScaled: integer("provider_rate_scaled"),
    /**
     * The rate the user says they got, which is the rate their return is assessed
     * on. Beside the provider's rather than instead of it, so a report can say
     * which one it used — adopted from Firefly's `user_rate` (Dossier 03 §5).
     */
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

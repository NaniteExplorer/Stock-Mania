import { relations, sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { users } from "./auth";
import { journalEntries, ledgerAccounts } from "./ledger";
import {
  calendarDate,
  createdAt,
  currencyCode,
  moneyMinor,
  quantityScaled,
  timestamp,
  updatedAt,
} from "./columns";

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

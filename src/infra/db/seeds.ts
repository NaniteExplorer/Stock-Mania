import type { Database } from "./client";
import { MarketCalendar } from "@/core/time";
import { legalityRows } from "@/domain/transactions";
import {
  chargeRates,
  costInflationIndex,
  marketHolidays,
  taxRules,
  txnTypeLegality,
} from "./schema";

/**
 * Reference data, as TypeScript rather than SQL.
 *
 * Every table here holds facts the domain also needs at runtime — the legality
 * matrix is checked in a constructor, the CII table is read by an indexation
 * rule, the charge rates are injected into a broker charge model. Writing them as
 * SQL inserts would mean two copies of each fact, and the copy the domain uses
 * would be the one nobody diffed.
 *
 * Seeding is idempotent (`INSERT OR IGNORE` on a natural key), so
 * `migrateAndSeed()` can run on every boot.
 */

/* ═══ Legality matrix — 20-DOMAIN-MODEL.md §3.6 ═════════════════════════ */

/*
 * The rows come from the domain, not from here.
 *
 * They used to be generated in this file, which meant the table SQL reporting
 * joins against and the matrix a transaction is checked against were two
 * statements of one fact — and the one that would have been wrong is the one
 * nobody diffed. `legalityRows()` now lives beside the constructor that enforces
 * it, and this table is its projection.
 */

/* ═══ Tax rules — the SQL mirror of the shipped regimes ═════════════════ */

/**
 * A mirror, not the source.
 *
 * Each shipped `TaxRegime` freezes these numbers as constants so a past year
 * recomputes identically; these rows exist so SQL reporting can join against
 * them. `tests/tax-regimes.spec.ts` asserts the two agree — two sources of truth
 * that can disagree eventually do.
 *
 * A NULL `stcgRateScaled` means "taxed at slab", which is a different claim from
 * a zero rate.
 */
const PERCENT = 1_000_000; // Percentage scale, 1e6

const TAX_RULE_ROWS: (typeof taxRules.$inferInsert)[] = [
  // ── IndiaFY2024: pre-2024-07-23 disposals ────────────────────────────────
  {
    regime: "IN-FY2024",
    taxCategory: "LISTED_EQUITY",
    effectiveFrom: "2018-04-01",
    effectiveTo: "2024-07-22",
    longTermDays: 365,
    ltcgRateScaled: 10 * PERCENT,
    stcgRateScaled: 15 * PERCENT,
    indexationAllowed: false,
    grandfatherDate: "2018-02-01",
    exemptionLimitMinor: 10_000_000, // ₹1,00,000
  },
  {
    regime: "IN-FY2024",
    taxCategory: "EQUITY_MUTUAL_FUND",
    effectiveFrom: "2018-04-01",
    effectiveTo: "2024-07-22",
    longTermDays: 365,
    ltcgRateScaled: 10 * PERCENT,
    stcgRateScaled: 15 * PERCENT,
    indexationAllowed: false,
    grandfatherDate: "2018-02-01",
    exemptionLimitMinor: 10_000_000,
  },
  {
    // Debt bought before 2023-04-01 kept indexation and a 20% long-term rate.
    regime: "IN-FY2024",
    taxCategory: "DEBT_LEGACY",
    effectiveFrom: "2018-04-01",
    effectiveTo: "2023-03-31",
    longTermDays: 1095,
    ltcgRateScaled: 20 * PERCENT,
    stcgRateScaled: null,
    indexationAllowed: true,
    grandfatherDate: null,
    exemptionLimitMinor: null,
  },
  {
    regime: "IN-FY2024",
    taxCategory: "UNLISTED_EQUITY",
    effectiveFrom: "2018-04-01",
    effectiveTo: "2024-07-22",
    longTermDays: 730,
    ltcgRateScaled: 20 * PERCENT,
    stcgRateScaled: null,
    indexationAllowed: true,
    grandfatherDate: null,
    exemptionLimitMinor: null,
  },

  // ── IndiaFY2025: from the 23 July 2024 budget ────────────────────────────
  {
    regime: "IN-FY2025",
    taxCategory: "LISTED_EQUITY",
    effectiveFrom: "2024-07-23",
    effectiveTo: null,
    longTermDays: 365,
    ltcgRateScaled: 12.5 * PERCENT,
    stcgRateScaled: 20 * PERCENT,
    indexationAllowed: false,
    grandfatherDate: "2018-02-01",
    exemptionLimitMinor: 12_500_000, // ₹1,25,000
  },
  {
    regime: "IN-FY2025",
    taxCategory: "EQUITY_MUTUAL_FUND",
    effectiveFrom: "2024-07-23",
    effectiveTo: null,
    longTermDays: 365,
    ltcgRateScaled: 12.5 * PERCENT,
    stcgRateScaled: 20 * PERCENT,
    indexationAllowed: false,
    grandfatherDate: "2018-02-01",
    exemptionLimitMinor: 12_500_000,
  },
  {
    // Debt acquired on or after 2023-04-01: slab always, no long-term rate.
    regime: "IN-FY2025",
    taxCategory: "DEBT",
    effectiveFrom: "2023-04-01",
    effectiveTo: null,
    longTermDays: null,
    ltcgRateScaled: null,
    stcgRateScaled: null,
    indexationAllowed: false,
    grandfatherDate: null,
    exemptionLimitMinor: null,
  },
  {
    regime: "IN-FY2025",
    taxCategory: "GOLD",
    effectiveFrom: "2024-07-23",
    effectiveTo: null,
    longTermDays: 730,
    ltcgRateScaled: 12.5 * PERCENT,
    stcgRateScaled: null,
    indexationAllowed: false,
    grandfatherDate: null,
    exemptionLimitMinor: null,
  },
  {
    // A virtual digital asset is flat-rated with no set-off and no carry-forward.
    regime: "IN-FY2025",
    taxCategory: "VDA",
    effectiveFrom: "2022-04-01",
    effectiveTo: null,
    longTermDays: null,
    ltcgRateScaled: 30 * PERCENT,
    stcgRateScaled: 30 * PERCENT,
    indexationAllowed: false,
    grandfatherDate: null,
    exemptionLimitMinor: null,
  },
  {
    regime: "IN-FY2025",
    taxCategory: "UNLISTED_EQUITY",
    effectiveFrom: "2024-07-23",
    effectiveTo: null,
    longTermDays: 730,
    ltcgRateScaled: 12.5 * PERCENT,
    stcgRateScaled: null,
    indexationAllowed: false,
    grandfatherDate: null,
    exemptionLimitMinor: null,
  },
  {
    // PPF, EPF and SGB-at-maturity are exempt outright: a zero rate, not a low one.
    regime: "IN-FY2025",
    taxCategory: "EXEMPT_SCHEME",
    effectiveFrom: "2000-04-01",
    effectiveTo: null,
    longTermDays: null,
    ltcgRateScaled: 0,
    stcgRateScaled: 0,
    indexationAllowed: false,
    grandfatherDate: null,
    exemptionLimitMinor: null,
  },
];

/* ═══ Cost Inflation Index ══════════════════════════════════════════════ */

/**
 * CBDT-notified CII, base 2001-02 = 100.
 *
 * One number a year. Paisa fetches this from a personal domain; there is no
 * reason for a network dependency on a published constant.
 */
const CII_ROWS: (typeof costInflationIndex.$inferInsert)[] = [
  { financialYear: "2001-02", value: 100 },
  { financialYear: "2002-03", value: 105 },
  { financialYear: "2003-04", value: 109 },
  { financialYear: "2004-05", value: 113 },
  { financialYear: "2005-06", value: 117 },
  { financialYear: "2006-07", value: 122 },
  { financialYear: "2007-08", value: 129 },
  { financialYear: "2008-09", value: 137 },
  { financialYear: "2009-10", value: 148 },
  { financialYear: "2010-11", value: 167 },
  { financialYear: "2011-12", value: 184 },
  { financialYear: "2012-13", value: 200 },
  { financialYear: "2013-14", value: 220 },
  { financialYear: "2014-15", value: 240 },
  { financialYear: "2015-16", value: 254 },
  { financialYear: "2016-17", value: 264 },
  { financialYear: "2017-18", value: 272 },
  { financialYear: "2018-19", value: 280 },
  { financialYear: "2019-20", value: 289 },
  { financialYear: "2020-21", value: 301 },
  { financialYear: "2021-22", value: 317 },
  { financialYear: "2022-23", value: 331 },
  { financialYear: "2023-24", value: 348 },
  { financialYear: "2024-25", value: 363 },
  { financialYear: "2025-26", value: 376 },
];

/* ═══ Broker charge rates ═══════════════════════════════════════════════ */

const BP = PERCENT / 100; // one basis point, at Percentage scale

/**
 * FY2025-26 statutory and broker rates.
 *
 * Three details here are what make "reproduces to the paisa" achievable at all,
 * and all three are easy to miss:
 *
 *  - STT is **sell-side only for intraday** but both sides for delivery, and it
 *    rounds to the **whole rupee**.
 *  - Stamp duty is **buy-side only** and also rounds to the **whole rupee**.
 *  - Zerodha's DP charge is per **scrip per day** on the sell side — not per
 *    trade, so two sells of the same scrip on one day are charged once.
 *
 * Leaving STT and stamp duty at paise precision is the usual reason a contract
 * note reproduction misses by a few paise.
 */
const CHARGE_RATE_ROWS: (typeof chargeRates.$inferInsert)[] = [
  // ── Zerodha ──────────────────────────────────────────────────────────────
  {
    brokerId: "zerodha",
    segment: "EQ_DELIVERY",
    chargeType: "BROKERAGE",
    side: "BOTH",
    basis: "TURNOVER",
    rateScaled: 0,
    flatMinor: 0,
    deductibility: "DEDUCTIBLE",
    effectiveFrom: "2025-04-01",
  },
  {
    brokerId: "zerodha",
    segment: "EQ_INTRADAY",
    chargeType: "BROKERAGE",
    side: "BOTH",
    basis: "TURNOVER",
    rateScaled: 3 * BP, // 0.03%
    capMinor: 2000, // ₹20
    deductibility: "DEDUCTIBLE",
    effectiveFrom: "2025-04-01",
  },
  {
    brokerId: "zerodha",
    segment: "EQ_DELIVERY",
    chargeType: "DP_CHARGES",
    side: "SELL",
    basis: "PER_SCRIP_DAY",
    flatMinor: 1534, // ₹15.34
    deductibility: "DEDUCTIBLE",
    effectiveFrom: "2025-04-01",
  },

  // ── Groww ────────────────────────────────────────────────────────────────
  {
    brokerId: "groww",
    segment: "EQ_DELIVERY",
    chargeType: "BROKERAGE",
    side: "BOTH",
    basis: "TURNOVER",
    rateScaled: 10 * BP, // 0.1%
    capMinor: 2000,
    deductibility: "DEDUCTIBLE",
    effectiveFrom: "2025-04-01",
  },
  {
    brokerId: "groww",
    segment: "EQ_INTRADAY",
    chargeType: "BROKERAGE",
    side: "BOTH",
    basis: "TURNOVER",
    rateScaled: 10 * BP,
    capMinor: 2000,
    deductibility: "DEDUCTIBLE",
    effectiveFrom: "2025-04-01",
  },
  {
    brokerId: "groww",
    segment: "EQ_DELIVERY",
    chargeType: "DP_CHARGES",
    side: "SELL",
    basis: "PER_SCRIP_DAY",
    flatMinor: 1850, // ₹18.50
    deductibility: "DEDUCTIBLE",
    effectiveFrom: "2025-04-01",
  },
];

/**
 * Statutory charges. Identical for every broker, which is why the base charge
 * model computes them and only brokerage and DP are left to a subclass.
 *
 * STT is non-deductible against capital gains; stamp duty is capitalised into
 * cost basis. Both facts are properties of the charge here, not comments
 * somewhere else.
 */
const STATUTORY_ROWS: (typeof chargeRates.$inferInsert)[] = [
  {
    brokerId: "*",
    segment: "EQ_DELIVERY",
    chargeType: "STT",
    side: "BOTH",
    basis: "TURNOVER",
    rateScaled: 10 * BP, // 0.1%
    deductibility: "NON_DEDUCTIBLE",
    rounding: "HALF_UP",
    roundingUnit: "RUPEE",
    effectiveFrom: "2025-04-01",
  },
  {
    brokerId: "*",
    segment: "EQ_INTRADAY",
    chargeType: "STT",
    side: "SELL", // intraday STT is charged on the sell leg only
    basis: "TURNOVER",
    rateScaled: 2.5 * BP, // 0.025%
    deductibility: "NON_DEDUCTIBLE",
    rounding: "HALF_UP",
    roundingUnit: "RUPEE",
    effectiveFrom: "2025-04-01",
  },
  {
    brokerId: "*",
    segment: "EQ_DELIVERY",
    chargeType: "EXCHANGE_TXN",
    side: "BOTH",
    basis: "TURNOVER",
    rateScaled: 0.297 * BP, // 0.00297% (NSE)
    deductibility: "DEDUCTIBLE",
    effectiveFrom: "2025-04-01",
  },
  {
    brokerId: "*",
    segment: "EQ_INTRADAY",
    chargeType: "EXCHANGE_TXN",
    side: "BOTH",
    basis: "TURNOVER",
    rateScaled: 0.297 * BP,
    deductibility: "DEDUCTIBLE",
    effectiveFrom: "2025-04-01",
  },
  {
    brokerId: "*",
    segment: "EQ_DELIVERY",
    chargeType: "SEBI_TURNOVER",
    side: "BOTH",
    basis: "TURNOVER",
    rateScaled: 0.01 * BP, // 0.0001%, i.e. ₹10 per crore
    deductibility: "DEDUCTIBLE",
    effectiveFrom: "2025-04-01",
  },
  {
    brokerId: "*",
    segment: "EQ_INTRADAY",
    chargeType: "SEBI_TURNOVER",
    side: "BOTH",
    basis: "TURNOVER",
    rateScaled: 0.01 * BP,
    deductibility: "DEDUCTIBLE",
    effectiveFrom: "2025-04-01",
  },
  {
    brokerId: "*",
    segment: "EQ_DELIVERY",
    chargeType: "STAMP_DUTY",
    side: "BUY", // buy side only
    basis: "TURNOVER",
    rateScaled: 1.5 * BP, // 0.015%, ₹1,500 per crore
    deductibility: "CAPITALISED",
    rounding: "HALF_UP",
    roundingUnit: "RUPEE",
    effectiveFrom: "2025-04-01",
  },
  {
    brokerId: "*",
    segment: "EQ_INTRADAY",
    chargeType: "STAMP_DUTY",
    side: "BUY",
    basis: "TURNOVER",
    rateScaled: 0.3 * BP, // 0.003%, ₹300 per crore
    deductibility: "CAPITALISED",
    rounding: "HALF_UP",
    roundingUnit: "RUPEE",
    effectiveFrom: "2025-04-01",
  },
  {
    brokerId: "*",
    segment: "EQ_DELIVERY",
    chargeType: "GST",
    side: "BOTH",
    basis: "BROKERAGE_PLUS_FEES", // brokerage + exchange + SEBI + DP
    rateScaled: 18 * PERCENT,
    deductibility: "DEDUCTIBLE",
    effectiveFrom: "2025-04-01",
  },
  {
    brokerId: "*",
    segment: "EQ_INTRADAY",
    chargeType: "GST",
    side: "BOTH",
    basis: "BROKERAGE_PLUS_FEES",
    rateScaled: 18 * PERCENT,
    deductibility: "DEDUCTIBLE",
    effectiveFrom: "2025-04-01",
  },
];

/* ═══ Runner ════════════════════════════════════════════════════════════ */

/**
 * Idempotent. `onConflictDoNothing` against each table's natural key, so booting
 * twice is a no-op and adding a row to any list above is picked up on the next
 * boot without a migration.
 */
export async function seedReferenceData(db: Database): Promise<void> {
  const legality = legalityRows();
  if (legality.length > 0) {
    await db.insert(txnTypeLegality).values(legality).onConflictDoNothing();
  }
  await db.insert(taxRules).values(TAX_RULE_ROWS).onConflictDoNothing();
  await db.insert(costInflationIndex).values(CII_ROWS).onConflictDoNothing();
  await db
    .insert(chargeRates)
    .values([...CHARGE_RATE_ROWS, ...STATUTORY_ROWS])
    .onConflictDoNothing();

  // Mirrored from MarketCalendar so a SQL report can join on trading days. The
  // domain never reads this table — MarketCalendar is the source, and one
  // transcription of the exchange circulars is the whole point.
  const nse = MarketCalendar.nse();
  const holidays: (typeof marketHolidays.$inferInsert)[] = [];
  for (const mic of ["XNSE", "XBOM"] as const) {
    for (const holidayDate of nse.holidayDates()) {
      holidays.push({ mic, holidayDate });
    }
  }
  await db.insert(marketHolidays).values(holidays).onConflictDoNothing();
}

/** Exposed for the seed-integrity test, which asserts the SQL mirror matches. */
export const SEED_DATA = {
  legalityRows,
  TAX_RULE_ROWS,
  CII_ROWS,
  CHARGE_RATE_ROWS,
  STATUTORY_ROWS,
} as const;

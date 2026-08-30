/**
 * Per-kind form copy: what to type, and how the thing is taxed.
 *
 * The add-instrument form used to carry one set of placeholders for all
 * seventeen kinds, and they were the equity ones — so choosing "Digital gold"
 * still suggested `INFY`, `NSE`, an ISIN and an AMFI scheme code, and the price
 * hint said "an AMFI scheme code is not an NSE ticker". Every one of those is
 * wrong for grams held in a vault, and the price code is the field that decides
 * whether the holding can be priced at all. A wrong hint there is not cosmetic:
 * it is the difference between a holding that values itself and one that shows
 * an em-dash forever.
 *
 * **On the tax lines.** They are display copy, not the computation. The
 * authority is each leaf's `taxProfile()` in `domain/instruments.ts`, which is
 * what the tax engine reads; this table exists because a `<select>` cannot
 * construct a `MarketInstrument` to ask. Keep them in step — and when they
 * disagree, the leaf is right and this file is stale.
 */

import type { InstrumentKind } from "@/domain/instruments";

export interface InstrumentHint {
  /** What the symbol field is for this kind. */
  readonly symbol: string;
  readonly name: string;
  /** The code the price feed knows it by, and which feed that is. */
  readonly quoteRef: string;
  readonly quoteHint: string;
  readonly exchange: string;
  /** False where the field is meaningless — a vault holding has no ISIN. */
  readonly hasIsin: boolean;
  readonly hasExchange: boolean;
  /** One line on how a gain here is taxed. */
  readonly tax: string;
}

const EQUITY_TAX =
  "Listed equity: STT applies. Gains under 12 months are short-term at 20%; 12 months or more are long-term at 12.5% above the ₹1.25 lakh annual exemption.";
const EQUITY_FUND_TAX =
  "Taxed as an equity fund: under 12 months short-term at 20%, 12 months or more long-term at 12.5% above the ₹1.25 lakh exemption.";
const DEBT_TAX =
  "Debt: slab-taxed at every holding period since April 2023. There is no long-term rate, however long it is held.";
const METAL_TAX =
  "Bullion: no STT. Gains under 24 months are slab-taxed; 24 months or more are long-term at 12.5% without indexation.";

const DEFAULT: InstrumentHint = {
  symbol: "INFY",
  name: "Infosys Ltd",
  quoteRef: "",
  quoteHint: "The code the price source knows it by. Blank uses the symbol.",
  exchange: "NSE",
  hasIsin: true,
  hasExchange: true,
  tax: "",
};

const HINTS: Readonly<Record<InstrumentKind, InstrumentHint>> = {
  LISTED_EQUITY: {
    ...DEFAULT,
    quoteHint: "NSE symbol. Blank uses the symbol above, which is usually right.",
    tax: EQUITY_TAX,
  },
  ETF: {
    ...DEFAULT,
    symbol: "NIFTYBEES",
    name: "Nippon India ETF Nifty 50 BeES",
    quoteRef: "NIFTYBEES",
    quoteHint: "NSE symbol. Blank uses the symbol above.",
    tax: "Depends on what it holds — set that below. A gold ETF is taxed as bullion, not as equity.",
  },
  REIT: {
    ...DEFAULT,
    symbol: "MINDSPACE",
    name: "Mindspace Business Parks REIT",
    quoteRef: "MINDSPACE",
    quoteHint: "NSE symbol. Blank uses the symbol above.",
    tax: "Listed business trust: the same 12-month line as equity — 20% short-term, 12.5% long-term.",
  },
  INDEX_FUND: {
    ...DEFAULT,
    symbol: "UTI-NIFTY50",
    name: "UTI Nifty 50 Index Fund",
    quoteRef: "120716",
    quoteHint: "AMFI scheme code — a number, not a ticker. Priced from the daily NAV.",
    hasExchange: false,
    tax: EQUITY_FUND_TAX,
  },
  MUTUAL_FUND: {
    ...DEFAULT,
    symbol: "PPFAS-FLEXI",
    name: "Parag Parikh Flexi Cap Fund",
    quoteRef: "122639",
    quoteHint: "AMFI scheme code — a number, not a ticker. Priced from the daily NAV.",
    hasExchange: false,
    tax: EQUITY_FUND_TAX,
  },
  ELSS_FUND: {
    ...DEFAULT,
    symbol: "MIRAE-ELSS",
    name: "Mirae Asset ELSS Tax Saver",
    quoteRef: "135781",
    quoteHint: "AMFI scheme code. Priced from the daily NAV.",
    hasExchange: false,
    tax:
      EQUITY_FUND_TAX +
      " Locked in for three years from each purchase — the app refuses a sale inside it.",
  },
  LIQUID_FUND: {
    ...DEFAULT,
    symbol: "SBI-LIQUID",
    name: "SBI Liquid Fund",
    quoteRef: "119807",
    quoteHint: "AMFI scheme code. Priced from the daily NAV.",
    hasExchange: false,
    tax: DEBT_TAX,
  },
  DEBT_FUND: {
    ...DEFAULT,
    symbol: "HDFC-CORP",
    name: "HDFC Corporate Bond Fund",
    quoteRef: "119063",
    quoteHint: "AMFI scheme code. Priced from the daily NAV.",
    hasExchange: false,
    tax: DEBT_TAX + " Units bought before April 2023 keep indexation — tick the box below.",
  },
  BOND: {
    ...DEFAULT,
    symbol: "NCD-IIFL-2029",
    name: "IIFL Finance NCD 2029",
    quoteRef: "",
    quoteHint: "ISIN, or the exchange symbol. Bonds are thinly quoted; manual prices are normal.",
    tax: "Debt: interest is slab-taxed, and a gain on sale follows the debt rules.",
  },
  GOVT_SECURITY: {
    ...DEFAULT,
    symbol: "GS2033",
    name: "7.26% GOI 2033",
    quoteRef: "",
    quoteHint: "ISIN, or the exchange symbol.",
    tax: "Debt: interest is slab-taxed, and a gain on sale follows the debt rules.",
  },
  SOVEREIGN_GOLD_BOND: {
    ...DEFAULT,
    symbol: "SGBAUG32",
    name: "SGB 2024-25 Series II",
    quoteRef: "",
    quoteHint: "ISIN of the tranche, e.g. IN0020230085.",
    tax: "Gold, with the one exemption in the book: the capital gain is exempt if held to maturity, and taxed as bullion if sold early. The 2.5% coupon is slab-taxed either way.",
  },
  DIGITAL_GOLD: {
    symbol: "GOLD-TANISHQ",
    name: "Digital Gold — Tanishq",
    quoteRef: "GOLD999",
    quoteHint:
      "IBJA metal slug, not a ticker — GOLD999 for 24k, GOLD995 for 22k. This is what prices the holding.",
    exchange: "",
    hasIsin: false,
    hasExchange: false,
    tax: METAL_TAX,
  },
  DIGITAL_SILVER: {
    symbol: "SILVER-SAFEGOLD",
    name: "Digital Silver — SafeGold",
    quoteRef: "SILVER999",
    quoteHint: "IBJA metal slug, not a ticker — e.g. SILVER999.",
    exchange: "",
    hasIsin: false,
    hasExchange: false,
    tax: METAL_TAX,
  },
  DIGITAL_PLATINUM: {
    symbol: "PLATINUM-MMTC",
    name: "Digital Platinum — MMTC-PAMP",
    quoteRef: "PLATINUM999",
    quoteHint: "IBJA metal slug. IBJA publishes platinum irregularly, so it may stay unpriced.",
    exchange: "",
    hasIsin: false,
    hasExchange: false,
    tax: METAL_TAX,
  },
  CRYPTO: {
    symbol: "BTC",
    name: "Bitcoin",
    quoteRef: "bitcoin",
    quoteHint: "CoinGecko id, lowercase — bitcoin, ethereum. Not the ticker.",
    exchange: "",
    hasIsin: false,
    hasExchange: false,
    tax: "Virtual digital asset: a flat 30% at every holding period, no long-term relief, and losses that cannot be set off against anything — not even other crypto gains.",
  },
  OPTION: {
    ...DEFAULT,
    symbol: "NIFTY24000CE",
    name: "Nifty 24000 Call",
    quoteRef: "",
    quoteHint: "No shipped feed carries derivatives — price these manually.",
    hasIsin: false,
    tax: "F&O is business income, not capital gains: taxed at slab, with an audit threshold and its own set-off rules.",
  },
  FUTURE: {
    ...DEFAULT,
    symbol: "NIFTYSEPFUT",
    name: "Nifty September Future",
    quoteRef: "",
    quoteHint: "No shipped feed carries derivatives — price these manually.",
    hasIsin: false,
    tax: "F&O is business income, not capital gains: taxed at slab, with an audit threshold and its own set-off rules.",
  },
};

export function hintsFor(kind: InstrumentKind): InstrumentHint {
  return HINTS[kind] ?? DEFAULT;
}

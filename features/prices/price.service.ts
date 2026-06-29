import { logger } from "@/core/logger";
import { INDIAN_STOCK_SYMBOLS } from "@/lib/constants";
import type { Investment } from "@/features/investments/investment.types";
import type { Quote } from "./price.types";

/**
 * Live price lookups from FREE, public, no-auth sources. This NEVER touches the
 * user's accounts — it only reads public market prices and converts them to INR.
 *   - Yahoo Finance  → stocks/ETFs (US + NSE/BSE via the .NS suffix) and FX rates
 *   - MFAPI.in       → mutual-fund NAV (when the symbol is a numeric scheme code)
 *   - CoinGecko      → crypto, priced directly in INR
 */
const YAHOO = "https://query1.finance.yahoo.com/v8/finance/chart/";
const COINGECKO = "https://api.coingecko.com/api/v3/simple/price";
const MFAPI = "https://api.mfapi.in/mf/";

const indianSymbols = new Set(INDIAN_STOCK_SYMBOLS);

const COIN_IDS: Record<string, string> = {
  BTC: "bitcoin",
  ETH: "ethereum",
  SOL: "solana",
  BNB: "binancecoin",
  XRP: "ripple",
  ADA: "cardano",
  DOGE: "dogecoin",
  MATIC: "matic-network",
  DOT: "polkadot",
  LTC: "litecoin",
  USDT: "tether",
  USDC: "usd-coin",
};

async function fetchJson(url: string): Promise<unknown | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
      cache: "no-store",
    });
    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    logger.warn("price fetch failed", { url, err });
    return null;
  }
}

async function fetchYahoo(symbol: string): Promise<Quote | null> {
  const json = (await fetchJson(
    `${YAHOO}${encodeURIComponent(symbol)}?interval=1d&range=1d`,
  )) as { chart?: { result?: Array<{ meta?: { regularMarketPrice?: number; currency?: string } }> } } | null;
  const meta = json?.chart?.result?.[0]?.meta;
  if (!meta || typeof meta.regularMarketPrice !== "number") return null;
  return { price: meta.regularMarketPrice, currency: meta.currency || "USD" };
}

/** Multiplier to convert `currency` → INR (1 for INR). Cached per refresh run. */
async function fxToInr(currency: string, cache: Map<string, number>): Promise<number | null> {
  const cur = currency.toUpperCase();
  if (cur === "INR") return 1;
  if (cache.has(cur)) return cache.get(cur)!;
  const quote = await fetchYahoo(`${cur}INR=X`);
  if (!quote) return null;
  cache.set(cur, quote.price);
  return quote.price;
}

async function fetchCryptoInr(symbol: string): Promise<number | null> {
  const id = COIN_IDS[symbol.toUpperCase()];
  if (!id) return null;
  const json = (await fetchJson(`${COINGECKO}?ids=${id}&vs_currencies=inr`)) as
    | Record<string, { inr?: number }>
    | null;
  const price = json?.[id]?.inr;
  return typeof price === "number" ? price : null;
}

async function fetchMfNav(schemeCode: string): Promise<number | null> {
  const json = (await fetchJson(`${MFAPI}${schemeCode}/latest`)) as
    | { data?: Array<{ nav?: string }> }
    | null;
  const nav = json?.data?.[0]?.nav;
  const num = nav ? Number(nav) : NaN;
  return Number.isFinite(num) ? num : null;
}

/** Map an investment to a Yahoo symbol (adds .NS for known Indian tickers). */
function yahooSymbolFor(rawSymbol: string): string {
  const sym = rawSymbol.trim().toUpperCase();
  if (sym.includes(".")) return sym; // already exchange-qualified (e.g. RELIANCE.NS)
  if (indianSymbols.has(sym)) return `${sym}.NS`;
  return sym; // assume US / global
}

export const priceService = {
  /** Latest price in INR for one holding, or null if it can't be resolved. */
  async getInrPrice(inv: Investment, fxCache: Map<string, number>): Promise<number | null> {
    const symbol = (inv.symbol || "").trim();
    if (!symbol) return null;

    if (inv.kind === "CRYPTO") return fetchCryptoInr(symbol);
    if (inv.kind === "MUTUAL_FUND" && /^\d+$/.test(symbol)) return fetchMfNav(symbol);

    const quote = await fetchYahoo(yahooSymbolFor(symbol));
    if (!quote) return null;
    const fx = await fxToInr(quote.currency, fxCache);
    if (fx == null) return null;
    return quote.price * fx;
  },
};

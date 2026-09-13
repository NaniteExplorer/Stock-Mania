/**
 * `query2.finance.yahoo.com/v1/finance/search` — a **candidate generator**.
 *
 * Not the ranker, and deliberately not in the keystroke chain (C11). Measured at
 * 74% intent accuracy: it ranks ADRs above home listings, and it has zero typo
 * tolerance for company names ("relaince" returns nothing). What it is good at is
 * producing plausible keys for symbols the local catalogue has never heard of, at
 * ingest time, so the catalogue can probe and index them offline.
 *
 * Two normalisations happen here because they are properties of *this* source:
 * `.` becomes `-` in a query (Yahoo spells the Berkshire B share `BRK-B`), and
 * anything that is not an equity or an ETF is dropped — its free-text search
 * otherwise offers futures, options and currencies for an equity query.
 */

import { Ok } from "@/core/kernel";
import { Currency } from "@/core/money";
import { RateLimitBudget } from "@/domain/pricing";
import { ProviderOptions, ProviderRuntime } from "@/infra/providers";
import { MarketDataSource } from "@/market-data/engine/source";
import type {
  MarketCode,
  MarketDataResult,
  MarketDataSourceInfo,
  SymbolCandidate,
  SymbolSearchPort,
  SymbolSearchQuery,
  TradableType,
} from "@/market-data/ports";

interface YahooSearchPayload {
  quotes?: {
    symbol?: string;
    shortname?: string;
    longname?: string;
    exchange?: string;
    exchDisp?: string;
    quoteType?: string;
  }[];
}

/** Yahoo's exchange code to our market and the currency that exchange trades in. */
const EXCHANGE_MARKETS: Record<string, { market: MarketCode; currency: string }> = {
  NSI: { market: "IN", currency: "INR" },
  BSE: { market: "IN", currency: "INR" },
  BOM: { market: "IN", currency: "INR" },
  NMS: { market: "US", currency: "USD" },
  NGM: { market: "US", currency: "USD" },
  NCM: { market: "US", currency: "USD" },
  NYQ: { market: "US", currency: "USD" },
  PCX: { market: "US", currency: "USD" },
  ASE: { market: "US", currency: "USD" },
  BTS: { market: "US", currency: "USD" },
};

const ACCEPTED_TYPES: Record<string, TradableType> = {
  EQUITY: "EQUITY",
  ETF: "ETF",
};

/** `.`-to-`-`: Yahoo spells class shares with a hyphen. Also the ranker's rule (C11). */
export function yahooQueryNormalisation(text: string): string {
  return text.trim().replace(/\./g, "-");
}

export class YahooSearchAdapter extends MarketDataSource implements SymbolSearchPort {
  readonly info: MarketDataSourceInfo = {
    id: "yahoo-search",
    displayName: "Yahoo Finance search (candidate generator)",
    capabilities: ["SEARCH"],
    markets: ["GLOBAL", "IN", "US"],
    keyless: true,
  };

  constructor(runtime: ProviderRuntime, options: ProviderOptions = {}) {
    super(runtime, options);
  }

  override rateLimit(): RateLimitBudget {
    return { requests: 20, perMillis: 60_000, burst: 4 };
  }

  async search(query: SymbolSearchQuery): Promise<MarketDataResult<readonly SymbolCandidate[]>> {
    const text = yahooQueryNormalisation(query.text);
    if (text.length === 0) return Ok([]);

    const limit = query.limit ?? 10;
    return this.run(async () => {
      const payload = await this.getJson<YahooSearchPayload>(
        `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(text)}` +
          `&quotesCount=${limit * 3}&newsCount=0&listsCount=0`,
      );

      const candidates: SymbolCandidate[] = [];
      for (const row of payload.quotes ?? []) {
        const symbol = row.symbol?.trim();
        const instrumentType = ACCEPTED_TYPES[String(row.quoteType ?? "").toUpperCase()];
        if (!symbol || !instrumentType) continue;

        const exchange = String(row.exchange ?? "").toUpperCase();
        const placed = EXCHANGE_MARKETS[exchange];
        // An exchange this adapter cannot name a currency for is dropped rather
        // than guessed: a GBP price silently taken as USD is the error class the
        // currency guard in the chart adapter exists to catch, and guessing here
        // would just move it earlier.
        if (!placed) continue;
        if (query.market && query.market !== "GLOBAL" && placed.market !== query.market) continue;

        candidates.push({
          quoteKey: symbol,
          symbol: symbol.split(".")[0],
          name: (row.longname ?? row.shortname ?? symbol).trim(),
          exchange: row.exchDisp?.trim() || exchange,
          currency: Currency.of(placed.currency),
          market: placed.market,
          instrumentType,
          isin: null,
          // Zero, deliberately: this source does not rank, the catalogue does.
          score: 0,
          sourceId: this.info.id,
        });
        if (candidates.length >= limit) break;
      }
      return candidates as readonly SymbolCandidate[];
    });
  }
}

import { cache as requestCache } from "react";
import { config } from "@/core/config/env";
import { fetchJSON } from "@/core/http/fetch-json";
import { cache } from "@/core/cache";
import { logger } from "@/core/logger";
import { POPULAR_STOCK_SYMBOLS } from "@/lib/constants";

type FinnhubProfile = {
  name?: string;
  ticker?: string;
  exchange?: string;
};

type FinnhubSearchResultWithExchange = FinnhubSearchResult & {
  exchange?: string;
};

/**
 * Stock search via Finnhub.
 *
 * Two layers of caching:
 *  1. React `cache()` — deduplicates repeated calls within a single request.
 *  2. `core/cache` (Redis when set, in-memory otherwise) — cross-request cache
 *     so 1,000 concurrent users searching "AAPL" produce 1 Finnhub call, not 1,000.
 *
 * TTLs:
 *  - Symbol profiles: 1 hour (company metadata rarely changes)
 *  - Search results: 30 minutes
 */
export const searchStocks = requestCache(
  async (query?: string): Promise<StockWithWatchlistStatus[]> => {
    try {
      const { apiKey, baseUrl } = config.finnhub();
      if (!apiKey) {
        logger.error("Finnhub API key is not configured");
        return [];
      }

      const trimmed = typeof query === "string" ? query.trim() : "";
      let results: FinnhubSearchResultWithExchange[] = [];

      if (!trimmed) {
        const top = POPULAR_STOCK_SYMBOLS.slice(0, 10);

        const profiles = await Promise.all(
          top.map(async (sym) => {
            const profile = await cache.wrap<FinnhubProfile | null>(
              `profile:${sym}`,
              3600,
              async () => {
                try {
                  const url = `${baseUrl}/stock/profile2?symbol=${encodeURIComponent(sym)}&token=${apiKey}`;
                  return fetchJSON<FinnhubProfile>(url, { revalidateSeconds: 3600 });
                } catch {
                  logger.warn("Failed to fetch profile2", { sym });
                  return null;
                }
              },
            );
            return { sym, profile };
          }),
        );

        results = profiles
          .map(({ sym, profile }) => {
            const symbol = sym.toUpperCase();
            const name = profile?.name || profile?.ticker || undefined;
            const exchange = profile?.exchange || undefined;
            if (!name) return undefined;
            const item: FinnhubSearchResultWithExchange = {
              symbol,
              description: name,
              displaySymbol: symbol,
              type: "Common Stock",
              exchange,
            };
            return item;
          })
          .filter((x): x is FinnhubSearchResultWithExchange => Boolean(x));
      } else {
        const cacheKey = `search:${trimmed.toLowerCase()}`;
        const data = await cache.wrap<FinnhubSearchResponse | null>(
          cacheKey,
          1800,
          async () => {
            const url = `${baseUrl}/search?q=${encodeURIComponent(trimmed)}&token=${apiKey}`;
            return fetchJSON<FinnhubSearchResponse>(url, { revalidateSeconds: 1800 });
          },
        );
        results = Array.isArray(data?.result) ? data.result : [];
      }

      return results
        .map((r) => {
          const upper = (r.symbol || "").toUpperCase();
          const name = r.description || upper;
          const exchangeFromDisplay =
            (r.displaySymbol as string | undefined) || undefined;
          const exchange = exchangeFromDisplay || r.exchange || "US";
          const type = r.type || "Stock";
          const item: StockWithWatchlistStatus = {
            symbol: upper,
            name,
            exchange,
            type,
            isInWatchlist: false,
          };
          return item;
        })
        .slice(0, 15);
    } catch (err) {
      logger.error("searchStocks failed", err);
      return [];
    }
  },
);

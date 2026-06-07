import { cache as requestCache } from "react";
import { config } from "@/core/config/env";
import { fetchJSON } from "@/core/http/fetch-json";
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
 * Stock search via Finnhub. Wrapped in React `cache` so repeated calls within a
 * single request (e.g. Header + nav) are de-duplicated.
 *
 * SCALE: the per-symbol profile fetches and search results are prime candidates
 * for a shared Redis cache (core/cache) so one upstream call serves every user,
 * instead of hitting Finnhub's rate limit per request.
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
        // Default view: profiles for the top popular symbols.
        const top = POPULAR_STOCK_SYMBOLS.slice(0, 10);
        const profiles = await Promise.all(
          top.map(async (sym) => {
            try {
              const url = `${baseUrl}/stock/profile2?symbol=${encodeURIComponent(sym)}&token=${apiKey}`;
              const profile = await fetchJSON<FinnhubProfile>(url, {
                revalidateSeconds: 3600,
              });
              return { sym, profile };
            } catch {
              logger.warn("Failed to fetch profile2", { sym });
              return { sym, profile: null };
            }
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
        const url = `${baseUrl}/search?q=${encodeURIComponent(trimmed)}&token=${apiKey}`;
        const data = await fetchJSON<FinnhubSearchResponse>(url, {
          revalidateSeconds: 1800,
        });
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

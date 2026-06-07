import { cache } from "@/core/cache";
import { config } from "@/core/config/env";
import { fetchJSON } from "@/core/http/fetch-json";
import { logger } from "@/core/logger";
import { formatArticle, getDateRange, validateArticle } from "@/lib/utils";

const MAX_ARTICLES = 6;

/**
 * Market / company news via Finnhub.
 *
 * SCALE: per-symbol company-news fetches are the same for every user tracking a
 * symbol — cache them once in Redis (core/cache) keyed by symbol+date and fan
 * the daily email out per user (see lib/inngest/functions.ts) instead of the
 * current single-step loop.
 */
export async function getNews(
  symbols?: string[],
): Promise<MarketNewsArticle[]> {
  try {
    const { apiKey, baseUrl } = config.finnhub();
    if (!apiKey) throw new Error("Finnhub API key is not configured");

    const range = getDateRange(5);
    const cleanSymbols = (symbols || [])
      .map((s) => s?.trim().toUpperCase())
      .filter((s): s is string => Boolean(s));

    if (cleanSymbols.length > 0) {
      const perSymbolArticles: Record<string, RawNewsArticle[]> = {};

      await Promise.all(
        cleanSymbols.map(async (sym) => {
          try {
            // Cached per symbol+date so one upstream call serves every user
            // tracking that symbol (Redis next session — see SCALABILITY.md).
            perSymbolArticles[sym] = await cache.wrap(
              `finnhub:company-news:${sym}:${range.from}:${range.to}`,
              300,
              async () => {
                const url = `${baseUrl}/company-news?symbol=${encodeURIComponent(sym)}&from=${range.from}&to=${range.to}&token=${apiKey}`;
                const list = await fetchJSON<RawNewsArticle[]>(url, {
                  revalidateSeconds: 300,
                });
                return (list || []).filter(validateArticle);
              },
            );
          } catch {
            logger.warn("Failed to fetch company news", { sym });
            perSymbolArticles[sym] = [];
          }
        }),
      );

      const collected: MarketNewsArticle[] = [];
      // Round-robin across symbols up to MAX_ARTICLES.
      for (let round = 0; round < MAX_ARTICLES; round++) {
        for (let i = 0; i < cleanSymbols.length; i++) {
          const sym = cleanSymbols[i];
          const list = perSymbolArticles[sym] || [];
          if (list.length === 0) continue;
          const article = list.shift();
          if (!article || !validateArticle(article)) continue;
          collected.push(formatArticle(article, true, sym, round));
          if (collected.length >= MAX_ARTICLES) break;
        }
        if (collected.length >= MAX_ARTICLES) break;
      }

      if (collected.length > 0) {
        collected.sort((a, b) => (b.datetime || 0) - (a.datetime || 0));
        return collected.slice(0, MAX_ARTICLES);
      }
      // Fall through to general news if nothing collected.
    }

    const generalUrl = `${baseUrl}/news?category=general&token=${apiKey}`;
    const general = await cache.wrap("finnhub:news:general", 300, () =>
      fetchJSON<RawNewsArticle[]>(generalUrl, { revalidateSeconds: 300 }),
    );

    const seen = new Set<string>();
    const unique: RawNewsArticle[] = [];
    for (const art of general || []) {
      if (!validateArticle(art)) continue;
      const key = `${art.id}-${art.url}-${art.headline}`;
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(art);
      if (unique.length >= 20) break;
    }

    return unique
      .slice(0, MAX_ARTICLES)
      .map((a, idx) => formatArticle(a, false, undefined, idx));
  } catch (err) {
    logger.error("getNews failed", err);
    throw new Error("Failed to fetch news");
  }
}

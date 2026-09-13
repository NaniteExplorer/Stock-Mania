/**
 * `stockanalysis.com/api/quotes/s/{symbol}` — the third line for a US live quote.
 *
 * Reached only when both Yahoo and Nasdaq have failed, which is why it is a quote
 * adapter and nothing more. Its history endpoint is deliberately **not**
 * implemented: `stockanalysis.com`'s `MAX` range lies exactly the way Yahoo's
 * `range=max` does (C4), returning 200 with a silently down-sampled series, and an
 * adapter that can only serve a trap is worse than no adapter.
 *
 * The payload ships prices as decimal strings, so they are parsed straight to
 * scaled integers. It is an undocumented site endpoint with no ToS grant and its
 * shape has not been verified from this codebase — the parsing below is therefore
 * defensive, and an unrecognised body is a typed malformed response rather than an
 * exception that escapes into a page render.
 */

import { CalendarDate } from "@/core/time";
import { RateLimitBudget } from "@/domain/pricing";
import { ProviderOptions, ProviderRuntime } from "@/infra/providers";
import { MarketDataSource } from "@/market-data/engine/source";
import {
  type LiveQuote,
  type LiveQuotePort,
  type LiveQuoteRequest,
  type MarketDataResult,
  type MarketDataSourceInfo,
  scaledFromDecimal,
} from "@/market-data/ports";

interface StockAnalysisPayload {
  status?: number;
  data?: {
    /** Last price, as a decimal string. */
    p?: string | number;
    /** The stamp the site rendered the quote at. */
    u?: string;
  };
}

export class StockAnalysisQuoteAdapter extends MarketDataSource implements LiveQuotePort {
  readonly info: MarketDataSourceInfo = {
    id: "stockanalysis-quote",
    displayName: "stockanalysis.com quote (US, third line)",
    capabilities: ["QUOTE"],
    markets: ["US"],
    keyless: true,
  };

  constructor(runtime: ProviderRuntime, options: ProviderOptions = {}) {
    super(runtime, options);
  }

  override rateLimit(): RateLimitBudget {
    return { requests: 15, perMillis: 60_000, burst: 3 };
  }

  async quote(request: LiveQuoteRequest): Promise<MarketDataResult<readonly LiveQuote[]>> {
    const asAt = request.asAt ?? new Date(this.runtime.now());
    const freshnessMinutes = request.freshnessMinutes ?? 30;

    return this.run(async () => {
      const quotes: LiveQuote[] = [];
      for (const subject of request.subjects) {
        if (subject.currency.code !== "USD") {
          throw this.malformed(
            `${subject.quoteKey} is held in ${subject.currency.code}; this source prices in USD.`,
          );
        }
        // Yahoo's `.`-to-`-` convention is this site's convention too.
        const symbol = subject.quoteKey.replace(/\./g, "-").toLowerCase();
        const payload = await this.getJson<StockAnalysisPayload>(
          `https://stockanalysis.com/api/quotes/s/${encodeURIComponent(symbol)}`,
        );

        const raw = payload.data?.p;
        if (raw === undefined || raw === null || raw === "") {
          throw this.malformed(`no last price in the payload for ${subject.quoteKey}.`);
        }
        // A string is parsed exactly; a number is rendered at scale first. Either
        // way nothing multiplies a float by 1e8.
        const priceScaled =
          typeof raw === "string" ? scaledFromDecimal(raw.replace(/[,$]/g, "")) : scaledFromDecimal(raw.toFixed(8));

        const parsedAt = payload.data?.u ? Date.parse(payload.data.u) : Number.NaN;
        const observedAt = Number.isNaN(parsedAt) ? asAt : new Date(parsedAt);
        quotes.push({
          quoteKey: subject.quoteKey,
          priceScaled,
          currency: subject.currency,
          asOf: CalendarDate.fromUtcInstant(observedAt),
          observedAt,
          stale: Math.floor((asAt.getTime() - observedAt.getTime()) / 60_000) > freshnessMinutes,
          sourceId: this.info.id,
        });
      }
      return quotes as readonly LiveQuote[];
    });
  }
}

/**
 * `api.nasdaq.com/api/quote/{symbol}/chart` — the US history failover.
 *
 * An **independent transport**, and that is all it is claimed to be. It very
 * probably shares an upstream with Yahoo, so it is a failover and explicitly
 * **not** a cross-check oracle (C12): two sources agreeing means nothing when they
 * may be the same data twice, and treating agreement as verification would give
 * false confidence about the exact prints that are most likely to be wrong.
 *
 * Explicit `fromdate`/`todate`, always (C4). Nasdaq ships its prices as *strings*
 * with a currency symbol and thousands separators (`"$1,229.35"`), so they are
 * cleaned and parsed straight to scaled integers — no float on the path.
 *
 * `adjusted: true`: like Yahoo, the series is restated into post-split terms.
 */

import { Err } from "@/core/kernel";
import { CalendarDate } from "@/core/time";
import { ProviderError, RateLimitBudget } from "@/domain/pricing";
import { ProviderOptions, ProviderRuntime } from "@/infra/providers";
import { MarketDataSource } from "@/market-data/engine/source";
import {
  type DailyBar,
  dailyBar,
  type HistoricalSeries,
  type HistoricalSeriesPort,
  type HistoryRequest,
  type MarketDataResult,
  type MarketDataSourceInfo,
  scaledFromDecimal,
} from "@/market-data/ports";

interface NasdaqChartPayload {
  data?: {
    chart?: {
      z?: {
        date?: string;
        open?: string;
        high?: string;
        low?: string;
        close?: string;
        volume?: string;
      };
    }[];
  };
  status?: { rCode?: number; bCodeMessage?: unknown };
}

/** `"$1,229.35"` -> `"1229.35"`. Currency symbol and separators, nothing else. */
export function cleanNasdaqPrice(text: string): string {
  return text.replace(/[^0-9.\-]/g, "");
}

/** `"Sep 12, 2025"` — Nasdaq's own spelling, in US Eastern terms. */
export function parseNasdaqDate(text: string): CalendarDate | null {
  const parsed = Date.parse(`${text.trim()} UTC`);
  if (Number.isNaN(parsed)) return null;
  return CalendarDate.fromUtcInstant(new Date(parsed));
}

export class NasdaqChartHistoryAdapter extends MarketDataSource implements HistoricalSeriesPort {
  readonly info: MarketDataSourceInfo = {
    id: "nasdaq-chart-history",
    displayName: "Nasdaq chart API (US failover)",
    capabilities: ["HISTORY"],
    markets: ["US"],
    keyless: true,
  };

  constructor(runtime: ProviderRuntime, options: ProviderOptions = {}) {
    super(runtime, options);
  }

  override rateLimit(): RateLimitBudget {
    return { requests: 20, perMillis: 60_000, burst: 4 };
  }

  async history(request: HistoryRequest): Promise<MarketDataResult<HistoricalSeries>> {
    if (!request.adjusted) {
      return Err(
        new ProviderError(
          "UNSUPPORTED",
          this.info.id,
          `${this.info.id} serves split-restated prices only; an as-traded US series has no ` +
            `free keyless source in this stack.`,
          false,
        ),
      );
    }
    if (request.currency.code !== "USD") {
      return Err(
        new ProviderError(
          "UNSUPPORTED",
          this.info.id,
          `${this.info.id} prices in USD, not ${request.currency.code}.`,
          false,
        ),
      );
    }

    return this.run(async () => {
      const payload = await this.getJson<NasdaqChartPayload>(
        `https://api.nasdaq.com/api/quote/${encodeURIComponent(request.quoteKey)}/chart` +
          `?assetclass=stocks&fromdate=${request.range.start.toISO()}&todate=${request.range.end.toISO()}`,
      );

      const points = payload.data?.chart;
      if (!points || points.length === 0) throw this.unknownSymbol(request.quoteKey);

      const bars: DailyBar[] = [];
      for (const point of points) {
        const z = point.z;
        if (!z?.date || !z.open || !z.high || !z.low || !z.close) continue;
        const asOf = parseNasdaqDate(z.date);
        if (!asOf || !request.range.contains(asOf)) continue;
        const lowScaled = scaledFromDecimal(cleanNasdaqPrice(z.low));
        if (lowScaled <= 0n) continue;
        bars.push(
          dailyBar(this.info.id, {
            asOf,
            openScaled: scaledFromDecimal(cleanNasdaqPrice(z.open)),
            highScaled: scaledFromDecimal(cleanNasdaqPrice(z.high)),
            lowScaled,
            closeScaled: scaledFromDecimal(cleanNasdaqPrice(z.close)),
            volume: z.volume ? BigInt(z.volume.replace(/[^0-9]/g, "") || "0") : null,
          }),
        );
      }

      if (bars.length === 0) throw this.unknownSymbol(request.quoteKey);
      bars.sort((a, b) => a.asOf.compareTo(b.asOf));

      return {
        quoteKey: request.quoteKey,
        currency: request.currency,
        adjusted: true,
        asOf: bars[bars.length - 1].asOf,
        bars,
        sourceId: this.info.id,
      } satisfies HistoricalSeries;
    });
  }
}

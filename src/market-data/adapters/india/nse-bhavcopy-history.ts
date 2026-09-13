/**
 * `nsearchives.nseindia.com/products/content/sec_bhavdata_full_DDMMYYYY.csv` — the
 * official NSE daily security file, **as traded**.
 *
 * This is the Indian history failover, and the only source in the stack that
 * prints what actually changed hands: the exchange does not retroactively restate
 * a 2019 close when a 10:1 split happens in 2024. So it declares
 * **`adjusted: false`**, and that flag is the whole reason the adapter exists —
 * the chain will refuse to splice it onto a Yahoo series rather than produce a
 * chart with an invisible 10x step in it (C3).
 *
 * The archive is one file per trading day, which makes it a gap-filler and a
 * failover, not a backfill mechanism: 30 years is roughly 7 500 requests. The
 * range is therefore capped, and a caller asking for more is told to use the
 * primary rather than quietly being put in a two-hour loop.
 *
 * A day with no file is a market holiday, not an outage (`tryGetText`).
 */

import { Err } from "@/core/kernel";
import { CalendarDate } from "@/core/time";
import { ProviderError, RateLimitBudget } from "@/domain/pricing";
import { ProviderOptions, ProviderRuntime } from "@/infra/providers";
import { MarketDataSource, parseDelimited, weekdaysIn } from "@/market-data/engine/source";
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

/** Beyond this the caller wants a backfill, and a backfill belongs to the primary. */
export const NSE_BHAVCOPY_MAX_DAYS = 90;

const TRADED_SERIES = new Set(["EQ", "BE", "BZ", "SM", "ST"]);

function ddmmyyyy(date: CalendarDate): string {
  const iso = date.toISO();
  return `${iso.slice(8, 10)}${iso.slice(5, 7)}${iso.slice(0, 4)}`;
}

export class NseBhavcopyHistoryAdapter extends MarketDataSource implements HistoricalSeriesPort {
  readonly info: MarketDataSourceInfo = {
    id: "nse-bhavcopy-history",
    displayName: "NSE daily bhavcopy archive (as traded)",
    capabilities: ["HISTORY"],
    markets: ["IN"],
    keyless: true,
  };

  constructor(runtime: ProviderRuntime, options: ProviderOptions = {}) {
    super(runtime, options);
  }

  override rateLimit(): RateLimitBudget {
    // One file per day means the loop below is the thing that needs pacing, and
    // this host sits behind Akamai. Slow and steady.
    return { requests: 30, perMillis: 60_000, burst: 5 };
  }

  async history(request: HistoryRequest): Promise<MarketDataResult<HistoricalSeries>> {
    if (request.adjusted) {
      return Err(
        new ProviderError(
          "UNSUPPORTED",
          this.info.id,
          `${this.info.id} publishes as-traded prices and cannot produce a split-restated ` +
            `series for ${request.quoteKey}.`,
          false,
        ),
      );
    }
    if (request.currency.code !== "INR") {
      return Err(
        new ProviderError(
          "UNSUPPORTED",
          this.info.id,
          `${this.info.id} prices in INR, not ${request.currency.code}.`,
          false,
        ),
      );
    }

    const days = weekdaysIn(request.range);
    if (days.length > NSE_BHAVCOPY_MAX_DAYS) {
      return Err(
        new ProviderError(
          "UNSUPPORTED",
          this.info.id,
          `${this.info.id} is one file per trading day; ${days.length} days would be ` +
            `${days.length} requests. Ask it for at most ${NSE_BHAVCOPY_MAX_DAYS} days.`,
          false,
        ),
      );
    }

    // `RELIANCE.NS` -> `RELIANCE`. The archive is keyed by the bare NSE symbol.
    const symbol = request.quoteKey.replace(/\.(NS|BO)$/i, "").toUpperCase();

    return this.run(async () => {
      const bars: DailyBar[] = [];
      for (const day of days) {
        const body = await this.tryGetText(
          `https://nsearchives.nseindia.com/products/content/sec_bhavdata_full_${ddmmyyyy(day)}.csv`,
        );
        if (body === null) continue;

        for (const row of parseDelimited(body)) {
          if (row.SYMBOL !== symbol) continue;
          if (!TRADED_SERIES.has(row.SERIES)) continue;
          const open = row.OPEN_PRICE;
          const high = row.HIGH_PRICE;
          const low = row.LOW_PRICE;
          const close = row.CLOSE_PRICE;
          if (!open || !high || !low || !close) continue;
          // Decimal strings, parsed straight to scaled integers — never via a float.
          const lowScaled = scaledFromDecimal(low);
          // A suspended scrip prints as a row of zeroes rather than as no row.
          if (lowScaled <= 0n) continue;
          bars.push(
            dailyBar(this.info.id, {
              asOf: day,
              openScaled: scaledFromDecimal(open),
              highScaled: scaledFromDecimal(high),
              lowScaled,
              closeScaled: scaledFromDecimal(close),
              volume: row.TTL_TRD_QNTY ? BigInt(row.TTL_TRD_QNTY.replace(/[^0-9]/g, "") || "0") : null,
            }),
          );
          break;
        }
      }

      if (bars.length === 0) throw this.unknownSymbol(request.quoteKey);
      bars.sort((a, b) => a.asOf.compareTo(b.asOf));

      return {
        quoteKey: request.quoteKey,
        currency: request.currency,
        // Never `true`, under any circumstance. See the file comment.
        adjusted: false,
        asOf: bars[bars.length - 1].asOf,
        bars,
        sourceId: this.info.id,
      } satisfies HistoricalSeries;
    });
  }
}

/**
 * `nsearchives.nseindia.com/content/indices/ind_close_all_DDMMYYYY.csv` — the
 * official daily close of every NSE index, from roughly 2013.
 *
 * This is the benchmark source for the comparison view: NIFTY 50 and NIFTY 500 on
 * the same normalised axis as a holding. It is an *index level*, not a price, so
 * `adjusted: false` is the honest flag — nobody restates an index level, and
 * declaring `true` would let the chain splice it onto a restated equity series.
 *
 * One file per trading day, same as the bhavcopy archives, so the same range cap.
 * Yahoo's `^NSEI` remains the primary for long benchmark history (it goes back to
 * 2007); this is the official failover and the cross-check.
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

export const NSE_INDEX_CLOSE_MAX_DAYS = 90;

/** The archive names indexes in prose; the app names them the Yahoo way. */
const INDEX_NAMES: Record<string, string> = {
  "^NSEI": "NIFTY 50",
  "^NSEBANK": "NIFTY BANK",
  "^CNX100": "NIFTY 100",
  "^CRSLDX": "NIFTY 500",
};

function ddmmyyyy(date: CalendarDate): string {
  const iso = date.toISO();
  return `${iso.slice(8, 10)}${iso.slice(5, 7)}${iso.slice(0, 4)}`;
}

export class NseIndexCloseAdapter extends MarketDataSource implements HistoricalSeriesPort {
  readonly info: MarketDataSourceInfo = {
    id: "nse-index-close",
    displayName: "NSE daily index close archive",
    capabilities: ["HISTORY"],
    markets: ["IN"],
    keyless: true,
  };

  constructor(runtime: ProviderRuntime, options: ProviderOptions = {}) {
    super(runtime, options);
  }

  override rateLimit(): RateLimitBudget {
    return { requests: 30, perMillis: 60_000, burst: 5 };
  }

  async history(request: HistoryRequest): Promise<MarketDataResult<HistoricalSeries>> {
    if (request.adjusted) {
      return Err(
        new ProviderError(
          "UNSUPPORTED",
          this.info.id,
          `${this.info.id} publishes index levels, which are never restated.`,
          false,
        ),
      );
    }

    const wanted = (INDEX_NAMES[request.quoteKey.toUpperCase()] ?? request.quoteKey).toUpperCase();
    const days = weekdaysIn(request.range);
    if (days.length > NSE_INDEX_CLOSE_MAX_DAYS) {
      return Err(
        new ProviderError(
          "UNSUPPORTED",
          this.info.id,
          `${this.info.id} is one file per trading day; ask it for at most ` +
            `${NSE_INDEX_CLOSE_MAX_DAYS} days, not ${days.length}.`,
          false,
        ),
      );
    }

    return this.run(async () => {
      const bars: DailyBar[] = [];
      for (const day of days) {
        const body = await this.tryGetText(
          `https://nsearchives.nseindia.com/content/indices/ind_close_all_${ddmmyyyy(day)}.csv`,
        );
        if (body === null) continue;

        for (const row of parseDelimited(body)) {
          if ((row["INDEX NAME"] ?? "").toUpperCase() !== wanted) continue;
          const open = row["OPEN INDEX VALUE"];
          const high = row["HIGH INDEX VALUE"];
          const low = row["LOW INDEX VALUE"];
          const close = row["CLOSING INDEX VALUE"];
          if (!open || !high || !low || !close) continue;
          const lowScaled = scaledFromDecimal(low);
          if (lowScaled <= 0n) continue;
          bars.push(
            dailyBar(this.info.id, {
              asOf: day,
              openScaled: scaledFromDecimal(open),
              highScaled: scaledFromDecimal(high),
              lowScaled,
              closeScaled: scaledFromDecimal(close),
              // An index has no share count. Null, never zero.
              volume: null,
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
        adjusted: false,
        asOf: bars[bars.length - 1].asOf,
        bars,
        sourceId: this.info.id,
      } satisfies HistoricalSeries;
    });
  }
}

/**
 * `bseindia.com/download/BhavCopy/Equity/BhavCopy_BSE_CM_0_0_0_YYYYMMDD_F_0000.CSV`
 * — the official BSE daily file, **as traded**.
 *
 * The sibling of the NSE archive, and it exists for a specific tier rather than as
 * a duplicate: BSE-only scrips are 96% priceable and are a *full* tier, not a
 * degraded one (C9). It is also the only history source for a scrip whose `.BO`
 * Yahoo key truncates — `.BO` truncation hits exactly the dual-listed blue chips,
 * which is why C9 canonicalises those to `.NS` and leaves this adapter for the
 * BSE-only names.
 *
 * `adjusted: false`, always: the exchange prints what traded and never restates.
 * One file per trading day, so the same range cap as NSE applies.
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

export const BSE_BHAVCOPY_MAX_DAYS = 90;

/**
 * `SctySrs` values that are equity.
 *
 * Note what this is **not**: the Upstox master's `instrument_type`, which is a BSE
 * *group code* — filtering that on `"EQ"` returns zero rows and `F`/`G` are debt
 * (C9). The bhavcopy's own series column is a different field with different
 * values, and the two are easy to confuse.
 */
const EQUITY_SERIES = new Set(["A", "B", "T", "X", "XT", "M", "MT", "MS", "IF", "E", "EQ"]);

function yyyymmdd(date: CalendarDate): string {
  return date.toISO().replace(/-/g, "");
}

export class BseBhavcopyHistoryAdapter extends MarketDataSource implements HistoricalSeriesPort {
  readonly info: MarketDataSourceInfo = {
    id: "bse-bhavcopy-history",
    displayName: "BSE daily bhavcopy archive (as traded)",
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
    if (days.length > BSE_BHAVCOPY_MAX_DAYS) {
      return Err(
        new ProviderError(
          "UNSUPPORTED",
          this.info.id,
          `${this.info.id} is one file per trading day; ask it for at most ` +
            `${BSE_BHAVCOPY_MAX_DAYS} days, not ${days.length}.`,
          false,
        ),
      );
    }

    const symbol = request.quoteKey.replace(/\.(NS|BO)$/i, "").toUpperCase();

    return this.run(async () => {
      const bars: DailyBar[] = [];
      for (const day of days) {
        const body = await this.tryGetText(
          `https://www.bseindia.com/download/BhavCopy/Equity/` +
            `BhavCopy_BSE_CM_0_0_0_${yyyymmdd(day)}_F_0000.CSV`,
        );
        if (body === null) continue;

        for (const row of parseDelimited(body)) {
          if ((row.TCKRSYMB ?? "").toUpperCase() !== symbol) continue;
          if (row.SCTYSRS && !EQUITY_SERIES.has(row.SCTYSRS.toUpperCase())) continue;
          const open = row.OPNPRIC;
          const high = row.HGHPRIC;
          const low = row.LWPRIC;
          const close = row.CLSPRIC;
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
              volume: row.TTLTRADGVOL
                ? BigInt(row.TTLTRADGVOL.replace(/[^0-9]/g, "") || "0")
                : null,
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

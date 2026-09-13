/**
 * `cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/{base}.json`
 * — the FX third line, and **today only**.
 *
 * A daily JSON file on a CDN: no host to be rate-limited by, which is exactly what
 * a third line should be. What it cannot do is history — the published file is the
 * current day's, and there is no dated path on the CDN that this stack trusts.
 *
 * So a request for any date other than the one the file declares is **refused**
 * rather than served with today's rate. Valuing a 2019 position at today's USD/INR
 * is not a small error; it is the difference between a 12% return and a 60% one,
 * and it would be invisible in the output.
 */

import { CalendarDate } from "@/core/time";
import { ProviderError, RateLimitBudget } from "@/domain/pricing";
import { ProviderOptions, ProviderRuntime } from "@/infra/providers";
import { MarketDataSource } from "@/market-data/engine/source";
import {
  type FxRate,
  type FxRateKind,
  type FxRatePort,
  type FxRateRequest,
  type MarketDataResult,
  type MarketDataSourceInfo,
  scaledFromSourceNumber,
} from "@/market-data/ports";

export const CURRENCY_API_CDN_BASE =
  "https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies";

interface CurrencyApiPayload {
  date?: string;
  [currency: string]: unknown;
}

export class CurrencyApiCdnFxAdapter extends MarketDataSource implements FxRatePort {
  readonly info: MarketDataSourceInfo = {
    id: "currency-api-cdn",
    displayName: "currency-api on jsDelivr (today only)",
    capabilities: ["FX"],
    markets: ["GLOBAL"],
    keyless: true,
  };

  readonly rateKind: FxRateKind = "INDICATIVE_LIVE";

  constructor(
    runtime: ProviderRuntime,
    private readonly baseUrl = CURRENCY_API_CDN_BASE,
    options: ProviderOptions = {},
  ) {
    super(runtime, options);
  }

  override rateLimit(): RateLimitBudget {
    return { requests: 60, perMillis: 60_000, burst: 10 };
  }

  async rate(request: FxRateRequest): Promise<MarketDataResult<FxRate>> {
    return this.run(async () => {
      const base = request.base.code.toLowerCase();
      const quote = request.quote.code.toLowerCase();
      const payload = await this.getJson<CurrencyApiPayload>(`${this.baseUrl}/${base}.json`);

      if (!payload.date) {
        throw this.malformed("the file carried no date, so the rate cannot be dated.");
      }
      const effectiveDate = CalendarDate.parse(payload.date);
      if (effectiveDate.toISO() !== request.on.toISO()) {
        // Not `clamped: true` — a refusal. This source has exactly one day and it
        // is not the day that was asked for.
        throw new ProviderError(
          "UNSUPPORTED",
          this.info.id,
          `${this.info.id} publishes ${effectiveDate.toISO()} only; ${request.on.toISO()} must ` +
            `come from a dated source.`,
          false,
        );
      }

      const table = payload[base];
      const raw =
        table && typeof table === "object"
          ? (table as Record<string, unknown>)[quote]
          : undefined;
      if (typeof raw !== "number") {
        throw this.malformed(`no ${request.base.code}/${request.quote.code} rate in the file.`);
      }

      return {
        base: request.base,
        quote: request.quote,
        rateScaled: scaledFromSourceNumber(raw),
        requestedDate: request.on,
        effectiveDate,
        clamped: false,
        kind: this.rateKind,
        sourceId: this.info.id,
      } satisfies FxRate;
    });
  }
}

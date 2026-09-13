/**
 * `api.exchangerate.dev` — the FX second line, keyless.
 *
 * Reached when Frankfurter is down. It publishes **indicative** rates, not the ECB
 * fixing, so `kind: "INDICATIVE_LIVE"` — and that is not a detail. The chain will
 * refuse to value one portfolio history with a mixture of this and Frankfurter,
 * because the two differ by roughly 0.18% and a switch mid-series reads as a return.
 *
 * That refusal is the correct behaviour, and it makes this adapter a *whole-series*
 * substitute rather than a per-date patch: if Frankfurter cannot serve the range,
 * this source serves all of it or none of it.
 *
 * Not to be confused with `exchangerate.host`, which is key-walled and eliminated
 * (C1).
 */

import { CalendarDate } from "@/core/time";
import { RateLimitBudget } from "@/domain/pricing";
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

export const EXCHANGERATE_DEV_BASE_URL = "https://api.exchangerate.dev/v1";

interface ExchangerateDevPayload {
  base?: string;
  date?: string;
  rates?: Record<string, number>;
}

export class ExchangerateDevFxAdapter extends MarketDataSource implements FxRatePort {
  readonly info: MarketDataSourceInfo = {
    id: "exchangerate-dev",
    displayName: "Exchangerate.dev (indicative)",
    capabilities: ["FX"],
    markets: ["GLOBAL"],
    keyless: true,
  };

  readonly rateKind: FxRateKind = "INDICATIVE_LIVE";

  constructor(
    runtime: ProviderRuntime,
    private readonly baseUrl = EXCHANGERATE_DEV_BASE_URL,
    options: ProviderOptions = {},
  ) {
    super(runtime, options);
  }

  override rateLimit(): RateLimitBudget {
    return { requests: 20, perMillis: 60_000, burst: 5 };
  }

  async rate(request: FxRateRequest): Promise<MarketDataResult<FxRate>> {
    return this.run(async () => {
      const payload = await this.getJson<ExchangerateDevPayload>(
        `${this.baseUrl}/${request.on.toISO()}` +
          `?base=${encodeURIComponent(request.base.code)}&symbols=${encodeURIComponent(request.quote.code)}`,
      );

      const raw = payload.rates?.[request.quote.code];
      if (raw === undefined || raw === null) {
        throw this.malformed(`no ${request.base.code}/${request.quote.code} rate in the response.`);
      }

      // A source that will not say which day it priced cannot be used to value a
      // dated position, so a missing date is a malformed response rather than an
      // invitation to assume the requested one.
      if (!payload.date) {
        throw this.malformed("the response carried no date, so the rate cannot be dated.");
      }
      const effectiveDate = CalendarDate.parse(payload.date);

      return {
        base: request.base,
        quote: request.quote,
        rateScaled: scaledFromSourceNumber(raw),
        requestedDate: request.on,
        effectiveDate,
        clamped: effectiveDate.toISO() !== request.on.toISO(),
        kind: this.rateKind,
        sourceId: this.info.id,
      } satisfies FxRate;
    });
  }
}

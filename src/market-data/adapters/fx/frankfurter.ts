/**
 * `api.frankfurter.dev` — the FX primary: ECB daily reference rates, keyless.
 *
 * Measured: 6 824 daily points for USD/INR, starting **2000-01-13**. That start
 * date is the trap this adapter exists to make visible. Ask Frankfurter for
 * 1995-06-01 and it answers **200, with the 2000-01-13 rate** — no warning, no
 * field saying it moved. A backfill that trusted the request date would silently
 * value five years of history at one day's rate.
 *
 * So the `date` in the response is read as the answer, `effectiveDate` carries it,
 * and `clamped` says plainly that the source moved. The caller decides what to do;
 * it is never guessed at here.
 *
 * `kind: "ECB_REFERENCE"`, which is what makes the chain's refusal to mix rate
 * types work: an ECB fixing and an indicative live rate are ~0.18% apart, and a
 * history valued with both shows a return the portfolio never earned.
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

export const FRANKFURTER_BASE_URL = "https://api.frankfurter.dev/v1";

/** The first day the ECB series exists. Earlier requests are clamped to it. */
export const FRANKFURTER_FIRST_DATE = "1999-01-04";

interface FrankfurterPayload {
  amount?: number;
  base?: string;
  date?: string;
  rates?: Record<string, number>;
}

export class FrankfurterFxAdapter extends MarketDataSource implements FxRatePort {
  readonly info: MarketDataSourceInfo = {
    id: "frankfurter",
    displayName: "Frankfurter (ECB reference rates)",
    capabilities: ["FX"],
    markets: ["GLOBAL"],
    keyless: true,
  };

  readonly rateKind: FxRateKind = "ECB_REFERENCE";

  constructor(
    runtime: ProviderRuntime,
    private readonly baseUrl = FRANKFURTER_BASE_URL,
    options: ProviderOptions = {},
  ) {
    super(runtime, options);
  }

  override rateLimit(): RateLimitBudget {
    return { requests: 30, perMillis: 60_000, burst: 10 };
  }

  async rate(request: FxRateRequest): Promise<MarketDataResult<FxRate>> {
    return this.run(async () => {
      const payload = await this.getJson<FrankfurterPayload>(
        `${this.baseUrl}/${request.on.toISO()}` +
          `?base=${encodeURIComponent(request.base.code)}&symbols=${encodeURIComponent(request.quote.code)}`,
      );

      const raw = payload.rates?.[request.quote.code];
      if (raw === undefined || raw === null) {
        throw this.malformed(`no ${request.base.code}/${request.quote.code} rate in the response.`);
      }
      if (!payload.date) {
        throw this.malformed("the response carried no date, so the rate cannot be dated.");
      }

      const effectiveDate = CalendarDate.parse(payload.date);
      return {
        base: request.base,
        quote: request.quote,
        rateScaled: scaledFromSourceNumber(raw),
        requestedDate: request.on,
        // The date the source actually served — not the one we asked for.
        effectiveDate,
        clamped: effectiveDate.toISO() !== request.on.toISO(),
        kind: this.rateKind,
        sourceId: this.info.id,
      } satisfies FxRate;
    });
  }
}

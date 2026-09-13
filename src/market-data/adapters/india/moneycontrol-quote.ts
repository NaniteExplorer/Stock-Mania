/**
 * `priceapi.moneycontrol.com/pricefeed/{nse,bse}/equitycash/{scId}` — the Indian
 * live-quote failover, and the dual-listing failover with it.
 *
 * Keyless, and measured at 200 from the dev machine. Two things it is **not**:
 *
 *  - **Not a history source.** Moneycontrol's historical sibling sits behind
 *    Akamai and returns 403 cold (C11). There is no history path in this file and
 *    there should not be one added; Indian history failover is the exchange
 *    bhavcopy archives.
 *  - **Not a search dependency.** Its autosuggest is an *offline* alias harvester
 *    for the catalogue, never something a keystroke waits on.
 *
 * It needs Moneycontrol's own `sc_id` (`RI` for Reliance), which is not derivable
 * from a ticker. That mapping is catalogue data, so it is injected rather than
 * guessed: an adapter that invented `RELIANCE` as an sc_id would 404 on every
 * instrument and look like an outage.
 */

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
import { CalendarDate } from "@/core/time";

/** Quote key (`RELIANCE.NS`) to Moneycontrol's `sc_id` (`RI`). Catalogue data. */
export interface MoneycontrolCodes {
  scIdFor(quoteKey: string): string | null;
}

export const EMPTY_MONEYCONTROL_CODES: MoneycontrolCodes = { scIdFor: () => null };

interface MoneycontrolPayload {
  data?: {
    pricecurrent?: string;
    lastupd?: string;
    NSEID?: string;
    BSEID?: string;
    company?: string;
  };
}

export class MoneycontrolQuoteAdapter extends MarketDataSource implements LiveQuotePort {
  readonly info: MarketDataSourceInfo = {
    id: "moneycontrol-quote",
    displayName: "Moneycontrol price feed (India)",
    capabilities: ["QUOTE"],
    markets: ["IN"],
    keyless: true,
  };

  constructor(
    runtime: ProviderRuntime,
    private readonly codes: MoneycontrolCodes = EMPTY_MONEYCONTROL_CODES,
    options: ProviderOptions = {},
  ) {
    super(runtime, options);
  }

  override rateLimit(): RateLimitBudget {
    return { requests: 30, perMillis: 60_000, burst: 5 };
  }

  async quote(request: LiveQuoteRequest): Promise<MarketDataResult<readonly LiveQuote[]>> {
    const asAt = request.asAt ?? new Date(this.runtime.now());
    const freshnessMinutes = request.freshnessMinutes ?? 30;

    return this.run(async () => {
      const quotes: LiveQuote[] = [];
      for (const subject of request.subjects) {
        const scId = this.codes.scIdFor(subject.quoteKey);
        if (!scId) throw this.unknownSymbol(subject.quoteKey);

        // NSE first, BSE second: a dual-listed scrip that is suspended on one
        // exchange still prints on the other, and that is the whole reason this
        // adapter tries twice rather than reporting the instrument as dead.
        const preferred = subject.quoteKey.endsWith(".BO")
          ? (["bse", "nse"] as const)
          : (["nse", "bse"] as const);

        let priced: LiveQuote | null = null;
        for (const exchange of preferred) {
          const body = await this.tryGetText(
            `https://priceapi.moneycontrol.com/pricefeed/${exchange}/equitycash/${encodeURIComponent(scId)}`,
          );
          if (body === null) continue;
          const payload = JSON.parse(body) as MoneycontrolPayload;
          const price = payload.data?.pricecurrent?.trim();
          if (!price || price === "-" || price === "0.00") continue;

          // A decimal *string* from the source: parsed straight to a scaled
          // integer. Nothing here becomes a float on the way.
          const priceScaled = scaledFromDecimal(price);
          const observedAt = parseLastUpdate(payload.data?.lastupd) ?? asAt;
          priced = {
            quoteKey: subject.quoteKey,
            priceScaled,
            currency: subject.currency,
            asOf: CalendarDate.fromUtcInstant(observedAt),
            observedAt,
            stale: Math.floor((asAt.getTime() - observedAt.getTime()) / 60_000) > freshnessMinutes,
            sourceId: this.info.id,
          };
          break;
        }

        if (!priced) throw this.unknownSymbol(subject.quoteKey);
        quotes.push(priced);
      }
      return quotes as readonly LiveQuote[];
    });
  }
}

/** `"Feb 14, 2026 15:30:00"` — Moneycontrol's own stamp, in IST. */
function parseLastUpdate(text: string | undefined): Date | null {
  if (!text) return null;
  const parsed = Date.parse(`${text} GMT+0530`);
  return Number.isNaN(parsed) ? null : new Date(parsed);
}

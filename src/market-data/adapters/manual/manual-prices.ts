/**
 * The manual tier: prices the owner typed in himself.
 *
 * There will always be holdings no free source prices — an unlisted share, a
 * chit fund, a physical asset. The failure mode to avoid is the one the current
 * add flow has: inventing a quote key for such a holding, at which point the
 * position looks priced, is silently never refreshed, and its staleness is
 * invisible.
 *
 * So everything this adapter returns is marked **`stale: true`**, permanently and
 * by construction. A manually entered price is correct as of the day it was
 * entered and is not a live quote on any later day; the UI is expected to render
 * that as an explicit "you priced this on <date>" badge rather than as a number
 * indistinguishable from a market print.
 *
 * `adjusted: false` on the history side, for the same reason the exchange archives
 * are: the owner types what he believes the thing was worth, and nobody restates it.
 *
 * No network. No breaker. The store is injected, so this file has no opinion about
 * whether the prices live in the database or in a test's `Map`.
 */

import { Err, Ok } from "@/core/kernel";
import { Currency } from "@/core/money";
import { CalendarDate } from "@/core/time";
import { type HealthStatus, ProviderError } from "@/domain/pricing";
import {
  type DailyBar,
  dailyBar,
  type HistoricalSeries,
  type HistoricalSeriesPort,
  type HistoryRequest,
  type LiveQuote,
  type LiveQuotePort,
  type LiveQuoteRequest,
  type MarketDataResult,
  type MarketDataSourceInfo,
} from "@/market-data/ports";

/** One price the owner entered. Scaled 1e8, like every other price in the layer. */
export interface ManualPrice {
  readonly quoteKey: string;
  readonly asOf: CalendarDate;
  readonly priceScaled: bigint;
  readonly currencyCode: string;
}

/** Where manual prices come from. A repository in production, a `Map` in a test. */
export interface ManualPriceStore {
  /** Every manual price for a key, in any order. */
  pricesFor(quoteKey: string): readonly ManualPrice[];
}

export class InMemoryManualPriceStore implements ManualPriceStore {
  private readonly byKey = new Map<string, ManualPrice[]>();

  constructor(prices: readonly ManualPrice[] = []) {
    for (const price of prices) this.record(price);
  }

  record(price: ManualPrice): void {
    const existing = this.byKey.get(price.quoteKey) ?? [];
    // One price per key per day: a correction replaces, it does not accumulate.
    const kept = existing.filter((other) => other.asOf.toISO() !== price.asOf.toISO());
    kept.push(price);
    this.byKey.set(price.quoteKey, kept);
  }

  pricesFor(quoteKey: string): readonly ManualPrice[] {
    return [...(this.byKey.get(quoteKey) ?? [])].sort((a, b) => a.asOf.compareTo(b.asOf));
  }
}

const ALWAYS_HEALTHY: HealthStatus = {
  state: "HEALTHY",
  consecutiveFailures: 0,
  lastError: null,
  circuitOpenUntil: null,
};

const SOURCE_ID = "manual-prices";

export class ManualPriceAdapter implements LiveQuotePort, HistoricalSeriesPort {
  readonly info: MarketDataSourceInfo = {
    id: SOURCE_ID,
    displayName: "Manually entered prices (not live)",
    capabilities: ["QUOTE", "HISTORY"],
    markets: ["GLOBAL", "IN", "US"],
    keyless: true,
  };

  constructor(private readonly store: ManualPriceStore) {}

  health(): HealthStatus {
    return ALWAYS_HEALTHY;
  }

  async quote(request: LiveQuoteRequest): Promise<MarketDataResult<readonly LiveQuote[]>> {
    const quotes: LiveQuote[] = [];
    for (const subject of request.subjects) {
      const prices = this.store.pricesFor(subject.quoteKey);
      const latest = prices[prices.length - 1];
      if (!latest) {
        return Err(
          new ProviderError(
            "UNKNOWN_SYMBOL",
            SOURCE_ID,
            `No price has been entered for ${subject.quoteKey}.`,
            false,
          ),
        );
      }
      const mismatch = assertCurrency(latest.currencyCode, subject.currency, subject.quoteKey);
      if (mismatch) return Err(mismatch);

      quotes.push({
        quoteKey: subject.quoteKey,
        priceScaled: latest.priceScaled,
        currency: subject.currency,
        asOf: latest.asOf,
        observedAt: latest.asOf.toUtcInstant(),
        // Always. See the file comment: this is the whole point of the tier.
        stale: true,
        sourceId: SOURCE_ID,
      });
    }
    return Ok(quotes);
  }

  async history(request: HistoryRequest): Promise<MarketDataResult<HistoricalSeries>> {
    if (request.adjusted) {
      return Err(
        new ProviderError(
          "UNSUPPORTED",
          SOURCE_ID,
          `Manually entered prices are as-entered; there is no restated series for ` +
            `${request.quoteKey}.`,
          false,
        ),
      );
    }

    const bars: DailyBar[] = [];
    for (const price of this.store.pricesFor(request.quoteKey)) {
      if (!request.range.contains(price.asOf)) continue;
      const mismatch = assertCurrency(price.currencyCode, request.currency, request.quoteKey);
      if (mismatch) return Err(mismatch);
      // One number a day, so it is the open, the high, the low and the close. That
      // satisfies every `price_bars` constraint by construction rather than by
      // luck — and it is honest: no intraday range was ever observed.
      bars.push(
        dailyBar(SOURCE_ID, {
          asOf: price.asOf,
          openScaled: price.priceScaled,
          highScaled: price.priceScaled,
          lowScaled: price.priceScaled,
          closeScaled: price.priceScaled,
          volume: null,
        }),
      );
    }

    if (bars.length === 0) {
      return Err(
        new ProviderError(
          "UNKNOWN_SYMBOL",
          SOURCE_ID,
          `No prices have been entered for ${request.quoteKey} in ${request.range.toString()}.`,
          false,
        ),
      );
    }

    return Ok({
      quoteKey: request.quoteKey,
      currency: request.currency,
      adjusted: false,
      asOf: bars[bars.length - 1].asOf,
      bars,
      sourceId: SOURCE_ID,
    });
  }
}

function assertCurrency(
  stored: string,
  expected: Currency,
  quoteKey: string,
): ProviderError | null {
  if (stored.toUpperCase() === expected.code) return null;
  return new ProviderError(
    "MALFORMED_RESPONSE",
    SOURCE_ID,
    `${quoteKey} was priced in ${stored.toUpperCase()} but is held in ${expected.code}.`,
    false,
  );
}

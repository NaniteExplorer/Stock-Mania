/**
 * `query2.finance.yahoo.com/v8/finance/chart/{symbol}` — quote, daily history and
 * corporate actions, for every market.
 *
 * Ported from `YahooQuoteProvider` in `src/infra/providers.ts`, which stays in
 * place until step 10 retires it. What is carried over deliberately:
 *
 *  - **Explicit `period1`/`period2`, always** (C4). `range=max` returns HTTP 200
 *    with *monthly* data — AAPL comes back as 169 rows instead of 11 529 — and
 *    nothing in the payload says so. There is no code path here that omits the
 *    period pair.
 *  - **The currency guard.** Yahoo reports the currency it priced in, and it is
 *    compared as a *string* before any `Currency` is constructed, so an
 *    unrecognised code reads as "this source quoted something we cannot hold this
 *    in" rather than as a registry-lookup failure.
 *
 * What is new here is the honesty about adjustment (C3). Yahoo's chart OHLC is
 * **restated into post-split terms**: after a 10:1 split the whole prior series is
 * rewritten. That is the property `adjusted: true` names, and it is why this
 * adapter *refuses* a request for `adjusted: false` instead of serving its own
 * numbers under the wrong flag — an unadjusted request belongs to the bhavcopy
 * archives, which print what actually traded.
 *
 * `events=div,split` is parsed for reconciliation only (C2): a split Yahoo knows
 * about and the ledger does not is a warning for the owner, never a ledger edit.
 */

import { Err } from "@/core/kernel";
import { Currency } from "@/core/money";
import { CalendarDate } from "@/core/time";
import { ProviderError, RateLimitBudget } from "@/domain/pricing";
import type { QuoteKeyProbeResult as QuoteKeyProbe } from "@/domain/instrument-catalog";
import { ProviderOptions, ProviderRuntime } from "@/infra/providers";
import { MarketDataSource } from "@/market-data/engine/source";
import {
  type CorporateAction,
  type CorporateActionsPort,
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
  scaledFromSourceNumber,
} from "@/market-data/ports";

const YAHOO_CHART_BASE = "https://query2.finance.yahoo.com/v8/finance/chart";

interface YahooChartPayload {
  chart?: {
    result?: {
      meta?: {
        currency?: string;
        symbol?: string;
        regularMarketPrice?: number;
        regularMarketTime?: number;
        firstTradeDate?: number;
        instrumentType?: string;
        exchangeName?: string;
        fullExchangeName?: string;
      };
      timestamp?: number[];
      indicators?: {
        quote?: {
          open?: (number | null)[];
          high?: (number | null)[];
          low?: (number | null)[];
          close?: (number | null)[];
          volume?: (number | null)[];
        }[];
      };
      events?: {
        splits?: Record<string, { date?: number; numerator?: number; denominator?: number }>;
        dividends?: Record<string, { date?: number; amount?: number }>;
      };
    }[];
    error?: { code?: string; description?: string } | null;
  };
}

export class YahooChartAdapter
  implements LiveQuotePort, HistoricalSeriesPort, CorporateActionsPort
{
  readonly info: MarketDataSourceInfo = {
    id: "yahoo-chart",
    displayName: "Yahoo Finance chart (unofficial)",
    capabilities: ["QUOTE", "HISTORY", "CORPORATE_ACTIONS"],
    markets: ["GLOBAL", "IN", "US"],
    keyless: true,
  };

  private readonly source: YahooChartSource;

  constructor(runtime: ProviderRuntime, options: ProviderOptions = {}) {
    this.source = new YahooChartSource(this.info, runtime, options);
  }

  health() {
    return this.source.health();
  }

  async quote(request: LiveQuoteRequest): Promise<MarketDataResult<readonly LiveQuote[]>> {
    const asAt = request.asAt ?? new Date(this.source.nowMillis());
    const freshnessMinutes = request.freshnessMinutes ?? 30;

    return this.source.call(async () => {
      const quotes: LiveQuote[] = [];
      for (const subject of request.subjects) {
        // Five calendar days back: enough to span a long weekend plus a holiday,
        // and small enough that a quote is not a history download.
        const end = CalendarDate.fromUtcInstant(asAt);
        const payload = await this.source.fetchChart(subject.quoteKey, end.plusDays(-5), end, false);
        const result = this.source.firstResult(payload, subject.quoteKey);
        this.source.assertCurrency(result.meta?.currency, subject.currency, subject.quoteKey);

        const price = result.meta?.regularMarketPrice;
        const at = result.meta?.regularMarketTime;
        if (price === undefined || price === null || !at) {
          throw this.source.noQuote(subject.quoteKey);
        }
        const observedAt = new Date(at * 1000);
        const ageMinutes = Math.floor((asAt.getTime() - observedAt.getTime()) / 60_000);
        quotes.push({
          quoteKey: subject.quoteKey,
          priceScaled: scaledFromSourceNumber(price),
          currency: subject.currency,
          asOf: CalendarDate.fromUtcInstant(observedAt),
          observedAt,
          // Stale, not dropped: a Saturday quote is the right number, correctly
          // labelled as yesterday's.
          stale: ageMinutes > freshnessMinutes,
          sourceId: this.info.id,
        });
      }
      return quotes as readonly LiveQuote[];
    });
  }

  async history(request: HistoryRequest): Promise<MarketDataResult<HistoricalSeries>> {
    if (!request.adjusted) {
      // Not a failure to retry and not something to paper over: Yahoo has no
      // as-traded series to give, so the chain must fall through to an archive.
      return Err(
        new ProviderError(
          "UNSUPPORTED",
          this.info.id,
          `${this.info.id} only serves split-restated prices; an as-traded series for ` +
            `${request.quoteKey} must come from an exchange archive.`,
          false,
        ),
      );
    }

    return this.source.call(async () => {
      const payload = await this.source.fetchChart(
        request.quoteKey,
        request.range.start,
        request.range.end,
        true,
      );
      const result = this.source.firstResult(payload, request.quoteKey);
      this.source.assertCurrency(result.meta?.currency, request.currency, request.quoteKey);

      const stamps = result.timestamp ?? [];
      const ohlc = result.indicators?.quote?.[0];
      if (!ohlc) throw this.source.malformedSeries(request.quoteKey);

      const bars: DailyBar[] = [];
      for (let i = 0; i < stamps.length; i += 1) {
        const open = ohlc.open?.[i];
        const high = ohlc.high?.[i];
        const low = ohlc.low?.[i];
        const close = ohlc.close?.[i];
        // A market holiday inside the range comes back as a row of nulls.
        if (
          open === null ||
          open === undefined ||
          high === null ||
          high === undefined ||
          low === null ||
          low === undefined ||
          close === null ||
          close === undefined
        ) {
          continue;
        }
        const asOf = CalendarDate.fromUtcInstant(new Date(stamps[i] * 1000));
        if (!request.range.contains(asOf)) continue;
        const rawVolume = ohlc.volume?.[i];
        bars.push(
          dailyBar(this.info.id, {
            asOf,
            openScaled: scaledFromSourceNumber(open),
            highScaled: scaledFromSourceNumber(high),
            lowScaled: scaledFromSourceNumber(low),
            closeScaled: scaledFromSourceNumber(close),
            volume:
              rawVolume === null || rawVolume === undefined
                ? null
                : BigInt(Math.trunc(rawVolume)),
          }),
        );
      }

      if (bars.length === 0) throw this.source.unknown(request.quoteKey);
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

  /**
   * Does this string resolve to a priceable instrument, and what is it?
   *
   * The catalogue's priceability gate (C10) asks a different question from
   * `history`: not "give me the series" but "is `RELIANCE.NS` a real, INR-priced
   * equity with an inception date". Answering it through `history` would mean
   * downloading twenty years of bars — ~850 KB — for every one of ~30 000
   * catalogue rows, so this asks for **five days** and reads `meta`, which carries
   * the currency, the type and `firstTradeDate` regardless of the window.
   *
   * `null` means the key does not resolve: a 404 (`TATAMOTORS.NS` after the
   * demerger) or a payload with no result. Anything else — wrong currency, a
   * future, an empty series — comes back as a populated result and is judged by
   * `acceptQuoteKeyProbe` in the domain, because that judgement is policy and
   * belongs where it can be read and tested without a network.
   */
  async probeQuoteKey(
    quoteKey: string,
    asAt: Date = new Date(this.source.nowMillis()),
  ): Promise<MarketDataResult<QuoteKeyProbe | null>> {
    return this.source.call(async () => {
      const end = CalendarDate.fromUtcInstant(asAt);
      let payload: YahooChartPayload;
      try {
        payload = await this.source.fetchChart(quoteKey, end.plusDays(-7), end, false);
      } catch (thrown) {
        if (thrown instanceof ProviderError && thrown.kind === "UNKNOWN_SYMBOL") return null;
        throw thrown;
      }
      if (payload.chart?.error) return null;
      const result = payload.chart?.result?.[0];
      if (!result) return null;

      const stamps = result.timestamp ?? [];
      const closes = result.indicators?.quote?.[0]?.close ?? [];
      let bars = 0;
      for (let i = 0; i < stamps.length; i += 1) {
        if (closes[i] !== null && closes[i] !== undefined) bars += 1;
      }

      const firstTrade = result.meta?.firstTradeDate;
      return {
        quoteKey,
        bars,
        currency: result.meta?.currency?.toUpperCase() ?? null,
        instrumentType: result.meta?.instrumentType ?? null,
        firstTradeDate:
          firstTrade === undefined || firstTrade === null
            ? null
            : CalendarDate.fromUtcInstant(new Date(firstTrade * 1000)).toISO(),
        sourceId: this.info.id,
      } satisfies QuoteKeyProbe;
    });
  }

  /** Reconciliation only (C2). A split found here never touches the ledger. */
  async actions(request: HistoryRequest): Promise<MarketDataResult<readonly CorporateAction[]>> {
    return this.source.call(async () => {
      const payload = await this.source.fetchChart(
        request.quoteKey,
        request.range.start,
        request.range.end,
        true,
      );
      const result = this.source.firstResult(payload, request.quoteKey);
      const currency = result.meta?.currency
        ? Currency.of(result.meta.currency.toUpperCase())
        : request.currency;

      const actions: CorporateAction[] = [];
      for (const split of Object.values(result.events?.splits ?? {})) {
        if (!split.date || !split.numerator || !split.denominator) continue;
        actions.push({
          quoteKey: request.quoteKey,
          onDate: CalendarDate.fromUtcInstant(new Date(split.date * 1000)),
          kind: "SPLIT",
          numerator: BigInt(Math.trunc(split.numerator)),
          denominator: BigInt(Math.trunc(split.denominator)),
          amountScaled: null,
          currency: null,
          sourceId: this.info.id,
        });
      }
      for (const dividend of Object.values(result.events?.dividends ?? {})) {
        if (!dividend.date || dividend.amount === undefined) continue;
        actions.push({
          quoteKey: request.quoteKey,
          onDate: CalendarDate.fromUtcInstant(new Date(dividend.date * 1000)),
          kind: "DIVIDEND",
          numerator: null,
          denominator: null,
          amountScaled: scaledFromSourceNumber(dividend.amount),
          currency,
          sourceId: this.info.id,
        });
      }
      actions.sort((a, b) => a.onDate.compareTo(b.onDate));
      return actions as readonly CorporateAction[];
    });
  }
}

/**
 * The resilience-bearing half.
 *
 * Composition rather than inheritance, because `YahooChartAdapter` implements
 * three ports and a single `MarketDataSource` subclass would have had to choose
 * one of them to *be*. One source object means one token bucket and one breaker
 * across all three capabilities, which is the point: when the endpoint is down it
 * is down for quotes as well as for history.
 */
class YahooChartSource extends MarketDataSource {
  constructor(
    readonly info: MarketDataSourceInfo,
    runtime: ProviderRuntime,
    options: ProviderOptions,
  ) {
    super(runtime, options);
  }

  override rateLimit(): RateLimitBudget {
    // Politeness, not a measured ceiling: 775 requests in an hour from one IP
    // produced zero 429s (C13). The budget is here so a runaway loop is slow
    // rather than banned.
    return { requests: 20, perMillis: 60_000, burst: 4 };
  }

  nowMillis(): number {
    return this.runtime.now();
  }

  call<T>(work: () => Promise<T>): Promise<MarketDataResult<T>> {
    return this.run(work);
  }

  async fetchChart(
    symbol: string,
    from: CalendarDate,
    to: CalendarDate,
    withEvents: boolean,
  ): Promise<YahooChartPayload> {
    const period1 = Math.floor(from.toUtcInstant().getTime() / 1000);
    // Yahoo's `period2` is exclusive, so the requested end date is included by
    // asking for the day after it.
    const period2 = Math.floor(to.plusDays(1).toUtcInstant().getTime() / 1000);
    const events = withEvents ? "&events=div%2Csplit" : "";
    return this.getJson<YahooChartPayload>(
      `${YAHOO_CHART_BASE}/${encodeURIComponent(symbol)}` +
        `?period1=${period1}&period2=${period2}&interval=1d${events}`,
    );
  }

  firstResult(payload: YahooChartPayload, symbol: string) {
    if (payload.chart?.error) throw this.unknown(symbol);
    const result = payload.chart?.result?.[0];
    if (!result) throw this.unknown(symbol);
    return result;
  }

  assertCurrency(reportedRaw: string | undefined, expected: Currency, symbol: string): void {
    const reported = reportedRaw?.toUpperCase() ?? expected.code;
    if (reported !== expected.code) {
      throw this.malformed(
        `${symbol} is held in ${expected.code} but the source quoted ${reported}.`,
      );
    }
  }

  unknown(symbol: string): ProviderError {
    return this.unknownSymbol(symbol);
  }

  noQuote(symbol: string): ProviderError {
    return this.malformed(`no live price in the payload for ${symbol}.`);
  }

  malformedSeries(symbol: string): ProviderError {
    return this.malformed(`no OHLC series for ${symbol}.`);
  }
}

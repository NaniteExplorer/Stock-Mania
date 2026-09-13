/**
 * Where the market-data engine is actually built, and the three adapters back to
 * the old ports.
 *
 * `src/market-data/` is a clean seam — ports, a registry, and one adapter file per
 * vendor. The rest of the application predates it and speaks two older languages:
 * `FxProviderPort` (which `FxBook` consumes) and `DailyHistoryFeed` (which the bar
 * ingest consumes). Somebody has to translate, and it has to be here rather than
 * in either of them: the engine must not know `FxBook` exists, and `FxBook` must
 * not learn a second FX interface. This file is that boundary, and it is the only
 * place in the tree that imports both.
 *
 * Nothing here decides anything. The chain order lives in
 * `src/market-data/engine/registry.ts`, which is the file the owner edits when he
 * buys a feed; this file only constructs what that one names.
 */

import "server-only";

import { Currency } from "@/core/money";
import { Quantity } from "@/core/numeric";
import { CalendarDate, DateRange } from "@/core/time";
import { Err, Ok, Result } from "@/core/kernel";
import {
  FxProviderPort,
  FxQuote,
  HealthStatus,
  ProviderCapabilities,
  ProviderError,
  RateLimitBudget,
} from "@/domain/pricing";
import type { QuoteKeyProbeResult } from "@/domain/instrument-catalog";
import type { QuoteKeyProbePort } from "@/infra/instrument-catalog";
import type { DailyHistoryFeed } from "@/app/pricing.usecases";
import type { ProviderRuntime } from "@/infra/providers";
import { CurrencyApiCdnFxAdapter } from "@/market-data/adapters/fx/currency-api-cdn";
import { ExchangerateDevFxAdapter } from "@/market-data/adapters/fx/exchangerate-dev";
import { FrankfurterFxAdapter } from "@/market-data/adapters/fx/frankfurter";
import { YahooChartAdapter } from "@/market-data/adapters/global/yahoo-chart";
import { YahooSearchAdapter } from "@/market-data/adapters/global/yahoo-search";
import { BseBhavcopyHistoryAdapter } from "@/market-data/adapters/india/bse-bhavcopy-history";
import { MoneycontrolQuoteAdapter } from "@/market-data/adapters/india/moneycontrol-quote";
import { NseBhavcopyHistoryAdapter } from "@/market-data/adapters/india/nse-bhavcopy-history";
import { NseEquityMasterAdapter } from "@/market-data/adapters/india/nse-equity-master";
import { UpstoxMasterAdapter } from "@/market-data/adapters/india/upstox-master";
import { NasdaqChartHistoryAdapter } from "@/market-data/adapters/international/nasdaq-chart-history";
import { NasdaqTraderMasterAdapter } from "@/market-data/adapters/international/nasdaq-trader-master";
import { SecMasterAdapter } from "@/market-data/adapters/international/sec-master";
import { StockAnalysisQuoteAdapter } from "@/market-data/adapters/international/stockanalysis-quote";
import { CatalogueRankerAdapter } from "@/market-data/adapters/local/catalogue-ranker";
import { OpenFigiMappingAdapter } from "@/market-data/adapters/symbology/openfigi-mapping";
import { MarketDataChain } from "@/market-data/engine/chain";
import {
  InMemoryVendorPins,
  MarketDataRegistry,
  type VendorPins,
} from "@/market-data/engine/registry";
import {
  PRICE_FACTOR,
  type AnyMarketDataPort,
  type HistoricalSeries,
  type HistoryRequest,
  type MarketDataResult,
} from "@/market-data/ports";

export interface MarketDataEngine {
  readonly registry: MarketDataRegistry;
  readonly chain: MarketDataChain;
  readonly pins: VendorPins;
  /** The Yahoo adapter, held by name because the quote-key prober needs it. */
  readonly yahoo: YahooChartAdapter;
}

/**
 * Every shipped adapter, registered, validated and chained.
 *
 * `MarketDataRegistry`'s constructor validates the configuration, so a chain that
 * names an adapter nobody registered throws **here**, at composition time, rather
 * than at 09:15 on the first quote of the day.
 *
 * `moneycontrolCodes` is the harvested `sc_id` map (C11): `RI` for Reliance, and
 * no rule derives it from the symbol. It is loaded from the catalogue offline and
 * handed in, so the quote adapter never performs a lookup under a keystroke.
 */
export function buildMarketDataEngine(
  runtime: ProviderRuntime,
  options: { moneycontrolCodes?: ReadonlyMap<string, string> } = {},
): MarketDataEngine {
  const yahoo = new YahooChartAdapter(runtime);

  const adapters: AnyMarketDataPort[] = [
    yahoo,
    new YahooSearchAdapter(runtime),
    new MoneycontrolQuoteAdapter(runtime, {
      /*
       * The harvested map, keyed by the normalised symbol the catalogue stores,
       * looked up from the quote key by stripping the exchange suffix. A key with
       * no harvested id returns null and the adapter declines, which is the right
       * answer: guessing an sc_id prices a holding from a different company.
       */
      scIdFor: (quoteKey: string) =>
        options.moneycontrolCodes?.get(quoteKey.replace(/\.(NS|BO)$/i, "").toUpperCase()) ?? null,
    }),
    new NseBhavcopyHistoryAdapter(runtime),
    new BseBhavcopyHistoryAdapter(runtime),
    new NseEquityMasterAdapter(runtime),
    new UpstoxMasterAdapter(runtime),
    new NasdaqChartHistoryAdapter(runtime),
    new StockAnalysisQuoteAdapter(runtime),
    new SecMasterAdapter(runtime),
    new NasdaqTraderMasterAdapter(runtime),
    new CatalogueRankerAdapter(),
    new OpenFigiMappingAdapter(runtime),
    new FrankfurterFxAdapter(runtime),
    new ExchangerateDevFxAdapter(runtime),
    new CurrencyApiCdnFxAdapter(runtime),
  ];

  /*
   * In-memory pins for now. The durable pin is `instrument_catalog_listings`'
   * `quote_provider`, written by the reconciler when a key resolves; wiring that
   * into the registry is a read per chain lookup and belongs with the catalogue's
   * own caching, not here.
   */
  const pins = new InMemoryVendorPins();
  const registry = new MarketDataRegistry(adapters, undefined, pins);
  return { registry, chain: new MarketDataChain(registry, pins), pins, yahoo };
}

/* ═══ Bridges ═════════════════════════════════════════════════════════ */

/**
 * The engine's FX chain, wearing `FxProviderPort` so `FxBook` can hold it.
 *
 * `FxBook` asks for a **range** and gets back whatever the source has; the engine
 * answers one date at a time and refuses to mix rate kinds across a series
 * (`MarketDataChain.fxSeries`). So the range is expanded to its dates here and the
 * whole set is fetched from one source or not at all — which is the property that
 * matters, because an ECB fixing and an indicative live rate differ by ~0.18% and
 * a history valued with both shows a return nobody earned.
 *
 * The scale conversion is exact: engine rates are 1e8-scaled bigints and
 * `Quantity` is 1e8-scaled, so `Quantity.fromScaled` is a relabelling. No float.
 */
export class EngineFxProvider implements FxProviderPort {
  readonly id: string;
  readonly displayName: string;

  constructor(
    private readonly chain: MarketDataChain,
    private readonly registry: MarketDataRegistry,
    private readonly now: () => number,
    id = "market-data-engine-fx",
    displayName = "Market-data engine (Frankfurter, Exchangerate.dev, currency-api)",
  ) {
    this.id = id;
    this.displayName = displayName;
  }

  capabilities(): ProviderCapabilities {
    return {
      assetClasses: ["FX"],
      supportsIntraday: false,
      supportsHistorical: true,
      supportsCorporateActions: false,
      supportsInstrumentSearch: false,
      identifierTypes: ["TICKER"],
      // Frankfurter's INR series starts 2000-01-13 and silently clamps earlier
      // requests; `FxRate.clamped` reports it per rate, and this is the honest
      // upper bound for the chain as a whole.
      maxHistoryYears: 26,
      quoteDelayMinutes: 24 * 60,
      quoteTypes: ["CLOSE"],
    };
  }

  health(): HealthStatus {
    // The chain's health is its primary's: the fallbacks exist precisely so a
    // degraded primary is not an outage.
    const [primary] = this.registry.fxChain();
    return primary?.health() ?? { state: "HEALTHY", consecutiveFailures: 0 };
  }

  rateLimit(): RateLimitBudget {
    return { requests: 30, perMillis: 60_000, burst: 10 };
  }

  async fetchRates(request: {
    base: string;
    quotes: readonly string[];
    range: DateRange;
  }): Promise<Result<readonly FxQuote[], ProviderError>> {
    const base = Currency.of(request.base);
    const wanted = request.quotes.filter((code) => code !== request.base);
    if (wanted.length === 0) return Ok([]);

    const days: CalendarDate[] = [];
    for (let day = request.range.start; day.isOnOrBefore(request.range.end); day = day.plusDays(1)) {
      days.push(day);
    }

    const ingestedAt = new Date(this.now());
    const quotes: FxQuote[] = [];

    for (const code of wanted) {
      const quote = Currency.of(code);
      const outcome = await this.chain.fxSeries(days.map((on) => ({ base, quote, on })));
      if (!outcome.ok) return Err(outcome.error);

      for (const rate of outcome.value.value) {
        /*
         * A clamped rate is dropped rather than stored under the date that was
         * asked for. Frankfurter answers a pre-2000 request with the 2000-01-13
         * rate and a 200; writing that as "the USD/INR rate on 1997-04-02" would
         * be a fabricated number that every later valuation would trust.
         */
        if (rate.clamped) continue;
        quotes.push({
          base: rate.base.code,
          quote: rate.quote.code,
          asOf: rate.effectiveDate,
          rate: Quantity.fromScaled(rate.rateScaled),
          providerId: rate.sourceId,
          sourceType: "PROVIDER",
          ingestedAt,
          derivation: null,
        });
      }
    }

    if (quotes.length === 0) {
      return Err(
        new ProviderError(
          "UNKNOWN_SYMBOL",
          this.id,
          `No source published ${request.base}/${wanted.join(", ")} inside ${request.range.toString()}.`,
        ),
      );
    }
    return Ok(quotes.sort((a, b) => a.asOf.compareTo(b.asOf)));
  }
}

/** The engine's history chain, wearing the use case's one-method port. */
export class EngineHistoryFeed implements DailyHistoryFeed {
  constructor(private readonly chain: MarketDataChain) {}

  async history(request: HistoryRequest): Promise<MarketDataResult<HistoricalSeries>> {
    const outcome = await this.chain.history(request);
    return outcome.ok ? Ok(outcome.value.value) : outcome;
  }
}

/**
 * The catalogue's quote-key prober, over Yahoo's chart `meta`.
 *
 * One source rather than the chain, deliberately. The question is "does *this
 * key* resolve on the endpoint the history chain will actually use", and asking a
 * fallback instead would index a row whose key the primary cannot serve — a gate
 * that passes and a chart that is empty.
 *
 * A failure is `null`, not a throw: a key that does not resolve is the ordinary
 * answer this exists to get, and `InstrumentQuoteKeyReconciler` decides what it
 * means (never validated, or a symbol that has died).
 */
export class YahooQuoteKeyProber implements QuoteKeyProbePort {
  constructor(private readonly yahoo: YahooChartAdapter) {}

  async probe(quoteKey: string): Promise<QuoteKeyProbeResult | null> {
    const outcome = await this.yahoo.probeQuoteKey(quoteKey);
    return outcome.ok ? outcome.value : null;
  }
}

/** Re-exported so a caller need not import the ports module for one constant. */
export { PRICE_FACTOR };

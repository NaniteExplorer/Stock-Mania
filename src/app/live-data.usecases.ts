import type { Clock, UserId } from "@/core/kernel";
import type { InstrumentCatalogRepository } from "@/domain/instrument-catalog";
import type { InstrumentRepository, MarketInstrument } from "@/domain/instruments";
import {
  providerProfile,
  type LiveDataCenterOutput,
  type LiveDataFreshness,
  type LiveDataTrackedInstrument,
} from "@/domain/live-data";

export interface LiveDataConfiguration {
  readonly finnhubConfigured: boolean;
  readonly zerodhaConfigured: boolean;
}

/** Builds a server-safe, primitive-only view of market-data coverage and readiness. */
export class ViewLiveDataCenter {
  constructor(
    private readonly instruments: InstrumentRepository,
    private readonly catalog: InstrumentCatalogRepository,
    private readonly clock: Clock,
    private readonly configuration: LiveDataConfiguration,
  ) {}

  async execute(input: { userId: UserId }): Promise<LiveDataCenterOutput> {
    const [tracked, upstoxFetch, amfiFetch, secFetch, zerodhaFetch] = await Promise.all([
      this.instruments.list(input.userId),
      this.catalog.latestSuccessfulFetch("UPSTOX_PUBLIC"),
      this.catalog.latestSuccessfulFetch("AMFI_NAV"),
      this.catalog.latestSuccessfulFetch("SEC_COMPANY_TICKERS"),
      this.catalog.latestSuccessfulFetch("ZERODHA_CSV"),
    ]);

    const trackedOutput = tracked.map((instrument) => this.toTracked(instrument));
    return {
      asOf: this.clock.now().toISOString(),
      providers: [
        providerProfile({
          id: "zerodha",
          name: "Zerodha Kite Connect",
          market: "IN",
          configured: this.configuration.zerodhaConfigured,
          cost: "PAID",
          freshness: "LIVE",
          assetClasses: ["EQUITY", "ETF"],
          capabilities: ["Authenticated current quotes", "Instrument mapping", "Future WebSocket seam"],
          limitations: ["Requires an active Connect entitlement and session access token", "No order placement in this application"],
          lastFetch: zerodhaFetch,
          cacheOnly: true,
        }),
        providerProfile({
          id: "amfi",
          name: "AMFI",
          market: "IN",
          configured: true,
          cost: "FREE",
          freshness: "NAV_DAILY",
          assetClasses: ["MUTUAL_FUND"],
          capabilities: ["Official scheme catalogue", "Daily mutual-fund NAV"],
          limitations: ["NAV is daily, not an intraday price"],
          lastFetch: amfiFetch,
        }),
        providerProfile({
          id: "mfapi",
          name: "MFAPI",
          market: "IN",
          configured: true,
          cost: "FREE",
          freshness: "NAV_DAILY",
          assetClasses: ["MUTUAL_FUND"],
          capabilities: ["Mutual-fund NAV history"],
          limitations: ["Convenience source; AMFI remains the official NAV reference"],
        }),
        providerProfile({
          id: "upstox-public",
          name: "Upstox public instrument master",
          market: "IN",
          configured: true,
          cost: "FREE",
          freshness: "EOD",
          assetClasses: ["EQUITY", "ETF"],
          capabilities: ["Indian equity catalogue identity"],
          limitations: ["Catalogue only; it does not provide a live quote entitlement"],
          lastFetch: upstoxFetch,
        }),
        providerProfile({
          id: "sec",
          name: "SEC listed companies",
          market: "US",
          configured: true,
          cost: "FREE",
          freshness: "EOD",
          assetClasses: ["EQUITY"],
          capabilities: ["US ticker, exchange and CIK identity catalogue"],
          limitations: ["Identity data only; no market prices"],
          lastFetch: secFetch,
        }),
        providerProfile({
          id: "finnhub",
          name: "Finnhub",
          market: "US",
          configured: this.configuration.finnhubConfigured,
          cost: "OPTIONAL_KEY",
          freshness: "LIVE",
          assetClasses: ["EQUITY", "ETF"],
          capabilities: ["Current USD US-equity quotes"],
          limitations: ["Requires FINNHUB_API_TOKEN", "Entitlement and rate limits remain provider-controlled"],
        }),
        providerProfile({
          id: "yahoo",
          name: "Yahoo chart fallback",
          market: "GLOBAL",
          configured: true,
          cost: "FREE",
          freshness: "DELAYED",
          assetClasses: ["EQUITY", "ETF", "MUTUAL_FUND"],
          capabilities: ["Historical and fallback close prices"],
          limitations: ["Undocumented endpoint; availability and delay are not guaranteed"],
        }),
      ],
      tracked: trackedOutput,
      coverage: {
        indianStocks: trackedOutput.filter((row) => row.market === "IN" && isExchangeTraded(row.kind)).length,
        indianFunds: trackedOutput.filter((row) => row.market === "IN" && isFund(row.kind)).length,
        usStocks: trackedOutput.filter((row) => row.market === "US" && isExchangeTraded(row.kind)).length,
        other: trackedOutput.filter((row) =>
          row.market === "OTHER" || (!isExchangeTraded(row.kind) && !isFund(row.kind))
        ).length,
      },
      searchSamples: { indianStock: null, mutualFund: null, usStock: null },
      automationReadiness: [
        {
          label: "Indian streaming market data",
          state: this.configuration.zerodhaConfigured ? "READY" : "NEEDS_CONFIG",
          detail: this.configuration.zerodhaConfigured
            ? "The authenticated Zerodha data seam is configured."
            : "Configure Zerodha Connect credentials to enable its current-quote and future streaming seam.",
        },
        {
          label: "US current quotes",
          state: this.configuration.finnhubConfigured ? "READY" : "NEEDS_CONFIG",
          detail: this.configuration.finnhubConfigured
            ? "Finnhub is configured for USD US-equity quotes."
            : "Manual tracking and fallback closes remain available without a Finnhub token.",
        },
        {
          label: "Automated execution and HFT",
          state: "DEFERRED",
          detail: "No strategy loop or order placement is implemented; execution remains a separate future boundary.",
        },
      ],
    };
  }

  private toTracked(instrument: MarketInstrument): LiveDataTrackedInstrument {
    const market = instrument.currency.code === "USD"
      ? "US" as const
      : instrument.currency.code === "INR" ? "IN" as const : "OTHER" as const;
    const freshness: LiveDataFreshness = isFund(instrument.kind)
      ? "NAV_DAILY"
      : market === "US"
        ? this.configuration.finnhubConfigured ? "LIVE" : "EOD"
        : isExchangeTraded(instrument.kind)
          ? this.configuration.zerodhaConfigured ? "LIVE" : "DELAYED"
          : "STALE";
    const hftReady = isExchangeTraded(instrument.kind) && (
      (market === "IN" && this.configuration.zerodhaConfigured) ||
      (market === "US" && this.configuration.finnhubConfigured)
    );

    return {
      instrumentId: instrument.id.value,
      symbol: instrument.symbol,
      name: instrument.name,
      kind: instrument.kind,
      market,
      currency: instrument.currency.code,
      preferredPriceFreshness: freshness,
      hftReady,
      readinessReason: hftReady
        ? "A current market-data adapter is configured; execution is still disabled."
        : isFund(instrument.kind)
          ? "Mutual funds publish daily NAV and are not streaming instruments."
          : "No entitled streaming data adapter is configured for this holding.",
    };
  }
}

const isFund = (kind: LiveDataTrackedInstrument["kind"]): boolean =>
  ["INDEX_FUND", "MUTUAL_FUND", "LIQUID_FUND", "DEBT_FUND", "ELSS_FUND"].includes(kind);

const isExchangeTraded = (kind: LiveDataTrackedInstrument["kind"]): boolean =>
  ["LISTED_EQUITY", "ETF", "REIT"].includes(kind);

import type { CatalogFetchReceipt, CatalogSearchOutput } from "@/domain/instrument-catalog";
import type { InstrumentKind } from "@/domain/instruments";

export type LiveDataFreshness = "LIVE" | "DELAYED" | "EOD" | "NAV_DAILY" | "STALE" | "UNAVAILABLE";
export type LiveDataProviderState = "READY" | "CONFIG_REQUIRED" | "CACHE_ONLY" | "UNAVAILABLE";
export type LiveDataProviderCost = "FREE" | "PAID" | "OPTIONAL_KEY";

export interface LiveDataProviderProfile {
  readonly id: string;
  readonly name: string;
  readonly market: "IN" | "US" | "GLOBAL";
  readonly state: LiveDataProviderState;
  readonly cost: LiveDataProviderCost;
  readonly freshness: LiveDataFreshness;
  readonly assetClasses: readonly ("EQUITY" | "ETF" | "MUTUAL_FUND" | "FX" | "COMMODITY")[];
  readonly capabilities: readonly string[];
  readonly limitations: readonly string[];
  readonly lastFetch: string | null;
}

export interface LiveDataTrackedInstrument {
  readonly instrumentId: string;
  readonly symbol: string;
  readonly name: string;
  readonly kind: InstrumentKind;
  readonly market: "IN" | "US" | "OTHER";
  readonly currency: string;
  readonly preferredPriceFreshness: LiveDataFreshness;
  readonly hftReady: boolean;
  readonly readinessReason: string;
}

export interface LiveDataCenterOutput {
  readonly asOf: string;
  readonly providers: readonly LiveDataProviderProfile[];
  readonly tracked: readonly LiveDataTrackedInstrument[];
  readonly coverage: {
    readonly indianStocks: number;
    readonly indianFunds: number;
    readonly usStocks: number;
    readonly other: number;
  };
  readonly searchSamples: {
    readonly indianStock: CatalogSearchOutput | null;
    readonly mutualFund: CatalogSearchOutput | null;
    readonly usStock: CatalogSearchOutput | null;
  };
  readonly automationReadiness: readonly {
    readonly label: string;
    readonly state: "READY" | "NEEDS_CONFIG" | "DEFERRED";
    readonly detail: string;
  }[];
}

export function providerProfile(input: {
  readonly id: string;
  readonly name: string;
  readonly market: LiveDataProviderProfile["market"];
  readonly configured: boolean;
  readonly cost: LiveDataProviderCost;
  readonly freshness: LiveDataFreshness;
  readonly assetClasses: LiveDataProviderProfile["assetClasses"];
  readonly capabilities: readonly string[];
  readonly limitations: readonly string[];
  readonly lastFetch?: CatalogFetchReceipt | null;
  readonly cacheOnly?: boolean;
}): LiveDataProviderProfile {
  const state: LiveDataProviderState = input.configured
    ? "READY"
    : input.cacheOnly && input.lastFetch ? "CACHE_ONLY" : "CONFIG_REQUIRED";
  return {
    id: input.id,
    name: input.name,
    market: input.market,
    state,
    cost: input.cost,
    freshness: input.configured ? input.freshness : input.cacheOnly && input.lastFetch ? "STALE" : "UNAVAILABLE",
    assetClasses: input.assetClasses,
    capabilities: input.capabilities,
    limitations: input.limitations,
    lastFetch: input.lastFetch?.fetchedAt.toISOString() ?? null,
  };
}

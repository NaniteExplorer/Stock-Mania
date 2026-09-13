/**
 * The registry: `capability x market -> ordered adapter chain`.
 *
 * This is the file the owner edits when he buys a feed. Everything else about a
 * vendor swap is one new file under `adapters/`; nothing in `app/`, no use case
 * and no repository changes, because callers only ever hold a port.
 *
 * Three properties are deliberate:
 *
 *  - **Chains are explicit and ordered, per market.** There is no implicit
 *    "and then try the global one" rule, because the correct order is not the same
 *    in both markets — Indian history falls back to the NSE bhavcopy archive and
 *    US history falls back to Nasdaq, and writing that down beats inferring it.
 *  - **A typo fails at construction.** `validate()` runs when the registry is
 *    built, so a chain naming an adapter that is not registered throws then,
 *    rather than at 09:15 when the first quote is requested.
 *  - **A pin beats the chain.** Once a catalogue row records which adapter actually
 *    resolved its quote key, that adapter is tried first for that instrument
 *    forever after — the chain order is the default for an instrument nobody has
 *    learned anything about yet.
 */

import type {
  AnyMarketDataPort,
  FxRatePort,
  HistoricalSeriesPort,
  InstrumentMasterPort,
  LiveQuotePort,
  MarketCode,
  MarketDataCapability,
  SymbolSearchPort,
  SymbologyPort,
} from "@/market-data/ports";

/** Ordered adapter ids per market, for one capability. */
export type CapabilityChains = Partial<Record<MarketCode, readonly string[]>>;

export type MarketDataChainConfig = Partial<Record<MarketDataCapability, CapabilityChains>>;

/**
 * Which adapter resolved a given instrument last time.
 *
 * Deliberately a tiny port: in production the pin lives on the catalogue row, in
 * tests it is a `Map`. The registry never writes a pin — whoever resolved the
 * instrument does, because only they know it succeeded.
 */
export interface VendorPins {
  pinFor(capability: MarketDataCapability, key: string): string | null;
}

export class InMemoryVendorPins implements VendorPins {
  private readonly pins = new Map<string, string>();

  pinFor(capability: MarketDataCapability, key: string): string | null {
    return this.pins.get(`${capability}|${key}`) ?? null;
  }

  pin(capability: MarketDataCapability, key: string, adapterId: string): void {
    this.pins.set(`${capability}|${key}`, adapterId);
  }

  clear(): void {
    this.pins.clear();
  }
}

/** Pins nothing. The default, so a caller need not supply a store to get a chain. */
export const NO_VENDOR_PINS: VendorPins = { pinFor: () => null };

/**
 * The shipped chain, encoding C12.
 *
 * History: Yahoo, then Nasdaq (US) or the NSE/BSE bhavcopy archives (IN). Nasdaq is
 * an independent *transport* but probably a shared upstream, so it is a failover
 * and **not** a cross-check oracle. Quote: Yahoo, then Moneycontrol `pricefeed`
 * (IN) or stockanalysis (US). FX: Frankfurter, then Exchangerate.dev, then
 * currency-api (today only).
 *
 * `yahoo-search` is listed under `GLOBAL` search only, and `GLOBAL` is never used
 * as an implicit fallback: per C11 it is a candidate generator for offline
 * catalogue work, never a dependency of a keystroke. What runs under the user's
 * cursor is the in-process catalogue ranker.
 */
export const DEFAULT_MARKET_DATA_CHAINS: MarketDataChainConfig = {
  SEARCH: {
    IN: ["local-catalogue-ranker"],
    US: ["local-catalogue-ranker"],
    GLOBAL: ["yahoo-search"],
  },
  QUOTE: {
    IN: ["yahoo-chart", "moneycontrol-quote"],
    US: ["yahoo-chart", "stockanalysis-quote"],
    GLOBAL: ["yahoo-chart"],
  },
  HISTORY: {
    IN: ["yahoo-chart", "nse-bhavcopy-history", "bse-bhavcopy-history"],
    US: ["yahoo-chart", "nasdaq-chart-history"],
    GLOBAL: ["yahoo-chart"],
  },
  FX: {
    GLOBAL: ["frankfurter", "exchangerate-dev", "currency-api-cdn"],
  },
  MASTER: {
    IN: ["upstox-master", "nse-equity-master"],
    US: ["sec-master", "nasdaq-trader-master"],
  },
  SYMBOLOGY: {
    GLOBAL: ["openfigi-mapping"],
  },
};

export class MarketDataRegistry {
  private readonly byId = new Map<string, AnyMarketDataPort>();

  constructor(
    adapters: readonly AnyMarketDataPort[],
    private readonly config: MarketDataChainConfig = DEFAULT_MARKET_DATA_CHAINS,
    private readonly pins: VendorPins = NO_VENDOR_PINS,
  ) {
    for (const adapter of adapters) this.register(adapter);
    this.validate();
  }

  register(adapter: AnyMarketDataPort): void {
    const existing = this.byId.get(adapter.info.id);
    if (existing && existing !== adapter) {
      throw new Error(`Two market-data adapters claim the id "${adapter.info.id}".`);
    }
    this.byId.set(adapter.info.id, adapter);
  }

  get(id: string): AnyMarketDataPort | null {
    return this.byId.get(id) ?? null;
  }

  /** Every registered adapter, for a health page. */
  all(): readonly AnyMarketDataPort[] {
    return [...this.byId.values()];
  }

  /**
   * The ordered chain for a capability and market, pinned adapter first.
   *
   * A configured id that is not registered is *not* silently skipped here — it is
   * rejected in {@link validate} when the registry is built. A pinned id that is
   * not registered is skipped, because a pin is data that can outlive an adapter.
   */
  chain<T extends AnyMarketDataPort>(
    capability: MarketDataCapability,
    market: MarketCode,
    pinKey?: string,
  ): readonly T[] {
    const ids = [...(this.config[capability]?.[market] ?? [])];

    const pinnedId = pinKey ? this.pins.pinFor(capability, pinKey) : null;
    if (pinnedId && this.byId.has(pinnedId)) {
      const pinned = this.byId.get(pinnedId)!;
      if (pinned.info.capabilities.includes(capability)) {
        const rest = ids.filter((id) => id !== pinnedId);
        ids.length = 0;
        ids.push(pinnedId, ...rest);
      }
    }

    const seen = new Set<string>();
    const chain: T[] = [];
    for (const id of ids) {
      if (seen.has(id)) continue;
      seen.add(id);
      const adapter = this.byId.get(id);
      if (adapter) chain.push(adapter as T);
    }
    return chain;
  }

  searchChain(market: MarketCode, pinKey?: string): readonly SymbolSearchPort[] {
    return this.chain<SymbolSearchPort>("SEARCH", market, pinKey);
  }

  quoteChain(market: MarketCode, pinKey?: string): readonly LiveQuotePort[] {
    return this.chain<LiveQuotePort>("QUOTE", market, pinKey);
  }

  historyChain(market: MarketCode, pinKey?: string): readonly HistoricalSeriesPort[] {
    return this.chain<HistoricalSeriesPort>("HISTORY", market, pinKey);
  }

  fxChain(): readonly FxRatePort[] {
    return this.chain<FxRatePort>("FX", "GLOBAL");
  }

  masterChain(market: MarketCode): readonly InstrumentMasterPort[] {
    return this.chain<InstrumentMasterPort>("MASTER", market);
  }

  symbologyChain(): readonly SymbologyPort[] {
    return this.chain<SymbologyPort>("SYMBOLOGY", "GLOBAL");
  }

  /**
   * The documented fallback chain, rendered.
   *
   * Printed into the operations runbook and asserted in a test: the chain a reader
   * believes in is the one that is configured, not the one in a comment.
   */
  describe(): readonly string[] {
    const lines: string[] = [];
    for (const [capability, chains] of Object.entries(this.config)) {
      for (const [market, ids] of Object.entries(chains ?? {})) {
        lines.push(`${capability} ${market}: ${(ids ?? []).join(" -> ") || "(none)"}`);
      }
    }
    return lines.sort();
  }

  private validate(): void {
    const problems: string[] = [];
    for (const [capability, chains] of Object.entries(this.config)) {
      for (const [market, ids] of Object.entries(chains ?? {})) {
        for (const id of ids ?? []) {
          const adapter = this.byId.get(id);
          if (!adapter) {
            problems.push(`${capability}/${market} names "${id}", which is not registered`);
            continue;
          }
          if (!adapter.info.capabilities.includes(capability as MarketDataCapability)) {
            problems.push(
              `${capability}/${market} names "${id}", which serves ` +
                `${adapter.info.capabilities.join(", ")}`,
            );
          }
          if (
            market !== "GLOBAL" &&
            !adapter.info.markets.includes(market as MarketCode) &&
            !adapter.info.markets.includes("GLOBAL")
          ) {
            problems.push(`${capability}/${market} names "${id}", which does not serve ${market}`);
          }
        }
      }
    }
    if (problems.length > 0) {
      throw new Error(`Market-data registry configuration is wrong:\n  - ${problems.join("\n  - ")}`);
    }
  }
}

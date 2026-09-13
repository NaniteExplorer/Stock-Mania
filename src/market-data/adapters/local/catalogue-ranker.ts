/**
 * The search that actually runs under the user's cursor.
 *
 * C11, in code: **the local catalogue is the ranker**, and Yahoo's search is only a
 * candidate generator used offline. Measured, Yahoo's search has 74% intent
 * accuracy, puts ADRs above home listings, and has zero typo tolerance for company
 * names. None of those are fixable from the outside — so search is done in process
 * over the ~30 000-row catalogue, which is a few megabytes of strings and costs
 * nothing per keystroke.
 *
 * The scoring is deliberately boring and deliberately **integer** (0..10000, C8):
 *
 *  - an exact symbol or alias match outranks everything;
 *  - a name that starts with the query outranks one that merely contains it;
 *  - a **home listing** is boosted over a foreign listing of the same company,
 *    which is the specific defect that makes Yahoo return `INFY` (the ADR) above
 *    `INFY.NS` for an Indian user;
 *  - a token subsequence match gives "hdfc bank" a hit on "HDFC Bank Limited";
 *  - ties break on the shorter name, because the parent company is usually what was
 *    meant and its name is usually the shortest.
 *
 * No network, so no breaker and no bucket: `health()` is permanently healthy
 * because there is nothing here that can be unavailable.
 */

import { Ok } from "@/core/kernel";
import { Currency } from "@/core/money";
import type { HealthStatus } from "@/domain/pricing";
import { AliasTable, normaliseAlias } from "@/market-data/adapters/local/alias-table";
import type {
  MarketCode,
  MarketDataResult,
  MarketDataSourceInfo,
  SymbolCandidate,
  SymbolSearchPort,
  SymbolSearchQuery,
} from "@/market-data/ports";

/** One indexed row. The catalogue supplies these; this file does not fetch them. */
export interface CatalogueEntry {
  readonly quoteKey: string;
  readonly symbol: string;
  readonly name: string;
  readonly exchange: string;
  readonly currencyCode: string;
  readonly market: MarketCode;
  readonly instrumentType: "EQUITY" | "ETF" | "INDEX" | "FUND" | "OTHER";
  readonly isin: string | null;
  /** True for a listing on the instrument's own home exchange. */
  readonly homeListing: boolean;
}

const SCORE = {
  exactSymbol: 10_000,
  exactAlias: 9_500,
  symbolPrefix: 8_000,
  namePrefix: 7_000,
  allTokens: 6_000,
  nameContains: 5_000,
  /** Added, not multiplied: a boost must never let a bad match outrank a good one. */
  homeListing: 400,
  equity: 100,
} as const;

const ALWAYS_HEALTHY: HealthStatus = {
  state: "HEALTHY",
  consecutiveFailures: 0,
  lastError: null,
  circuitOpenUntil: null,
};

export class CatalogueRankerAdapter implements SymbolSearchPort {
  readonly info: MarketDataSourceInfo = {
    id: "local-catalogue-ranker",
    displayName: "Local catalogue (in-process ranker)",
    capabilities: ["SEARCH"],
    markets: ["GLOBAL", "IN", "US"],
    keyless: true,
  };

  private readonly entries: readonly CatalogueEntry[];

  constructor(
    entries: readonly CatalogueEntry[] = [],
    private readonly aliases: AliasTable = new AliasTable(),
    /**
     * Whose home market this user is in. The boost is relative to the reader:
     * an Indian owner searching "infosys" wants `INFY.NS`, not the ADR.
     */
    private readonly homeMarket: MarketCode = "IN",
  ) {
    this.entries = entries;
  }

  health(): HealthStatus {
    return ALWAYS_HEALTHY;
  }

  async search(query: SymbolSearchQuery): Promise<MarketDataResult<readonly SymbolCandidate[]>> {
    return Ok(this.rank(query));
  }

  /** Synchronous, for a caller that already has the catalogue in hand. */
  rank(query: SymbolSearchQuery): readonly SymbolCandidate[] {
    const text = normaliseAlias(query.text);
    if (text.length === 0) return [];

    const limit = query.limit ?? 10;
    const tokens = text.split(" ").filter(Boolean);
    const aliasIsins = new Set(this.aliases.isinsFor(text));

    const scored: { entry: CatalogueEntry; score: number }[] = [];
    for (const entry of this.entries) {
      if (query.market && query.market !== "GLOBAL" && entry.market !== query.market) continue;

      const symbol = normaliseAlias(entry.symbol);
      const quoteKey = normaliseAlias(entry.quoteKey);
      const name = normaliseAlias(entry.name);

      let score = 0;
      if (symbol === text || quoteKey === text) score = SCORE.exactSymbol;
      else if (entry.isin && aliasIsins.has(entry.isin.toUpperCase())) score = SCORE.exactAlias;
      else if (symbol.startsWith(text)) score = SCORE.symbolPrefix;
      else if (name.startsWith(text)) score = SCORE.namePrefix;
      else if (tokens.length > 1 && tokens.every((token) => name.includes(token)))
        score = SCORE.allTokens;
      else if (name.includes(text)) score = SCORE.nameContains;
      else continue;

      // The home-listing boost, and the reason it is an addition: a foreign
      // exact-symbol match must still beat a home partial-name match.
      if (entry.homeListing && entry.market === this.homeMarket) score += SCORE.homeListing;
      if (entry.instrumentType === "EQUITY" || entry.instrumentType === "ETF") {
        score += SCORE.equity;
      }

      scored.push({ entry, score: Math.min(score, 10_000) });
    }

    scored.sort(
      (a, b) => b.score - a.score || a.entry.name.length - b.entry.name.length ||
        a.entry.quoteKey.localeCompare(b.entry.quoteKey),
    );

    return scored.slice(0, limit).map(({ entry, score }) => ({
      quoteKey: entry.quoteKey,
      symbol: entry.symbol,
      name: entry.name,
      exchange: entry.exchange,
      currency: currencyOf(entry.currencyCode),
      market: entry.market,
      instrumentType: entry.instrumentType,
      isin: entry.isin,
      score,
      sourceId: this.info.id,
    }));
  }
}

/** Memoised, because ranking builds one per candidate per keystroke. */
const CURRENCY_CACHE = new Map<string, Currency>();

function currencyOf(code: string): Currency {
  const key = code.trim().toUpperCase();
  const cached = CURRENCY_CACHE.get(key);
  if (cached) return cached;
  const currency = Currency.of(key);
  CURRENCY_CACHE.set(key, currency);
  return currency;
}

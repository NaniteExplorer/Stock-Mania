/**
 * The public face of the market-data seam.
 *
 * Callers import from `@/market-data/ports` and never from an adapter file: that
 * is what makes "swap the vendor" a registry edit rather than a search-and-replace
 * across the app. Adapters import from here too, so the direction of dependency is
 * always adapter -> ports, never ports -> adapter.
 */

export type {
  AnyMarketDataPort,
  CorporateAction,
  CorporateActionsPort,
  DailyBar,
  FxRate,
  FxRateKind,
  FxRatePort,
  FxRateRequest,
  HistoricalSeries,
  HistoricalSeriesPort,
  HistoryRequest,
  InstrumentMasterPort,
  InstrumentMasterRow,
  LiveQuote,
  LiveQuotePort,
  LiveQuoteRequest,
  MarketCode,
  MarketDataCapability,
  MarketDataPort,
  MarketDataResult,
  MarketDataSourceInfo,
  QuoteSubject,
  SymbolCandidate,
  SymbolSearchPort,
  SymbolSearchQuery,
  SymbologyJob,
  SymbologyMatch,
  SymbologyPort,
  TradableType,
} from "./types";

export {
  PRICE_FACTOR,
  PRICE_SCALE,
  dailyBar,
  decimalFromScaled,
  scaledFromDecimal,
  scaledFromSourceNumber,
} from "./types";

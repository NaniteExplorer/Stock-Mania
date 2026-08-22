/**
 * TradingView embed configurations.
 *
 * TradingView is the one third-party widget kept in v2: the embed is free and
 * keyless, so it costs nothing and needs no credential. These are the six
 * configs actually rendered — the marketing page's ticker/overview/heatmaps and
 * the news/market-data panels. The dozen per-symbol configs v1 also carried
 * went with the `stocks` feature that rendered them.
 *
 * Colours are passed to an iframe we do not control, so the hex values here are
 * deliberate duplicates of the design tokens rather than `var(--…)` references.
 */

export const TICKER_TAPE_WIDGET_CONFIG = {
  symbols: [
    { proName: "FOREXCOM:SPXUSD", title: "S&P 500" },
    { proName: "FOREXCOM:NSXUSD", title: "Nasdaq 100" },
    { proName: "BSE:SENSEX", title: "Sensex" },
    { proName: "NSE:NIFTY", title: "Nifty 50" },
    { proName: "NASDAQ:AAPL", title: "Apple" },
    { proName: "NASDAQ:NVDA", title: "Nvidia" },
    { proName: "NSE:RELIANCE", title: "Reliance" },
    { proName: "NSE:TCS", title: "TCS" },
    { proName: "BSE:HDFCBANK", title: "HDFC Bank" },
  ],
  showSymbolLogo: true,
  isTransparent: true,
  displayMode: "adaptive",
  colorTheme: "light",
  locale: "en",
};
export const MARKET_OVERVIEW_WIDGET_CONFIG = {
  colorTheme: "light",
  dateRange: "12M",
  locale: "en",
  largeChartUrl: "",
  isTransparent: true,
  showFloatingTooltip: true,
  plotLineColorGrowing: "#10b981",
  plotLineColorFalling: "#f43f5e",
  gridLineColor: "rgba(240, 243, 250, 0)",
  scaleFontColor: "#e2e8f0",
  belowLineFillColorGrowing: "rgba(16, 185, 129, 0.12)",
  belowLineFillColorFalling: "rgba(244, 63, 94, 0.12)",
  belowLineFillColorGrowingBottom: "rgba(16, 185, 129, 0)",
  belowLineFillColorFallingBottom: "rgba(244, 63, 94, 0)",
  symbolActiveColor: "rgba(245, 158, 11, 0.08)",
  tabs: [
    {
      title: "Financial",
      symbols: [
        { s: "NYSE:JPM", d: "JPMorgan Chase" },
        { s: "NYSE:WFC", d: "Wells Fargo Co New" },
        { s: "NYSE:BAC", d: "Bank Amer Corp" },
        { s: "NYSE:HSBC", d: "Hsbc Hldgs Plc" },
        { s: "NYSE:C", d: "Citigroup Inc" },
        { s: "NYSE:MA", d: "Mastercard Incorporated" },
      ],
    },
    {
      title: "Technology",
      symbols: [
        { s: "NASDAQ:AAPL", d: "Apple" },
        { s: "NASDAQ:GOOGL", d: "Alphabet" },
        { s: "NASDAQ:MSFT", d: "Microsoft" },
        { s: "NASDAQ:FB", d: "Meta Platforms" },
        { s: "NYSE:ORCL", d: "Oracle Corp" },
        { s: "NASDAQ:INTC", d: "Intel Corp" },
      ],
    },
    {
      title: "Services",
      symbols: [
        { s: "NASDAQ:AMZN", d: "Amazon" },
        { s: "NYSE:BABA", d: "Alibaba Group Hldg Ltd" },
        { s: "NYSE:T", d: "At&t Inc" },
        { s: "NYSE:WMT", d: "Walmart" },
        { s: "NYSE:V", d: "Visa" },
      ],
    },
    {
      title: "India",
      symbols: [
        { s: "BSE:RELIANCE", d: "Reliance Industries" },
        { s: "BSE:TCS", d: "TCS" },
        { s: "BSE:HDFCBANK", d: "HDFC Bank" },
        { s: "BSE:INFY", d: "Infosys" },
        { s: "BSE:ICICIBANK", d: "ICICI Bank" },
        { s: "BSE:BHARTIARTL", d: "Bharti Airtel" },
      ],
    },
  ],
  support_host: "https://www.tradingview.com",
  backgroundColor: "#ffffff",
  width: "100%",
  height: 600,
  showSymbolLogo: true,
  showChart: true,
};
export const HEATMAP_WIDGET_CONFIG = {
  dataSource: "SPX500",
  blockSize: "market_cap_basic",
  blockColor: "change",
  grouping: "sector",
  isTransparent: true,
  locale: "en",
  symbolUrl: "",
  colorTheme: "light",
  exchanges: [],
  hasTopBar: false,
  isDataSetEnabled: false,
  isZoomEnabled: true,
  hasSymbolTooltip: true,
  isMonoSize: false,
  width: "100%",
  height: "600",
};
export const INDIA_HEATMAP_WIDGET_CONFIG = {
  dataSource: "SENSEX",
  blockSize: "market_cap_basic",
  blockColor: "change",
  grouping: "sector",
  isTransparent: true,
  locale: "en",
  symbolUrl: "",
  colorTheme: "light",
  exchanges: [],
  hasTopBar: false,
  isDataSetEnabled: false,
  isZoomEnabled: true,
  hasSymbolTooltip: true,
  isMonoSize: false,
  width: "100%",
  height: "600",
};
export const TOP_STORIES_WIDGET_CONFIG = {
  displayMode: "regular",
  feedMode: "market",
  colorTheme: "light",
  isTransparent: true,
  locale: "en",
  market: "stock",
  width: "100%",
  height: "600",
};
export const MARKET_DATA_WIDGET_CONFIG = {
  title: "Stocks",
  width: "100%",
  height: 600,
  locale: "en",
  showSymbolLogo: true,
  colorTheme: "light",
  isTransparent: false,
  backgroundColor: "#ffffff",
  symbolsGroups: [
    {
      name: "Financial",
      symbols: [
        { name: "NYSE:JPM", displayName: "JPMorgan Chase" },
        { name: "NYSE:WFC", displayName: "Wells Fargo Co New" },
        { name: "NYSE:BAC", displayName: "Bank Amer Corp" },
        { name: "NYSE:HSBC", displayName: "Hsbc Hldgs Plc" },
        { name: "NYSE:C", displayName: "Citigroup Inc" },
        { name: "NYSE:MA", displayName: "Mastercard Incorporated" },
      ],
    },
    {
      name: "Technology",
      symbols: [
        { name: "NASDAQ:AAPL", displayName: "Apple" },
        { name: "NASDAQ:GOOGL", displayName: "Alphabet" },
        { name: "NASDAQ:MSFT", displayName: "Microsoft" },
        { name: "NASDAQ:FB", displayName: "Meta Platforms" },
        { name: "NYSE:ORCL", displayName: "Oracle Corp" },
        { name: "NASDAQ:INTC", displayName: "Intel Corp" },
      ],
    },
    {
      name: "Services",
      symbols: [
        { name: "NASDAQ:AMZN", displayName: "Amazon" },
        { name: "NYSE:BABA", displayName: "Alibaba Group Hldg Ltd" },
        { name: "NYSE:T", displayName: "At&t Inc" },
        { name: "NYSE:WMT", displayName: "Walmart" },
        { name: "NYSE:V", displayName: "Visa" },
      ],
    },
    {
      name: "India",
      symbols: [
        { name: "BSE:RELIANCE", displayName: "Reliance" },
        { name: "BSE:TCS", displayName: "TCS" },
        { name: "BSE:HDFCBANK", displayName: "HDFC Bank" },
        { name: "BSE:INFY", displayName: "Infosys" },
        { name: "BSE:ICICIBANK", displayName: "ICICI Bank" },
        { name: "BSE:BHARTIARTL", displayName: "Airtel" },
      ],
    },
  ],
};

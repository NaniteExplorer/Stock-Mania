import { LayoutDashboard, Search, Star, BriefcaseBusiness, Zap, History, Settings } from "lucide-react";

export const NAV_ITEMS = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/search", label: "Search", icon: Search },
  { href: "/watchlist", label: "Watchlist", icon: Star },
  { href: "/portfolio", label: "Portfolio", icon: BriefcaseBusiness },
  { href: "/signals", label: "AI Signals", icon: Zap },
  { href: "/orders", label: "Orders", icon: History },
  { href: "/settings", label: "Settings", icon: Settings },
];

// Sign-up form select options
export const INVESTMENT_GOALS = [
  { value: "Growth", label: "Growth" },
  { value: "Income", label: "Income" },
  { value: "Balanced", label: "Balanced" },
  { value: "Conservative", label: "Conservative" },
];

export const RISK_TOLERANCE_OPTIONS = [
  { value: "Low", label: "Low" },
  { value: "Medium", label: "Medium" },
  { value: "High", label: "High" },
];

export const PREFERRED_INDUSTRIES = [
  { value: "Technology", label: "Technology" },
  { value: "Healthcare", label: "Healthcare" },
  { value: "Finance", label: "Finance" },
  { value: "Energy", label: "Energy" },
  { value: "Consumer Goods", label: "Consumer Goods" },
];

export const ALERT_TYPE_OPTIONS = [
  { value: "upper", label: "Upper" },
  { value: "lower", label: "Lower" },
];

export const CONDITION_OPTIONS = [
  { value: "greater", label: "Greater than (>)" },
  { value: "less", label: "Less than (<)" },
];

// Indian stock symbols (NSE) — Nifty 50 + top mid-caps
export const INDIAN_STOCK_SYMBOLS = [
  "RELIANCE", "TCS", "HDFCBANK", "INFY", "ICICIBANK",
  "HINDUNILVR", "ITC", "SBIN", "BAJFINANCE", "BHARTIARTL",
  "KOTAKBANK", "LT", "ASIANPAINT", "AXISBANK", "MARUTI",
  "SUNPHARMA", "NESTLEIND", "ULTRACEMCO", "WIPRO", "TITAN",
  "ADANIPORTS", "POWERGRID", "NTPC", "ONGC", "JSWSTEEL",
  "TATASTEEL", "DIVISLAB", "DRREDDY", "APOLLOHOSP", "CIPLA",
  "HCLTECH", "TECHM", "BAJAJFINSV", "BPCL", "COALINDIA",
  "EICHERMOT", "GRASIM", "HEROMOTOCO", "HINDALCO", "INDUSINDBK",
  "TATAMOTORS", "TATACONSUM", "VEDL", "SHREECEM", "UPL",
  "SBILIFE", "ICICIPRULI", "HDFCLIFE", "BRITANNIA", "MM",
];

// TradingView Charts
export const MARKET_OVERVIEW_WIDGET_CONFIG = {
  colorTheme: "dark",
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
  backgroundColor: "#0b1120",
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
  colorTheme: "dark",
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
  colorTheme: "dark",
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
  colorTheme: "dark",
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
  colorTheme: "dark",
  isTransparent: false,
  backgroundColor: "#0b1120",
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

export const SYMBOL_INFO_WIDGET_CONFIG = (symbol: string) => ({
  symbol: symbol.toUpperCase(),
  colorTheme: "dark",
  isTransparent: true,
  locale: "en",
  width: "100%",
  height: 170,
});

export const CANDLE_CHART_WIDGET_CONFIG = (symbol: string) => ({
  allow_symbol_change: false,
  calendar: false,
  details: true,
  hide_side_toolbar: true,
  hide_top_toolbar: false,
  hide_legend: false,
  hide_volume: false,
  hotlist: false,
  interval: "D",
  locale: "en",
  save_image: false,
  style: 1,
  symbol: symbol.toUpperCase(),
  theme: "dark",
  timezone: "Etc/UTC",
  backgroundColor: "#0b1120",
  gridColor: "#0b1120",
  watchlist: [],
  withdateranges: false,
  compareSymbols: [],
  studies: [],
  width: "100%",
  height: 600,
});

export const BASELINE_WIDGET_CONFIG = (symbol: string) => ({
  allow_symbol_change: false,
  calendar: false,
  details: false,
  hide_side_toolbar: true,
  hide_top_toolbar: false,
  hide_legend: false,
  hide_volume: false,
  hotlist: false,
  interval: "D",
  locale: "en",
  save_image: false,
  style: 10,
  symbol: symbol.toUpperCase(),
  theme: "dark",
  timezone: "Etc/UTC",
  backgroundColor: "#0b1120",
  gridColor: "#0b1120",
  watchlist: [],
  withdateranges: false,
  compareSymbols: [],
  studies: [],
  width: "100%",
  height: 600,
});

export const TECHNICAL_ANALYSIS_WIDGET_CONFIG = (symbol: string) => ({
  symbol: symbol.toUpperCase(),
  colorTheme: "dark",
  isTransparent: "true",
  locale: "en",
  width: "100%",
  height: 400,
  interval: "1h",
  largeChartUrl: "",
});

export const COMPANY_PROFILE_WIDGET_CONFIG = (symbol: string) => ({
  symbol: symbol.toUpperCase(),
  colorTheme: "dark",
  isTransparent: "true",
  locale: "en",
  width: "100%",
  height: 440,
});

export const COMPANY_FINANCIALS_WIDGET_CONFIG = (symbol: string) => ({
  symbol: symbol.toUpperCase(),
  colorTheme: "dark",
  isTransparent: "true",
  locale: "en",
  width: "100%",
  height: 464,
  displayMode: "regular",
  largeChartUrl: "",
});

export const POPULAR_STOCK_SYMBOLS = [
  // Tech Giants
  "AAPL", "MSFT", "GOOGL", "AMZN", "TSLA", "META", "NVDA", "NFLX", "ORCL", "CRM",
  // Growing Tech
  "ADBE", "INTC", "AMD", "PYPL", "UBER", "ZOOM", "SPOT", "SQ", "SHOP", "ROKU",
  // Newer Tech
  "SNOW", "PLTR", "COIN", "RBLX", "DDOG", "CRWD", "NET", "OKTA", "TWLO", "ZM",
  // Consumer & Delivery
  "DOCU", "PTON", "PINS", "SNAP", "LYFT", "DASH", "ABNB", "RIVN", "LCID", "NIO",
  // International
  "XPEV", "LI", "BABA", "JD", "PDD", "TME", "BILI", "DIDI", "GRAB", "SE",
];

export const NO_MARKET_NEWS =
  '<p class="mobile-text" style="margin:0 0 20px 0;font-size:16px;line-height:1.6;color:#4b5563;">No market news available today. Please check back tomorrow.</p>';

export const WATCHLIST_TABLE_HEADER = [
  "Company",
  "Symbol",
  "Price",
  "Change",
  "Market Cap",
  "P/E Ratio",
  "Alert",
  "Action",
];

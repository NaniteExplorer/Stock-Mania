export type MarketRegion = "india" | "global";

export interface Holding {
  symbol: string;
  exchange: string;
  quantity: number;
  avgPrice: number;
  currentPrice: number;
  pnl: number;
  pnlPercent: number;
  dayChange: number;
  dayChangePercent: number;
  totalValue: number;
  investedValue: number;
  broker: "ZERODHA" | "ALPACA";
  currency: "INR" | "USD";
}

export interface Position {
  symbol: string;
  exchange: string;
  product: string;
  quantity: number;
  avgPrice: number;
  currentPrice: number;
  pnl: number;
  unrealised: number;
  realised: number;
  side: "LONG" | "SHORT";
  broker: "ZERODHA" | "ALPACA";
  currency: "INR" | "USD";
}

export interface PortfolioSummary {
  holdings: Holding[];
  positions: Position[];
  totalInvested: number;
  currentValue: number;
  totalPnl: number;
  totalPnlPercent: number;
  dayPnl: number;
  zerodhaConnected: boolean;
  alpacaConnected: boolean;
}

import type { InvestmentKind } from "@/features/investments/investment.types";

export type TradeSide = "BUY" | "SELL";
export type TradeSource = "MANUAL" | "IMPORT" | "DRIVE";

export interface TradeCharges {
  brokerage: number;
  taxes: number;
  other: number;
}

export interface Trade {
  id: string;
  userId: string;
  /** Investment identity the trade rolls up into. */
  symbol: string | null;
  name: string;
  kind: InvestmentKind;
  side: TradeSide;
  date: Date;
  quantity: number;
  pricePerUnit: number;
  charges: TradeCharges;
  chargesTotal: number;
  currency: string;
  source: TradeSource;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateTradeInput {
  symbol?: string | null;
  name: string;
  kind: InvestmentKind;
  side: TradeSide;
  date: string; // ISO from the form
  quantity: number;
  pricePerUnit: number;
  charges?: Partial<TradeCharges>;
  currency?: string;
  source?: TradeSource;
}

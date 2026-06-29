export type InvestmentKind = "STOCK" | "ETF" | "MUTUAL_FUND" | "BOND" | "CRYPTO";

export const INVESTMENT_KIND_LABELS: Record<InvestmentKind, string> = {
  STOCK: "Stock",
  ETF: "ETF",
  MUTUAL_FUND: "Mutual fund",
  BOND: "Bond",
  CRYPTO: "Crypto",
};

export interface Investment {
  id: string;
  userId: string;
  name: string;
  symbol: string | null;
  kind: InvestmentKind;
  units: number;
  avgCost: number;
  currentPrice: number;
  createdAt: Date;
  updatedAt: Date;
  // derived
  invested: number;
  currentValue: number;
  pnl: number;
  pnlPercent: number;
}

export interface CreateInvestmentInput {
  name: string;
  symbol?: string | null;
  kind: InvestmentKind;
  units: number;
  avgCost: number;
  currentPrice: number;
}

export type UpdateInvestmentInput = Partial<CreateInvestmentInput>;

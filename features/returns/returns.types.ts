import type { InvestmentKind } from "@/features/investments/investment.types";

/** How a holding's XIRR was derived. */
export type ReturnMethod = "LEDGER" | "SNAPSHOT" | "NONE";

export interface HoldingReturn {
  holdingKey: string;
  name: string;
  symbol: string | null;
  kind: InvestmentKind;
  invested: number;
  currentValue: number;
  /** Annualized money-weighted return (decimal), or null when undefined. */
  xirr: number | null;
  /** Simple lifetime P&L percentage (currentValue/invested − 1). */
  absoluteReturn: number | null;
  method: ReturnMethod;
}

export interface AssetClassReturn {
  kind: InvestmentKind;
  invested: number;
  currentValue: number;
  xirr: number | null;
}

export interface PortfolioReturn {
  xirr: number | null;
  invested: number;
  currentValue: number;
  byClass: AssetClassReturn[];
  byHolding: HoldingReturn[];
}

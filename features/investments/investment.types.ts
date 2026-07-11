export type InvestmentKind =
  | "STOCK"
  | "ETF"
  | "MUTUAL_FUND"
  | "BOND"
  | "CRYPTO"
  | "DIGITAL_GOLD"
  | "COMMODITY";

export const INVESTMENT_KIND_LABELS: Record<InvestmentKind, string> = {
  STOCK: "Stock",
  ETF: "ETF",
  MUTUAL_FUND: "Mutual fund",
  BOND: "Bond",
  CRYPTO: "Crypto",
  DIGITAL_GOLD: "Digital gold",
  COMMODITY: "Commodity (MCX)",
};

/** Kinds measured in grams rather than share/unit counts. */
export const GRAM_KINDS: InvestmentKind[] = ["DIGITAL_GOLD"];

export interface Investment {
  id: string;
  userId: string;
  name: string;
  symbol: string | null;
  kind: InvestmentKind;
  units: number;
  avgCost: number;
  currentPrice: number;
  // ledger-derived, persisted (0 for manual-only holdings)
  holdingSince: Date | null;
  realizedGain: number;
  realizedTax: number;
  totalCharges: number;
  openBuyCharges: number;
  createdAt: Date;
  updatedAt: Date;
  // derived
  invested: number;
  currentValue: number;
  pnl: number;
  pnlPercent: number;
  /** Total cash deployed to acquire the open position (price × units + buy charges). */
  grossInvested: number;
  /** What you'd actually receive if you sold now: currentValue − est. exit tax (Phase 2). */
  netProceedsIfSold: number;
  /** netProceedsIfSold − grossInvested. */
  unrealizedNet: number;
  /** realizedGain − realizedTax. */
  realizedNet: number;
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

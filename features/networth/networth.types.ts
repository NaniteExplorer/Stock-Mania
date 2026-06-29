export interface AllocationSlice {
  key: string;
  label: string;
  value: number;
  percent: number;
  color: string;
}

export interface NetWorthOverview {
  /** Total assets minus total liabilities. */
  netWorth: number;
  totalAssets: number;
  totalLiabilities: number;
  dayChange: number;
  dayChangePercent: number;
  allocation: AllocationSlice[];
  totals: {
    accounts: number;
    investments: number;
    brokerage: number;
    esops: number;
    assets: number;
  };
  counts: {
    accounts: number;
    investments: number;
    esops: number;
    assets: number;
    liabilities: number;
  };
  hasData: boolean;
}

export interface NetWorthSummary {
  netWorth: string;
  changeLabel: string;
  positive: boolean;
}

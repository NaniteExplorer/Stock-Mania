import type {
  MonthlyWealthMetrics,
  MonthlyWealthValues,
  SnapshotBreakdown,
} from "./tracking.types";

export const EMPTY_MONTHLY_WEALTH: MonthlyWealthValues = {
  cash: 0,
  indianStocks: 0,
  usStocks: 0,
  cryptoCurrency: 0,
  etfs: 0,
  reits: 0,
  digitalGold: 0,
  creditCardLoans: 0,
  loans: 0,
  sbiBank: 0,
  jioPaymentsBank: 0,
  axisBank: 0,
  mutualFunds: 0,
  ppf: 0,
  rdFd: 0,
  nps: 0,
  epfo: 0,
  equityCryptoPnl: 0,
  lifeInsurance: 0,
  healthInsurance: 0,
};

/** Spreadsheet-compatible calculations. Debt inputs may be negative or positive. */
export function calculateMonthlyWealth(values: MonthlyWealthValues): MonthlyWealthMetrics {
  const inHand = values.cash + values.sbiBank + values.jioPaymentsBank + values.axisBank;
  const cashExcludingSalary = values.cash + values.sbiBank + values.jioPaymentsBank;
  const midTerm =
    values.indianStocks + values.usStocks + values.cryptoCurrency + values.etfs +
    values.reits + values.digitalGold;
  const longTerm = values.mutualFunds + values.ppf + values.rdFd + values.nps + values.epfo;
  const totalDebts = -Math.abs(values.creditCardLoans) - Math.abs(values.loans);
  const netWorth = inHand + midTerm + totalDebts;
  return {
    inHand,
    cashExcludingSalary,
    midTerm,
    longTerm,
    totalDebts,
    netWorth,
    totalWorth: netWorth + longTerm,
  };
}

export function toSnapshotBreakdown(values: MonthlyWealthValues): SnapshotBreakdown {
  return {
    accounts: values.cash + values.sbiBank + values.jioPaymentsBank + values.axisBank,
    investments:
      values.indianStocks + values.usStocks + values.cryptoCurrency + values.etfs +
      values.reits + values.digitalGold + values.mutualFunds + values.ppf + values.rdFd +
      values.nps + values.epfo,
    brokerage: 0,
    esops: 0,
    assets: 0,
    liabilities: Math.abs(values.loans),
    creditCard: Math.abs(values.creditCardLoans),
  };
}

/**
 * Forward-compatible contracts for the historical wealth engine.
 * These are intentionally not wired into current-value CRUD yet: introducing
 * them separately keeps existing actions stable while the event ledger and
 * snapshot migration are built as a later vertical slice.
 */
export type CurrencyCode = "INR" | "USD" | (string & {});
export type ValuationSource = "MANUAL" | "BROKER" | "IMPORTED" | "CALCULATED";

export interface RecordProvenance {
  currency: CurrencyCode;
  valuationSource: ValuationSource;
  asOfDate: Date;
  lastVerifiedAt: Date | null;
  externalSourceId?: string | null;
}

export type TransactionType =
  | "DEPOSIT" | "WITHDRAWAL" | "BUY" | "SELL" | "DIVIDEND"
  | "INTEREST" | "FEE" | "DEBT_PAYMENT" | "ADJUSTMENT";

export interface WealthTransaction extends RecordProvenance {
  id: string;
  userId: string;
  entityId: string;
  entityType: "ACCOUNT" | "INVESTMENT" | "ESOP" | "ASSET" | "LIABILITY" | "BROKERAGE";
  type: TransactionType;
  amount: number;
  units?: number | null;
  effectiveAt: Date;
  note?: string | null;
  immutable: true;
}

export interface Valuation extends RecordProvenance {
  id: string;
  userId: string;
  entityId: string;
  value: number;
  effectiveAt: Date;
  confidence?: number | null;
}

export interface NetWorthSnapshot {
  id: string;
  userId: string;
  capturedAt: Date;
  currency: CurrencyCode;
  totalAssets: number;
  totalLiabilities: number;
  netWorth: number;
  contributions: number;
  withdrawals: number;
  marketMovement: number;
  income: number;
  debtReduction: number;
}

export interface FinancialGoal {
  id: string;
  userId: string;
  name: string;
  targetAmount: number;
  targetDate: Date;
  linkedEntityIds: string[];
  requiredMonthlyContribution: number;
  probabilityPercent: number | null;
}

export interface RecurringCashFlow {
  id: string;
  userId: string;
  name: string;
  kind: "INCOME" | "EXPENSE" | "EMI" | "SUBSCRIPTION" | "PREMIUM";
  amount: number;
  currency: CurrencyCode;
  cadence: "WEEKLY" | "MONTHLY" | "QUARTERLY" | "YEARLY";
  nextDueAt: Date;
}

export interface DataConnection {
  id: string;
  userId: string;
  provider: string;
  status: "CONNECTED" | "SYNCING" | "STALE" | "ERROR" | "DISCONNECTED";
  lastSyncedAt: Date | null;
  lastError?: string | null;
}

/**
 * Contracts for the historical wealth engine.
 *
 * The NetWorthSnapshot contract below is now WIRED — see features/tracking/
 * snapshot.{model,repository,service,actions}.ts. The remaining contracts
 * (WealthTransaction event ledger, FinancialGoal, RecurringCashFlow) are still
 * forward-declared for a later vertical slice and are not yet persisted.
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

/** How a snapshot came to exist. Distinguishes auto-captured from corrected rows. */
export type SnapshotSource = "MANUAL" | "IMPORTED" | "EDITED";

/** The editable cells from the monthly wealth sheet. Derived totals are never stored as inputs. */
export interface MonthlyWealthValues {
  cash: number;
  indianStocks: number;
  usStocks: number;
  cryptoCurrency: number;
  etfs: number;
  reits: number;
  digitalGold: number;
  creditCardLoans: number;
  loans: number;
  sbiBank: number;
  jioPaymentsBank: number;
  axisBank: number;
  mutualFunds: number;
  ppf: number;
  rdFd: number;
  nps: number;
  epfo: number;
  equityCryptoPnl: number;
  lifeInsurance: number;
  healthInsurance: number;
}

export interface MonthlyWealthMetrics {
  inHand: number;
  cashExcludingSalary: number;
  midTerm: number;
  longTerm: number;
  totalDebts: number;
  netWorth: number;
  totalWorth: number;
}

/**
 * Per-class value split retained on each snapshot so the timeline can show
 * composition over time and XIRR can fall back to snapshot history for
 * manual-only holdings. Mirrors NetWorthOverview.totals plus liabilities.
 */
export interface SnapshotBreakdown {
  accounts: number;
  investments: number;
  brokerage: number;
  esops: number;
  assets: number;
  liabilities: number;
  creditCard: number;
}

export interface NetWorthSnapshot {
  id: string;
  userId: string;
  capturedAt: Date;
  /** Month bucket "YYYY-MM" — the idempotency key (one snapshot per user per month). */
  periodKey: string;
  currency: CurrencyCode;
  totalAssets: number;
  totalLiabilities: number;
  netWorth: number;
  breakdown: SnapshotBreakdown;
  values: MonthlyWealthValues | null;
  metrics: MonthlyWealthMetrics | null;
  // Attribution deltas vs the previous snapshot (0 when not derivable).
  contributions: number;
  withdrawals: number;
  marketMovement: number;
  income: number;
  debtReduction: number;
  source: SnapshotSource;
  note: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** A single point the dashboard timeline renders. */
export interface SnapshotTimelinePoint {
  periodKey: string;
  capturedAt: Date;
  netWorth: number;
  totalAssets: number;
  totalLiabilities: number;
}

export interface CaptureSnapshotInput {
  /** Defaults to now; pass an explicit month-end when backfilling. */
  asOf?: Date;
  source?: SnapshotSource;
  /** Overwrite an existing period's row (manual re-capture). Default false. */
  overwrite?: boolean;
}

export interface SaveMonthlySnapshotInput {
  capturedAt: Date;
  values: MonthlyWealthValues;
  note?: string | null;
}

/** Editable fields for a manual correction. */
export interface EditSnapshotInput {
  totalAssets?: number;
  totalLiabilities?: number;
  breakdown?: Partial<SnapshotBreakdown>;
  note?: string | null;
}

/** One parsed row of the monthly net-worth CSV backfill. */
export interface SnapshotCsvRow {
  periodKey: string;
  capturedAt: Date;
  breakdown: SnapshotBreakdown;
  totalAssets: number;
  totalLiabilities: number;
  /** Authoritative net worth from the CSV when present; else computed. */
  netWorth: number;
  values: MonthlyWealthValues;
  metrics: MonthlyWealthMetrics;
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

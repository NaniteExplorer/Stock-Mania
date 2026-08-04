export type AccountType = "BANK" | "CASH" | "WALLET" | "CREDIT_CARD" | "FIXED_DEPOSIT" | "RECURRING_DEPOSIT" | "PPF" | "NPS" | "EPFO";

export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  BANK: "Bank account",
  CASH: "Cash",
  WALLET: "Wallet",
  CREDIT_CARD: "Credit card",
  FIXED_DEPOSIT: "Fixed deposit",
  RECURRING_DEPOSIT: "Recurring deposit",
  PPF: "Public Provident Fund",
  NPS: "National Pension System",
  EPFO: "Employees' Provident Fund",
};

/** Credit cards are tracked as accounts but represent debt, not assets. */
export const LIABILITY_ACCOUNT_TYPES: AccountType[] = ["CREDIT_CARD"];

export interface Account {
  id: string;
  userId: string;
  name: string;
  institution: string;
  providerId: string | null;
  currency: string;
  type: AccountType;
  balance: number;
  balanceAsOf: Date | null;
  last4: string | null;
  /** Annual interest % for FD/RD/PPF/EPF — the accrual job grows the balance daily. */
  interestRatePercent: number | null;
  lastAccruedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateAccountInput {
  name: string;
  institution: string;
  providerId?: string | null;
  currency?: string;
  type: AccountType;
  balance: number;
  last4?: string | null;
  interestRatePercent?: number | null;
}

export type UpdateAccountInput = Partial<CreateAccountInput>;

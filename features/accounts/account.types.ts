export type AccountType = "BANK" | "CASH" | "WALLET" | "FIXED_DEPOSIT" | "RECURRING_DEPOSIT" | "PPF" | "NPS" | "EPFO";

export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  BANK: "Bank account",
  CASH: "Cash",
  WALLET: "Wallet",
  FIXED_DEPOSIT: "Fixed deposit",
  RECURRING_DEPOSIT: "Recurring deposit",
  PPF: "Public Provident Fund",
  NPS: "National Pension System",
  EPFO: "Employees' Provident Fund",
};

export interface Account {
  id: string;
  userId: string;
  name: string;
  institution: string;
  providerId: string | null;
  currency: string;
  type: AccountType;
  balance: number;
  last4: string | null;
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
}

export type UpdateAccountInput = Partial<CreateAccountInput>;

import type { CategorySource } from "./transaction.categories";

export type TransactionDirection = "CREDIT" | "DEBIT";
export type TransactionSource = "MANUAL" | "STATEMENT_IMPORT";

export interface AccountTransaction {
  id: string;
  accountId: string;
  userId: string;
  transactionDate: Date;
  description: string;
  reference: string | null;
  amount: number;
  direction: TransactionDirection;
  balanceAfter: number | null;
  currency: string;
  category: string | null;
  categorySource: CategorySource | null;
  source: TransactionSource;
  sourceFile: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ParsedStatementRow {
  transactionDate: string;
  description: string;
  reference?: string | null;
  amount: number;
  direction: TransactionDirection;
  balanceAfter?: number | null;
  currency?: string;
  occurrence?: number;
}

export interface StatementImportResult {
  success: boolean;
  inserted: number;
  skipped: number;
  rejected: number;
  balanceUpdated: boolean;
  error?: string;
}

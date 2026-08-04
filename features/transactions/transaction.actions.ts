"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { getCurrentSession } from "@/lib/better-auth/auth";
import { logger } from "@/core/logger";
import { userPreferencesService } from "@/features/user/user.preferences";
import { transactionService, type SpendSummary, type SpendTrendMonth } from "./transaction.service";
import { budgetService, type BudgetItem } from "./budget.service";
import { extractPdfText, PdfPasswordError } from "./pdf-parser";
import { parseStatementText } from "./ai-statement.service";
import { isTransactionCategory } from "./transaction.categories";
import { parseInput } from "@/core/validation/parse";
import {
  importStatementSchema,
  objectIdSchema,
  setBudgetSchema,
  transactionQuerySchema,
} from "./transaction.schema";
import type { AccountTransaction, ParsedStatementRow, StatementImportResult } from "./transaction.types";

export interface ParseUploadResult {
  success: boolean;
  rows?: ParsedStatementRow[];
  error?: string;
  needsPassword?: boolean;
}

/**
 * Server-side parse for PDF statements: extract text (pdfjs) then structure it
 * with Gemini into normalized rows for the existing preview + dedup import.
 * Non-PDF formats are parsed in the browser by parseStatementFile().
 */
export async function parseStatementUpload(formData: FormData): Promise<ParseUploadResult> {
  const session = await getCurrentSession();
  if (!session?.user?.id) return { success: false, error: "You must be signed in." };

  const file = formData.get("file");
  if (!(file instanceof File)) return { success: false, error: "No file was uploaded." };
  if (file.size > 8 * 1024 * 1024) return { success: false, error: "PDF is too large (max 8 MB)." };

  const password = String(formData.get("password") ?? "");
  const currency = String(formData.get("currency") ?? "INR").toUpperCase();

  try {
    const data = new Uint8Array(await file.arrayBuffer());
    const text = await extractPdfText(data, password);
    const rows = await parseStatementText(text, currency);
    if (!rows.length) {
      return { success: false, error: "No transactions were found in this PDF." };
    }
    return { success: true, rows };
  } catch (error) {
    if (error instanceof PdfPasswordError) {
      return { success: false, needsPassword: true, error: error.message };
    }
    logger.error("PDF statement parse failed", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "The statement could not be parsed.",
    };
  }
}

export async function importAccountStatement(accountId: string, fileName: string, rows: ParsedStatementRow[]): Promise<StatementImportResult> {
  const session = await getCurrentSession();
  if (!session?.user?.id) return { success: false, inserted: 0, skipped: 0, rejected: rows.length, balanceUpdated: false, error: "You must be signed in." };
  const parsed = parseInput(importStatementSchema, { accountId, fileName, rows });
  if (!parsed.success) return { success: false, inserted: 0, skipped: 0, rejected: rows.length, balanceUpdated: false, error: parsed.error };
  try {
    const result = await transactionService.importStatement(session.user.id, parsed.data.accountId, parsed.data.fileName, parsed.data.rows);
    if (result.success) {
      // Re-run the keyword categorizer over everything (skips manual overrides) and
      // recompute balances — so importing fixes categories AND balances in one go,
      // including rows imported before the rules/balance parsing improved.
      try {
        await transactionService.reprocess(session.user.id);
      } catch (reprocessError) {
        logger.warn("post-import reprocess failed (non-fatal)", { reprocessError });
      }
    }
    revalidatePath("/accounts"); revalidatePath("/dashboard"); revalidatePath("/transactions"); revalidatePath("/spends");
    return result;
  } catch (error) {
    logger.error("Statement import failed", error);
    return { success: false, inserted: 0, skipped: 0, rejected: rows.length, balanceUpdated: false, error: "The statement could not be imported." };
  }
}

/** Delete a single transaction. */
export async function deleteTransaction(id: string): Promise<{ success: boolean; error?: string }> {
  const session = await getCurrentSession();
  if (!session?.user?.id) return { success: false, error: "You must be signed in." };
  const parsedId = parseInput(objectIdSchema, id);
  if (!parsedId.success) return { success: false, error: parsedId.error };
  try {
    await transactionService.remove(parsedId.data, session.user.id);
    revalidatePath("/transactions"); revalidatePath("/spends"); revalidatePath("/accounts"); revalidatePath("/dashboard");
    return { success: true };
  } catch (error) {
    logger.error("deleteTransaction failed", error);
    return { success: false, error: "Could not delete the transaction." };
  }
}

/** Bulk delete — all transactions, or only a given account's. */
export async function deleteAllTransactions(accountId?: string): Promise<{ success: boolean; deleted?: number; error?: string }> {
  const session = await getCurrentSession();
  if (!session?.user?.id) return { success: false, error: "You must be signed in." };
  if (accountId !== undefined) {
    const parsedId = parseInput(objectIdSchema, accountId);
    if (!parsedId.success) return { success: false, error: parsedId.error };
  }
  try {
    const deleted = await transactionService.removeMany(session.user.id, accountId);
    revalidatePath("/transactions"); revalidatePath("/spends"); revalidatePath("/accounts"); revalidatePath("/dashboard");
    return { success: true, deleted };
  } catch (error) {
    logger.error("deleteAllTransactions failed", error);
    return { success: false, error: "Could not delete transactions." };
  }
}

/** Re-run keyword categorization rules over existing transactions + recompute balances. */
export async function reprocessTransactions(): Promise<{ success: boolean; recategorized?: number; balancesUpdated?: number; error?: string }> {
  const session = await getCurrentSession();
  if (!session?.user?.id) return { success: false, error: "You must be signed in." };
  try {
    const result = await transactionService.reprocess(session.user.id);
    revalidatePath("/transactions"); revalidatePath("/accounts"); revalidatePath("/spends"); revalidatePath("/dashboard");
    return { success: true, ...result };
  } catch (error) {
    logger.error("reprocessTransactions failed", error);
    return { success: false, error: "Could not reprocess transactions." };
  }
}

/** Server-side paginated + filtered transactions — scales to any history size. */
export async function queryTransactions(
  query: import("./transaction.service").TransactionQuery,
): Promise<{ transactions: AccountTransaction[]; total: number; grandTotal: number }> {
  const session = await getCurrentSession();
  if (!session?.user?.id) return { transactions: [], total: 0, grandTotal: 0 };
  const parsed = parseInput(transactionQuerySchema, query);
  if (!parsed.success) return { transactions: [], total: 0, grandTotal: 0 };
  try {
    const [{ rows, total }, grandTotal] = await Promise.all([
      transactionService.query(session.user.id, parsed.data),
      transactionService.count(session.user.id),
    ]);
    return { transactions: rows, total, grandTotal };
  } catch (error) {
    logger.error("queryTransactions failed", error);
    return { transactions: [], total: 0, grandTotal: 0 };
  }
}

export async function getSpendSummary(sinceDays = 90): Promise<SpendSummary | null> {
  const session = await getCurrentSession();
  if (!session?.user?.id) return null;
  try {
    return await transactionService.spendSummary(session.user.id, sinceDays);
  } catch (error) {
    logger.error("getSpendSummary failed", error);
    return null;
  }
}

export async function getSpendTrend(months = 6): Promise<SpendTrendMonth[]> {
  const session = await getCurrentSession();
  if (!session?.user?.id) return [];
  try {
    return await transactionService.spendTrend(session.user.id, months);
  } catch (error) {
    logger.error("getSpendTrend failed", error);
    return [];
  }
}

export async function getMyBudgets(): Promise<BudgetItem[]> {
  const session = await getCurrentSession();
  if (!session?.user?.id) return [];
  try {
    return await budgetService.list(session.user.id);
  } catch (error) {
    logger.error("getMyBudgets failed", error);
    return [];
  }
}

export async function setBudget(category: string, monthlyLimit: number): Promise<{ success: boolean; error?: string }> {
  const session = await getCurrentSession();
  if (!session?.user?.id) return { success: false, error: "You must be signed in." };
  const parsed = parseInput(setBudgetSchema, { category, monthlyLimit });
  if (!parsed.success) return { success: false, error: parsed.error };
  if (!isTransactionCategory(parsed.data.category)) return { success: false, error: "Unknown category." };
  try {
    await budgetService.set(session.user.id, parsed.data.category, parsed.data.monthlyLimit);
    revalidatePath("/spends");
    return { success: true };
  } catch (error) {
    logger.error("setBudget failed", error);
    return { success: false, error: "Could not save the budget." };
  }
}

const categoryRulesSchema = z.array(
  z.object({
    keyword: z.string().trim().min(1).max(80),
    category: z.string().trim().min(1).max(40),
  }),
).max(500);

/** Fetch the user's saved keyword→category rules. */
export async function getCategoryRules(): Promise<{ keyword: string; category: string }[]> {
  const session = await getCurrentSession();
  if (!session?.user?.id) return [];
  try {
    const prefs = await userPreferencesService.get(session.user.id);
    return prefs.categoryRules;
  } catch (error) {
    logger.error("getCategoryRules failed", error);
    return [];
  }
}

/**
 * Replace the user's keyword→category rules and immediately re-categorise all
 * non-manual transactions with them. Returns how many rows changed so the UI
 * can confirm the impact.
 */
export async function saveCategoryRules(
  rules: { keyword: string; category: string }[],
): Promise<{ success: boolean; recategorized?: number; error?: string }> {
  const session = await getCurrentSession();
  if (!session?.user?.id) return { success: false, error: "You must be signed in." };
  const parsed = categoryRulesSchema.safeParse(rules);
  if (!parsed.success) return { success: false, error: "Each rule needs a keyword (≤80 chars) and a category." };
  const invalid = parsed.data.find((rule) => !isTransactionCategory(rule.category));
  if (invalid) return { success: false, error: `Unknown category: ${invalid.category}.` };

  // De-duplicate on the normalized keyword, keeping the last-wins entry.
  const deduped = [...new Map(parsed.data.map((rule) => [rule.keyword.toLowerCase(), rule])).values()];

  try {
    await userPreferencesService.update(session.user.id, { categoryRules: deduped });
    const result = await transactionService.reprocess(session.user.id);
    revalidatePath("/transactions"); revalidatePath("/spends"); revalidatePath("/accounts"); revalidatePath("/dashboard");
    return { success: true, recategorized: result.recategorized };
  } catch (error) {
    logger.error("saveCategoryRules failed", error);
    return { success: false, error: "Could not save the keyword rules." };
  }
}

/** Manual category override for a single transaction. */
export async function setTransactionCategory(
  id: string,
  category: string,
): Promise<{ success: boolean; error?: string }> {
  const session = await getCurrentSession();
  if (!session?.user?.id) return { success: false, error: "You must be signed in." };
  const parsedId = parseInput(objectIdSchema, id);
  if (!parsedId.success) return { success: false, error: parsedId.error };
  if (!isTransactionCategory(category)) return { success: false, error: "Unknown category." };
  try {
    await transactionService.setCategory(parsedId.data, session.user.id, category);
    revalidatePath("/accounts"); revalidatePath("/dashboard");
    return { success: true };
  } catch (error) {
    logger.error("setTransactionCategory failed", error);
    return { success: false, error: "Could not update the category." };
  }
}

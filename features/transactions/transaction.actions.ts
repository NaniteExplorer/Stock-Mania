"use server";

import { revalidatePath } from "next/cache";
import { getCurrentSession } from "@/lib/better-auth/auth";
import { logger } from "@/core/logger";
import { eventBus } from "@/core/queue/event-bus";
import { transactionService } from "./transaction.service";
import { extractPdfText, PdfPasswordError } from "./pdf-parser";
import { parseStatementText } from "./ai-statement.service";
import { isTransactionCategory } from "./transaction.categories";
import type { ParsedStatementRow, StatementImportResult } from "./transaction.types";

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
  try {
    const result = await transactionService.importStatement(session.user.id, accountId, fileName, rows);
    // Kick off async AI categorization for rows the rules engine left null.
    if (result.success && result.inserted > 0) {
      try {
        await eventBus.publish({ name: "app/transactions.imported", data: { userId: session.user.id, accountId } });
      } catch (publishError) {
        logger.warn("transactions.imported publish failed (non-fatal)", { publishError });
      }
    }
    revalidatePath("/accounts"); revalidatePath("/dashboard");
    return result;
  } catch (error) {
    logger.error("Statement import failed", error);
    return { success: false, inserted: 0, skipped: 0, rejected: rows.length, balanceUpdated: false, error: "The statement could not be imported." };
  }
}

/** Manual category override for a single transaction. */
export async function setTransactionCategory(
  id: string,
  category: string,
): Promise<{ success: boolean; error?: string }> {
  const session = await getCurrentSession();
  if (!session?.user?.id) return { success: false, error: "You must be signed in." };
  if (!isTransactionCategory(category)) return { success: false, error: "Unknown category." };
  try {
    await transactionService.setCategory(id, session.user.id, category);
    revalidatePath("/accounts"); revalidatePath("/dashboard");
    return { success: true };
  } catch (error) {
    logger.error("setTransactionCategory failed", error);
    return { success: false, error: "Could not update the category." };
  }
}

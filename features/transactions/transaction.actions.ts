"use server";

import { revalidatePath } from "next/cache";
import { getCurrentSession } from "@/lib/better-auth/auth";
import { logger } from "@/core/logger";
import { transactionService } from "./transaction.service";
import type { ParsedStatementRow, StatementImportResult } from "./transaction.types";

export async function importAccountStatement(accountId: string, fileName: string, rows: ParsedStatementRow[]): Promise<StatementImportResult> {
  const session = await getCurrentSession();
  if (!session?.user?.id) return { success: false, inserted: 0, skipped: 0, rejected: rows.length, balanceUpdated: false, error: "You must be signed in." };
  try {
    const result = await transactionService.importStatement(session.user.id, accountId, fileName, rows);
    revalidatePath("/accounts"); revalidatePath("/dashboard");
    return result;
  } catch (error) {
    logger.error("Statement import failed", error);
    return { success: false, inserted: 0, skipped: 0, rejected: rows.length, balanceUpdated: false, error: "The statement could not be imported." };
  }
}

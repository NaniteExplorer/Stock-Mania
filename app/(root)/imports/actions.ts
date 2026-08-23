"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { AccountId } from "@/domain/accounts";
import { currentUserId, ensureSeeded, services } from "@/infra/container";
import { StatementParseError, parseStatementFile } from "@/infra/statements";

export interface ImportActionState {
  ok: boolean;
  message: string;
}

/**
 * Uploads and stages a statement.
 *
 * The file is hashed here, from its bytes, and the hash is what invariant I02
 * keys on: re-uploading the identical file stages nothing and says so. Hashing
 * the *bytes* rather than the parsed rows is deliberate — a parser change must
 * not make yesterday's file look new.
 *
 * Nothing is posted. The action ends by redirecting to the review step, which is
 * the only place a row can be confirmed.
 */
export async function stageStatementAction(
  _previous: ImportActionState | null,
  formData: FormData,
): Promise<ImportActionState> {
  const accountId = formData.get("accountId");
  const file = formData.get("file");

  if (typeof accountId !== "string" || !z.string().uuid().safeParse(accountId).success) {
    return { ok: false, message: "Choose the account this statement belongs to." };
  }
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, message: "Choose a CSV, XLSX or OFX file." };
  }

  const userId = await currentUserId();
  await ensureSeeded(userId);

  const bytes = new Uint8Array(await file.arrayBuffer());
  const fileHash = createHash("sha256").update(bytes).digest("hex");

  let statement;
  try {
    statement = await parseStatementFile(file);
  } catch (error) {
    if (error instanceof StatementParseError) return { ok: false, message: error.message };
    throw error;
  }

  const staged = await services().banking.stageImport.execute({
    userId,
    accountId: AccountId.from(accountId),
    fileName: file.name,
    fileHash,
    statement,
  });

  if (!staged.ok) return { ok: false, message: staged.error.message };

  if (staged.value.alreadyImportedBatchId) {
    return {
      ok: false,
      message:
        `This exact file has already been imported. Open batch ` +
        `${staged.value.alreadyImportedBatchId.slice(0, 8)} to see what it did.`,
    };
  }

  revalidatePath("/imports");
  redirect(`/imports/${staged.value.batchId}`);
}

const batchSchema = z.object({ batchId: z.string().uuid() });

/** Confirms every categorised row the matcher did not flag. */
export async function confirmUnmatchedAction(formData: FormData): Promise<void> {
  const { batchId } = batchSchema.parse(Object.fromEntries(formData));
  const userId = await currentUserId();
  await services().banking.confirmUnmatched.execute({ userId, batchId });
  revalidatePath(`/imports/${batchId}`);
}

/** Confirms or rejects one row. */
export async function reviewRowAction(formData: FormData): Promise<void> {
  const parsed = z
    .object({
      batchId: z.string().uuid(),
      rowId: z.string().uuid(),
      decision: z.enum(["CONFIRM", "REJECT"]),
      accountId: z.string().uuid().optional().or(z.literal("")),
    })
    .parse(Object.fromEntries(formData));

  const userId = await currentUserId();
  await services().banking.reviewRow.execute({
    userId,
    batchId: parsed.batchId,
    rowId: parsed.rowId,
    decision: parsed.decision,
    accountId: parsed.accountId ? AccountId.from(parsed.accountId) : undefined,
  });
  revalidatePath(`/imports/${parsed.batchId}`);
}

/** Posts the confirmed rows — the one path from a staged row to the ledger. */
export async function postBatchAction(formData: FormData): Promise<void> {
  const { batchId } = batchSchema.parse(Object.fromEntries(formData));
  const userId = await currentUserId();
  await services().banking.postBatch.execute({ userId, batchId });
  revalidatePath(`/imports/${batchId}`);
  revalidatePath("/transactions");
  revalidatePath("/accounts");
  revalidatePath("/dashboard");
}

/** Tombstones everything the batch posted, and frees its file hash. */
export async function undoBatchAction(formData: FormData): Promise<void> {
  const { batchId } = batchSchema.parse(Object.fromEntries(formData));
  const userId = await currentUserId();
  await services().banking.undoImport.execute({ userId, batchId });
  revalidatePath(`/imports/${batchId}`);
  revalidatePath("/transactions");
  revalidatePath("/accounts");
  revalidatePath("/dashboard");
}

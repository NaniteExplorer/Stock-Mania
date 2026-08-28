"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { UserId } from "@/core/kernel";
import { AccountCode, AccountId } from "@/domain/accounts";
import { currentUserId, ensureSeeded, services } from "@/infra/container";
import { StatementParseError, parseStatementFile } from "@/infra/statements";
import { COUNTER_ACCOUNT_KINDS, counterAccountKindNames } from "./counter-accounts";
import { fail, ok, type ActionState } from "@/ui/action-state";

export type { ActionState } from "@/ui/action-state";

/** Kept as an alias so the upload form's existing prop type still reads right. */
export type ImportActionState = ActionState;

function revalidateBatch(batchId: string) {
  revalidatePath("/imports");
  revalidatePath(`/imports/${batchId}`);
}

function revalidateLedger(batchId: string) {
  revalidateBatch(batchId);
  revalidatePath("/transactions");
  revalidatePath("/accounts");
  revalidatePath("/dashboard");
  revalidatePath("/budgets");
}

/**
 * Uploads and stages a statement.
 *
 * The file is hashed here, from its bytes, and the hash is what invariant I02
 * keys on: re-uploading the identical file stages nothing and says so. Hashing
 * the *bytes* rather than the parsed rows is deliberate — a parser change must
 * not make yesterday's file look new.
 *
 * `allowReimport` is the escape hatch, and it is a deliberate one rather than a
 * loosening of I02: a user who genuinely wants the same bytes staged twice (a
 * batch erased by mistake, a statement re-filed against a different account)
 * previously had no route at all, and would resort to editing the file to change
 * its hash — which defeats the duplicate check for every *future* upload of it.
 *
 * Nothing is posted. The action ends by redirecting to the review step, which is
 * the only place a row can be confirmed.
 */
export async function stageStatementAction(
  _previous: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  const accountId = formData.get("accountId");
  const file = formData.get("file");
  const allowReimport = formData.get("allowReimport") === "on";

  if (typeof accountId !== "string" || !z.string().uuid().safeParse(accountId).success) {
    return fail("Choose the account this statement belongs to.", { accountId: ["Required"] });
  }
  if (!(file instanceof File) || file.size === 0) {
    return fail("Choose a CSV, XLSX, PDF or OFX file.", { file: ["Required"] });
  }

  const userId = await currentUserId();
  await ensureSeeded(userId);

  const bytes = new Uint8Array(await file.arrayBuffer());
  const fileHash = createHash("sha256").update(bytes).digest("hex");

  let statement;
  try {
    statement = await parseStatementFile(file);
  } catch (error) {
    if (error instanceof StatementParseError) return fail(error.message);
    throw error;
  }

  const staged = await services().banking.stageImport.execute({
    userId,
    accountId: AccountId.from(accountId),
    fileName: file.name,
    fileHash,
    statement,
    allowReimport,
  });

  if (!staged.ok) return fail(staged.error.message);

  if (staged.value.alreadyImportedBatchId) {
    return fail(
      "This exact file has already been imported as batch " +
        staged.value.alreadyImportedBatchId.slice(0, 8) +
        '. Tick "import it anyway" to stage it a second time.',
    );
  }

  revalidatePath("/imports");
  redirect(`/imports/${staged.value.batchId}`);
}

const batchSchema = z.object({ batchId: z.string().uuid() });

/** Confirms every categorised row the matcher did not flag. */
export async function confirmUnmatchedAction(
  _previous: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  const parsed = batchSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail("Unknown import batch.");

  const userId = await currentUserId();
  // ConfirmUnmatchedRows cannot fail — it skips what it cannot decide rather
  // than erroring, so there is no error branch to handle here.
  const result = await services().banking.confirmUnmatched.execute({
    userId,
    batchId: parsed.data.batchId,
  });

  revalidateBatch(parsed.data.batchId);
  const { confirmed, needingChoice } = result.value;
  return ok(
    needingChoice > 0
      ? `${confirmed} confirmed. ${needingChoice} still need an account chosen.`
      : `${confirmed} row${confirmed === 1 ? "" : "s"} confirmed.`,
  );
}

/** Confirms safe rows and infers obvious transfer counter-accounts. */
export async function smartReviewAction(
  _previous: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  const parsed = batchSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail("Unknown import batch.");

  const userId = await currentUserId();
  const result = await services().banking.smartReview.execute({
    userId,
    batchId: parsed.data.batchId,
  });
  if (!result.ok) return fail(result.error.message);

  revalidateBatch(parsed.data.batchId);
  const { confirmed, inferredTransfers, needingChoice } = result.value;
  return ok(
    `${confirmed} confirmed, ${inferredTransfers} transfer${inferredTransfers === 1 ? "" : "s"} ` +
      `matched up, ${needingChoice} left for you.`,
  );
}

/** Bulk path for first imports: smart-review what is safe, then post confirmed rows. */
export async function smartReviewAndPostAction(
  _previous: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  const parsed = batchSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail("Unknown import batch.");

  const userId = await currentUserId();
  const reviewed = await services().banking.smartReview.execute({
    userId,
    batchId: parsed.data.batchId,
  });
  if (!reviewed.ok) return fail(reviewed.error.message);

  const posted = await services().banking.postBatch.execute({
    userId,
    batchId: parsed.data.batchId,
  });
  if (!posted.ok) return fail(posted.error.message);

  revalidateLedger(parsed.data.batchId);
  return ok(
    `${posted.value.posted} posted. ${reviewed.value.needingChoice} row(s) still need a choice.`,
  );
}

const decisionSchema = z.object({
  batchId: z.string().uuid(),
  rowId: z.string().uuid(),
  decision: z.enum(["CONFIRM", "REJECT", "RESET"]),
  accountId: z.string().uuid().optional().or(z.literal("")),
});

/**
 * Confirms, rejects or *un-decides* one row.
 *
 * `RESET` is the control this screen was missing. A row confirmed or skipped by
 * mistake was unrecoverable short of undoing the whole import and uploading the
 * file again — the review table rendered a decided row as plain text, so there
 * was nothing left to click. A decision is only genuinely irreversible once the
 * row has been posted, and that is the one case refused here.
 */
export async function reviewRowAction(
  _previous: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  const parsed = decisionSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail("That row could not be read.");

  const userId = await currentUserId();
  const { batchId, rowId, decision } = parsed.data;

  if (decision === "RESET") {
    const result = await resetRows(userId, batchId, [rowId]);
    if (!result.ok) return result;
    revalidateBatch(batchId);
    return ok("Decision undone — the row is back under review.");
  }

  const result = await services().banking.reviewRow.execute({
    userId,
    batchId,
    rowId,
    decision,
    accountId: parsed.data.accountId ? AccountId.from(parsed.data.accountId) : undefined,
  });
  if (!result.ok) return fail(result.error.message);

  revalidateBatch(batchId);
  return ok(decision === "CONFIRM" ? "Row confirmed." : "Row skipped.");
}

const bulkSchema = z.object({
  batchId: z.string().uuid(),
  decision: z.enum(["CONFIRM", "REJECT", "RESET"]),
  accountId: z.string().uuid().optional().or(z.literal("")),
});

/**
 * The same three decisions, applied to every ticked row.
 *
 * Failures are collected rather than thrown: a hundred-row selection where two
 * transfers lack a counter-account should confirm the ninety-eight and say which
 * two it could not, not abort halfway and leave the user to work out where it
 * stopped.
 */
export async function bulkReviewRowsAction(
  _previous: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  const parsed = bulkSchema.safeParse({
    batchId: formData.get("batchId"),
    decision: formData.get("decision"),
    accountId: formData.get("accountId") ?? "",
  });
  if (!parsed.success) return fail("That bulk action could not be read.");

  const rowIds = formData
    .getAll("rowId")
    .filter((value): value is string => typeof value === "string")
    .filter((value) => z.string().uuid().safeParse(value).success);

  if (rowIds.length === 0) return fail("Tick at least one row first.");

  const userId = await currentUserId();
  const { batchId, decision } = parsed.data;

  if (decision === "RESET") {
    const result = await resetRows(userId, batchId, rowIds);
    if (!result.ok) return result;
    revalidateBatch(batchId);
    return ok(`${rowIds.length} row${rowIds.length === 1 ? "" : "s"} back under review.`);
  }

  const accountId = parsed.data.accountId ? AccountId.from(parsed.data.accountId) : undefined;
  let done = 0;
  const problems: string[] = [];

  for (const rowId of rowIds) {
    const result = await services().banking.reviewRow.execute({
      userId,
      batchId,
      rowId,
      decision,
      accountId,
      rejectedReason: decision === "REJECT" ? "Skipped in bulk review" : undefined,
    });
    if (result.ok) done += 1;
    else problems.push(result.error.message);
  }

  revalidateBatch(batchId);
  const verb = decision === "CONFIRM" ? "confirmed" : "skipped";
  if (problems.length === 0) return ok(`${done} row${done === 1 ? "" : "s"} ${verb}.`);
  return {
    ok: done > 0,
    message:
      `${done} ${verb}, ${problems.length} could not be: ` +
      [...new Set(problems)].slice(0, 2).join(" "),
  };
}

/**
 * Puts rows back to `PARSED`.
 *
 * A posted row is refused: its transaction is in the ledger, and the only honest
 * way back from there is to undo the import, which reverses the postings too.
 */
async function resetRows(
  userId: UserId,
  batchId: string,
  rowIds: readonly string[],
): Promise<ActionState> {
  const { imports } = services().repositories;
  const rows = await imports.listRows(userId, batchId);
  const byId = new Map(rows.map((row) => [row.id, row]));

  const posted = new Set(
    rowIds.filter((rowId) => {
      const row = byId.get(rowId);
      return row?.status === "CONFIRMED" && row.matchedTransactionId !== null;
    }),
  );
  if (posted.size === rowIds.length) {
    return fail(
      posted.size === 1
        ? "That row is already in the ledger. Undo the import to reverse it."
        : "Those rows are already in the ledger. Undo the import to reverse them.",
    );
  }

  for (const rowId of rowIds) {
    if (posted.has(rowId) || !byId.has(rowId)) continue;
    await imports.setRowStatus(userId, rowId, {
      status: "PARSED",
      matchedTransactionId: null,
      matchPass: null,
      rejectedReason: null,
    });
  }

  return ok("Rows reopened.");
}

/** Posts the confirmed rows — the one path from a staged row to the ledger. */
export async function postBatchAction(
  _previous: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  const parsed = batchSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail("Unknown import batch.");

  const userId = await currentUserId();
  const result = await services().banking.postBatch.execute({
    userId,
    batchId: parsed.data.batchId,
  });
  if (!result.ok) return fail(result.error.message);

  revalidateLedger(parsed.data.batchId);
  const { posted, skipped } = result.value;
  return ok(
    skipped > 0
      ? `${posted} posted to the ledger, ${skipped} skipped.`
      : `${posted} row${posted === 1 ? "" : "s"} posted to the ledger.`,
  );
}

/** Tombstones everything the batch posted, and frees its file hash. */
export async function undoBatchAction(
  _previous: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  const parsed = batchSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail("Unknown import batch.");

  const userId = await currentUserId();
  const result = await services().banking.undoImport.execute({
    userId,
    batchId: parsed.data.batchId,
  });
  if (!result.ok) return fail(result.error.message);

  revalidateLedger(parsed.data.batchId);
  return ok("Import undone — every transaction it posted has been reversed.");
}

/** Hides an already-undone import so the user can start over with a clean list. */
export async function eraseUndoneBatchAction(
  _previous: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  const parsed = batchSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail("Unknown import batch.");

  const userId = await currentUserId();
  const batch = await services().repositories.imports.findBatch(userId, parsed.data.batchId);
  if (!batch) return fail("That import no longer exists.");
  if (batch.status !== "UNDONE") {
    return fail("Only an undone import can be erased. Undo it first.");
  }

  await services().repositories.imports.softDeleteBatch(userId, parsed.data.batchId, new Date());
  revalidatePath("/imports");
  return ok(`${batch.fileName} erased from the history.`);
}

const counterAccountSchema = z.object({
  batchId: z.string().uuid(),
  rowId: z.string().uuid(),
  name: z.string().trim().min(1, "Give the account a name.").max(120),
  kind: z.enum(counterAccountKindNames),
  /** Confirm the row against the new account in the same step. */
  confirmRow: z.string().optional(),
});

/**
 * Opens the missing counter-account and, optionally, confirms the row onto it.
 *
 * Doing both in one action is the point. Sending the user to `/accounts` to
 * create the account means losing the review screen's filters, its selection and
 * their place in a 700-row file — for a piece of information that is on screen
 * right now, in the narration they are looking at.
 */
export async function createCounterAccountAction(
  _previous: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  const parsed = counterAccountSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    const fieldErrors = z.flattenError(parsed.error).fieldErrors as Record<string, string[]>;
    return fail(Object.values(fieldErrors).flat()[0] ?? "Check the account.", fieldErrors);
  }

  const userId = await currentUserId();
  await ensureSeeded(userId);

  const spec = COUNTER_ACCOUNT_KINDS[parsed.data.kind];
  const parent = await services().repositories.accounts.findByCode(
    userId,
    AccountCode.parse(spec.parent),
  );

  const opened = await services().ledger.openAccount.execute({
    userId,
    name: parsed.data.name,
    type: spec.type,
    subtype: spec.subtype,
    parentId: parent?.id ?? null,
  });
  if (!opened.ok) return fail(opened.error.message);

  if (parsed.data.confirmRow) {
    const confirmed = await services().banking.reviewRow.execute({
      userId,
      batchId: parsed.data.batchId,
      rowId: parsed.data.rowId,
      decision: "CONFIRM",
      accountId: opened.value.accountId,
    });
    if (!confirmed.ok) {
      // The account is real even though the row did not take; say so rather than
      // implying nothing happened and inviting a second attempt at creating it.
      return fail(
        `${opened.value.code} was created, but the row could not be confirmed: ` +
          confirmed.error.message,
      );
    }
  }

  revalidateBatch(parsed.data.batchId);
  revalidatePath("/accounts");
  return ok(
    parsed.data.confirmRow
      ? `${opened.value.code} created, and this row confirmed against it.`
      : `${opened.value.code} created.`,
  );
}

const ruleSchema = z.object({
  batchId: z.string().uuid(),
  pattern: z.string().trim().min(2, "A rule needs at least two characters to match on.").max(120),
  accountId: z.string().uuid("Choose the category this rule should post to."),
  matchType: z.enum(["CONTAINS", "STARTS_WITH", "EXACT"]),
  appliesTo: z.enum(["ANY", "DEBIT", "CREDIT"]),
});

/**
 * Turns "this row was categorised wrong" into a rule, from the review screen.
 *
 * Correcting the row alone fixes one line of one statement; the same narration
 * arrives again next month and is miscategorised again. The rule is the durable
 * fix, and it is created from the row so the pattern arrives prefilled with the
 * text that actually appeared — the user is not left guessing what their bank
 * writes in the narration.
 */
export async function createRuleFromRowAction(
  _previous: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  const parsed = ruleSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    const fieldErrors = z.flattenError(parsed.error).fieldErrors as Record<string, string[]>;
    return fail(Object.values(fieldErrors).flat()[0] ?? "Check the rule.", fieldErrors);
  }

  const userId = await currentUserId();
  const { accounts, rules } = services().repositories;
  const account = await accounts.findById(userId, AccountId.from(parsed.data.accountId));
  if (!account) return fail("That category no longer exists.");
  if (!account.type.isIncomeStatement) {
    return fail(`${account.displayName} is not a category — pick an income or expense account.`);
  }

  const created = await rules.saveMany(userId, [
    {
      pattern: parsed.data.pattern,
      matchType: parsed.data.matchType,
      accountId: account.id,
      appliesTo: parsed.data.appliesTo,
      // Above the shipped defaults, so a rule the user wrote themselves beats a
      // built-in one that happens to match the same narration.
      priority: 10,
      isEnabled: true,
    },
  ]);

  if (created === 0) return fail(`A rule for "${parsed.data.pattern}" already exists.`);

  revalidateBatch(parsed.data.batchId);
  revalidatePath("/settings");
  return ok(`Future rows matching "${parsed.data.pattern}" will go to ${account.name}.`);
}

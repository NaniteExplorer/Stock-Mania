"use server";

import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Count } from "@/core/units";
import { TombstoneRefusedError, TransactionId, UndoRefusedError } from "@/domain/transactions";
import { InMemoryRedoCursorStore, RemoveTransactions, UndoBatch } from "@/app/ledger.usecases";
import { currentUserId, services } from "@/infra/container";
import {
  applyExclusions, bulkScopeLimit, checkBulkScope, isResolvedScope, describeRemovalRefusal, filterErrorMessage, parseFilterResult, phraseMatches, removalPhrase, removedMessage,
  type FilterErrors,
} from "./bulk-scope";
import { toTransactionQuery } from "./bulk-query";

/**
 * Filter-scoped bulk removal (task 2.5, DESIGN §7).
 *
 * The client sends the *filter*, the count it showed and the typed phrase — never
 * a list of ids. The ids are resolved here, at confirm time, from the filter; a
 * count that drifted since the dialog opened refuses. The removal is one
 * `RemoveTransactions` call, so the batch is atomic (D1) and one undoable
 * `requestId`, which is returned so the screen can offer Undo.
 *
 * Repaired after QA (2026-11-03): an impossible date is a field error, never a thrown
 * `RangeError`; `exclude` (from *Filter them out*) narrows the resolved scope; and the
 * D1 preflight refuses a scope holding a reconciled row, naming it, **before** any write.
 */

export interface BulkRemovalState {
  ok: boolean;
  message: string;
  /** The undo unit, on success. */
  requestId?: string;
  removed?: number;
  /** Why the removal did not happen; drives which refusal body the dialog shows. */
  refusal?: "INVALID" | "UNFILTERED" | "EMPTY" | "TOO_MANY" | "DRIFTED" | "PHRASE" | "RECONCILED" | "ALREADY_REMOVED" | "NOT_FOUND";
  /** On INVALID: which filter field could not be used, and why. */
  fieldErrors?: FilterErrors;
  /** The rows the ledger named in a refusal (first 20). */
  blockedIds?: string[];
  /** On DRIFTED: the count now, for "Review again". */
  actualCount?: number;
}

/** D3's class A redo cursor lives per user + session; the store is process-local. */
const redoCursors = new InMemoryRedoCursorStore();
const SESSION_COOKIE = "sm-undo-session";

async function undoSessionId(): Promise<string> {
  const jar = await cookies();
  const existing = jar.get(SESSION_COOKIE)?.value;
  if (existing && /^[0-9a-f-]{36}$/i.test(existing)) return existing;
  const fresh = randomUUID();
  jar.set(SESSION_COOKIE, fresh, { httpOnly: true, sameSite: "lax", path: "/" });
  return fresh;
}

function revalidateLedgerSurfaces() {
  revalidatePath("/transactions");
  revalidatePath("/accounts", "layout");
  revalidatePath("/dashboard");
}

const confirmSchema = z.object({
  expectedCount: z.coerce.number().int().nonnegative(),
  phrase: z.string().default(""),
});

export async function removeMatchingTransactionsAction(
  _previous: BulkRemovalState | null,
  formData: FormData,
): Promise<BulkRemovalState> {
  const raw = Object.fromEntries(formData);
  const parsed = confirmSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, message: "The confirmation was incomplete. Review again.", refusal: "DRIFTED" };
  const { filter, errors } = parseFilterResult(raw);
  // A field that could not be read refuses: dropping it would widen the scope.
  if (Object.keys(errors).length > 0) {
    return { ok: false, message: `${filterErrorMessage(errors)} Nothing was removed.`, refusal: "INVALID", fieldErrors: errors };
  }

  const userId = await currentUserId();
  const { repositories } = services();

  // Resolve the scope now, from the filter — not from anything the page sent.
  const query = toTransactionQuery(filter);
  const page = await repositories.journal.find(userId, { ...query, limit: Count(bulkScopeLimit(filter.exclude)), offset: Count(0) });
  const scope = applyExclusions(
    page.transactions.map((txn) => ({ id: txn.id.value, txn })),
    page.totalCount,
    filter.exclude,
  );
  const gate = checkBulkScope({
    filter,
    expectedCount: parsed.data.expectedCount,
    actualCount: scope.count,
    phrase: parsed.data.phrase,
  });
  if (!gate.ok) return { ok: false, message: gate.message, refusal: gate.reason, actualCount: scope.count };
  // Every accepted row must be resolved before anything is written: a partly loaded
  // scope would remove fewer rows than were confirmed and still report success.
  if (!isResolvedScope(scope)) {
    return { ok: false, message: "The scope could not be resolved in full. Nothing was removed. Review again.", refusal: "DRIFTED", actualCount: scope.count };
  }

  return removeResolvedScope(userId, scope.rows.map(({ txn }) => txn));
}

type JournalTransaction = NonNullable<Awaited<ReturnType<ReturnType<typeof services>["repositories"]["journal"]["findById"]>>>;

/**
 * The one removal path both entry points share (Batch 5): the D1 preflight, one atomic
 * `RemoveTransactions` call and one undoable `requestId`. Bulk resolves the scope from
 * the filter; the per-row action resolves a one-id scope. Nothing else writes.
 */
async function removeResolvedScope(
  userId: Awaited<ReturnType<typeof currentUserId>>,
  scope: readonly JournalTransaction[],
): Promise<BulkRemovalState> {
  const { repositories, clock } = services();
  // D1 preflight: a reconciled (L10) row anywhere in scope refuses the whole batch,
  // named, before anything is written. `RemoveTransactions` still refuses it inside the
  // write as the last line; this makes the refusal the first thing, not the last.
  const protectedIds = scope.filter((txn) => txn.postings().some((posting) => posting.isReconciled)).map((txn) => txn.id.value);
  if (protectedIds.length > 0) {
    return {
      ok: false,
      message: describeRemovalRefusal("RECONCILED", protectedIds, "before"),
      refusal: "RECONCILED",
      blockedIds: protectedIds.slice(0, 20),
    };
  }

  const ids: TransactionId[] = scope.map((txn) => txn.id);
  const result = await new RemoveTransactions(repositories.journal, clock).execute({ userId, transactionIds: ids });
  if (!result.ok) {
    const error = result.error;
    if (error instanceof TombstoneRefusedError) {
      return {
        ok: false,
        message: describeRemovalRefusal(error.reason, error.transactionIds),
        refusal: error.reason,
        blockedIds: error.transactionIds.slice(0, 20),
      };
    }
    return { ok: false, message: error.message };
  }

  revalidateLedgerSurfaces();
  return { ok: true, message: removedMessage(result.value.removed), requestId: result.value.requestId, removed: result.value.removed };
}

const singleSchema = z.object({
  transactionId: z.string().min(1).max(64),
  phrase: z.string().default(""),
});

/**
 * Per-row removal (register `Del` on the cursor row, Batch 5). The scope is one id,
 * resolved here against the ledger, then the same path as the bulk removal: D1
 * preflight, one atomic batch, one undoable `requestId` for the banner and `Ctrl+Z`.
 */
export async function removeTransactionAction(
  _previous: BulkRemovalState | null,
  formData: FormData,
): Promise<BulkRemovalState> {
  const parsed = singleSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, message: "The confirmation was incomplete. Review again.", refusal: "DRIFTED" };
  if (!phraseMatches(parsed.data.phrase, 1)) {
    return { ok: false, message: `Type “${removalPhrase(1)}” to confirm.`, refusal: "PHRASE" };
  }
  const userId = await currentUserId();
  const { repositories } = services();
  const txn = await repositories.journal.findById(userId, TransactionId.from(parsed.data.transactionId));
  if (!txn) {
    return { ok: false, message: describeRemovalRefusal("NOT_FOUND", [parsed.data.transactionId]), refusal: "NOT_FOUND", blockedIds: [parsed.data.transactionId] };
  }
  return removeResolvedScope(userId, [txn]);
}

const undoSchema = z.object({ requestId: z.string().uuid() });

/** Undo one whole batch (task 2.3) — the Undo on the toast and the banner. */
export async function undoBulkRemovalAction(
  _previous: BulkRemovalState | null,
  formData: FormData,
): Promise<BulkRemovalState> {
  const parsed = undoSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, message: "There is nothing to undo." };

  const userId = await currentUserId();
  const { repositories, clock } = services();
  const sessionId = await undoSessionId();
  const result = await new UndoBatch(repositories.journal, redoCursors, clock).execute({
    userId,
    sessionId,
    requestId: parsed.data.requestId,
  });
  if (!result.ok) {
    const error = result.error;
    return { ok: false, message: error instanceof UndoRefusedError ? error.message : "The undo was refused. Nothing was changed." };
  }
  revalidateLedgerSurfaces();
  return { ok: true, message: `Restored ${result.value.restored.toLocaleString("en-IN")} transaction${result.value.restored === 1 ? "" : "s"}.` };
}

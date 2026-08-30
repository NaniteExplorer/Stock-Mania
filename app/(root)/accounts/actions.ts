"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { Money } from "@/core/money";
import { CalendarDate } from "@/core/time";
import { AccountCode, AccountId, SystemAccountCodes } from "@/domain/accounts";
import { TransactionId } from "@/domain/transactions";
import { currentUserId, ensureSeeded, services } from "@/infra/container";
import { fail, ok, type ActionState } from "@/ui/action-state";

export type { ActionState } from "@/ui/action-state";

/**
 * Account server actions.
 *
 * The amount fields are `z.string()` and go straight into `Money.fromRupees`.
 * That is the whole reason they are strings: `z.coerce.number()` would parse
 * `"1234.56"` into a float before any of our code saw it, and the float
 * prohibition would have been defeated at the one boundary it matters most —
 * where a human types an amount.
 *
 * Every action returns an {@link ActionState}. They used to return `void` and
 * simply `return` when their parse failed, which meant a rejected edit and a
 * saved one looked identical on screen: the page revalidated, the inputs snapped
 * back to the stored values, and nothing said why.
 */

const AMOUNT = z
  .string()
  .trim()
  .regex(/^\d+(\.\d{1,2})?$/, "Enter an amount like 1234.50");

const openSchema = z.object({
  name: z.string().trim().min(1, "Give the account a name.").max(120),
  subtype: z.enum(["BANK", "SAVINGS", "WALLET", "CASH"]),
  institution: z.string().trim().max(120).optional(),
  accountNumberSuffix: z
    .string()
    .trim()
    .regex(/^\d{4}$/, "Only the last four digits.")
    .optional()
    .or(z.literal("")),
  openingBalance: AMOUNT.optional().or(z.literal("")),
  openingBalanceOn: z.string().trim().optional().or(z.literal("")),
});

function flatten(error: z.ZodError): Record<string, string[]> {
  return z.flattenError(error).fieldErrors as Record<string, string[]>;
}

function revalidateAccountSurfaces(accountId?: string) {
  revalidatePath("/accounts");
  if (accountId) revalidatePath(`/accounts/${accountId}`);
  revalidatePath("/imports");
  revalidatePath("/transactions");
  revalidatePath("/dashboard");
  revalidatePath("/budgets");
}

export async function openCashAccountAction(
  _previous: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  const parsed = openSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail("Check the form.", flatten(parsed.error));

  const userId = await currentUserId();
  await ensureSeeded(userId);

  const input = parsed.data;
  const result = await services().banking.openCashAccount.execute({
    userId,
    name: input.name,
    subtype: input.subtype,
    institution: input.institution || null,
    accountNumberSuffix: input.accountNumberSuffix || null,
    openingBalance: input.openingBalance ? Money.fromRupees(input.openingBalance) : null,
    openingBalanceOn: input.openingBalanceOn
      ? CalendarDate.parse(input.openingBalanceOn)
      : undefined,
  });

  if (!result.ok) return fail(result.error.message);

  revalidateAccountSurfaces();
  return ok(`${input.name} opened as ${result.value.code}.`);
}

const reconcileSchema = z.object({
  accountId: z.string().uuid(),
  asOf: z.string().trim().min(1, "Pick the statement date."),
  statementClosing: AMOUNT,
});

/**
 * Reconciles one account against a printed closing balance.
 *
 * Returns the difference rather than changing anything — see
 * `domain/banking.ts`'s note on why reconciliation reports instead of stamping
 * postings. {@link bookAdjustmentAction} is the separate, explicit step that
 * turns a difference the user accepts into a transaction.
 */
export async function reconcileAccountAction(
  _previous: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  const parsed = reconcileSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return fail("Enter a date and a closing balance.", flatten(parsed.error));
  }

  const userId = await currentUserId();
  const result = await services().banking.reconcile.execute({
    userId,
    accountId: AccountId.from(parsed.data.accountId),
    asOf: CalendarDate.parse(parsed.data.asOf),
    statementClosing: Money.fromRupees(parsed.data.statementClosing),
  });

  if (!result.ok) return fail(result.error.message);

  const report = result.value;
  return {
    ok: report.isReconciled,
    message: report.isReconciled
      ? `Reconciled: the ledger agrees with the statement on ${report.asOf.toISO()}.`
      : report.findings.join(" "),
  };
}

const adjustmentSchema = z.object({
  accountId: z.string().uuid(),
  asOf: z.string().trim().min(1, "Pick the date this balance is true on."),
  statementClosing: AMOUNT,
  narration: z.string().trim().max(160).optional().or(z.literal("")),
});

/**
 * Books the reconciliation difference as a real transaction.
 *
 * The other side is `Equity:Opening Balances`, which is what that account is
 * for: money that exists but whose history this ledger never saw. This is also
 * the only honest way to *correct* an opening balance — the original opening
 * transaction is not edited, because a transaction that has been posted is
 * append-only (A03), so the correction is a second posting and both stay
 * visible.
 *
 * The amount is recomputed here from the account's balance rather than taken
 * from the form. A difference the client calculated could be stale by the time
 * it arrives — an import posted in another tab is enough — and booking a stale
 * difference would leave the account wrong in a new way.
 */
export async function bookAdjustmentAction(
  _previous: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  const parsed = adjustmentSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return fail("Enter a date and the balance the statement shows.", flatten(parsed.error));
  }

  const userId = await currentUserId();
  const { accounts, balances } = services().repositories;
  const accountId = AccountId.from(parsed.data.accountId);

  const account = await accounts.findById(userId, accountId);
  if (!account) return fail("That account no longer exists.");
  if (account.isClosed) return fail(`${account.displayName} is closed. Reopen it first.`);

  const equity = await accounts.findByCode(
    userId,
    AccountCode.parse(SystemAccountCodes.openingBalances),
  );
  if (!equity) return fail("The chart of accounts has not been seeded yet.");

  const asOf = CalendarDate.parse(parsed.data.asOf);
  const target = Money.fromRupees(parsed.data.statementClosing);
  const ledger = await balances.balanceOf(userId, accountId, asOf);
  const difference = target.minus(ledger);

  if (difference.isZero) {
    return fail("There is nothing to adjust — the ledger already agrees with that balance.");
  }

  // Positive difference: the account holds more than the ledger knows, so money
  // flows in from equity. Negative: the reverse. `record` wants a positive
  // amount and takes the direction from which account is which.
  const moneyIn = difference.isPositive;
  const result = await services().ledger.record.execute({
    userId,
    fromAccountId: moneyIn ? equity.id : account.id,
    toAccountId: moneyIn ? account.id : equity.id,
    amount: difference.abs(),
    postedOn: asOf,
    narration:
      parsed.data.narration ||
      `Balance adjustment — ${account.displayName} as at ${asOf.toISO()}`,
  });

  if (!result.ok) return fail(result.error.message);

  revalidateAccountSurfaces(parsed.data.accountId);
  return ok(
    `Adjusted by ${difference.abs().toDecimalString()} — ${account.displayName} now reads ` +
      `${target.toDecimalString()} as at ${asOf.toISO()}.`,
  );
}

const editAccountSchema = z.object({
  accountId: z.string().uuid(),
  name: z.string().trim().min(1, "Give the account a name.").max(120),
  subtype: z.enum(["BANK", "SAVINGS", "WALLET", "CASH"]),
  institution: z.string().trim().max(120).optional(),
  accountNumberSuffix: z
    .string()
    .trim()
    .regex(/^\d{4}$/, "Only the last four digits.")
    .optional()
    .or(z.literal("")),
  sortOrder: z.string().trim().regex(/^-?\d{1,4}$/).optional().or(z.literal("")),
});

export async function updateCashAccountAction(
  _previous: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  const parsed = editAccountSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail("Check the account details.", flatten(parsed.error));

  const userId = await currentUserId();
  const account = await services().repositories.accounts.findById(
    userId,
    AccountId.from(parsed.data.accountId),
  );
  if (!account) return fail("That account no longer exists.");
  if (account.isSystem) {
    return fail(`${account.displayName} is maintained by the app and cannot be edited.`);
  }

  const next = account.rename(parsed.data.name).updateDetails({
    subtype: parsed.data.subtype,
    institution: parsed.data.institution || null,
    accountNumberSuffix: parsed.data.accountNumberSuffix || null,
    sortOrder: parsed.data.sortOrder ? Number(parsed.data.sortOrder) : undefined,
  });

  await services().repositories.accounts.save(next);
  revalidateAccountSurfaces(parsed.data.accountId);
  return ok(`${next.displayName} saved.`);
}

const accountIdSchema = z.object({ accountId: z.string().uuid() });

export async function closeCashAccountAction(
  _previous: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  const parsed = accountIdSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail("Unknown account.");

  const userId = await currentUserId();
  const account = await services().repositories.accounts.findById(
    userId,
    AccountId.from(parsed.data.accountId),
  );
  if (!account) return fail("That account no longer exists.");
  if (account.isSystem) return fail(`${account.displayName} is maintained by the app.`);
  if (account.isClosed) return fail(`${account.displayName} is already closed.`);

  await services().repositories.accounts.save(account.close());
  revalidateAccountSurfaces(parsed.data.accountId);
  return ok(`${account.displayName} closed. Its history is untouched.`);
}

export async function reopenCashAccountAction(
  _previous: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  const parsed = accountIdSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail("Unknown account.");

  const userId = await currentUserId();
  const account = await services().repositories.accounts.findById(
    userId,
    AccountId.from(parsed.data.accountId),
  );
  if (!account) return fail("That account no longer exists.");
  if (account.isSystem) return fail(`${account.displayName} is maintained by the app.`);
  if (!account.isClosed) return fail(`${account.displayName} is already open.`);

  await services().repositories.accounts.save(account.reopen());
  revalidateAccountSurfaces(parsed.data.accountId);
  return ok(`${account.displayName} reopened.`);
}

/** Closes several accounts in one go, from the list screen's selection. */
export async function bulkCloseAccountsAction(
  _previous: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  const ids = formData
    .getAll("accountId")
    .filter((value): value is string => typeof value === "string")
    .filter((value) => z.string().uuid().safeParse(value).success);

  if (ids.length === 0) return fail("Tick at least one account first.");
  if (ids.length > 100) return fail("Close at most 100 accounts at a time.");

  const userId = await currentUserId();
  const { accounts } = services().repositories;
  let closed = 0;
  const refused: string[] = [];

  for (const id of ids) {
    const account = await accounts.findById(userId, AccountId.from(id));
    if (!account || account.isSystem || account.isClosed) {
      if (account) refused.push(account.displayName);
      continue;
    }
    await accounts.save(account.close());
    closed += 1;
  }

  revalidateAccountSurfaces();
  if (refused.length === 0) return ok(`${closed} account${closed === 1 ? "" : "s"} closed.`);
  return {
    ok: closed > 0,
    message: `${closed} closed. Left alone: ${refused.slice(0, 3).join(", ")}.`,
  };
}

export async function deleteEmptyCashAccountAction(
  _previous: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  const parsed = accountIdSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail("Unknown account.");

  const userId = await currentUserId();
  const accountId = AccountId.from(parsed.data.accountId);
  const account = await services().repositories.accounts.findById(userId, accountId);
  if (!account) return fail("That account no longer exists.");
  if (account.isSystem) return fail(`${account.displayName} is maintained by the app.`);

  const postingCount = await services().repositories.accounts.countPostings(userId, accountId);
  if (postingCount > 0) {
    return fail(
      `${account.displayName} has ${postingCount} posting(s). Close it and delete its history ` +
        `instead — deleting an account out from under its transactions would orphan them.`,
    );
  }

  await services().repositories.accounts.softDelete(userId, accountId, new Date());
  revalidateAccountSurfaces();
  return ok(`${account.displayName} deleted.`);
}

/**
 * Deletes a closed account *and* everything posted to it.
 *
 * The most destructive control in the app, which is why it insists the account be
 * closed first: closing is a deliberate, reversible step, and requiring it means
 * this can never be the first click that goes wrong.
 */
export async function deleteCashAccountHistoryAction(
  _previous: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  const parsed = accountIdSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail("Unknown account.");

  const userId = await currentUserId();
  const accountId = AccountId.from(parsed.data.accountId);
  const account = await services().repositories.accounts.findById(userId, accountId);
  if (!account) return fail("That account no longer exists.");
  if (account.isSystem) return fail(`${account.displayName} is maintained by the app.`);
  if (!account.isClosed) {
    return fail(`Close ${account.displayName} first — deleting its history is not reversible.`);
  }

  const at = new Date();
  const reversed = await services().repositories.journal.softDeleteByAccount(userId, accountId, at);
  await services().repositories.accounts.softDelete(userId, accountId, at);
  const message = `${account.displayName} and its ${reversed} transaction(s) deleted.`;
  revalidateAccountSurfaces();

  // The user is most likely standing on this account's own page, which no longer
  // has anything to render. `redirect` throws, so the success state below is
  // reached only when this is called from the list.
  redirect("/accounts");
  return ok(message);
}

/* ═══ One transaction at a time ═══════════════════════════════════════ */

const transactionSchema = z.object({
  transactionId: z.string().uuid(),
  accountId: z.string().uuid(),
});

const bulkTransactionSchema = z.object({
  transactionIds: z.string().min(1, "Nothing was selected."),
  accountId: z.string().uuid(),
});

/**
 * Reverses one transaction — the right control for a transaction that happened
 * but was recorded wrongly.
 *
 * It posts an equal and opposite entry rather than editing the original, so both
 * the error and the correction stay on the statement. That is the whole reason
 * the ledger is append-only: a bank statement you can quietly edit is not
 * evidence of anything, and the first time a figure has to be explained to
 * somebody else, the edit is the thing you cannot explain.
 */
export async function reverseTransactionAction(
  _previous: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  const parsed = transactionSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail("Unknown transaction.");

  const userId = await currentUserId();
  const result = await services().ledger.reverse.execute({
    userId,
    transactionId: TransactionId.from(parsed.data.transactionId),
  });
  if (!result.ok) return fail(result.error.message);

  revalidateAccountSurfaces(parsed.data.accountId);
  return ok("Reversed. The original and its reversal both stay in the ledger.");
}

/**
 * Deletes one transaction — for an entry that should never have existed at all,
 * such as a duplicate from a re-import.
 *
 * Distinct from reversing on purpose. A reversal says "this happened and was
 * recorded wrongly"; a delete says "this never happened". Collapsing the two into
 * one button would mean every correction either invented a phantom pair of
 * postings or destroyed the evidence, depending on which one we picked.
 *
 * Soft, per A03 — the row keeps its `deleted_at` and drops out of every read.
 */
export async function deleteTransactionAction(
  _previous: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  const parsed = transactionSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail("Unknown transaction.");

  const userId = await currentUserId();
  const { journal } = services().repositories;
  const transactionId = TransactionId.from(parsed.data.transactionId);

  const existing = await journal.findById(userId, transactionId);
  if (!existing) return fail("That transaction is already gone.");

  await journal.softDelete(userId, transactionId, new Date());
  revalidateAccountSurfaces(parsed.data.accountId);
  return ok(`Deleted ${existing.description}.`);
}

/**
 * Deletes the selected transactions.
 *
 * One at a time through the repository rather than one bulk `UPDATE … IN (…)`:
 * the count reported back has to be the number actually tombstoned, and a
 * transaction that vanished between the page rendering and the click should be
 * skipped rather than silently inflating the total.
 */
export async function bulkDeleteTransactionsAction(
  _previous: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  const parsed = bulkTransactionSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail("Select at least one transaction.");

  const userId = await currentUserId();
  const { journal } = services().repositories;
  const at = new Date();

  const ids = parsed.data.transactionIds.split(",").filter(Boolean);
  if (ids.length > 500) return fail("Delete at most 500 transactions at a time.");
  if (ids.some((id) => !z.string().uuid().safeParse(id).success)) {
    return fail("The transaction selection is invalid.");
  }

  let deleted = 0;
  for (const id of ids) {
    const transactionId = TransactionId.from(id);
    if (await journal.findById(userId, transactionId)) {
      await journal.softDelete(userId, transactionId, at);
      deleted += 1;
    }
  }

  if (deleted === 0) return fail("Those transactions are already gone.");
  revalidateAccountSurfaces(parsed.data.accountId);
  return ok(`${deleted} transaction(s) deleted.`);
}

"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Money } from "@/core/money";
import { CalendarDate } from "@/core/time";
import { AccountId } from "@/domain/accounts";
import { currentUserId, ensureSeeded, services } from "@/infra/container";

/**
 * Account server actions.
 *
 * The amount fields are `z.string()` and go straight into `Money.fromRupees`.
 * That is the whole reason they are strings: `z.coerce.number()` would parse
 * `"1234.56"` into a float before any of our code saw it, and the float
 * prohibition would have been defeated at the one boundary it matters most —
 * where a human types an amount.
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

export interface ActionState {
  ok: boolean;
  message: string;
  fieldErrors?: Record<string, string[]>;
}

export async function openCashAccountAction(
  _previous: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  const parsed = openSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return {
      ok: false,
      message: "Check the form.",
      fieldErrors: z.flattenError(parsed.error).fieldErrors as Record<string, string[]>,
    };
  }

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

  if (!result.ok) {
    return { ok: false, message: result.error.message };
  }

  revalidatePath("/accounts");
  revalidatePath("/dashboard");
  return { ok: true, message: `${input.name} opened as ${result.value.code}.` };
}

const reconcileSchema = z.object({
  accountId: z.string().uuid(),
  asOf: z.string().trim().min(1),
  statementClosing: AMOUNT,
});

/**
 * Reconciles one account against a printed closing balance.
 *
 * Returns the difference rather than changing anything — see
 * `domain/banking.ts`'s note on why reconciliation reports instead of stamping
 * postings.
 */
export async function reconcileAccountAction(
  _previous: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  const parsed = reconcileSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return {
      ok: false,
      message: "Enter a date and a closing balance.",
      fieldErrors: z.flattenError(parsed.error).fieldErrors as Record<string, string[]>,
    };
  }

  const userId = await currentUserId();
  const result = await services().banking.reconcile.execute({
    userId,
    accountId: AccountId.from(parsed.data.accountId),
    asOf: CalendarDate.parse(parsed.data.asOf),
    statementClosing: Money.fromRupees(parsed.data.statementClosing),
  });

  if (!result.ok) return { ok: false, message: result.error.message };

  const report = result.value;
  return {
    ok: report.isReconciled,
    message: report.isReconciled
      ? `Reconciled: the ledger agrees with the statement on ${report.asOf.toISO()}.`
      : report.findings.join(" "),
  };
}

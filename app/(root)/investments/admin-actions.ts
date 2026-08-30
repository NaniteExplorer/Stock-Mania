"use server";

/**
 * Editing and removing what the investments screens registered.
 *
 * Split out of `actions.ts` because the two files answer different questions:
 * that one records what happened, this one corrects what was recorded. Keeping
 * them apart also keeps the correction vocabulary in one place, and it is
 * vocabulary worth being consistent about — the same three verbs recur, and each
 * means a different thing:
 *
 *   - **Correct** — this happened, and the numbers were wrong. Posts a reversal
 *     and re-records, so both halves stay on the statement.
 *   - **Void / delete** — this never happened. Tombstones it.
 *   - **Close / archive** — this is over. Changes nothing, hides it from the
 *     pickers.
 *
 * The wording is lifted from `app/(root)/accounts/actions.ts` on purpose, so a
 * user who has met the distinction on a bank transaction meets the same one here.
 */

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { Money } from "@/core/money";
import { Percentage, Quantity } from "@/core/numeric";
import { CalendarDate } from "@/core/time";
import { AccountId } from "@/domain/accounts";
import { InstitutionId } from "@/domain/institutions";
import { InstrumentId } from "@/domain/instruments";
import { LeaseId } from "@/domain/leasing";
import { currentUserId, services } from "@/infra/container";
import type { InvestingActionState } from "./actions";
import { NEW as NEW_PLATFORM } from "./platform-select";

const AMOUNT = /^\d+(\.\d{1,2})?$/;
const UNITS = /^\d+(\.\d{1,8})?$/;
const money = z.string().trim().regex(AMOUNT, "Use digits, up to two decimals.");
const units = z.string().trim().regex(UNITS, "Use digits, up to eight decimals.");

function revalidateInvesting(instrumentId?: string): void {
  if (instrumentId) revalidatePath(`/investments/${instrumentId}`);
  revalidatePath("/investments");
  revalidatePath("/platforms");
  revalidatePath("/accounts");
  revalidatePath("/transactions");
  revalidatePath("/dashboard");
}

/* ═══ Trades ══════════════════════════════════════════════════════════ */

const voidTradeSchema = z.object({
  instrumentId: z.string().trim().min(1),
  tradeId: z.string().trim().min(1),
  mode: z.enum(["REVERSE", "DELETE"]),
  reason: z.string().trim().max(200).optional().or(z.literal("")),
});

/**
 * Undoes a trade.
 *
 * Most of the interesting behaviour is a refusal, and the refusals carry their
 * own explanations from the use case — "some of what this purchase bought has
 * already been sold", naming the sales. They are passed through verbatim rather
 * than flattened to "could not void", because the message *is* the next step.
 */
export async function voidTradeAction(
  _previous: InvestingActionState | null,
  formData: FormData,
): Promise<InvestingActionState> {
  const parsed = voidTradeSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, message: "Which trade?" };

  const userId = await currentUserId();
  const result = await services().investing.voidTrade.execute({
    userId,
    tradeId: parsed.data.tradeId,
    mode: parsed.data.mode,
    reason: parsed.data.reason || undefined,
  });
  if (!result.ok) return { ok: false, message: result.error.message };

  revalidateInvesting(parsed.data.instrumentId);
  const { side, quantityUndone, reversalTransactionId } = result.value;
  const what = `${side === "BUY" ? "purchase" : "sale"} of ${quantityUndone.toDecimalString()} units`;
  return {
    ok: true,
    message: reversalTransactionId
      ? `The ${what} has been reversed. Both the original and the correction stay on the ` +
        `statement — that is what makes the ledger evidence of anything.`
      : `The ${what} has been deleted, as never having happened.`,
  };
}

const correctTradeSchema = z.object({
  instrumentId: z.string().trim().min(1),
  tradeId: z.string().trim().min(1),
  quantity: units.optional().or(z.literal("")),
  pricePerUnit: money.optional().or(z.literal("")),
  tradedOn: z.string().trim().optional().or(z.literal("")),
  charges: money.optional().or(z.literal("")),
  deductibleCharges: money.optional().or(z.literal("")),
  settlementAccountId: z.string().trim().optional().or(z.literal("")),
  method: z.enum(["FIFO", "LIFO", "HIFO", "AVERAGE_COST", "SPECIFIC_ID"]).optional(),
  reason: z.string().trim().max(200).optional().or(z.literal("")),
});

export async function correctTradeAction(
  _previous: InvestingActionState | null,
  formData: FormData,
): Promise<InvestingActionState> {
  const parsed = correctTradeSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return {
      ok: false,
      message: "Check the form.",
      fieldErrors: z.flattenError(parsed.error).fieldErrors as Record<string, string[]>,
    };
  }

  const data = parsed.data;
  const userId = await currentUserId();
  const result = await services().investing.correctTrade.execute({
    userId,
    tradeId: data.tradeId,
    reason: data.reason || undefined,
    /*
     * Only what the user actually typed. An empty field means "leave it", not
     * "set it to zero" — a blank charges box on a correction that was only ever
     * about the price must not quietly wipe the brokerage.
     */
    changes: {
      quantity: data.quantity ? Quantity.fromString(data.quantity) : undefined,
      pricePerUnit: data.pricePerUnit ? Money.fromRupees(data.pricePerUnit) : undefined,
      tradedOn: data.tradedOn ? CalendarDate.parse(data.tradedOn) : undefined,
      charges: data.charges ? Money.fromRupees(data.charges) : undefined,
      deductibleCharges: data.deductibleCharges
        ? Money.fromRupees(data.deductibleCharges)
        : undefined,
      settlementAccountId: data.settlementAccountId
        ? AccountId.from(data.settlementAccountId)
        : undefined,
      method: data.method,
    },
  });
  if (!result.ok) return { ok: false, message: result.error.message };

  revalidateInvesting(data.instrumentId);
  const caveats = result.value.caveats;
  return {
    ok: true,
    message:
      "Corrected. The original was reversed rather than edited, so the statement shows both." +
      (caveats.length > 0 ? ` ${caveats.join(" ")}` : ""),
  };
}

/* ═══ Instruments ═════════════════════════════════════════════════════ */

const updateInstrumentSchema = z.object({
  instrumentId: z.string().trim().min(1),
  name: z.string().trim().min(1, "Give it a name.").max(160),
  isin: z.string().trim().length(12).optional().or(z.literal("")),
  exchange: z.string().trim().max(16).optional().or(z.literal("")),
  quoteRef: z.string().trim().max(64).optional().or(z.literal("")),
  institutionId: z.string().trim().optional().or(z.literal("")),
});

/**
 * Corrects a holding's registration.
 *
 * Kind and currency are absent from the schema, not merely disabled in the form:
 * both are baked into every disposal already stored, and letting a request set
 * them would restate a filed capital gain from a hidden field.
 */
export async function updateInstrumentAction(
  _previous: InvestingActionState | null,
  formData: FormData,
): Promise<InvestingActionState> {
  const parsed = updateInstrumentSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return {
      ok: false,
      message: "Check the form.",
      fieldErrors: z.flattenError(parsed.error).fieldErrors as Record<string, string[]>,
    };
  }

  const data = parsed.data;
  if (data.institutionId === NEW_PLATFORM) {
    return {
      ok: false,
      message: "Add the platform on the platforms screen first, then pick it here.",
      fieldErrors: { institutionId: ["Not registered yet"] },
    };
  }

  const userId = await currentUserId();
  const result = await services().investing.updateInstrument.execute({
    userId,
    instrumentId: InstrumentId.from(data.instrumentId),
    name: data.name,
    isin: data.isin || null,
    exchange: data.exchange || null,
    quoteRef: data.quoteRef || null,
    institutionId: data.institutionId ? InstitutionId.from(data.institutionId) : null,
  });
  if (!result.ok) return { ok: false, message: result.error.message };

  revalidateInvesting(data.instrumentId);
  return { ok: true, message: `${data.name} updated.` };
}

const instrumentIdSchema = z.object({ instrumentId: z.string().trim().min(1) });

export async function closeInstrumentAction(
  _previous: InvestingActionState | null,
  formData: FormData,
): Promise<InvestingActionState> {
  const parsed = instrumentIdSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, message: "Which holding?" };

  const reopen = formData.get("reopen") === "on";
  const userId = await currentUserId();
  const result = await services().investing.closeInstrument.execute({
    userId,
    instrumentId: InstrumentId.from(parsed.data.instrumentId),
    reopen,
  });
  if (!result.ok) return { ok: false, message: result.error.message };

  revalidateInvesting(parsed.data.instrumentId);
  if (!reopen) redirect("/investments");
  return {
    ok: true,
    message: reopen
      ? "Reopened — it is back in every picker."
      : "Closed. Its history is intact; it just no longer appears in the pickers.",
  };
}

export async function deleteInstrumentAction(
  _previous: InvestingActionState | null,
  formData: FormData,
): Promise<InvestingActionState> {
  const parsed = instrumentIdSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, message: "Which holding?" };

  const userId = await currentUserId();
  const result = await services().investing.deleteInstrument.execute({
    userId,
    instrumentId: InstrumentId.from(parsed.data.instrumentId),
  });
  if (!result.ok) return { ok: false, message: result.error.message };

  revalidateInvesting();
  return { ok: true, message: "Removed." };
}

/* ═══ Leases ══════════════════════════════════════════════════════════ */

const updateLeaseSchema = z.object({
  leaseId: z.string().trim().min(1),
  platform: z.string().trim().max(120).optional().or(z.literal("")),
  quantity: units.optional().or(z.literal("")),
  startOn: z.string().trim().optional().or(z.literal("")),
  closesOn: z.string().trim().optional().or(z.literal("")),
  annualRate: money.optional().or(z.literal("")),
  tdsRate: money.optional().or(z.literal("")),
  sourceReference: z.string().trim().max(120).optional().or(z.literal("")),
  notes: z.string().trim().max(500).optional().or(z.literal("")),
});

export async function updateLeaseAction(
  _previous: InvestingActionState | null,
  formData: FormData,
): Promise<InvestingActionState> {
  const parsed = updateLeaseSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return {
      ok: false,
      message: "Check the form.",
      fieldErrors: z.flattenError(parsed.error).fieldErrors as Record<string, string[]>,
    };
  }

  const data = parsed.data;
  const userId = await currentUserId();
  const result = await services().leasing.update.execute({
    userId,
    leaseId: LeaseId.from(data.leaseId),
    platform: data.platform || undefined,
    quantity: data.quantity ? Quantity.fromString(data.quantity) : undefined,
    startOn: data.startOn ? CalendarDate.parse(data.startOn) : undefined,
    closesOn: data.closesOn ? CalendarDate.parse(data.closesOn) : undefined,
    annualRate: data.annualRate ? Percentage.of(data.annualRate) : undefined,
    tdsRate: data.tdsRate ? Percentage.of(data.tdsRate) : undefined,
    sourceReference: data.sourceReference || null,
    notes: data.notes || null,
  });
  if (!result.ok) return { ok: false, message: result.error.message };

  revalidateInvesting();
  return { ok: true, message: "Lease updated." };
}

const leaseIdSchema = z.object({ leaseId: z.string().trim().min(1) });

export async function deleteLeaseAction(
  _previous: InvestingActionState | null,
  formData: FormData,
): Promise<InvestingActionState> {
  const parsed = leaseIdSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, message: "Which lease?" };

  const userId = await currentUserId();
  const result = await services().leasing.remove.execute({
    userId,
    leaseId: LeaseId.from(parsed.data.leaseId),
  });
  if (!result.ok) return { ok: false, message: result.error.message };

  revalidateInvesting();
  return { ok: true, message: "Lease removed." };
}

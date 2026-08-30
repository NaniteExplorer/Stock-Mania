"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Percentage, Quantity } from "@/core/numeric";
import { CalendarDate } from "@/core/time";
import { InstrumentId } from "@/domain/instruments";
import { AccountId } from "@/domain/accounts";
import { LeaseId, PAYOUT_FREQUENCIES, PAYOUT_MODES } from "@/domain/leasing";
import { currentUserId, ensureSeeded, services } from "@/infra/container";

/**
 * Gold-lease server actions.
 *
 * Their own file rather than more of `actions.ts`, because a lease is not a trade:
 * opening one posts nothing, and accruing one posts an in-kind receipt. Keeping
 * them apart means the trade actions stay readable as trade actions.
 *
 * Grams are `z.string()` into `Quantity.fromString` for the same reason amounts
 * are: `z.coerce.number()` would turn "8.5" into a float before our code saw it,
 * and 4% of a gram is exactly where that would show.
 */

export interface LeasingActionState {
  ok: boolean;
  message: string;
  fieldErrors?: Record<string, string[]>;
}

/** Grams carry eight decimals, matching `Quantity`'s scale. */
const GRAMS = z
  .string()
  .trim()
  .regex(/^\d+(\.\d{1,8})?$/, "Enter grams like 8.5 or 12.34567");
const RATE = z
  .string()
  .trim()
  .regex(/^\d+(\.\d{1,4})?$/, "Enter a rate like 4 or 4.25");

const flatten = (error: z.ZodError) =>
  z.flattenError(error).fieldErrors as Record<string, string[]>;

const openSchema = z.object({
  instrumentId: z.string().uuid("Pick which gold holding is being leased."),
  platform: z.string().trim().min(1, "Which platform holds the lease?").max(120),
  reference: z.string().trim().max(60).optional().or(z.literal("")),
  quantity: GRAMS,
  startOn: z.string().trim().min(1, "When did the lease start?"),
  closesOn: z.string().trim().min(1, "When does it close?"),
  annualRate: RATE,
  payoutFrequency: z.enum(PAYOUT_FREQUENCIES).default("MONTHLY"),
  payoutMode: z.enum(PAYOUT_MODES).default("GRAMS"),
  payoutAccountId: z.string().trim().optional().or(z.literal("")),
  tdsRate: RATE.optional().or(z.literal("")),
  sourceReference: z.string().trim().max(120).optional().or(z.literal("")),
});

function revalidateLeasing() {
  revalidatePath("/investments");
  // The accrual books grams into a holding, so both figures move with it.
  revalidatePath("/dashboard");
}

/**
 * Opens a lease.
 *
 * The success message carries the wallet balance and any over-lease warning
 * verbatim, because that warning ("more grams on lease than held") means either a
 * lease against gold never bought or gold sold while still leased — and the moment
 * to see it is now, not at the next accrual.
 */
export async function openLeaseAction(
  _previous: LeasingActionState | null,
  formData: FormData,
): Promise<LeasingActionState> {
  const parsed = openSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return {
      ok: false,
      message: "Check the grams, dates and rate.",
      fieldErrors: flatten(parsed.error),
    };
  }

  const userId = await currentUserId();
  await ensureSeeded(userId);

  const result = await services().leasing.open.execute({
    userId,
    instrumentId: InstrumentId.from(parsed.data.instrumentId),
    platform: parsed.data.platform,
    reference: parsed.data.reference || undefined,
    quantity: Quantity.fromString(parsed.data.quantity),
    startOn: CalendarDate.parse(parsed.data.startOn),
    closesOn: CalendarDate.parse(parsed.data.closesOn),
    annualRate: Percentage.of(parsed.data.annualRate),
    payoutFrequency: parsed.data.payoutFrequency,
    payoutMode: parsed.data.payoutMode,
    payoutAccountId: parsed.data.payoutAccountId
      ? AccountId.from(parsed.data.payoutAccountId)
      : null,
    tdsRate: parsed.data.tdsRate ? Percentage.of(parsed.data.tdsRate) : undefined,
    sourceReference: parsed.data.sourceReference || null,
  });

  if (!result.ok) return { ok: false, message: result.error.message };

  revalidateLeasing();
  revalidatePath(`/investments/${parsed.data.instrumentId}`);
  const { reference, unleased, warnings } = result.value;
  return {
    ok: true,
    message:
      `${reference} opened. ${unleased.toDecimalString()}g still unleased in the wallet.` +
      (warnings.length > 0 ? ` ${warnings.join(" ")}` : ""),
  };
}

const accrueSchema = z.object({
  leaseId: z.string().uuid(),
  asOf: z.string().trim().min(1),
});

/**
 * Books the interest earned so far.
 *
 * Idempotent by construction — the use case books only the grams not already
 * credited — so pressing it twice on the same day is safe, and says so rather than
 * silently doing nothing.
 */
export async function accrueLeaseAction(
  _previous: LeasingActionState | null,
  formData: FormData,
): Promise<LeasingActionState> {
  const parsed = accrueSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, message: "Give a lease and a date." };

  const userId = await currentUserId();
  const result = await services().leasing.accrue.execute({
    userId,
    leaseId: LeaseId.from(parsed.data.leaseId),
    asOf: CalendarDate.parse(parsed.data.asOf),
  });

  if (!result.ok) return { ok: false, message: result.error.message };

  const { postedGrams, grossValue, tdsValue, netValue, because } = result.value;
  if (postedGrams.isZero) {
    return { ok: true, message: `Nothing new to book. ${because}` };
  }

  revalidateLeasing();
  return {
    ok: true,
    message:
      `Booked ${postedGrams.toDecimalString()}g — income ${grossValue.toString()}, ` +
      `TDS ${tdsValue.toString()} held as a receivable, ${netValue.toString()} into the holding.`,
  };
}

const settleSchema = z.object({
  leaseId: z.string().uuid(),
  outcome: z.enum(["MATURED", "CANCELLED"]),
  endedOn: z.string().trim().min(1),
});

/**
 * Closes a lease.
 *
 * It deliberately does not book the outstanding interest — that is the accrual's
 * job, and two paths writing the same posting is how a gram gets credited twice.
 * So when grams are left unbooked the message says so instead of hiding it.
 */
export async function settleLeaseAction(
  _previous: LeasingActionState | null,
  formData: FormData,
): Promise<LeasingActionState> {
  const parsed = settleSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, message: "Give an outcome and a date." };

  const userId = await currentUserId();
  const result = await services().leasing.settle.execute({
    userId,
    leaseId: LeaseId.from(parsed.data.leaseId),
    outcome: parsed.data.outcome,
    endedOn: CalendarDate.parse(parsed.data.endedOn),
  });

  if (!result.ok) return { ok: false, message: result.error.message };

  revalidateLeasing();
  const { status, unpostedGrams } = result.value;
  return {
    ok: true,
    message: unpostedGrams.isZero
      ? `Closed as ${status.toLowerCase()}.`
      : `Closed as ${status.toLowerCase()}, with ${unpostedGrams.toDecimalString()}g of interest ` +
        `still unbooked — accrue it so the grams reach the holding.`,
  };
}

"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Money } from "@/core/money";
import { Percentage, Rate } from "@/core/numeric";
import { CalendarDate } from "@/core/time";
import { AccountId } from "@/domain/accounts";
import { currentUserId, ensureSeeded, services } from "@/infra/container";

export interface DepositActionState {
  ok: boolean;
  message: string;
  fieldErrors?: Record<string, string[]>;
}

const AMOUNT = z
  .string()
  .trim()
  .regex(/^\d+(\.\d{1,2})?$/, "Enter an amount like 100000.00");
const DECIMAL = z
  .string()
  .trim()
  .regex(/^\d+(\.\d{1,4})?$/, "Enter a rate like 7.1");

const schema = z
  .object({
    name: z.string().trim().min(1, "Give the deposit a name.").max(120),
    kind: z.enum(["FIXED_DEPOSIT", "RECURRING_DEPOSIT", "PPF", "EPF", "NPS"]),
    institution: z.string().trim().max(120).optional().or(z.literal("")),
    openedOn: z.string().trim().min(1, "When was it opened?"),
    rate: DECIMAL.optional().or(z.literal("")),
    compounding: z.enum(["DAILY", "MONTHLY", "QUARTERLY", "HALF_YEARLY", "ANNUALLY", "AT_MATURITY"]),
    accrualBasis: z.enum(["SIMPLE", "COMPOUND"]),
    payout: z.enum(["CUMULATIVE", "PERIODIC_PAYOUT"]),
    principal: AMOUNT.optional().or(z.literal("")),
    maturesOn: z.string().trim().optional().or(z.literal("")),
    instalment: AMOUNT.optional().or(z.literal("")),
    months: z.coerce.number().int().min(1).max(600).optional(),
    prematurePenalty: DECIMAL.optional().or(z.literal("")),
    npsTier: z.enum(["TIER_I", "TIER_II"]).optional(),
    fundedFromAccountId: z.string().uuid().optional().or(z.literal("")),
  })
  .refine((value) => value.kind !== "FIXED_DEPOSIT" || (value.principal && value.maturesOn), {
    message: "A fixed deposit needs a principal and a maturity date.",
    path: ["principal"],
  })
  .refine((value) => value.kind !== "RECURRING_DEPOSIT" || (value.instalment && value.months), {
    message: "A recurring deposit needs an instalment and a number of months.",
    path: ["instalment"],
  });

/**
 * Opens a deposit.
 *
 * `fundedFromAccountId` is the field worth reading twice. Supplied, the money moves
 * out of a tracked account and net worth is unchanged — which is what saving does.
 * Left blank, an opening balance is booked against equity instead, which is right
 * for a deposit that predates the app. Guessing between the two would either
 * invent money or lose it.
 */
export async function openDepositAction(
  _previous: DepositActionState | null,
  formData: FormData,
): Promise<DepositActionState> {
  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    const flattened = z.flattenError(parsed.error);
    return {
      ok: false,
      message: flattened.formErrors[0] ?? "Check the form.",
      fieldErrors: flattened.fieldErrors as Record<string, string[]>,
    };
  }

  const userId = await currentUserId();
  await ensureSeeded(userId);
  const input = parsed.data;

  const result = await services().lending.openDeposit.execute({
    userId,
    name: input.name,
    kind: input.kind,
    institution: input.institution || null,
    openedOn: CalendarDate.parse(input.openedOn),
    principal: input.principal ? Money.fromRupees(input.principal) : undefined,
    instalment: input.instalment ? Money.fromRupees(input.instalment) : undefined,
    months: input.months,
    maturesOn: input.maturesOn ? CalendarDate.parse(input.maturesOn) : undefined,
    rate: input.rate ? Rate.annual(input.rate) : undefined,
    accrualBasis: input.accrualBasis,
    compounding: input.compounding,
    payout: input.payout,
    prematurePenalty: input.prematurePenalty ? Percentage.of(input.prematurePenalty) : undefined,
    npsTier: input.npsTier,
    fundedFromAccountId: input.fundedFromAccountId
      ? AccountId.from(input.fundedFromAccountId)
      : undefined,
  });

  if (!result.ok) return { ok: false, message: result.error.message };

  revalidatePath("/deposits");
  revalidatePath("/accounts");
  revalidatePath("/dashboard");
  return { ok: true, message: `${input.name} added as ${result.value.code}.` };
}

/** Books the interest a deposit has earned but the journal has not recorded. */
export async function bookAccruedInterestAction(formData: FormData): Promise<void> {
  const accountId = z.string().uuid().parse(formData.get("accountId"));
  const userId = await currentUserId();
  await services().lending.bookAccruedInterest.execute({
    userId,
    accountId: AccountId.from(accountId),
    asOf: CalendarDate.parse(new Date().toISOString().slice(0, 10)),
  });
  revalidatePath("/deposits");
  revalidatePath("/transactions");
  revalidatePath("/dashboard");
}

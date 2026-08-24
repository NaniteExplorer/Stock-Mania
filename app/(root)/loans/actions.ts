"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Money } from "@/core/money";
import { Percentage, Rate } from "@/core/numeric";
import { CalendarDate } from "@/core/time";
import { AccountId } from "@/domain/accounts";
import { currentUserId, ensureSeeded, services } from "@/infra/container";

export interface LoanActionState {
  ok: boolean;
  message: string;
  fieldErrors?: Record<string, string[]>;
}

const AMOUNT = z
  .string()
  .trim()
  .regex(/^\d+(\.\d{1,2})?$/, "Enter an amount like 5000000.00");
const DECIMAL = z
  .string()
  .trim()
  .regex(/^\d+(\.\d{1,4})?$/, "Enter a rate like 8.5");

const openSchema = z.object({
  name: z.string().trim().min(1, "Give the loan a name.").max(120),
  kind: z.enum(["HOME", "VEHICLE", "PERSONAL", "EDUCATION", "GOLD", "OTHER"]),
  institution: z.string().trim().max(120).optional().or(z.literal("")),
  principal: AMOUNT,
  annualRate: DECIMAL,
  periods: z.coerce.number().int().min(1).max(600),
  frequency: z.enum(["MONTHLY", "QUARTERLY", "ANNUALLY"]),
  accrualBasis: z.enum(["REDUCING_BALANCE", "FLAT"]),
  disbursedOn: z.string().trim().min(1),
  firstPaymentOn: z.string().trim().optional().or(z.literal("")),
  prepaymentPenalty: DECIMAL.optional().or(z.literal("")),
  disbursedToAccountId: z.string().uuid().optional().or(z.literal("")),
});

export async function openLoanAction(
  _previous: LoanActionState | null,
  formData: FormData,
): Promise<LoanActionState> {
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

  const result = await services().lending.openLoan.execute({
    userId,
    name: input.name,
    kind: input.kind,
    institution: input.institution || null,
    principal: Money.fromRupees(input.principal),
    annualRate: Rate.annual(input.annualRate),
    periods: input.periods,
    frequency: input.frequency,
    accrualBasis: input.accrualBasis,
    disbursedOn: CalendarDate.parse(input.disbursedOn),
    firstPaymentOn: input.firstPaymentOn ? CalendarDate.parse(input.firstPaymentOn) : undefined,
    prepaymentPenalty: input.prepaymentPenalty ? Percentage.of(input.prepaymentPenalty) : undefined,
    disbursedToAccountId: input.disbursedToAccountId
      ? AccountId.from(input.disbursedToAccountId)
      : undefined,
  });

  if (!result.ok) return { ok: false, message: result.error.message };

  revalidatePath("/loans");
  revalidatePath("/dashboard");
  return {
    ok: true,
    message: `${input.name} added. The instalment is ${result.value.instalment.toString()}.`,
  };
}

const instalmentSchema = z.object({
  loanAccountId: z.string().uuid(),
  fromAccountId: z.string().uuid(),
  period: z.coerce.number().int().min(1),
  paidOn: z.string().trim().optional().or(z.literal("")),
});

/**
 * Records one instalment.
 *
 * The split between principal and interest comes from the schedule, never from the
 * form: an EMI is one debit on a bank statement whose composition changes every
 * month, and asking a person to type it is asking them to amortise by hand.
 */
export async function recordInstalmentAction(
  _previous: LoanActionState | null,
  formData: FormData,
): Promise<LoanActionState> {
  const parsed = instalmentSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, message: "Choose the account paying and the period." };

  const userId = await currentUserId();
  const result = await services().lending.recordInstalment.execute({
    userId,
    loanAccountId: AccountId.from(parsed.data.loanAccountId),
    fromAccountId: AccountId.from(parsed.data.fromAccountId),
    period: parsed.data.period,
    paidOn: parsed.data.paidOn ? CalendarDate.parse(parsed.data.paidOn) : undefined,
  });

  if (!result.ok) return { ok: false, message: result.error.message };

  revalidatePath(`/loans/${parsed.data.loanAccountId}`);
  revalidatePath("/loans");
  revalidatePath("/accounts");
  revalidatePath("/transactions");
  revalidatePath("/dashboard");
  return {
    ok: true,
    message:
      `Recorded ${result.value.total.toString()}: ${result.value.principal.toString()} off the ` +
      `principal and ${result.value.interest.toString()} of interest.`,
  };
}

const prepaymentSchema = z.object({
  loanAccountId: z.string().uuid(),
  fromAccountId: z.string().uuid(),
  amount: AMOUNT,
  paidOn: z.string().trim().min(1),
  reduces: z.enum(["TERM", "INSTALMENT"]),
});

export async function recordPrepaymentAction(
  _previous: LoanActionState | null,
  formData: FormData,
): Promise<LoanActionState> {
  const parsed = prepaymentSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, message: "Check the amount, the date and the account." };

  const userId = await currentUserId();
  const result = await services().lending.recordPrepayment.execute({
    userId,
    loanAccountId: AccountId.from(parsed.data.loanAccountId),
    fromAccountId: AccountId.from(parsed.data.fromAccountId),
    amount: Money.fromRupees(parsed.data.amount),
    paidOn: CalendarDate.parse(parsed.data.paidOn),
    reduces: parsed.data.reduces,
  });

  if (!result.ok) return { ok: false, message: result.error.message };

  revalidatePath(`/loans/${parsed.data.loanAccountId}`);
  revalidatePath("/loans");
  revalidatePath("/dashboard");
  return {
    ok: true,
    message:
      `Prepayment recorded. It saves ${result.value.interestSaved.toString()} of interest` +
      (result.value.closesOn ? ` and the loan now closes on ${result.value.closesOn.toISO()}.` : "."),
  };
}

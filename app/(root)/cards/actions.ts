"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Money } from "@/core/money";
import { Percentage, Quantity, Rate } from "@/core/numeric";
import { CalendarDate } from "@/core/time";
import { AccountId } from "@/domain/accounts";
import { BillingCycleRule, type CardTerms } from "@/domain/assets";
import { currentUserId, ensureSeeded, services } from "@/infra/container";

export interface CardActionState {
  ok: boolean;
  message: string;
  fieldErrors?: Record<string, string[]>;
}

/**
 * Every amount is a string and every rate is a string.
 *
 * `Rate.annual("42")` parses ten decimal places exactly; `z.coerce.number()` on
 * the same field would hand it a float, and 42/365 of a float is where a card's
 * interest quietly stops matching the issuer's bill.
 */
const AMOUNT = z
  .string()
  .trim()
  .regex(/^\d+(\.\d{1,2})?$/, "Enter an amount like 200000.00");

const DECIMAL = z
  .string()
  .trim()
  .regex(/^\d+(\.\d{1,4})?$/, "Enter a number like 42 or 3.5");

const openSchema = z.object({
  name: z.string().trim().min(1, "Give the card a name.").max(120),
  institution: z.string().trim().max(120).optional().or(z.literal("")),
  accountNumberSuffix: z
    .string()
    .trim()
    .regex(/^\d{4}$/, "Only the last four digits.")
    .optional()
    .or(z.literal("")),
  creditLimit: AMOUNT,
  statementDay: z.coerce.number().int().min(1).max(31),
  graceDays: z.coerce.number().int().min(1).max(60),
  financeRate: DECIMAL,
  minimumDuePercent: DECIMAL,
  minimumDueFloor: AMOUNT,
  lateFee: AMOUNT,
  annualFee: AMOUNT,
  gstOnCharges: DECIMAL,
  pointsPerHundred: DECIMAL,
  openingBalance: AMOUNT.optional().or(z.literal("")),
  openingBalanceOn: z.string().trim().optional().or(z.literal("")),
});

function termsFrom(input: z.infer<typeof openSchema>): CardTerms {
  return {
    creditLimit: Money.fromRupees(input.creditLimit),
    cycle: new BillingCycleRule(input.statementDay, input.graceDays),
    financeRate: Rate.annual(input.financeRate),
    minimumDuePercent: Percentage.of(input.minimumDuePercent),
    minimumDueFloor: Money.fromRupees(input.minimumDueFloor),
    lateFee: Money.fromRupees(input.lateFee),
    annualFee: Money.fromRupees(input.annualFee),
    gstOnCharges: Percentage.of(input.gstOnCharges),
    pointsPerHundred: Quantity.fromString(input.pointsPerHundred),
  };
}

export async function openCardAction(
  _previous: CardActionState | null,
  formData: FormData,
): Promise<CardActionState> {
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

  const result = await services().cards.open.execute({
    userId,
    name: parsed.data.name,
    institution: parsed.data.institution || null,
    accountNumberSuffix: parsed.data.accountNumberSuffix || null,
    terms: termsFrom(parsed.data),
    openingBalance: parsed.data.openingBalance ? Money.fromRupees(parsed.data.openingBalance) : null,
    openingBalanceOn: parsed.data.openingBalanceOn
      ? CalendarDate.parse(parsed.data.openingBalanceOn)
      : undefined,
  });

  if (!result.ok) return { ok: false, message: result.error.message };

  revalidatePath("/cards");
  revalidatePath("/dashboard");
  return { ok: true, message: `${parsed.data.name} added as ${result.value.code}.` };
}

const paySchema = z.object({
  cardAccountId: z.string().uuid(),
  fromAccountId: z.string().uuid(),
  amount: AMOUNT,
  postedOn: z.string().trim().min(1),
});

/**
 * Pays a card bill — a transfer between two accounts the user owns.
 *
 * There is deliberately no "category" field on this form. Paying a card is not
 * spending (L12), and offering a category would invite the double-count the
 * transfer type exists to prevent.
 */
export async function payCardAction(
  _previous: CardActionState | null,
  formData: FormData,
): Promise<CardActionState> {
  const parsed = paySchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return {
      ok: false,
      message: "Check the amount, the date and the account paying.",
      fieldErrors: z.flattenError(parsed.error).fieldErrors as Record<string, string[]>,
    };
  }

  const userId = await currentUserId();
  const result = await services().cards.pay.execute({
    userId,
    cardAccountId: AccountId.from(parsed.data.cardAccountId),
    fromAccountId: AccountId.from(parsed.data.fromAccountId),
    amount: Money.fromRupees(parsed.data.amount),
    postedOn: CalendarDate.parse(parsed.data.postedOn),
  });

  if (!result.ok) return { ok: false, message: result.error.message };

  revalidatePath(`/cards/${parsed.data.cardAccountId}`);
  revalidatePath("/cards");
  revalidatePath("/accounts");
  revalidatePath("/transactions");
  revalidatePath("/dashboard");
  return { ok: true, message: "Payment recorded as a transfer — no expense category involved." };
}

const accrueSchema = z.object({
  cardAccountId: z.string().uuid(),
  statementDate: z.string().trim().min(1),
  lateFee: z.union([z.literal("on"), z.literal("")]).optional(),
  annualFee: z.union([z.literal("on"), z.literal("")]).optional(),
});

/** Posts the interest and fees a closed cycle earned, computed from the postings. */
export async function accrueChargesAction(
  _previous: CardActionState | null,
  formData: FormData,
): Promise<CardActionState> {
  const parsed = accrueSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, message: "Choose a statement date." };

  const userId = await currentUserId();
  const result = await services().cards.accrueCharges.execute({
    userId,
    cardAccountId: AccountId.from(parsed.data.cardAccountId),
    statementDate: CalendarDate.parse(parsed.data.statementDate),
    lateFeeApplies: parsed.data.lateFee === "on",
    annualFeeApplies: parsed.data.annualFee === "on",
  });

  if (!result.ok) return { ok: false, message: result.error.message };

  revalidatePath(`/cards/${parsed.data.cardAccountId}`);
  revalidatePath("/transactions");
  return {
    ok: true,
    message:
      result.value.interest.isZero && result.value.fees.isZero
        ? "Nothing to charge — the balance did not revolve past its due date."
        : `Charged ${result.value.interest.toString()} interest, ${result.value.fees.toString()} in fees and ${result.value.gst.toString()} GST.`,
  };
}

"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Money } from "@/core/money";
import { Quantity } from "@/core/numeric";
import { CalendarDate } from "@/core/time";
import { AccountId } from "@/domain/accounts";
import { InstrumentId } from "@/domain/instruments";
import { Split } from "@/domain/corporate";
import { currentUserId, ensureSeeded, services } from "@/infra/container";

export interface InvestingActionState {
  ok: boolean;
  message: string;
  fieldErrors?: Record<string, string[]>;
}

const AMOUNT = z
  .string()
  .trim()
  .regex(/^\d+(\.\d{1,2})?$/, "Enter an amount like 1500.00");
/** Units carry eight decimals: a mutual fund holding is rarely a whole number. */
const UNITS = z
  .string()
  .trim()
  .regex(/^\d+(\.\d{1,8})?$/, "Enter a quantity like 12.5432");

const addSchema = z.object({
  symbol: z.string().trim().min(1, "Give it a symbol.").max(40),
  name: z.string().trim().min(1, "Give it a name.").max(160),
  kind: z.enum([
    "LISTED_EQUITY",
    "ETF",
    "INDEX_FUND",
    "MUTUAL_FUND",
    "LIQUID_FUND",
    "DEBT_FUND",
    "ELSS_FUND",
    "BOND",
    "GOVT_SECURITY",
    "SOVEREIGN_GOLD_BOND",
    "DIGITAL_GOLD",
    "DIGITAL_SILVER",
    "CRYPTO",
  ]),
  isin: z.string().trim().length(12).optional().or(z.literal("")),
  exchange: z.string().trim().max(16).optional().or(z.literal("")),
  quoteRef: z.string().trim().max(64).optional().or(z.literal("")),
});

export async function addInstrumentAction(
  _previous: InvestingActionState | null,
  formData: FormData,
): Promise<InvestingActionState> {
  const parsed = addSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return {
      ok: false,
      message: "Check the form.",
      fieldErrors: z.flattenError(parsed.error).fieldErrors as Record<string, string[]>,
    };
  }

  const userId = await currentUserId();
  await ensureSeeded(userId);

  const result = await services().investing.addInstrument.execute({
    userId,
    symbol: parsed.data.symbol.toUpperCase(),
    name: parsed.data.name,
    kind: parsed.data.kind,
    isin: parsed.data.isin || null,
    exchange: parsed.data.exchange || null,
    quoteRef: parsed.data.quoteRef || null,
  });

  if (!result.ok) return { ok: false, message: result.error.message };

  revalidatePath("/investments");
  return { ok: true, message: `${parsed.data.symbol.toUpperCase()} added.` };
}

const tradeSchema = z.object({
  instrumentId: z.string().uuid(),
  accountId: z.string().uuid(),
  quantity: UNITS,
  pricePerUnit: AMOUNT,
  tradedOn: z.string().trim().min(1),
  charges: AMOUNT.optional().or(z.literal("")),
  deductibleCharges: AMOUNT.optional().or(z.literal("")),
  method: z.enum(["FIFO", "LIFO", "HIFO", "AVERAGE_COST", "SPECIFIC_ID"]).optional(),
});

export async function recordBuyAction(
  _previous: InvestingActionState | null,
  formData: FormData,
): Promise<InvestingActionState> {
  const parsed = tradeSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, message: "Check the quantity, price and date." };

  const userId = await currentUserId();
  const result = await services().investing.recordBuy.execute({
    userId,
    instrumentId: InstrumentId.from(parsed.data.instrumentId),
    fromAccountId: AccountId.from(parsed.data.accountId),
    quantity: Quantity.fromString(parsed.data.quantity),
    pricePerUnit: Money.fromRupees(parsed.data.pricePerUnit),
    tradedOn: CalendarDate.parse(parsed.data.tradedOn),
    charges: parsed.data.charges ? Money.fromRupees(parsed.data.charges) : undefined,
  });

  if (!result.ok) return { ok: false, message: result.error.message };

  revalidateInvesting(parsed.data.instrumentId);
  return {
    ok: true,
    message: `Bought. The lot opened at ${result.value.costBasis.toString()}, and ${result.value.cashPaid.toString()} left the account.`,
  };
}

/**
 * Records a sale.
 *
 * `deductibleCharges` is a separate field rather than a fraction of `charges`,
 * because STT is a real cost that is never deductible against a gain — offering
 * one number would make deducting all of it the path of least resistance.
 */
export async function recordSellAction(
  _previous: InvestingActionState | null,
  formData: FormData,
): Promise<InvestingActionState> {
  const parsed = tradeSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, message: "Check the quantity, price and date." };

  const userId = await currentUserId();
  const result = await services().investing.recordSell.execute({
    userId,
    instrumentId: InstrumentId.from(parsed.data.instrumentId),
    toAccountId: AccountId.from(parsed.data.accountId),
    quantity: Quantity.fromString(parsed.data.quantity),
    pricePerUnit: Money.fromRupees(parsed.data.pricePerUnit),
    tradedOn: CalendarDate.parse(parsed.data.tradedOn),
    charges: parsed.data.charges ? Money.fromRupees(parsed.data.charges) : undefined,
    deductibleCharges: parsed.data.deductibleCharges
      ? Money.fromRupees(parsed.data.deductibleCharges)
      : undefined,
    method: parsed.data.method,
  });

  if (!result.ok) return { ok: false, message: result.error.message };

  revalidateInvesting(parsed.data.instrumentId);
  const terms = result.value.disposals
    .map((disposal) => `${disposal.quantity.toDecimalString()} held ${disposal.holdingDays} days`)
    .join("; ");
  return {
    ok: true,
    message: `Sold. Realised ${result.value.realisedGain.toString()} across ${result.value.disposals.length} lot(s) — ${terms}.`,
  };
}

const splitSchema = z.object({
  instrumentId: z.string().uuid(),
  from: UNITS,
  to: UNITS,
  exDate: z.string().trim().min(1),
});

/**
 * Applies a split.
 *
 * Recorded as an action with an ex-date rather than an edit to the lots, so it is
 * visible, auditable and reversible — apply the inverse and the units come back.
 */
export async function applySplitAction(
  _previous: InvestingActionState | null,
  formData: FormData,
): Promise<InvestingActionState> {
  const parsed = splitSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, message: "Give a ratio and an ex-date." };

  const userId = await currentUserId();
  const { investing, repositories } = services();

  const instrumentId = InstrumentId.from(parsed.data.instrumentId);
  const openLots = await repositories.lots.openLots(userId, instrumentId);
  const held = openLots.reduce(
    (total, lot) => total.plus(lot.remaining),
    Quantity.ZERO,
  );

  let action: Split;
  try {
    action = new Split(
      {
        instrumentId,
        exDate: CalendarDate.parse(parsed.data.exDate),
        heldQuantity: held,
        currency: Money.zero().currency,
        source: "Manual entry",
      },
      { from: Quantity.fromString(parsed.data.from), to: Quantity.fromString(parsed.data.to) },
    );
  } catch (error) {
    return { ok: false, message: (error as Error).message };
  }

  const result = await investing.applyCorporateAction(userId).execute({ userId, action });
  if (!result.ok) return { ok: false, message: result.error.message };

  revalidateInvesting(parsed.data.instrumentId);
  return {
    ok: true,
    message: `Applied. The position is now ${result.value.quantityAfter.toDecimalString()} units, at the same cost.`,
  };
}

function revalidateInvesting(instrumentId: string): void {
  revalidatePath(`/investments/${instrumentId}`);
  revalidatePath("/investments");
  revalidatePath("/accounts");
  revalidatePath("/transactions");
  revalidatePath("/dashboard");
}

"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Money } from "@/core/money";
import { AccountId } from "@/domain/accounts";
import { currentUserId, services } from "@/infra/container";

export interface BudgetActionState {
  ok: boolean;
  message: string;
}

const schema = z.object({
  accountId: z.string().uuid(),
  /** Blank means the recurring default that every month falls back to. */
  month: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}$/, "Use YYYY-MM.")
    .optional()
    .or(z.literal("")),
  limit: z
    .string()
    .trim()
    .regex(/^\d+(\.\d{1,2})?$/, "Enter an amount like 10000.00"),
  warnAtPercent: z.coerce.number().int().min(1).max(100).default(80),
  carryover: z.union([z.literal("on"), z.literal("")]).optional(),
});

/**
 * Sets or replaces a budget.
 *
 * `limit` is a string and stays one until `Money.fromRupees` — the same reason as
 * every other amount field. `warnAtPercent` is coerced to a number because it
 * genuinely is a count, not money.
 */
export async function setBudgetAction(
  _previous: BudgetActionState | null,
  formData: FormData,
): Promise<BudgetActionState> {
  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    const first = Object.values(z.flattenError(parsed.error).fieldErrors).flat()[0];
    return { ok: false, message: first ?? "Check the form." };
  }

  const userId = await currentUserId();
  const { repositories } = services();

  await repositories.budgets.upsert(userId, {
    accountId: AccountId.from(parsed.data.accountId),
    month: parsed.data.month ? parsed.data.month : null,
    limit: Money.fromRupees(parsed.data.limit),
    warnAtPercent: parsed.data.warnAtPercent,
    carryover: parsed.data.carryover === "on",
  });

  revalidatePath("/budgets");
  return {
    ok: true,
    message: parsed.data.month
      ? `Budget set for ${parsed.data.month}.`
      : "Recurring budget set for every month.",
  };
}

"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { expectedBase, isCpiMonth } from "@/domain/cpi-series";
import { services } from "@/infra/container";
import { fail, ok, type ActionState } from "@/ui/action-state";

const schema = z.object({
  month: z.string().trim().refine(isCpiMonth, "Enter the month as yyyy-mm, e.g. 2026-09."),
  // Text, never a coerced number: the domain parses it exactly.
  index: z.string().trim().regex(/^\d+(\.\d{1,4})?$/, "Enter the index as published, e.g. 193.4 (at most 4 decimals)."),
  source: z.string().trim().min(1, "Say where you read the figure.").max(200, "At most 200 characters."),
});

/**
 * Records (or replaces) one month of CPI Urban for the signed-in owner. The base
 * is derived from the month, never taken from the form; the owner comes from the session.
 */
export async function recordCpiPointAction(_previous: ActionState | null, formData: FormData): Promise<ActionState> {
  const parsed = schema.safeParse({ month: formData.get("month") ?? "", index: formData.get("index") ?? "", source: formData.get("source") ?? "" });
  if (!parsed.success) return fail("Check the form.", z.flattenError(parsed.error).fieldErrors as Record<string, string[]>);
  const { month, index, source } = parsed.data;
  try {
    const { userId, record } = await services().cpiSeries.writes();
    const result = await record.execute({ userId, month, base: expectedBase(month), index, source });
    if (!result.ok) return fail(result.error.message);
  } catch (error) {
    console.error("recordCpiPointAction failed", error);
    return fail("Not saved — the CPI figure could not be stored. Nothing was changed; try again.");
  }
  revalidatePath("/settings/cpi");
  revalidatePath("/dashboard");
  return ok(`CPI for ${month} saved.`);
}

/** Tombstones one month (class B: never hard-deleted). */
export async function removeCpiPointAction(_previous: ActionState | null, formData: FormData): Promise<ActionState> {
  const month = String(formData.get("month") ?? "").trim();
  if (!isCpiMonth(month)) return fail("That month is not yyyy-mm.");
  try {
    const { userId, remove } = await services().cpiSeries.writes();
    const result = await remove.execute({ userId, month });
    if (!result.ok) return fail(result.error.message);
  } catch (error) {
    console.error("removeCpiPointAction failed", error);
    return fail("Not removed — nothing was changed; try again.");
  }
  revalidatePath("/settings/cpi");
  revalidatePath("/dashboard");
  return ok(`CPI for ${month} removed.`);
}

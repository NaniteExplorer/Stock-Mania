"use server";

import { revalidatePath } from "next/cache";
import { services } from "@/infra/container";
import { fail, ok, type ActionState } from "@/ui/action-state";
import { parsePolicyForm } from "./policy-form";

/**
 * Adds a policy. The owner comes from the session inside `manualFinance()` on every
 * call, never from the form. A domain refusal is a value (`ValidationError`); an
 * unexpected persistence failure propagates and is never reported as success.
 */
export async function createInsurancePolicyAction(_previous: ActionState | null, form: FormData): Promise<ActionState> {
  const finance = await services().manualFinance();
  const parsed = parsePolicyForm(form);
  if (!parsed.ok) return fail(parsed.message, parsed.fieldErrors);

  const result = await finance.createInsurancePolicy.execute({ userId: finance.userId, fields: parsed.fields });
  if (!result.ok) return fail(result.error.message);

  revalidatePath("/insurance");
  return ok(`${parsed.fields.insurer} policy added.`);
}

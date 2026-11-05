"use server";

import { revalidatePath } from "next/cache";
import { services } from "@/infra/container";
import { fail, ok, type ActionState } from "@/ui/action-state";
import { parseIncomeForm } from "./income-form";

/**
 * Marshalling only: parse, hand to the use case, report. The owner comes from the
 * session inside `manualFinance()`, never from a form field. A domain refusal
 * returns as a ValidationError value and is shown, not thrown.
 */
export async function createIncomeStreamAction(_previous: ActionState | null, formData: FormData): Promise<ActionState> {
  const parsed = parseIncomeForm(formData);
  if (!parsed.ok) return fail(parsed.fieldErrors.form?.[0] ?? "Check the form.", parsed.fieldErrors);

  const { userId, createIncomeStream } = await services().manualFinance();
  const result = await createIncomeStream.execute({ userId, fields: parsed.fields });
  if (!result.ok) return fail(result.error.userMessage);

  revalidatePath("/income");
  return ok(`${parsed.fields.name} added.`);
}

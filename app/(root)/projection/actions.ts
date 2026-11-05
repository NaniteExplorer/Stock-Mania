"use server";

import { revalidatePath } from "next/cache";
import { services } from "@/infra/container";
import { fail, ok, type ActionState } from "@/ui/action-state";
import { parseAssumptionsForm } from "./assumptions-form";

/**
 * Saves the projection assumptions. The owner comes from the session inside
 * `projection()`, never from a form field; a range or ordering refusal from the
 * domain comes back as a message, not a throw.
 */
export async function saveAssumptionsAction(_previous: ActionState | null, formData: FormData): Promise<ActionState> {
  const parsed = parseAssumptionsForm(Object.fromEntries(formData));
  if (!parsed.ok) return fail("Check the form.", parsed.fieldErrors);

  const { userId, save } = await services().projection();
  const result = await save.execute({ userId, changes: parsed.changes });
  if (!result.ok) return fail(result.error.userMessage);

  revalidatePath("/projection");
  return ok("Assumptions saved. Anything left empty stays unknown, and the projection names it.");
}

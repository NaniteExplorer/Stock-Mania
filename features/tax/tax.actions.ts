"use server";

import { revalidatePath } from "next/cache";
import { getCurrentSession } from "@/lib/better-auth/auth";
import { logger } from "@/core/logger";
import { parseInput } from "@/core/validation/parse";
import { taxSettingsService, type TaxSettings } from "./tax.settings.service";
import { taxSettingsSchema } from "./tax.schema";

type ActionResult = { success: boolean; error?: string };

export async function getTaxSettings(): Promise<TaxSettings> {
  const session = await getCurrentSession();
  if (!session?.user?.id) return taxSettingsService.defaults();
  try {
    return await taxSettingsService.get(session.user.id);
  } catch (err) {
    logger.error("getTaxSettings failed", err);
    return taxSettingsService.defaults();
  }
}

export async function saveTaxSettings(input: TaxSettings): Promise<ActionResult> {
  const session = await getCurrentSession();
  if (!session?.user?.id) return { success: false, error: "You must be signed in." };
  const parsed = parseInput(taxSettingsSchema, input);
  if (!parsed.success) return { success: false, error: parsed.error };
  try {
    await taxSettingsService.save(session.user.id, parsed.data);
    revalidatePath("/investments");
    revalidatePath("/settings");
    return { success: true };
  } catch (err) {
    logger.error("saveTaxSettings failed", err);
    return { success: false, error: "Failed to save tax settings." };
  }
}

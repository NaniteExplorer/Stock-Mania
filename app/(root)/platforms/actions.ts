"use server";

/**
 * Platform actions: add, rename, archive, restore, remove.
 *
 * The lifecycle is deliberately three-tiered, and the split is the same one the
 * ledger draws between a reversal and a delete:
 *
 *   - **Archive** says "I do not use this any more". It hides the platform from
 *     every picker and keeps every holding attributed to it. This is what a
 *     closed broking account wants, and it is the default suggestion.
 *   - **Restore** undoes that, because closing an account and reopening it is a
 *     thing people do.
 *   - **Remove** says "this never was" and is refused the moment anything points
 *     at it. It exists for the mis-click, not for tidying up history.
 */

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Percentage } from "@/core/numeric";
import { InstitutionId, INSTITUTION_KINDS } from "@/domain/institutions";
import { currentUserId, ensureSeeded, services } from "@/infra/container";

export interface PlatformActionState {
  ok: boolean;
  message: string;
  fieldErrors?: Record<string, string[]>;
}

const addSchema = z.object({
  name: z.string().trim().min(1, "Give it a name.").max(120),
  kind: z.enum(INSTITUTION_KINDS),
  providerId: z.string().trim().max(64).optional().or(z.literal("")),
  notes: z.string().trim().max(500).optional().or(z.literal("")),
});

function refreshPlatformViews() {
  revalidatePath("/platforms");
  revalidatePath("/investments");
}

export async function addPlatformAction(
  _previous: PlatformActionState | null,
  formData: FormData,
): Promise<PlatformActionState> {
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

  const result = await services().platforms.register.execute({
    userId,
    name: parsed.data.name,
    kind: parsed.data.kind,
    providerId: parsed.data.providerId || null,
    notes: parsed.data.notes || null,
  });
  if (!result.ok) return { ok: false, message: result.error.message };

  refreshPlatformViews();
  return {
    ok: true,
    message: result.value.alreadyExisted
      ? `${parsed.data.name} was already registered — nothing changed.`
      : `${parsed.data.name} added.`,
  };
}

const updateSchema = z.object({
  platformId: z.string().trim().min(1),
  name: z.string().trim().min(1, "Give it a name.").max(120),
  kind: z.enum(INSTITUTION_KINDS),
  /**
   * Percent under the benchmark this platform buys back at.
   *
   * Two decimals, and capped at 100: a "spread" above that would mean the vault
   * charges you for handing the metal back. Blank leaves it as it was.
   */
  sellSpread: z
    .string()
    .trim()
    .regex(/^\d{1,3}(\.\d{1,2})?$/, "Enter a percentage like 4 or 3.75")
    .optional()
    .or(z.literal("")),
  notes: z.string().trim().max(500).optional().or(z.literal("")),
});

export async function updatePlatformAction(
  _previous: PlatformActionState | null,
  formData: FormData,
): Promise<PlatformActionState> {
  const parsed = updateSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return {
      ok: false,
      message: "Check the form.",
      fieldErrors: z.flattenError(parsed.error).fieldErrors as Record<string, string[]>,
    };
  }

  const userId = await currentUserId();
  const result = await services().platforms.update.execute({
    userId,
    institutionId: InstitutionId.from(parsed.data.platformId),
    name: parsed.data.name,
    kind: parsed.data.kind,
    sellSpread: parsed.data.sellSpread ? Percentage.of(parsed.data.sellSpread) : undefined,
    notes: parsed.data.notes || null,
  });
  if (!result.ok) {
    return { ok: false, message: result.error.message };
  }

  refreshPlatformViews();
  return { ok: true, message: `${parsed.data.name} updated.` };
}

const idSchema = z.object({ platformId: z.string().trim().min(1) });

export async function archivePlatformAction(
  _previous: PlatformActionState | null,
  formData: FormData,
): Promise<PlatformActionState> {
  const parsed = idSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, message: "Which platform?" };

  const restore = formData.get("restore") === "on";
  const userId = await currentUserId();
  const result = await services().platforms.archive.execute({
    userId,
    institutionId: InstitutionId.from(parsed.data.platformId),
    restore,
  });
  if (!result.ok) return { ok: false, message: result.error.message };

  refreshPlatformViews();
  return {
    ok: true,
    message: restore
      ? "Restored — it is back in every picker."
      : "Archived. It keeps everything it holds and drops out of the pickers.",
  };
}

export async function deletePlatformAction(
  _previous: PlatformActionState | null,
  formData: FormData,
): Promise<PlatformActionState> {
  const parsed = idSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, message: "Which platform?" };

  const userId = await currentUserId();
  const result = await services().platforms.remove.execute({
    userId,
    institutionId: InstitutionId.from(parsed.data.platformId),
  });
  if (!result.ok) return { ok: false, message: result.error.message };

  refreshPlatformViews();
  return { ok: true, message: "Removed." };
}

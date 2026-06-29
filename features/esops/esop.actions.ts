"use server";

import { revalidatePath } from "next/cache";
import { getCurrentSession } from "@/lib/better-auth/auth";
import { logger } from "@/core/logger";
import { esopService } from "./esop.service";
import { parseInput } from "@/core/validation/parse";
import { createEsopSchema, updateEsopSchema } from "./esop.schema";
import type { EsopGrant, CreateEsopInput, UpdateEsopInput } from "./esop.types";

type ActionResult = { success: boolean; error?: string };

export async function getMyEsops(): Promise<EsopGrant[]> {
  const session = await getCurrentSession();
  if (!session?.user?.id) return [];
  try {
    return await esopService.list(session.user.id);
  } catch (err) {
    logger.error("getMyEsops failed", err);
    return [];
  }
}

export async function createEsop(input: CreateEsopInput): Promise<ActionResult> {
  const session = await getCurrentSession();
  if (!session?.user?.id) return { success: false, error: "You must be signed in." };
  const parsed = parseInput(createEsopSchema, input);
  if (!parsed.success) return { success: false, error: parsed.error };
  try {
    await esopService.create(session.user.id, parsed.data as CreateEsopInput);
    revalidatePath("/esops");
    revalidatePath("/dashboard");
    return { success: true };
  } catch (err) {
    logger.error("createEsop failed", err);
    return { success: false, error: "Failed to add ESOP grant." };
  }
}

export async function updateEsop(id: string, input: UpdateEsopInput): Promise<ActionResult> {
  const session = await getCurrentSession();
  if (!session?.user?.id) return { success: false, error: "You must be signed in." };
  const parsed = parseInput(updateEsopSchema, input);
  if (!parsed.success) return { success: false, error: parsed.error };
  try {
    await esopService.update(id, session.user.id, parsed.data as UpdateEsopInput);
    revalidatePath("/esops");
    revalidatePath("/dashboard");
    return { success: true };
  } catch (err) {
    logger.error("updateEsop failed", err);
    return { success: false, error: "Failed to update ESOP grant." };
  }
}

export async function deleteEsop(id: string): Promise<ActionResult> {
  const session = await getCurrentSession();
  if (!session?.user?.id) return { success: false, error: "You must be signed in." };
  try {
    await esopService.remove(id, session.user.id);
    revalidatePath("/esops");
    revalidatePath("/dashboard");
    return { success: true };
  } catch (err) {
    logger.error("deleteEsop failed", err);
    return { success: false, error: "Failed to delete ESOP grant." };
  }
}

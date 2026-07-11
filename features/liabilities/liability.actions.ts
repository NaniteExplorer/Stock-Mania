"use server";

import { revalidatePath } from "next/cache";
import { getCurrentSession } from "@/lib/better-auth/auth";
import { logger } from "@/core/logger";
import { liabilityService } from "./liability.service";
import { parseInput } from "@/core/validation/parse";
import {
  createLiabilitySchema,
  updateLiabilitySchema,
  objectIdSchema,
} from "./liability.schema";
import type { Liability, CreateLiabilityInput, UpdateLiabilityInput } from "./liability.types";

type ActionResult = { success: boolean; error?: string };

export async function getMyLiabilities(): Promise<Liability[]> {
  const session = await getCurrentSession();
  if (!session?.user?.id) return [];
  try {
    return await liabilityService.list(session.user.id);
  } catch (err) {
    logger.error("getMyLiabilities failed", err);
    return [];
  }
}

export async function createLiability(input: CreateLiabilityInput): Promise<ActionResult> {
  const session = await getCurrentSession();
  if (!session?.user?.id) return { success: false, error: "You must be signed in." };
  const parsed = parseInput(createLiabilitySchema, input);
  if (!parsed.success) return { success: false, error: parsed.error };
  try {
    await liabilityService.create(session.user.id, parsed.data);
    revalidatePath("/liabilities");
    revalidatePath("/dashboard");
    return { success: true };
  } catch (err) {
    logger.error("createLiability failed", err);
    return { success: false, error: "Failed to add liability." };
  }
}

export async function updateLiability(
  id: string,
  input: UpdateLiabilityInput,
): Promise<ActionResult> {
  const session = await getCurrentSession();
  if (!session?.user?.id) return { success: false, error: "You must be signed in." };
  const parsedId = parseInput(objectIdSchema, id);
  if (!parsedId.success) return { success: false, error: parsedId.error };
  const parsed = parseInput(updateLiabilitySchema, input);
  if (!parsed.success) return { success: false, error: parsed.error };
  try {
    await liabilityService.update(parsedId.data, session.user.id, parsed.data);
    revalidatePath("/liabilities");
    revalidatePath("/dashboard");
    return { success: true };
  } catch (err) {
    logger.error("updateLiability failed", err);
    return { success: false, error: "Failed to update liability." };
  }
}

export async function deleteLiability(id: string): Promise<ActionResult> {
  const session = await getCurrentSession();
  if (!session?.user?.id) return { success: false, error: "You must be signed in." };
  const parsedId = parseInput(objectIdSchema, id);
  if (!parsedId.success) return { success: false, error: parsedId.error };
  try {
    await liabilityService.remove(parsedId.data, session.user.id);
    revalidatePath("/liabilities");
    revalidatePath("/dashboard");
    return { success: true };
  } catch (err) {
    logger.error("deleteLiability failed", err);
    return { success: false, error: "Failed to delete liability." };
  }
}

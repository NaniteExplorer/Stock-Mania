"use server";

import { revalidatePath } from "next/cache";
import { getCurrentSession } from "@/lib/better-auth/auth";
import { logger } from "@/core/logger";
import { parseInput } from "@/core/validation/parse";
import { goldLeaseService } from "./gold-lease.service";
import { createGoldLeaseSchema } from "./gold-lease.schema";
import type { CreateGoldLeaseInput, GoldLease } from "./gold-lease.types";

type ActionResult = { success: boolean; error?: string };

export async function getMyGoldLeases(): Promise<GoldLease[]> {
  const session = await getCurrentSession();
  if (!session?.user?.id) return [];
  try {
    return await goldLeaseService.listByUser(session.user.id);
  } catch (err) {
    logger.error("getMyGoldLeases failed", err);
    return [];
  }
}

export async function createGoldLease(input: CreateGoldLeaseInput): Promise<ActionResult> {
  const session = await getCurrentSession();
  if (!session?.user?.id) return { success: false, error: "You must be signed in." };
  const parsed = parseInput(createGoldLeaseSchema, input);
  if (!parsed.success) return { success: false, error: parsed.error };
  try {
    await goldLeaseService.create(session.user.id, parsed.data as CreateGoldLeaseInput);
    revalidatePath("/investments");
    revalidatePath("/dashboard");
    return { success: true };
  } catch (err) {
    logger.error("createGoldLease failed", err);
    return { success: false, error: "Failed to create the lease." };
  }
}

export async function deleteGoldLease(id: string): Promise<ActionResult> {
  const session = await getCurrentSession();
  if (!session?.user?.id) return { success: false, error: "You must be signed in." };
  try {
    await goldLeaseService.remove(id, session.user.id);
    revalidatePath("/investments");
    revalidatePath("/dashboard");
    return { success: true };
  } catch (err) {
    logger.error("deleteGoldLease failed", err);
    return { success: false, error: "Failed to delete the lease." };
  }
}

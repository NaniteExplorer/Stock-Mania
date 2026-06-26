"use server";

import { revalidatePath } from "next/cache";
import { getCurrentSession } from "@/lib/better-auth/auth";
import { logger } from "@/core/logger";
import { investmentService } from "./investment.service";
import type {
  Investment,
  CreateInvestmentInput,
  UpdateInvestmentInput,
} from "./investment.types";

type ActionResult = { success: boolean; error?: string };

export async function getMyInvestments(): Promise<Investment[]> {
  const session = await getCurrentSession();
  if (!session?.user?.id) return [];
  try {
    return await investmentService.list(session.user.id);
  } catch (err) {
    logger.error("getMyInvestments failed", err);
    return [];
  }
}

export async function createInvestment(input: CreateInvestmentInput): Promise<ActionResult> {
  const session = await getCurrentSession();
  if (!session?.user?.id) return { success: false, error: "You must be signed in." };
  try {
    await investmentService.create(session.user.id, input);
    revalidatePath("/investments");
    revalidatePath("/dashboard");
    return { success: true };
  } catch (err) {
    logger.error("createInvestment failed", err);
    return { success: false, error: "Failed to add investment." };
  }
}

export async function updateInvestment(
  id: string,
  input: UpdateInvestmentInput,
): Promise<ActionResult> {
  const session = await getCurrentSession();
  if (!session?.user?.id) return { success: false, error: "You must be signed in." };
  try {
    await investmentService.update(id, session.user.id, input);
    revalidatePath("/investments");
    revalidatePath("/dashboard");
    return { success: true };
  } catch (err) {
    logger.error("updateInvestment failed", err);
    return { success: false, error: "Failed to update investment." };
  }
}

export async function deleteInvestment(id: string): Promise<ActionResult> {
  const session = await getCurrentSession();
  if (!session?.user?.id) return { success: false, error: "You must be signed in." };
  try {
    await investmentService.remove(id, session.user.id);
    revalidatePath("/investments");
    revalidatePath("/dashboard");
    return { success: true };
  } catch (err) {
    logger.error("deleteInvestment failed", err);
    return { success: false, error: "Failed to delete investment." };
  }
}

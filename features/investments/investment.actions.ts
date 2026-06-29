"use server";

import { revalidatePath } from "next/cache";
import { getCurrentSession } from "@/lib/better-auth/auth";
import { logger } from "@/core/logger";
import { investmentService } from "./investment.service";
import { parseInput } from "@/core/validation/parse";
import { createInvestmentSchema, updateInvestmentSchema } from "./investment.schema";
import { parseHoldingsFile, importHoldings, type HoldingsImportResult } from "./holdings-import.service";
import type {
  Investment,
  CreateInvestmentInput,
  UpdateInvestmentInput,
} from "./investment.types";

type ActionResult = { success: boolean; error?: string };

/** Import a broker holdings export (INDmoney/Groww/Zerodha CSV·XLSX·PDF). */
export async function importBrokerHoldings(formData: FormData): Promise<HoldingsImportResult> {
  const session = await getCurrentSession();
  if (!session?.user?.id) return { success: false, inserted: 0, updated: 0, rejected: 0, error: "You must be signed in." };

  const file = formData.get("file");
  if (!(file instanceof File)) return { success: false, inserted: 0, updated: 0, rejected: 0, error: "No file was uploaded." };
  if (file.size > 8 * 1024 * 1024) return { success: false, inserted: 0, updated: 0, rejected: 0, error: "File is too large (max 8 MB)." };

  const password = String(formData.get("password") ?? "");
  try {
    const holdings = await parseHoldingsFile(file, password);
    const result = await importHoldings(session.user.id, holdings);
    revalidatePath("/investments"); revalidatePath("/dashboard");
    return result;
  } catch (error) {
    logger.error("Holdings import failed", error);
    return { success: false, inserted: 0, updated: 0, rejected: 0, error: error instanceof Error ? error.message : "The file could not be imported." };
  }
}

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
  const parsed = parseInput(createInvestmentSchema, input);
  if (!parsed.success) return { success: false, error: parsed.error };
  try {
    await investmentService.create(session.user.id, parsed.data as CreateInvestmentInput);
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
  const parsed = parseInput(updateInvestmentSchema, input);
  if (!parsed.success) return { success: false, error: parsed.error };
  try {
    await investmentService.update(id, session.user.id, parsed.data as UpdateInvestmentInput);
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

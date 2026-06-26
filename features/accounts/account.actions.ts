"use server";

import { revalidatePath } from "next/cache";
import { getCurrentSession } from "@/lib/better-auth/auth";
import { logger } from "@/core/logger";
import { accountService } from "./account.service";
import type { Account, CreateAccountInput, UpdateAccountInput } from "./account.types";

type ActionResult = { success: boolean; error?: string };

export async function getMyAccounts(): Promise<Account[]> {
  const session = await getCurrentSession();
  if (!session?.user?.id) return [];
  try {
    return await accountService.list(session.user.id);
  } catch (err) {
    logger.error("getMyAccounts failed", err);
    return [];
  }
}

export async function createAccount(input: CreateAccountInput): Promise<ActionResult> {
  const session = await getCurrentSession();
  if (!session?.user?.id) return { success: false, error: "You must be signed in." };
  try {
    await accountService.create(session.user.id, input);
    revalidatePath("/accounts");
    revalidatePath("/dashboard");
    return { success: true };
  } catch (err) {
    logger.error("createAccount failed", err);
    return { success: false, error: "Failed to add account." };
  }
}

export async function updateAccount(
  id: string,
  input: UpdateAccountInput,
): Promise<ActionResult> {
  const session = await getCurrentSession();
  if (!session?.user?.id) return { success: false, error: "You must be signed in." };
  try {
    await accountService.update(id, session.user.id, input);
    revalidatePath("/accounts");
    revalidatePath("/dashboard");
    return { success: true };
  } catch (err) {
    logger.error("updateAccount failed", err);
    return { success: false, error: "Failed to update account." };
  }
}

export async function deleteAccount(id: string): Promise<ActionResult> {
  const session = await getCurrentSession();
  if (!session?.user?.id) return { success: false, error: "You must be signed in." };
  try {
    await accountService.remove(id, session.user.id);
    revalidatePath("/accounts");
    revalidatePath("/dashboard");
    return { success: true };
  } catch (err) {
    logger.error("deleteAccount failed", err);
    return { success: false, error: "Failed to delete account." };
  }
}

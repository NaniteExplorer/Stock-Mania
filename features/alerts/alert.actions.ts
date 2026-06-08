"use server";

import { getCurrentSession } from "@/lib/better-auth/auth";
import { alertService } from "./alert.service";
import type { CreateAlertInput, PriceAlert } from "./alert.types";

export async function createAlert(
  input: CreateAlertInput,
): Promise<{ success: true; alert: PriceAlert } | { success: false; error: string }> {
  const session = await getCurrentSession();
  if (!session?.user) return { success: false, error: "Not authenticated." };
  try {
    const alert = await alertService.create(session.user.id, input);
    return { success: true, alert };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to create alert.",
    };
  }
}

export async function getUserAlerts(): Promise<PriceAlert[]> {
  const session = await getCurrentSession();
  if (!session?.user) return [];
  return alertService.listForUser(session.user.id);
}

export async function cancelAlert(
  id: string,
): Promise<{ success: boolean; error?: string }> {
  const session = await getCurrentSession();
  if (!session?.user) return { success: false, error: "Not authenticated." };
  try {
    await alertService.cancel(id, session.user.id);
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to cancel alert.",
    };
  }
}

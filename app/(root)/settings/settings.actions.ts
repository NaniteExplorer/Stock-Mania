"use server";

import { getCurrentSession } from "@/lib/better-auth/auth";
import { userPreferencesService } from "@/features/user/user.preferences";

interface SavePrefsInput {
  displayCurrency: string;
}

export async function saveUserPreferences(
  input: SavePrefsInput,
): Promise<{ success: boolean; error?: string }> {
  const session = await getCurrentSession();
  if (!session?.user) return { success: false, error: "Not authenticated." };

  try {
    await userPreferencesService.update(session.user.id, input);
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to save preferences.",
    };
  }
}

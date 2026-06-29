"use server";

import { revalidatePath } from "next/cache";
import { getCurrentSession } from "@/lib/better-auth/auth";
import { logger } from "@/core/logger";
import { assetService } from "./asset.service";
import { parseInput } from "@/core/validation/parse";
import { createAssetSchema, updateAssetSchema } from "./asset.schema";
import type { Asset, CreateAssetInput, UpdateAssetInput } from "./asset.types";

type ActionResult = { success: boolean; error?: string };

export async function getMyAssets(): Promise<Asset[]> {
  const session = await getCurrentSession();
  if (!session?.user?.id) return [];
  try {
    return await assetService.list(session.user.id);
  } catch (err) {
    logger.error("getMyAssets failed", err);
    return [];
  }
}

export async function createAsset(input: CreateAssetInput): Promise<ActionResult> {
  const session = await getCurrentSession();
  if (!session?.user?.id) return { success: false, error: "You must be signed in." };
  const parsed = parseInput(createAssetSchema, input);
  if (!parsed.success) return { success: false, error: parsed.error };
  try {
    await assetService.create(session.user.id, parsed.data as CreateAssetInput);
    revalidatePath("/assets");
    revalidatePath("/dashboard");
    return { success: true };
  } catch (err) {
    logger.error("createAsset failed", err);
    return { success: false, error: "Failed to add asset." };
  }
}

export async function updateAsset(id: string, input: UpdateAssetInput): Promise<ActionResult> {
  const session = await getCurrentSession();
  if (!session?.user?.id) return { success: false, error: "You must be signed in." };
  const parsed = parseInput(updateAssetSchema, input);
  if (!parsed.success) return { success: false, error: parsed.error };
  try {
    await assetService.update(id, session.user.id, parsed.data as UpdateAssetInput);
    revalidatePath("/assets");
    revalidatePath("/dashboard");
    return { success: true };
  } catch (err) {
    logger.error("updateAsset failed", err);
    return { success: false, error: "Failed to update asset." };
  }
}

export async function deleteAsset(id: string): Promise<ActionResult> {
  const session = await getCurrentSession();
  if (!session?.user?.id) return { success: false, error: "You must be signed in." };
  try {
    await assetService.remove(id, session.user.id);
    revalidatePath("/assets");
    revalidatePath("/dashboard");
    return { success: true };
  } catch (err) {
    logger.error("deleteAsset failed", err);
    return { success: false, error: "Failed to delete asset." };
  }
}

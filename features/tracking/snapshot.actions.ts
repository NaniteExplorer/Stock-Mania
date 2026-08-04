"use server";

import { revalidatePath } from "next/cache";
import { getCurrentSession } from "@/lib/better-auth/auth";
import { logger } from "@/core/logger";
import { parseInput } from "@/core/validation/parse";
import { snapshotService } from "./snapshot.service";
import { captureSnapshotSchema, editSnapshotSchema, importSnapshotsSchema, saveMonthlySnapshotSchema } from "./snapshot.schema";
import type { EditSnapshotInput, NetWorthSnapshot, SaveMonthlySnapshotInput, SnapshotCsvRow, SnapshotTimelinePoint } from "./tracking.types";

type ActionResult = { success: boolean; error?: string };

export async function getMySnapshots(): Promise<NetWorthSnapshot[]> {
  const session = await getCurrentSession();
  if (!session?.user?.id) return [];
  try {
    return await snapshotService.list(session.user.id);
  } catch (err) {
    logger.error("getMySnapshots failed", err);
    return [];
  }
}

export async function getMySnapshotTimeline(): Promise<SnapshotTimelinePoint[]> {
  const session = await getCurrentSession();
  if (!session?.user?.id) return [];
  try {
    return await snapshotService.timeline(session.user.id);
  } catch (err) {
    logger.error("getMySnapshotTimeline failed", err);
    return [];
  }
}

export async function getLatestSnapshot(): Promise<NetWorthSnapshot | null> {
  const session = await getCurrentSession();
  if (!session?.user?.id) return null;
  try {
    return await snapshotService.latest(session.user.id);
  } catch (err) {
    logger.error("getLatestSnapshot failed", err);
    return null;
  }
}

export async function captureSnapshotNow(): Promise<ActionResult> {
  const session = await getCurrentSession();
  if (!session?.user?.id) return { success: false, error: "You must be signed in." };
  const parsed = parseInput(captureSnapshotSchema, { source: "MANUAL", overwrite: true });
  if (!parsed.success) return { success: false, error: parsed.error };
  try {
    await snapshotService.capture(session.user.id, parsed.data);
    revalidatePath("/dashboard");
    revalidatePath("/history");
    return { success: true };
  } catch (err) {
    logger.error("captureSnapshotNow failed", err);
    return { success: false, error: "Failed to capture snapshot." };
  }
}

export async function saveMonthlySnapshot(input: SaveMonthlySnapshotInput): Promise<ActionResult> {
  const session = await getCurrentSession();
  if (!session?.user?.id) return { success: false, error: "You must be signed in." };
  const parsed = parseInput(saveMonthlySnapshotSchema, input);
  if (!parsed.success) return { success: false, error: parsed.error };
  try {
    await snapshotService.saveMonthly(session.user.id, parsed.data as SaveMonthlySnapshotInput);
    revalidatePath("/dashboard");
    revalidatePath("/history");
    return { success: true };
  } catch (err) {
    logger.error("saveMonthlySnapshot failed", err);
    return { success: false, error: "Failed to save the monthly entry." };
  }
}

export async function editSnapshot(id: string, input: EditSnapshotInput): Promise<ActionResult> {
  const session = await getCurrentSession();
  if (!session?.user?.id) return { success: false, error: "You must be signed in." };
  const parsed = parseInput(editSnapshotSchema, input);
  if (!parsed.success) return { success: false, error: parsed.error };
  try {
    await snapshotService.edit(id, session.user.id, parsed.data as EditSnapshotInput);
    revalidatePath("/dashboard");
    revalidatePath("/history");
    return { success: true };
  } catch (err) {
    logger.error("editSnapshot failed", err);
    return { success: false, error: "Failed to update snapshot." };
  }
}

export async function deleteSnapshot(id: string): Promise<ActionResult> {
  const session = await getCurrentSession();
  if (!session?.user?.id) return { success: false, error: "You must be signed in." };
  try {
    await snapshotService.remove(id, session.user.id);
    revalidatePath("/dashboard");
    revalidatePath("/history");
    return { success: true };
  } catch (err) {
    logger.error("deleteSnapshot failed", err);
    return { success: false, error: "Failed to delete snapshot." };
  }
}

export async function importSnapshotsCsv(
  rows: SnapshotCsvRow[],
  overwrite = false,
): Promise<ActionResult & { inserted?: number; updated?: number; kept?: number }> {
  const session = await getCurrentSession();
  if (!session?.user?.id) return { success: false, error: "You must be signed in." };
  const parsed = parseInput(importSnapshotsSchema, { rows, overwrite });
  if (!parsed.success) return { success: false, error: parsed.error };
  try {
    const result = await snapshotService.persistImportedRows(
      session.user.id,
      parsed.data.rows as SnapshotCsvRow[],
      parsed.data.overwrite ?? false,
    );
    revalidatePath("/dashboard");
    revalidatePath("/history");
    return { success: true, ...result };
  } catch (err) {
    logger.error("importSnapshotsCsv failed", err);
    return { success: false, error: "Failed to import history." };
  }
}

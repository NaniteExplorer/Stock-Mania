"use server";

import { revalidatePath } from "next/cache";
import { getCurrentSession } from "@/lib/better-auth/auth";
import { logger } from "@/core/logger";
import { isDriveConfigured } from "@/core/integrations/google-drive";
import { driveImportService, type DriveImportSummary } from "./drive-import.service";
import type { ImportLogDoc } from "./import-log.model";

export interface DriveImportStatus {
  configured: boolean;
  runs: {
    fileName: string;
    status: string;
    tradesBooked: number;
    error: string | null;
    ranAt: string;
  }[];
}

export async function getDriveImportStatus(): Promise<DriveImportStatus> {
  const session = await getCurrentSession();
  if (!session?.user?.id) return { configured: false, runs: [] };
  try {
    const runs = await driveImportService.recentRuns(10);
    return {
      configured: isDriveConfigured(),
      runs: runs.map((r: ImportLogDoc) => ({
        fileName: r.fileName,
        status: r.status,
        tradesBooked: r.tradesBooked,
        error: r.error,
        ranAt: new Date(r.ranAt).toISOString(),
      })),
    };
  } catch (err) {
    logger.error("getDriveImportStatus failed", err);
    return { configured: isDriveConfigured(), runs: [] };
  }
}

export async function runDriveImportNow(): Promise<DriveImportSummary & { success: boolean; error?: string }> {
  const session = await getCurrentSession();
  if (!session?.user?.id) {
    return { success: false, error: "You must be signed in.", configured: false, filesSeen: 0, filesImported: 0, filesSkipped: 0, tradesBooked: 0, errors: 0 };
  }
  try {
    const summary = await driveImportService.pollAndImport();
    revalidatePath("/investments");
    revalidatePath("/settings");
    return { success: true, ...summary };
  } catch (err) {
    logger.error("runDriveImportNow failed", err);
    return { success: false, error: "Drive import failed.", configured: true, filesSeen: 0, filesImported: 0, filesSkipped: 0, tradesBooked: 0, errors: 1 };
  }
}

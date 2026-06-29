import { connectToDatabase } from "@/core/db/connection";
import { config } from "@/core/config/env";
import { logger } from "@/core/logger";
import { isDriveConfigured, listFolderPdfs, downloadFile } from "@/core/integrations/google-drive";
import { extractPdfText } from "@/features/transactions/pdf-parser";
import { parseTradesFromText, kindFromFilename } from "@/features/trades/ai-trade-parser.service";
import { tradeService } from "@/features/trades/trade.service";
import { ImportLog, type ImportLogDoc } from "./import-log.model";

export interface DriveImportSummary {
  configured: boolean;
  filesSeen: number;
  filesImported: number;
  filesSkipped: number;
  tradesBooked: number;
  errors: number;
  message?: string;
}

export const driveImportService = {
  /**
   * Poll the shared Drive folder, parse new purchase PDFs into trades, and book
   * them (dedup-safe via the trade fingerprint). Idempotent: a file version is
   * processed once, and re-parsing the same trades inserts nothing new.
   */
  async pollAndImport(): Promise<DriveImportSummary> {
    const empty: DriveImportSummary = { configured: false, filesSeen: 0, filesImported: 0, filesSkipped: 0, tradesBooked: 0, errors: 0 };
    if (!isDriveConfigured()) return { ...empty, message: "Drive not configured." };

    const ownerUserId = config.drive().importUserId;
    if (!ownerUserId) return { ...empty, configured: true, message: "Set DRIVE_IMPORT_USER_ID to the owning user." };

    await connectToDatabase();
    const files = await listFolderPdfs();
    let filesImported = 0;
    let filesSkipped = 0;
    let tradesBooked = 0;
    let errors = 0;

    for (const file of files) {
      const already = await ImportLog.findOne({ fileId: file.id, modifiedTime: file.modifiedTime }).lean();
      if (already) {
        filesSkipped++;
        continue;
      }
      try {
        const bytes = await downloadFile(file.id);
        const text = await extractPdfText(bytes);
        const kind = kindFromFilename(file.name);
        const trades = await parseTradesFromText(text, kind);
        let booked = 0;
        for (const trade of trades) {
          const { created } = await tradeService.add(ownerUserId, trade);
          if (created) booked++;
        }
        await ImportLog.create({
          fileId: file.id, modifiedTime: file.modifiedTime, fileName: file.name,
          status: "IMPORTED", tradesBooked: booked, error: null, ranAt: new Date(),
        });
        filesImported++;
        tradesBooked += booked;
      } catch (err) {
        errors++;
        logger.error("Drive import failed for file", err, { fileName: file.name });
        await ImportLog.create({
          fileId: file.id, modifiedTime: file.modifiedTime, fileName: file.name,
          status: "ERROR", tradesBooked: 0, error: (err as Error).message?.slice(0, 300) ?? "error", ranAt: new Date(),
        }).catch(() => undefined);
      }
    }

    const summary = { configured: true, filesSeen: files.length, filesImported, filesSkipped, tradesBooked, errors };
    logger.info("Drive import run complete", { ...summary });
    return summary;
  },

  async recentRuns(limit = 10): Promise<ImportLogDoc[]> {
    await connectToDatabase();
    return ImportLog.find({}).sort({ ranAt: -1 }).limit(limit).lean<ImportLogDoc[]>();
  },
};

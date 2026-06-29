import { drive as driveApi, type drive_v3 } from "@googleapis/drive";
import { JWT } from "google-auth-library";
import { config } from "@/core/config/env";
import { logger } from "@/core/logger";

/**
 * Minimal Google Drive client using a service account. Share a Drive folder
 * with the service-account email; this lists and downloads files from it.
 * Read-only scope — we never write to the user's Drive.
 */
const SCOPES = ["https://www.googleapis.com/auth/drive.readonly"];

export interface DriveFile {
  id: string;
  name: string;
  modifiedTime: string;
  mimeType: string;
}

export function isDriveConfigured(): boolean {
  const { serviceAccountJson, folderId } = config.drive();
  return Boolean(serviceAccountJson && folderId);
}

function driveClient(): drive_v3.Drive {
  const { serviceAccountJson } = config.drive();
  if (!serviceAccountJson) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON not set");
  const credentials = JSON.parse(serviceAccountJson) as { client_email: string; private_key: string };
  const auth = new JWT({
    email: credentials.client_email,
    key: credentials.private_key,
    scopes: SCOPES,
  });
  // Cast past the dual-copy google-auth-library type skew (@googleapis/drive
  // bundles its own copy); the JWT client is runtime-correct.
  const options = { version: "v3", auth } as unknown as Parameters<typeof driveApi>[0];
  return driveApi(options);
}

/** List PDF files in the configured folder (most-recently-modified first). */
export async function listFolderPdfs(): Promise<DriveFile[]> {
  const { folderId } = config.drive();
  if (!folderId) return [];
  try {
    const drive = driveClient();
    const res = await drive.files.list({
      q: `'${folderId}' in parents and mimeType = 'application/pdf' and trashed = false`,
      fields: "files(id, name, modifiedTime, mimeType)",
      orderBy: "modifiedTime desc",
      pageSize: 100,
    });
    return (res.data.files ?? []).map((f) => ({
      id: f.id!,
      name: f.name ?? "",
      modifiedTime: f.modifiedTime ?? "",
      mimeType: f.mimeType ?? "application/pdf",
    }));
  } catch (err) {
    logger.error("Drive list failed", err);
    throw err;
  }
}

/** Download a file's bytes. */
export async function downloadFile(fileId: string): Promise<Uint8Array> {
  const drive = driveClient();
  const res = await drive.files.get(
    { fileId, alt: "media" },
    { responseType: "arraybuffer" },
  );
  return new Uint8Array(res.data as ArrayBuffer);
}

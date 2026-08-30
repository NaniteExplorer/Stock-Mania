import "server-only";

import { createCipheriv, randomBytes } from "node:crypto";
import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { and, eq } from "drizzle-orm";
import { newUuid, type UserId } from "@/core/kernel";
import { config } from "@/core/config";
import { db } from "@/infra/db/client";
import { documents } from "@/infra/db/schema";

const MAGIC = Buffer.from("SMDA1", "ascii");

/**
 * Saves an uploaded source file once, addressed by its SHA-256.
 *
 * AES-256-GCM supplies confidentiality and tamper detection. A fresh nonce is
 * prepended to each ciphertext with a format marker and authentication tag. The
 * database stores only metadata and a relative storage key, keeping multi-MB
 * statements out of libSQL. The final rename is atomic on the same volume.
 */
export async function archiveImportDocument(input: {
  userId: UserId;
  sha256: string;
  filename: string;
  mimeType: string;
  bytes: Uint8Array;
  batchId: string;
}): Promise<"stored" | "already-stored" | "disabled"> {
  const settings = config.documents();
  if (!settings) return "disabled";
  if (!/^[a-f0-9]{64}$/.test(input.sha256)) throw new Error("Invalid document SHA-256.");

  const [existing] = await db
    .select({ id: documents.id })
    .from(documents)
    .where(and(eq(documents.userId, input.userId.value), eq(documents.sha256, input.sha256)))
    .limit(1);
  if (existing) return "already-stored";

  const relativeKey = join(input.userId.value, `${input.sha256}.smda`);
  const root = resolve(settings.directory);
  const destination = resolve(root, relativeKey);
  if (!destination.startsWith(root + "\\") && !destination.startsWith(root + "/")) {
    throw new Error("Document storage path escaped its configured root.");
  }

  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", settings.key, nonce);
  cipher.setAAD(Buffer.from(`${input.userId.value}:${input.sha256}`, "utf8"));
  const encrypted = Buffer.concat([cipher.update(input.bytes), cipher.final()]);
  const payload = Buffer.concat([MAGIC, nonce, cipher.getAuthTag(), encrypted]);
  const temporary = `${destination}.${newUuid()}.tmp`;

  await mkdir(dirname(destination), { recursive: true });
  await writeFile(temporary, payload, { flag: "wx", mode: 0o600 });
  try {
    await rename(temporary, destination);
    await db.insert(documents).values({
      id: newUuid(),
      userId: input.userId.value,
      sha256: input.sha256,
      filename: input.filename,
      mimeType: input.mimeType || "application/octet-stream",
      byteLength: input.bytes.byteLength,
      storageKey: relativeKey.replaceAll("\\", "/"),
      entityType: "IMPORT_BATCH",
      entityId: input.batchId,
    });
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
  return "stored";
}

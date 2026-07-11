import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { config } from "@/core/config/env";

/**
 * Small AES-256-GCM secretbox for encrypting secrets at rest (e.g. broker
 * access tokens in Redis). Key is derived from BETTER_AUTH_SECRET, so no new
 * env var is needed; rotating that secret invalidates stored ciphertexts.
 *
 * Format: base64(iv | authTag | ciphertext), prefixed with "v1:".
 */
const VERSION = "v1:";

const key = () =>
  createHash("sha256").update(`secretbox:${config.auth().secret}`).digest();

export function seal(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return VERSION + Buffer.concat([iv, tag, ciphertext]).toString("base64");
}

export function open(sealed: string): string | null {
  if (!sealed.startsWith(VERSION)) return null;
  try {
    const raw = Buffer.from(sealed.slice(VERSION.length), "base64");
    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(12, 28);
    const ciphertext = raw.subarray(28);
    const decipher = createDecipheriv("aes-256-gcm", key(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    return null; // tampered / wrong key / legacy value
  }
}

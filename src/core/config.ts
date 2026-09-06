/**
 * Validated, server-only configuration.
 *
 * The plan of record's file tree omits this module; `core/` is where it belongs,
 * since everything from the db client to the auth instance reads it.
 *
 * Each group is read lazily on first access, so importing this module never
 * throws during `next build` when unrelated variables happen to be absent — a
 * missing SMTP password must not break a page that only reads the ledger.
 *
 * Never import this from a Client Component; it reads secrets. Client-safe
 * values belong in `src/core/public.ts`.
 */

export class MissingEnvError extends Error {
  constructor(key: string, hint?: string) {
    super(
      `Missing required environment variable ${key}.` +
        (hint ? ` ${hint}` : " Add it to your .env.local file."),
    );
    this.name = "MissingEnvError";
  }
}

function read(key: string): string | undefined {
  const raw = process.env[key];
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  return trimmed === "" ? undefined : trimmed;
}

function required(key: string, hint?: string): string {
  const value = read(key);
  if (value === undefined) throw new MissingEnvError(key, hint);
  return value;
}

type NodeEnv = "development" | "production" | "test";

const nodeEnv = (): NodeEnv => (read("NODE_ENV") as NodeEnv | undefined) ?? "development";
const baseUrl = () => read("NEXT_PUBLIC_BASE_URL") ?? "http://localhost:3000";

export const config = {
  app: () => ({
    nodeEnv: nodeEnv(),
    isProduction: nodeEnv() === "production",
    baseUrl: baseUrl(),
  }),

  /**
   * libSQL connection. Two shapes, same driver:
   *   local  — `DATABASE_URL=file:./data/finance.db` (no token)
   *   hosted — `DATABASE_URL=libsql://<db>.turso.io` + `DATABASE_AUTH_TOKEN`
   */
  db: () => {
    const url = required(
      "DATABASE_URL",
      'Use "file:./data/finance.db" locally, or your libsql:// URL from Turso.',
    );
    const authToken = read("DATABASE_AUTH_TOKEN");
    if (url.startsWith("libsql://") && !authToken) {
      throw new MissingEnvError(
        "DATABASE_AUTH_TOKEN",
        "A remote libsql:// database needs an auth token (`turso db tokens create <db>`).",
      );
    }
    return { url, authToken };
  },

  auth: () => ({
    secret: required("BETTER_AUTH_SECRET", "Generate one with: openssl rand -base64 32"),
    baseUrl: read("BETTER_AUTH_URL") ?? baseUrl(),
  }),

  /**
   * SMTP for verification and password-reset mail. Optional: when absent, those
   * emails are skipped and sign-up stays usable in local development.
   */
  email: () => {
    const user = read("SMTP_USER");
    const password = read("SMTP_PASSWORD");
    if (!user || !password) return null;
    return {
      user,
      password,
      host: read("SMTP_HOST") ?? "smtp.gmail.com",
      port: Number(read("SMTP_PORT") ?? 465),
    };
  },

  marketData: () => ({
    /** Optional production quote feed. The token is server-only. */
    finnhubToken: read("FINNHUB_API_TOKEN"),
    /** Shared secret used by the scheduled market refresh endpoint. */
    cronSecret: read("CRON_SECRET"),
  }),

  /**
   * Optional encrypted source-document archive. The directory must be durable in
   * production (a mounted volume); the key is 32 random bytes encoded as base64.
   * Supplying only one setting is rejected so files are never silently written
   * unencrypted or to an unintended ephemeral directory.
   */
  documents: () => {
    const directory = read("DOCUMENT_STORAGE_DIR");
    const encodedKey = read("DOCUMENT_ENCRYPTION_KEY");
    if (!directory && !encodedKey) return null;
    if (!directory) throw new MissingEnvError("DOCUMENT_STORAGE_DIR");
    if (!encodedKey) throw new MissingEnvError("DOCUMENT_ENCRYPTION_KEY");
    const key = Buffer.from(encodedKey, "base64");
    if (key.length !== 32) {
      throw new Error("DOCUMENT_ENCRYPTION_KEY must decode to exactly 32 bytes.");
    }
    return { directory, key };
  },
} as const;

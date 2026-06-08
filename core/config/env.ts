/**
 * Centralized, validated, server-only configuration.
 *
 * Single source of truth for environment variables on the server. Each group is
 * read and validated lazily (on first access) so importing this module never
 * throws during `next build` when some variables may be absent. Required values
 * throw a clear error the first time they're actually needed.
 *
 * IMPORTANT: Do NOT import this module into Client Components — it reads secrets.
 * For client-safe values use core/config/public.ts.
 */

import { logger } from "@/core/logger";

class EnvError extends Error {
  constructor(key: string) {
    super(
      `[config] Missing required environment variable: ${key}. ` +
        `Add it to your .env file.`,
    );
    this.name = "EnvError";
  }
}

function read(key: string): string | undefined {
  const value = process.env[key];
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

function requireEnv(key: string): string {
  const value = read(key);
  if (value === undefined) throw new EnvError(key);
  return value;
}

function readList(key: string): string[] | null {
  const value = read(key);
  if (!value) return null;
  const list = value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  return list.length ? list : null;
}

type NodeEnv = "development" | "production" | "test";

const baseUrl = () => read("NEXT_PUBLIC_BASE_URL") ?? "http://localhost:3000";

/**
 * Grouped configuration accessors. Each call validates only the variables that
 * group needs, so unrelated missing values never block a feature that doesn't
 * use them.
 */
export const config = {
  app: () => ({
    nodeEnv: (read("NODE_ENV") as NodeEnv | undefined) ?? "development",
    baseUrl: baseUrl(),
  }),

  db: () => ({
    uri: requireEnv("MONGODB_URI"),
    dnsServers: readList("MONGODB_DNS_SERVERS"),
  }),

  auth: () => ({
    secret: requireEnv("BETTER_AUTH_SECRET"),
    baseUrl: read("BETTER_AUTH_URL") ?? baseUrl(),
    apiKey: read("BETTER_AUTH_API_KEY") ?? null,
  }),

  ai: () => ({
    // Optional: AI features degrade gracefully when this is absent.
    geminiApiKey: read("GEMINI_API_KEY") ?? null,
  }),

  email: () => ({
    user: requireEnv("NODEMAILER_EMAIL"),
    password: requireEnv("NODEMAILER_PASSWORD"),
  }),

  finnhub: () => {
    const serverKey = read("FINNHUB_API_KEY");
    const legacyPublicKey = read("NEXT_PUBLIC_FINNHUB_API_KEY");
    if (!serverKey && legacyPublicKey) {
      // The NEXT_PUBLIC_ prefix risks shipping the key to the browser bundle.
      logger.warn(
        "Using NEXT_PUBLIC_FINNHUB_API_KEY. Move it to a server-only FINNHUB_API_KEY — it must never reach the client.",
      );
    }
    return {
      apiKey: serverKey ?? legacyPublicKey ?? null,
      baseUrl: read("FINNHUB_BASE_URL") ?? "https://finnhub.io/api/v1",
    };
  },

  inngest: () => ({
    isDev: read("INNGEST_DEV") === "1",
  }),

  redis: () => ({
    url: read("REDIS_URL") ?? null,
  }),

  kafka: () => ({
    brokers: readList("KAFKA_BROKERS"),
    username: read("KAFKA_SASL_USERNAME") ?? null,
    password: read("KAFKA_SASL_PASSWORD") ?? null,
    clientId: read("KAFKA_CLIENT_ID") ?? "stockmania",
  }),

  zerodha: () => ({
    apiKey: requireEnv("ZERODHA_API_KEY"),
    apiSecret: requireEnv("ZERODHA_API_SECRET"),
    redirectUrl:
      read("ZERODHA_REDIRECT_URL") ??
      `${baseUrl()}/api/zerodha/callback`,
  }),

  twilio: () => ({
    accountSid: read("TWILIO_ACCOUNT_SID") ?? null,
    authToken: read("TWILIO_AUTH_TOKEN") ?? null,
    from: read("TWILIO_WHATSAPP_FROM") ?? "whatsapp:+14155238886",
  }),

  alpaca: () => ({
    apiKey: read("ALPACA_API_KEY") ?? null,
    apiSecret: read("ALPACA_API_SECRET") ?? null,
    baseUrl: read("ALPACA_BASE_URL") ?? "https://paper-api.alpaca.markets",
    live: read("ALPACA_LIVE") === "true",
  }),
} as const;

/**
 * Validate critical configuration at boot. Logs problems for visibility but does
 * not crash the build; the grouped accessors still throw lazily the first time a
 * missing value is actually used.
 */
export function validateServerConfig(): void {
  const problems: string[] = [];
  try {
    config.db();
  } catch (e) {
    problems.push((e as Error).message);
  }
  try {
    config.auth();
  } catch (e) {
    problems.push((e as Error).message);
  }
  try {
    config.email();
  } catch (e) {
    problems.push((e as Error).message);
  }

  if (!config.ai().geminiApiKey) {
    logger.warn("GEMINI_API_KEY not set — AI emails fall back to static copy.");
  }
  if (!config.finnhub().apiKey) {
    logger.warn(
      "FINNHUB_API_KEY not set — market data and search are unavailable.",
    );
  }
  if (!config.redis().url) {
    logger.warn(
      "REDIS_URL not set — cache and rate-limits are in-process only (single instance).",
    );
  }
  if (!config.kafka().brokers?.length) {
    logger.warn(
      "KAFKA_BROKERS not set — domain events route through Inngest only.",
    );
  }
  if (!config.twilio().accountSid) {
    logger.warn("TWILIO_ACCOUNT_SID not set — WhatsApp alerts disabled.");
  }
  if (!config.alpaca().apiKey) {
    logger.warn("ALPACA_API_KEY not set — US stock trading disabled (paper mode).");
  }

  try {
    config.zerodha();
  } catch (e) {
    problems.push((e as Error).message);
  }

  if (problems.length > 0) {
    logger.error("Server configuration incomplete at boot", undefined, {
      problems,
    });
  } else {
    logger.info("Server configuration validated");
  }
}

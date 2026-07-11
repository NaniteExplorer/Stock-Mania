import mongoose from "mongoose";
import dns from "node:dns";
import { config } from "@/core/config/env";
import { logger } from "@/core/logger";

/**
 * Mongoose connection with a global cache (required for serverless / hot-reload
 * so we don't open a new pool on every invocation).
 *
 * Resilience: connect attempts fail fast (5s server selection) and a failed
 * attempt is memoized for a short window so a burst of concurrent requests
 * during an outage doesn't thundering-herd reconnects — they all fail fast
 * with the same cached error until the window expires.
 *
 * SCALE: when migrating to Postgres, this is replaced by a pooled client and the
 * repositories in features/* switch to the new implementation behind the
 * Repository interface (core/db/repository.ts) — services stay untouched.
 */
const globalForMongoose = globalThis as unknown as {
  mongooseCache?: {
    conn: typeof mongoose | null;
    promise: Promise<typeof mongoose> | null;
    lastFailureAt: number;
    lastFailure: Error | null;
  };
};

const cached =
  globalForMongoose.mongooseCache ??
  (globalForMongoose.mongooseCache = {
    conn: null,
    promise: null,
    lastFailureAt: 0,
    lastFailure: null,
  });

/** How long a failed connect is memoized before we retry. */
const FAILURE_BACKOFF_MS = 10_000;

export class DatabaseUnavailableError extends Error {
  constructor(cause: unknown) {
    super("Database is unreachable");
    this.name = "DatabaseUnavailableError";
    this.cause = cause;
  }
}

export const connectToDatabase = async () => {
  if (cached.conn) return cached.conn;

  // Fail fast during an outage instead of re-dialing on every request.
  if (
    cached.lastFailure &&
    Date.now() - cached.lastFailureAt < FAILURE_BACKOFF_MS
  ) {
    throw new DatabaseUnavailableError(cached.lastFailure);
  }

  const { uri, dnsServers } = config.db();

  if (!cached.promise) {
    configureMongoSrvDns(uri, dnsServers);
    cached.promise = mongoose.connect(uri, {
      bufferCommands: false,
      serverSelectionTimeoutMS: 5_000,
      connectTimeoutMS: 10_000,
      maxPoolSize: 10,
    });
  }

  try {
    cached.conn = await cached.promise;
    cached.lastFailure = null;
    cached.lastFailureAt = 0;
  } catch (err) {
    cached.promise = null;
    cached.lastFailure = err instanceof Error ? err : new Error(String(err));
    cached.lastFailureAt = Date.now();
    logger.error("MongoDB connection failed — backing off", err, {
      backoffMs: FAILURE_BACKOFF_MS,
    });
    throw new DatabaseUnavailableError(err);
  }

  logger.info("Connected to MongoDB", { env: config.app().nodeEnv });
  return cached.conn;
};

const FALLBACK_DNS_SERVERS = ["1.1.1.1", "8.8.8.8"];

/**
 * SRV lookups (`mongodb+srv://`) fail on some local resolvers (loopback DNS,
 * captive portals). When the configured/system resolver can't serve SRV, point
 * Node's resolver at public DNS. Exported so boot-time instrumentation and the
 * lazy connection path share one implementation.
 *
 * NOTE: dns.setServers is process-wide; we only invoke it when strictly needed.
 */
export const configureMongoSrvDns = (
  uri: string,
  configuredServers: string[] | null,
) => {
  if (!uri.startsWith("mongodb+srv://")) return;

  const currentServers = dns.getServers();
  const shouldUseFallback =
    (configuredServers?.length ?? 0) > 0 ||
    currentServers.length === 0 ||
    currentServers.every(isLoopbackDnsServer);

  if (!shouldUseFallback) return;

  dns.setServers(
    configuredServers?.length ? configuredServers : FALLBACK_DNS_SERVERS,
  );
};

const isLoopbackDnsServer = (server: string) =>
  server === "127.0.0.1" ||
  server === "::1" ||
  server.startsWith("127.") ||
  server.toLowerCase().startsWith("[::1]");

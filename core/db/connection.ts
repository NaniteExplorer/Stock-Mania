import mongoose from "mongoose";
import dns from "node:dns";
import { config } from "@/core/config/env";
import { logger } from "@/core/logger";

/**
 * Mongoose connection with a global cache (required for serverless / hot-reload
 * so we don't open a new pool on every invocation).
 *
 * SCALE: when migrating to Postgres, this is replaced by a pooled client and the
 * repositories in features/* switch to the new implementation behind the
 * Repository interface (core/db/repository.ts) — services stay untouched.
 */
const globalForMongoose = globalThis as unknown as {
  mongooseCache?: {
    conn: typeof mongoose | null;
    promise: Promise<typeof mongoose> | null;
  };
};

const cached =
  globalForMongoose.mongooseCache ??
  (globalForMongoose.mongooseCache = { conn: null, promise: null });

export const connectToDatabase = async () => {
  if (cached.conn) return cached.conn;

  const { uri, dnsServers } = config.db();

  if (!cached.promise) {
    configureMongoSrvDns(uri, dnsServers);
    cached.promise = mongoose.connect(uri, { bufferCommands: false });
  }

  try {
    cached.conn = await cached.promise;
  } catch (err) {
    cached.promise = null;
    throw err;
  }

  logger.info("Connected to MongoDB", { env: config.app().nodeEnv });
  return cached.conn;
};

const FALLBACK_DNS_SERVERS = ["1.1.1.1", "8.8.8.8"];

const configureMongoSrvDns = (uri: string, configuredServers: string[] | null) => {
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

import mongoose from "mongoose";
import dns from "node:dns";

const MONGODB_URI = process.env.MONGODB_URI;
const FALLBACK_DNS_SERVERS = ["1.1.1.1", "8.8.8.8"];

declare global {
  var mongooseCache: {
    conn: typeof mongoose | null;
    promise: Promise<typeof mongoose> | null;
  };
}

let cached = global.mongooseCache;

if (!cached) {
  cached = global.mongooseCache = { conn: null, promise: null };
}

export const connectToDatabase = async () => {
  if (!MONGODB_URI) throw new Error("MONGODB_URI must be set within .env");

  if (cached.conn) return cached.conn;

  if (!cached.promise) {
    configureMongoSrvDns();
    cached.promise = mongoose.connect(MONGODB_URI, { bufferCommands: false });
  }

  try {
    cached.conn = await cached.promise;
  } catch (err) {
    cached.promise = null;
    throw err;
  }

  console.log(`Connected to database ${process.env.NODE_ENV}`);

  return cached.conn;
};

const configureMongoSrvDns = () => {
  if (!MONGODB_URI?.startsWith("mongodb+srv://")) return;

  const configuredServers = process.env.MONGODB_DNS_SERVERS?.split(",")
    .map((server) => server.trim())
    .filter(Boolean);

  const currentServers = dns.getServers();
  const shouldUseFallback =
    configuredServers?.length ||
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

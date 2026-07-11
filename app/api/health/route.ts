import { logger } from "@/core/logger";
import { enforceRequestRateLimit } from "@/core/http/rate-limit-request";

export const dynamic = "force-dynamic";

type ServiceStatus = "ok" | "degraded" | "down" | "disabled";

interface ServiceResult {
  status: ServiceStatus;
  latencyMs?: number;
  error?: string;
}

async function checkRedis(): Promise<ServiceResult> {
  if (!process.env.REDIS_URL) return { status: "disabled" };
  try {
    const { default: Redis } = await import("ioredis");
    const client = new Redis(process.env.REDIS_URL, {
      maxRetriesPerRequest: 1,
      connectTimeout: 3000,
      lazyConnect: true,
    });
    const t0 = Date.now();
    await client.connect();
    await client.ping();
    const latencyMs = Date.now() - t0;
    await client.quit();
    return { status: "ok", latencyMs };
  } catch (e) {
    logger.error("Redis health check failed", e);
    return { status: "down" };
  }
}

async function checkKafka(): Promise<ServiceResult> {
  if (!process.env.KAFKA_BROKERS) return { status: "disabled" };
  try {
    const { Kafka, logLevel } = await import("kafkajs");
    const kafka = new Kafka({
      clientId: "stockmania-health",
      brokers: process.env.KAFKA_BROKERS.split(",").map((b) => b.trim()),
      logLevel: logLevel.NOTHING,
      connectionTimeout: 3000,
      requestTimeout: 3000,
    });
    const admin = kafka.admin();
    const t0 = Date.now();
    await admin.connect();
    await admin.listTopics();
    const latencyMs = Date.now() - t0;
    await admin.disconnect();
    return { status: "ok", latencyMs };
  } catch (e) {
    logger.error("Kafka health check failed", e);
    return { status: "down" };
  }
}

async function checkMongo(): Promise<ServiceResult> {
  if (!process.env.MONGODB_URI) return { status: "disabled" };
  try {
    // Reuse the app's cached connection — probing shouldn't open new pools,
    // and during an outage it fails fast via the shared backoff.
    const { connectToDatabase } = await import("@/core/db/connection");
    const t0 = Date.now();
    const conn = await connectToDatabase();
    await conn.connection.db?.command({ ping: 1 });
    const latencyMs = Date.now() - t0;
    return { status: "ok", latencyMs };
  } catch (e) {
    logger.error("MongoDB health check failed", e);
    return { status: "down" };
  }
}

async function checkTwilio(): Promise<ServiceResult> {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) return { status: "disabled" };
  try {
    const t0 = Date.now();
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${sid}.json`,
      {
        headers: {
          Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`,
        },
        signal: AbortSignal.timeout(5000),
      },
    );
    const latencyMs = Date.now() - t0;
    if (res.status === 401) return { status: "down", error: "Invalid credentials" };
    if (!res.ok) return { status: "degraded", latencyMs, error: `HTTP ${res.status}` };
    return { status: "ok", latencyMs };
  } catch (e) {
    logger.error("Twilio health check failed", e);
    return { status: "down" };
  }
}

export async function GET(request: Request): Promise<Response> {
  // Monitoring endpoint — throttle to stop it being hammered for probing.
  const limited = await enforceRequestRateLimit(request, "health", 30, 60 * 1000);
  if (limited) return limited;

  const [redis, kafka, mongo, twilio] = await Promise.all([
    checkRedis(),
    checkKafka(),
    checkMongo(),
    checkTwilio(),
  ]);

  const services = { redis, kafka, mongo, twilio };
  const hasDown = Object.values(services).some((s) => s.status === "down");
  const overall = hasDown ? "degraded" : "ok";

  return Response.json(
    { status: overall, ts: Date.now(), services },
    { status: hasDown ? 503 : 200 },
  );
}

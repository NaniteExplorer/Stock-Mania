/**
 * stockMania — environment & connectivity checker
 * Run: node scripts/check-env.mjs
 *
 * Validates every env var group, then probes each live service.
 * Safe to run in CI — exits 0 if everything required is present,
 * exits 1 if a required service is unreachable.
 */
import "dotenv/config";

const RESET = "\x1b[0m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";

const ok = (msg) => console.log(`  ${GREEN}✓${RESET} ${msg}`);
const fail = (msg) => console.log(`  ${RED}✗${RESET} ${msg}`);
const warn = (msg) => console.log(`  ${YELLOW}!${RESET} ${msg}`);
const section = (title) => console.log(`\n${BOLD}${title}${RESET}`);
const dim = (msg) => console.log(`  ${DIM}${msg}${RESET}`);

function read(key) {
  const v = process.env[key];
  return v && v.trim() !== "" ? v.trim() : null;
}

function requireVar(key) {
  const v = read(key);
  if (v) {
    ok(`${key}`);
    return v;
  }
  fail(`${key} — MISSING (required)`);
  return null;
}

function optionalVar(key, note = "") {
  const v = read(key);
  if (v) {
    ok(`${key}`);
  } else {
    warn(`${key} — not set${note ? ` (${note})` : ""}`);
  }
  return v;
}

let hasErrors = false;

// ─── ENV VARS ────────────────────────────────────────────────────────────────

section("1. Core (required)");
const mongoUri = requireVar("MONGODB_URI") ?? (hasErrors = true, null);
const authSecret = requireVar("BETTER_AUTH_SECRET") ?? (hasErrors = true, null);
const emailUser = requireVar("NODEMAILER_EMAIL") ?? (hasErrors = true, null);
const emailPass = requireVar("NODEMAILER_PASSWORD") ?? (hasErrors = true, null);
requireVar("NEXT_PUBLIC_BASE_URL");

section("2. Zerodha Kite (required for Indian stock trading)");
const zerodhaKey = requireVar("ZERODHA_API_KEY") ?? (hasErrors = true, null);
const zerodhaSecret = requireVar("ZERODHA_API_SECRET") ?? (hasErrors = true, null);
optionalVar("ZERODHA_REDIRECT_URL", "defaults to BASE_URL/api/zerodha/callback");

section("3. Redis (optional — in-process fallback when not set)");
const redisUrl = optionalVar("REDIS_URL", "cache + rate-limiting will be in-memory only");
if (redisUrl && redisUrl.startsWith("https://")) {
  fail(
    `REDIS_URL starts with https:// — ioredis needs the rediss:// URL.\n` +
    `    Go to Upstash dashboard → your DB → Connect tab → copy the ioredis URL\n` +
    `    It looks like: rediss://default:<token>@<host>.upstash.io:6379`,
  );
  hasErrors = true;
}

section("4. Kafka (optional — Inngest fallback when not set)");
const kafkaBrokers = optionalVar("KAFKA_BROKERS", "events will route through Inngest");
if (kafkaBrokers) {
  optionalVar("KAFKA_SASL_USERNAME");
  const saslUser = read("KAFKA_SASL_USERNAME");
  if (saslUser) {
    const saslPass = optionalVar("KAFKA_SASL_PASSWORD", "required when KAFKA_SASL_USERNAME is set");
    if (!saslPass) { fail("KAFKA_SASL_PASSWORD — required when KAFKA_SASL_USERNAME is set"); hasErrors = true; }
  }
}

section("5. Twilio WhatsApp (optional — alerts disabled when not set)");
const twilioSid = optionalVar("TWILIO_ACCOUNT_SID");
const twilioToken = optionalVar("TWILIO_AUTH_TOKEN");
optionalVar("TWILIO_WHATSAPP_FROM", "defaults to sandbox number");

section("6. Alpaca US stocks (optional — US trading disabled)");
optionalVar("ALPACA_API_KEY");
optionalVar("ALPACA_API_SECRET");
optionalVar("ALPACA_BASE_URL", "defaults to paper-api.alpaca.markets");

section("7. AI / Finnhub (optional — graceful degradation)");
optionalVar("GEMINI_API_KEY", "AI emails fall back to static copy");
optionalVar("FINNHUB_API_KEY", "market data will be unavailable");

section("8. Inngest");
const inngestDev = read("INNGEST_DEV");
if (inngestDev === "1") {
  ok("INNGEST_DEV=1 (dev mode — no signing key needed)");
} else {
  optionalVar("INNGEST_SIGNING_KEY", "required in production");
  optionalVar("INNGEST_EVENT_KEY", "required in production");
}

// ─── CONNECTIVITY CHECKS ─────────────────────────────────────────────────────

section("9. Connectivity checks");

// MongoDB — apply DNS override before SRV lookup (same fix as scripts/db-check.mjs)
if (mongoUri) {
  process.stdout.write(`  ? MongoDB … `);
  try {
    if (mongoUri.startsWith("mongodb+srv://")) {
      const dns = await import("node:dns");
      const servers = (read("MONGODB_DNS_SERVERS") ?? "1.1.1.1,8.8.8.8")
        .split(",").map((s) => s.trim()).filter(Boolean);
      dns.default.setServers(servers);
    }
    const mongoose = (await import("mongoose")).default;
    const conn = await mongoose
      .createConnection(mongoUri, { serverSelectionTimeoutMS: 8000, bufferCommands: false })
      .asPromise();
    await conn.db?.command({ ping: 1 });
    await conn.close();
    console.log(`${GREEN}connected${RESET}`);
  } catch (e) {
    console.log(`${RED}FAILED — ${e.message}${RESET}`);
    hasErrors = true;
  }
} else {
  dim("MongoDB — skipped (MONGODB_URI not set)");
}

// Redis
if (redisUrl && !redisUrl.startsWith("https://")) {
  process.stdout.write(`  ? Redis … `);
  let firstRedisError = null;
  let redisClient = null;
  try {
    const { default: Redis } = await import("ioredis");
    redisClient = new Redis(redisUrl, {
      maxRetriesPerRequest: 1,
      connectTimeout: 5000,
      lazyConnect: true,
      enableReadyCheck: false,
    });
    redisClient.on("error", (e) => { if (!firstRedisError) firstRedisError = e; });
    await redisClient.connect();
    await redisClient.ping();
    // Test write permissions — read-only credentials will fail here.
    const testKey = `__health:check:${Math.random().toString(36).slice(2)}`;
    await redisClient.set(testKey, "1", "EX", 5);
    await redisClient.del(testKey);
    await redisClient.quit();
    console.log(`${GREEN}PONG (read-write verified)${RESET}`);
  } catch (e) {
    if (redisClient) redisClient.disconnect();
    const rootMsg = firstRedisError?.message ?? e.message ?? "";
    console.log(`${RED}FAILED — ${rootMsg}${RESET}`);
    if (rootMsg.toLowerCase().includes("noperm") || rootMsg.toLowerCase().includes("no permissions")) {
      console.log(`    ${YELLOW}Hint: You are using a READ-ONLY credential (default_ro).${RESET}`);
      console.log(`    ${YELLOW}The app writes to Redis — you need the read-write URL.${RESET}`);
      console.log(`    ${YELLOW}→ Upstash → your DB → Connect tab → copy the ioredis URL${RESET}`);
      console.log(`    ${YELLOW}  It uses "default" (not "default_ro") as the username.${RESET}`);
    } else if (rootMsg.toLowerCase().includes("wrongpass") || e.message?.toLowerCase().includes("closed")) {
      console.log(`    ${YELLOW}Hint: REDIS_URL password is wrong or still a placeholder.${RESET}`);
      console.log(`    ${YELLOW}→ Upstash → your DB → Connect tab → copy the ioredis URL${RESET}`);
      console.log(`    ${YELLOW}  It looks like: rediss://default:<TOKEN>@<host>.upstash.io:6379${RESET}`);
    }
    hasErrors = true;
  }
} else if (!redisUrl) {
  dim("Redis — skipped (REDIS_URL not set, using in-memory)");
}

// Kafka
if (kafkaBrokers) {
  process.stdout.write(`  ? Kafka … `);
  try {
    const { Kafka, logLevel } = await import("kafkajs");
    const kafka = new Kafka({
      clientId: "stockmania-check",
      brokers: kafkaBrokers.split(",").map((b) => b.trim()),
      logLevel: logLevel.NOTHING,
      connectionTimeout: 5000,
      requestTimeout: 5000,
      ...(read("KAFKA_SASL_USERNAME")
        ? {
            ssl: true,
            sasl: {
              mechanism: "plain",
              username: read("KAFKA_SASL_USERNAME"),
              password: read("KAFKA_SASL_PASSWORD") ?? "",
            },
          }
        : {}),
    });
    const admin = kafka.admin();
    await admin.connect();
    const topics = await admin.listTopics();
    await admin.disconnect();
    console.log(`${GREEN}connected — ${topics.length} topic(s)${RESET}`);
  } catch (e) {
    console.log(`${RED}FAILED — ${e.message}${RESET}`);
    hasErrors = true;
  }
} else {
  dim("Kafka — skipped (KAFKA_BROKERS not set, events via Inngest)");
}

// Twilio
if (twilioSid && twilioToken) {
  process.stdout.write(`  ? Twilio … `);
  try {
    const creds = Buffer.from(`${twilioSid}:${twilioToken}`).toString("base64");
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${twilioSid}.json`,
      { headers: { Authorization: `Basic ${creds}` }, signal: AbortSignal.timeout(8000) },
    );
    if (res.status === 401) throw new Error("Invalid credentials (401)");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    console.log(`${GREEN}authenticated — account: ${data.friendly_name ?? twilioSid}${RESET}`);
  } catch (e) {
    console.log(`${RED}FAILED — ${e.message}${RESET}`);
    hasErrors = true;
  }
} else {
  dim("Twilio — skipped (credentials not set, WhatsApp alerts disabled)");
}

// Zerodha (API key validation — no OAuth here, just format check)
if (zerodhaKey && zerodhaSecret) {
  ok(`Zerodha credentials present (OAuth flow at /api/zerodha/connect)`);
} else {
  dim("Zerodha — skipped (credentials not set)");
}

// ─── SUMMARY ─────────────────────────────────────────────────────────────────

console.log("");
if (hasErrors) {
  console.log(`${RED}${BOLD}Some checks failed. Fix the items marked ✗ above.${RESET}`);
  process.exit(1);
} else {
  console.log(`${GREEN}${BOLD}All checks passed. App is ready to run.${RESET}`);
  process.exit(0);
}

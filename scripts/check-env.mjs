/**
 * stockMania — environment checker
 * Run: node scripts/check-env.mjs
 *
 * v2 takes four environment variables and no API keys. This script exists to
 * turn "the app won't start" into a one-line answer, and to prove the libSQL URL
 * actually connects rather than merely being present.
 *
 * v1's version probed Mongo, Redis, Kafka, Zerodha, Alpaca, Finnhub, Gemini and
 * Twilio. All eight are gone; so are the seven required keys they needed.
 */
import { config as loadEnv } from "dotenv";
import { createClient } from "@libsql/client";

// Same order Next and drizzle.config.ts use: .env.local wins over .env.
loadEnv({ path: ".env.local", quiet: true });
loadEnv({ path: ".env", quiet: true });

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

const read = (key) => {
  const v = process.env[key];
  return v && v.trim() !== "" ? v.trim() : null;
};

let hasErrors = false;

function required(key, hint) {
  const v = read(key);
  if (v) { ok(key); return v; }
  fail(`${key} — MISSING`);
  if (hint) dim(hint);
  hasErrors = true;
  return null;
}

function optional(key, note) {
  const v = read(key);
  if (v) ok(key);
  else warn(`${key} — not set${note ? ` (${note})` : ""}`);
  return v;
}

section("1. Required");
const databaseUrl = required(
  "DATABASE_URL",
  'Use "file:./data/finance.db" locally, or your libsql:// URL from Turso.',
);
const authSecret = required(
  "BETTER_AUTH_SECRET",
  "Generate one with: openssl rand -base64 32",
);
required("NEXT_PUBLIC_BASE_URL", "e.g. http://localhost:3000");

if (authSecret && authSecret.length < 32) {
  fail("BETTER_AUTH_SECRET is shorter than 32 characters");
  hasErrors = true;
}

section("2. Optional");
optional("BETTER_AUTH_URL", "defaults to NEXT_PUBLIC_BASE_URL");
const remote = databaseUrl?.startsWith("libsql://");
if (remote) {
  required("DATABASE_AUTH_TOKEN", "A remote libsql:// database needs a token.");
} else {
  optional("DATABASE_AUTH_TOKEN", "not needed for a local file: database");
}
const smtpUser = optional("SMTP_USER", "verification and reset mail will be skipped");
if (smtpUser) {
  required("SMTP_PASSWORD");
  optional("SMTP_HOST", "defaults to smtp.gmail.com");
  optional("SMTP_PORT", "defaults to 465");
}

section("3. Database connectivity");
if (!databaseUrl) {
  fail("skipped — DATABASE_URL is not set");
} else {
  try {
    const client = createClient({
      url: databaseUrl,
      authToken: read("DATABASE_AUTH_TOKEN") ?? undefined,
    });
    await client.execute("select 1");
    const tables = await client.execute(
      "select count(*) as n from sqlite_master where type='table'",
    );
    ok(`connected — ${tables.rows[0].n} tables`);
    if (Number(tables.rows[0].n) === 0) {
      warn("no tables yet — run: npm run db:migrate");
    }
    client.close();
  } catch (error) {
    fail(`cannot connect: ${error.message}`);
    hasErrors = true;
  }
}

section(hasErrors ? "Result: not ready" : "Result: ready");
if (hasErrors) {
  dim("Fix the items marked ✗ above. See .env.example for the full list.");
}
process.exit(hasErrors ? 1 : 0);

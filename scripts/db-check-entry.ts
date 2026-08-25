/**
 * Schema drift check: is the database behind the code?
 *
 *   npm run db:check
 *
 * This exists because of a real failure. The dashboard started reading
 * `credit_card_terms` and the app crashed with `SQLITE_ERROR: no such table` —
 * not because the code was wrong, but because the local database had migration
 * `0000` applied and the six after it not. Nothing said so: `check-env` counted
 * 36 tables, found them non-zero, and reported "ready".
 *
 * A raw SQLite error three frames deep inside a React server component is the
 * worst possible way to learn that. So this compares three things and names the
 * fix:
 *
 *   1. **Migration files against applied migrations.** The authoritative check,
 *      because it catches a pending migration even when the tables it adds are
 *      ones nothing has read yet.
 *   2. **Tables the schema declares against tables that exist.** Catches a
 *      database built by `db:push` or edited by hand, where the migration ledger
 *      looks complete and the shape is not.
 *   3. **Reference data.** A migrated but unseeded database has an empty legality
 *      matrix, and every transaction fails a check whose data is missing.
 *
 * Exit 0 when the database matches the code, 1 when it does not. Deliberately
 * *not* run automatically at boot: applying migrations to production because a
 * page was loaded is how a bad migration becomes an outage.
 */

import { readdirSync } from "node:fs";
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local", quiet: true });
loadEnv({ path: ".env", quiet: true });

const { createClient } = await import("@libsql/client");
const { getTableName, is } = await import("drizzle-orm");
const { SQLiteTable } = await import("drizzle-orm/sqlite-core");
const schema = await import("@/infra/db/schema");

const RESET = "\x1b[0m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const BOLD = "\x1b[1m";

const ok = (message: string) => console.log(`  ${GREEN}✓${RESET} ${message}`);
const bad = (message: string) => console.log(`  ${RED}✗${RESET} ${message}`);
const warn = (message: string) => console.log(`  ${YELLOW}!${RESET} ${message}`);
const section = (title: string) => console.log(`\n${BOLD}${title}${RESET}`);

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set. Use "file:./data/finance.db" locally.');
  process.exit(1);
}

const client = createClient({
  url,
  ...(process.env.DATABASE_AUTH_TOKEN ? { authToken: process.env.DATABASE_AUTH_TOKEN } : {}),
});

let failed = false;

section("1. Migrations");

const files = readdirSync("./src/infra/db/migrations")
  .filter((file) => file.endsWith(".sql"))
  .sort();

let applied = 0;
try {
  const rows = await client.execute("select count(*) as n from __drizzle_migrations");
  applied = Number(rows.rows[0]?.n ?? 0);
} catch {
  warn("no migration ledger — this database has never been migrated");
}

if (applied === files.length) {
  ok(`${applied} of ${files.length} applied`);
} else {
  failed = true;
  bad(`${applied} of ${files.length} applied — ${files.length - applied} pending`);
  for (const file of files.slice(applied)) {
    console.log(`      pending: ${file}`);
  }
  console.log(`\n      Fix: ${BOLD}npm run db:migrate${RESET}`);
  console.log(`      The database is a file — copy it first if it holds data you want.`);
}

section("2. Tables");

/*
 * The table names the schema declares, read from the schema module itself rather
 * than from a hand-kept list — a list would be a second source of truth and the
 * one that goes stale.
 */
const declared = new Set<string>();
for (const value of Object.values(schema)) {
  // `is(value, SQLiteTable)` rather than duck-typing on an internal field: the
  // internals move between Drizzle versions and a silent zero-table check is
  // worse than no check at all — which is exactly what the first draft did.
  if (is(value, SQLiteTable)) declared.add(getTableName(value));
}
if (declared.size === 0) {
  failed = true;
  bad("no tables were found in the schema module — this check cannot verify anything");
}

const existing = new Set<string>();
const tables = await client.execute("select name from sqlite_master where type='table'");
for (const row of tables.rows) existing.add(String(row.name));

const missing = [...declared].filter((name) => !existing.has(name)).sort();
if (missing.length === 0) {
  ok(`all ${declared.size} declared tables exist`);
} else {
  failed = true;
  bad(`${missing.length} declared table(s) missing: ${missing.join(", ")}`);
  console.log(`\n      This is what a "no such table" crash looks like before it happens.`);
}

section("3. Reference data");

const REFERENCE = [
  { table: "txn_type_legality", why: "every transaction is checked against it" },
  { table: "tax_rules", why: "the SQL mirror of the shipped tax regimes" },
  { table: "cost_inflation_index", why: "indexation cannot be computed without it" },
  { table: "charge_rates", why: "brokerage and STT come from it" },
  { table: "market_holidays", why: "settlement dates depend on it" },
];

let unseeded = 0;
for (const { table, why } of REFERENCE) {
  if (!existing.has(table)) continue;
  const rows = await client.execute(`select count(*) as n from "${table}"`);
  const count = Number(rows.rows[0]?.n ?? 0);
  if (count === 0) {
    unseeded += 1;
    bad(`${table} is empty — ${why}`);
  } else {
    ok(`${table}: ${count} rows`);
  }
}
if (unseeded > 0) {
  failed = true;
  console.log(`\n      Fix: ${BOLD}npm run db:seed${RESET} (idempotent — safe to repeat)`);
}

section(failed ? `${RED}Result: the database is behind the code${RESET}` : `${GREEN}Result: in step${RESET}`);
client.close();
process.exit(failed ? 1 : 0);

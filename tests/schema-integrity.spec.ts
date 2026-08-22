import { readFileSync, readdirSync, rmSync } from "node:fs";
import { createClient } from "@libsql/client";
import { check, checkDeep, section, done } from "./harness";

/**
 * Float prohibition, layer 3 — the schema itself.
 *
 * Types stop `money + money`. Lint stops `parseFloat` on a money path. Neither
 * can stop a migration declaring `REAL`, and that is the one that corrupts data
 * silently and permanently: SQLite will happily store 0.1 + 0.2 in an amount
 * column and every report built on it is then wrong by an amount nobody can
 * reconstruct.
 *
 * The primary assertion here is deliberately stronger than the plan asks for.
 * The plan proposes matching column names against `%amount%|%price%|...`; this
 * asserts that **no column anywhere has a floating-point type**, whatever it is
 * called. A name-based rule only catches the columns you predicted the name of,
 * and `nav`, `stt` and `dp_charges` are exactly the ones a future contributor
 * will not spell the way the pattern expects. The name check stays as a second
 * layer, since it catches a money column declared as TEXT too.
 */

const DB_FILE = "./tmp/schema-integrity.db";

// SQLite type affinity: a column whose declared type contains REAL, FLOA or DOUB
// gets REAL affinity. Matching the affinity rule rather than a literal list is
// what makes this robust to `DOUBLE PRECISION`, `FLOAT4` and friends.
const FLOAT_AFFINITY = /REAL|FLOA|DOUB/i;

/** Columns whose value is money, a quantity or a rate — must be INTEGER. */
const NUMERIC_NAME = new RegExp(
  [
    "amount", "price", "balance", "cost", "value", "minor", "qty", "quantity",
    "units", "rate", "fee", "charge", "brokerage", "stt", "gst", "duty", "nav",
    "principal", "interest", "premium", "yield", "scaled", "percent",
  ].join("|"),
  "i",
);

/**
 * better-auth owns these table names and their columns. `account` matches the
 * numeric-name pattern by accident and holds OAuth tokens, not money.
 */
const AUTH_TABLES = new Set(["user", "session", "account", "verification"]);

/** Columns that match the name pattern but are genuinely not numeric. */
const NAME_EXEMPT = new Set([
  "postings.memo",          // free text
  "instruments.name",
  "ledger_accounts.name",
  "category_rules.value",   // the keyword being matched, not an amount
]);

interface Column {
  table: string;
  name: string;
  type: string;
  notnull: number;
}

async function main() {
  for (const suffix of ["", "-shm", "-wal"]) {
    try { rmSync(DB_FILE + suffix); } catch { /* not there */ }
  }

  const client = createClient({ url: "file:" + DB_FILE });

  const dir = "./src/infra/db/migrations";
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    const sqlText = readFileSync(`${dir}/${file}`, "utf8");
    for (const statement of sqlText.split("--> statement-breakpoint")) {
      const trimmed = statement.trim();
      if (trimmed) await client.execute(trimmed);
    }
  }
  check("migrations applied", files.length > 0, true);

  const tables = (
    await client.execute(
      "select name from sqlite_master where type='table' and name not like 'sqlite_%' and name not like '__drizzle%' order by name",
    )
  ).rows.map((r) => String(r.name));

  const columns: Column[] = [];
  for (const table of tables) {
    const info = await client.execute(`pragma table_info("${table}")`);
    for (const row of info.rows) {
      columns.push({
        table,
        name: String(row.name),
        type: String(row.type ?? ""),
        notnull: Number(row.notnull),
      });
    }
  }

  section(`schema: ${tables.length} tables, ${columns.length} columns`);
  check("every table has at least one column", columns.length >= tables.length, true);

  section("no floating-point column exists, whatever it is called");

  const floats = columns
    .filter((c) => FLOAT_AFFINITY.test(c.type))
    .map((c) => `${c.table}.${c.name} ${c.type}`);
  checkDeep("zero columns have REAL affinity", floats, []);

  section("money, quantity and rate columns are INTEGER");

  const misTyped = columns
    .filter((c) => !AUTH_TABLES.has(c.table))
    .filter((c) => NUMERIC_NAME.test(c.name))
    .filter((c) => !NAME_EXEMPT.has(`${c.table}.${c.name}`))
    .filter((c) => c.type.toUpperCase() !== "INTEGER")
    .map((c) => `${c.table}.${c.name} is ${c.type || "(untyped)"}, expected INTEGER`);
  checkDeep("every numeric-named column is INTEGER", misTyped, []);

  section("timestamps are epoch integers, not text");

  const badTimestamps = columns
    .filter((c) => !AUTH_TABLES.has(c.table))
    .filter((c) => /_at$/.test(c.name))
    .filter((c) => c.type.toUpperCase() !== "INTEGER")
    .map((c) => `${c.table}.${c.name} is ${c.type}`);
  checkDeep("every *_at column is INTEGER", badTimestamps, []);

  section("accounting dates are date-only text");

  // A posting happens on a day, not at an instant. Storing an accounting date as
  // a timestamp is what forces a timezone retrofit later.
  const dateColumns = columns.filter(
    (c) => /(^|_)(on|date)$/.test(c.name) && !AUTH_TABLES.has(c.table),
  );
  const badDates = dateColumns
    .filter((c) => c.type.toUpperCase() !== "TEXT")
    .map((c) => `${c.table}.${c.name} is ${c.type}, expected TEXT (YYYY-MM-DD)`);
  checkDeep("every accounting date column is TEXT", badDates, []);

  section("the money currency is always recorded alongside the amount");

  // An amount without its currency is not money. Any table with an amount column
  // must also carry a currency, or the value is uninterpretable.
  const byTable = new Map<string, Set<string>>();
  for (const c of columns) {
    if (!byTable.has(c.table)) byTable.set(c.table, new Set());
    byTable.get(c.table)!.add(c.name);
  }
  const amountWithoutCurrency: string[] = [];
  for (const [table, names] of byTable) {
    if (AUTH_TABLES.has(table)) continue;
    const hasMinor = [...names].some((n) => /_minor$/.test(n));
    if (hasMinor && !names.has("currency")) amountWithoutCurrency.push(table);
  }
  // Four tables predate this rule. Pinned rather than waived, so the list is
  // visible and can only shrink — adding a fifth fails the build.
  //
  //   trades              the sharpest of the four: a USD purchase can carry INR
  //                       charges, so one implied currency per row is wrong. The
  //                       instrument's currency covers price but not brokerage.
  //   net_worth_snapshots a projection in the reporting currency, which is not
  //                       recorded, so a change of reporting currency silently
  //                       reinterprets every historical row.
  //   budgets, tax_settings  INR-only in practice today.
  //
  // Phase 1f (schema consolidation) and Phase 5 (trades) close these.
  const KNOWN_MISSING_CURRENCY = ["budgets", "net_worth_snapshots", "tax_settings", "trades"];
  checkDeep(
    "no NEW table stores an amount without its currency",
    amountWithoutCurrency.filter((t) => !KNOWN_MISSING_CURRENCY.includes(t)),
    [],
  );
  checkDeep(
    "the known-gap list has not grown",
    amountWithoutCurrency.sort(),
    [...KNOWN_MISSING_CURRENCY].sort(),
  );

  section("the guard actually fails when it should");

  // A schema test that cannot fail is decoration. Prove the affinity check
  // catches a REAL column by creating one and asserting it is detected.
  await client.execute("create table _guard_probe (id text primary key, amount_minor REAL)");
  const probe = await client.execute("pragma table_info(_guard_probe)");
  const probeFloats = probe.rows
    .filter((r) => FLOAT_AFFINITY.test(String(r.type ?? "")))
    .map((r) => String(r.name));
  checkDeep("a REAL column is detected", probeFloats, ["amount_minor"]);
  await client.execute("drop table _guard_probe");

  /*
   * Phase 1f switches these on. Written now, and commented rather than absent,
   * so the assertion arrives with the migration instead of being remembered:
   *
   *   - every user-facing table has `deleted_at` (invariant A03), excluding the
   *     append-only logs where a tombstone is a contradiction
   *   - price_quotes is bitemporal: (instrument, as_of, quote_type, provider_id,
   *     ingested_at) is unique, and ingested_at is NOT NULL
   *   - audit_events and ledger_events have no UPDATE or DELETE path
   */

  client.close();
  done();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

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

/**
 * Columns that match the name pattern but are genuinely not numeric.
 *
 * Each is a name collision, not an exception to the rule: a `*_type` enum, a
 * memo, a matched keyword. Kept as an explicit list rather than loosening the
 * pattern, because a looser pattern stops catching the columns that matter.
 */
const NAME_EXEMPT = new Set([
  "postings.memo",           // free text
  "instruments.name",
  "ledger_accounts.name",
  "category_rules.value",    // the keyword being matched, not an amount
  "charge_rates.charge_type", // an enum name; the amounts beside it are *_minor
  "charge_rates.basis",       // what the rate applies to, as a word
  "charge_rates.rounding",    // a RoundingMode
  "charge_rates.rounding_unit",
  "corporate_actions.action_type",
  "price_quotes.quote_type",
  "price_divergences.quote_type",
  "provider_fetch_log.quote_type",
  "fx_rates.quote",          // the quote *currency* of the pair
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

  section("A03 — every user-facing table can be soft-deleted");

  /*
   * The append-only logs are excluded on purpose, not overlooked. A tombstone on
   * an immutable log is a contradiction: an audit event that can be deleted is
   * not an audit trail, and a corrected quote is a new bitemporal row rather than
   * a deletion. `net_worth_snapshots` is a rebuildable cache superseded by
   * `projection_cache`.
   */
  const APPEND_ONLY = new Set([
    "audit_events",
    "ledger_events",
    // Bitemporal: a correction is a new row pointing back at the one it
    // supersedes, so "what did we believe on the day" stays answerable.
    "price_quotes",
    "fx_rates",
    "price_divergences",
    "provider_fetch_log",
  ]);
  /**
   * Caches. Every row is derivable from the journal, so dropping one loses
   * nothing — and a tombstoned cache row would have to be excluded from every
   * lookup for no benefit.
   */
  const REBUILDABLE = new Set(["projection_cache", "net_worth_snapshots"]);
  /** Seeded reference data, keyed by natural key — there is no row to tombstone. */
  const REFERENCE_DATA = new Set([
    "txn_type_legality",
    "tax_rules",
    "cost_inflation_index",
    "charge_rates",
    "market_holidays",
  ]);

  const missingTombstone = tables
    .filter(
      (t) =>
        !AUTH_TABLES.has(t) &&
        !APPEND_ONLY.has(t) &&
        !REFERENCE_DATA.has(t) &&
        !REBUILDABLE.has(t),
    )
    .filter((t) => !columns.some((c) => c.table === t && c.name === "deleted_at"));
  checkDeep("every user-facing table has deleted_at", missingTombstone, []);

  section("the audit trail and event log exist and are ordered");

  for (const table of ["audit_events", "ledger_events"]) {
    check(`${table} exists`, tables.includes(table), true);
  }
  // seq is an autoincrement integer because replay follows insertion order, and a
  // uuid would give no ordering at all.
  const seq = columns.find((c) => c.table === "ledger_events" && c.name === "seq");
  check("ledger_events.seq is an INTEGER primary key", seq?.type.toUpperCase(), "INTEGER");

  section("Q02 — quotes are bitemporal");

  const quoteColumns = columns.filter((c) => c.table === "price_quotes").map((c) => c.name);
  for (const column of ["as_of", "ingested_at", "quote_type", "provider_id", "superseded_by"]) {
    check(`price_quotes.${column} exists`, quoteColumns.includes(column), true);
  }
  const quoteIndexes = (
    await client.execute("select name, sql from sqlite_master where type='index' and tbl_name='price_quotes'")
  ).rows.map((r) => String(r.sql ?? ""));
  // ingested_at must be IN the key: without it a vendor correction overwrites the
  // original, which defeats the whole point of the second time axis.
  check(
    "the unique key includes ingested_at",
    quoteIndexes.some((sqlText) => sqlText.includes("ingested_at") && sqlText.includes("UNIQUE")),
    true,
  );

  section("the legality matrix and seeded reference tables exist");

  for (const table of [
    "txn_type_legality",
    "tax_rules",
    "cost_inflation_index",
    "charge_rates",
    "market_holidays",
    "corporate_actions",
    "import_rows",
    "documents",
    "institutions",
    "counterparties",
    "fx_rates",
    "projection_cache",
  ]) {
    check(`${table} exists`, tables.includes(table), true);
  }

  section("the projection cache can tell its two scopes apart");

  // PERIOD and CUMULATIVE projections invalidate by different rules; without the
  // column the cache would have to invalidate everything or be wrong.
  const cacheColumns = columns.filter((c) => c.table === "projection_cache").map((c) => c.name);
  for (const column of ["scope", "revision_vector_hash", "period_start", "period_end", "as_of"]) {
    check(`projection_cache.${column} exists`, cacheColumns.includes(column), true);
  }
  const accountColumns = columns.filter((c) => c.table === "ledger_accounts").map((c) => c.name);
  check("ledger_accounts.revision exists", accountColumns.includes("revision"), true);
  check(
    "ledger_accounts.min_affected_date exists",
    accountColumns.includes("min_affected_date"),
    true,
  );

  client.close();
  done();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

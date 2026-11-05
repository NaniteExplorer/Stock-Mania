/** 0018 preserves history while enforcing the approved non-negative price contract. */
import { readFileSync, readdirSync, rmSync } from "node:fs";
import { createClient, type InValue } from "@libsql/client";
import { getTableConfig, SQLiteSyncDialect } from "drizzle-orm/sqlite-core";
import { insurancePriceSteps, commitmentPriceSteps, incomePriceSteps } from "@/infra/db/schema";
import { check, checkDeep, done, section, throwsAsync } from "./harness";

const dbPath = `tmp/p1-price-step-migration-${process.pid}.db`;
const client = createClient({ url: `file:${dbPath}`, intMode: "bigint" });
const cleanup = () => {
  for (const suffix of ["", "-wal", "-shm"]) {
    try { rmSync(dbPath + suffix, { force: true }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "EPERM") throw error; }
  }
};
const dir = "src/infra/db/migrations";
const migration = "0018_nonnegative_price_steps.sql";
const up = readFileSync(`${dir}/${migration}`, "utf8");
const down = readFileSync(`${dir}/rollback/0018_nonnegative_price_steps.down.sql`, "utf8");
const split = (text: string) => text.split("--> statement-breakpoint").map((p) => p.trim()).filter(Boolean);
async function apply(text: string) {
  const tx = await client.transaction("write");
  try {
    for (const statement of split(text)) await tx.execute(statement);
    await tx.commit();
  } catch (error) { await tx.rollback(); throw error; }
  finally { tx.close(); }
}
async function insert(table: string, row: Record<string, InValue>) {
  await client.execute({ sql: `INSERT INTO ${table} (${Object.keys(row).join(",")}) VALUES (${Object.keys(row).map(() => "?").join(",")})`, args: Object.values(row) });
}
const definitions = [
  { table: "insurance_price_steps", key: "policy_id", parent: "policy", drizzle: insurancePriceSteps },
  { table: "commitment_price_steps", key: "commitment_id", parent: "commitment", drizzle: commitmentPriceSteps },
  { table: "income_price_steps", key: "stream_id", parent: "stream", drizzle: incomePriceSteps },
] as const;
const rows = async (table: string) => (await client.execute(`SELECT * FROM ${table} ORDER BY id`)).rows;
const objects = async () => (await client.execute("SELECT type,name,tbl_name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name")).rows;
const schemaSql = async () => (await client.execute("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name")).rows;
const schedule = { cadence: "MONTHLY", anchor_on: "2025-01-31", schedule_ends_on: null, cancel_notice_days: null };
const large = 9007199254740993n;

async function main() {
  await client.execute("PRAGMA foreign_keys=ON");
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql") && f < migration).sort()) await apply(readFileSync(`${dir}/${file}`, "utf8"));
  for (const id of ["u1", "u2"]) await insert("user", { id, name: id, email: `${id}@test.invalid` });
  await insert("ledger_accounts", { id: "bank", user_id: "u1", code: "BANK", name: "Bank", type: "ASSET", currency: "USD" });
  await insert("insurance_policies", { id: "policy", user_id: "u1", kind: "HEALTH", insurer: "Insurer", insured: "Self", currency: "USD", sum_insured_minor: large, ...schedule, ends_on: null });
  await insert("recurring_commitments", { id: "commitment", user_id: "u1", name: "Service", kind: "SOFTWARE", currency: "USD", ...schedule, auto_renews: 1, ends_on: null });
  await insert("income_streams", { id: "stream", user_id: "u1", name: "Salary", kind: "SALARY", payer: null, currency: "USD", ...schedule, grace_days: 0 });
  for (const { table, key, parent } of definitions) {
    for (const [suffix, from, amount, deleted] of [["null", "2025-01-01", null, null], ["zero", "2025-02-01", 0n, null], ["large", "2025-03-01", large, null], ["deleted", "2025-04-01", large, 123n]] as const) {
      await insert(table, { id: `${table}-${suffix}`, user_id: "u1", [key]: parent, currency: "USD", from_date: from, amount_minor: amount, deleted_at: deleted });
    }
  }
  const beforeObjects = await objects();
  const protectedSql = (await schemaSql()).filter((row) => row.type !== "table");
  const ledger = await rows("ledger_accounts");
  const before = await Promise.all(definitions.map(({ table }) => rows(table)));
  section("upgrade preserves exact history and schema objects");
  await apply(up);
  checkDeep("object names and ownership unchanged", await objects(), beforeObjects);
  checkDeep("indexes, views and triggers retain exact definitions", (await schemaSql()).filter((row) => row.type !== "table"), protectedSql);
  checkDeep("prior ledger unchanged", await rows("ledger_accounts"), ledger);
  const snapshot = JSON.parse(readFileSync(`${dir}/meta/0018_snapshot.json`, "utf8"));
  for (const [index, { table, key, parent, drizzle }] of definitions.entries()) {
    checkDeep(`${table} exact null/zero/large/tombstone rows`, await rows(table), before[index]);
    const ddl = String((await client.execute({ sql: "SELECT sql FROM sqlite_master WHERE type='table' AND name=?", args: [table] })).rows[0].sql);
    const config = getTableConfig(drizzle);
    const constraint = snapshot.tables[table].checkConstraints[`${table}_amount_check`].value;
    check(`${table} metadata constraint agrees`, ddl.includes(constraint), true);
    check(`${table} actual nonnegative CHECK`, ddl.includes("amount_minor >= 0"), true);
    check(`${table} Drizzle amount CHECK present`, config.checks.some((c) => c.name === `${table}_amount_check`), true);
    check(`${table} Drizzle and snapshot CHECK identical`, new SQLiteSyncDialect().sqlToQuery(config.checks.find((c) => c.name === `${table}_amount_check`)!.value).sql, constraint);
    const base = { id: "bad", user_id: "u1", [key]: parent, currency: "USD", from_date: "2025-05-01", amount_minor: 1 };
    await throwsAsync(`${table} negative insert refused`, () => insert(table, { ...base, amount_minor: -1 }), "CHECK constraint");
    await throwsAsync(`${table} negative update refused`, () => client.execute(`UPDATE ${table} SET amount_minor=-1 WHERE id='${table}-large'`), "CHECK constraint");
    await throwsAsync(`${table} fractional insert refused`, () => insert(table, { ...base, amount_minor: 0.5 }), "CHECK constraint");
    await throwsAsync(`${table} cross-owner still refused`, () => insert(table, { ...base, user_id: "u2" }), "P1 parent");
    await throwsAsync(`${table} mixed currency still refused`, () => insert(table, { ...base, currency: "INR" }), "P1 parent");
    await throwsAsync(`${table} owner update still refused`, () => client.execute(`UPDATE ${table} SET user_id='u2' WHERE id='${table}-large'`), "P1 parent");
    await throwsAsync(`${table} currency update still refused`, () => client.execute(`UPDATE ${table} SET currency='INR' WHERE id='${table}-large'`), "P1 parent");
    await throwsAsync(`${table} duplicate date still refused`, () => insert(table, { ...base, from_date: "2025-03-01" }), "UNIQUE constraint");
    check(`${table} live view retained`, (await client.execute(`SELECT count(*) n FROM v_${table}`)).rows[0].n, 3n);
  }
  checkDeep("foreign keys remain sound", (await client.execute("PRAGMA foreign_key_check")).rows, []);
  section("rollback preserves data and restores prior constraints");
  await apply(down);
  checkDeep("down preserves schema object names", await objects(), beforeObjects);
  checkDeep("down restores all trigger/view/index definitions", (await schemaSql()).filter((row) => row.type !== "table"), protectedSql);
  for (const [index, { table }] of definitions.entries()) checkDeep(`${table} down preserves rows`, await rows(table), before[index]);
  section("negative legacy history refuses upgrade before schema changes");
  for (const { table, key, parent } of definitions) {
    await insert(table, { id: `${table}-negative`, user_id: "u1", [key]: parent, currency: "USD", from_date: "2025-06-01", amount_minor: -large });
    const priorSchema = await schemaSql();
    const priorRows = await rows(table);
    await throwsAsync(`${table} negative legacy history refuses upgrade`, () => apply(up), "CHECK constraint");
    checkDeep(`${table} failed preflight leaves schema untouched`, await schemaSql(), priorSchema);
    checkDeep(`${table} failed preflight leaves negative history untouched`, await rows(table), priorRows);
    // Explicit test-fixture repair, not migration behavior: permit the next case.
    await client.execute({ sql: `UPDATE ${table} SET amount_minor=? WHERE id=?`, args: [large, `${table}-negative`] });
  }
  await apply(up);
  checkDeep("second upgrade retains ledger", await rows("ledger_accounts"), ledger);
  checkDeep("second upgrade foreign keys remain sound", (await client.execute("PRAGMA foreign_key_check")).rows, []);
  client.close();
  cleanup();
  done();
}
main().catch((error) => { client.close(); cleanup(); console.error(error); process.exitCode = 1; });

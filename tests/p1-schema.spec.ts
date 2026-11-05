/** Task1.0 recurrence-backed persistence: reversible, exact and owner-scoped. */
import { readFileSync, readdirSync } from "node:fs";
import { createClient, type InValue } from "@libsql/client";
import { getTableConfig } from "drizzle-orm/sqlite-core";
import * as schema from "@/infra/db/schema";
import { check, checkDeep, checkTrue, done, section, throwsAsync } from "./harness";

const client = createClient({ url: "file::memory:", intMode: "bigint" });
const dir = "src/infra/db/migrations";
const migration = "0017_p1_recurring.sql";
const tables = [schema.insurancePolicies, schema.insurancePriceSteps, schema.coverAbsenceDeclarations,
  schema.recurringCommitments, schema.commitmentPriceSteps, schema.incomeStreams, schema.incomePriceSteps, schema.incomeReceipts];
const statements = (text: string) => text.split("--> statement-breakpoint").map((part) => part.trim()).filter(Boolean);
async function apply(text: string) { for (const statement of statements(text)) await client.execute(statement); }
async function insert(table: string, row: Record<string, InValue>) {
  const columns = Object.keys(row);
  await client.execute({ sql: `INSERT INTO ${table} (${columns.join(",")}) VALUES (${columns.map(() => "?").join(",")})`, args: Object.values(row) });
}
const inspectObjects = async () => (await client.execute("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name")).rows;
const ledgerRows = async () => (await client.execute("SELECT id,transaction_id,account_id,amount_minor,currency FROM postings ORDER BY id")).rows;
const schedule = { cadence: "MONTHLY", anchor_on: "2025-01-31", schedule_ends_on: null, cancel_notice_days: null };
const stream = (id: string, user = "u1", currency = "USD") => ({ id, user_id: user, name: "Salary", kind: "SALARY", payer: null, currency, ...schedule, grace_days: 0 });
const receipt = (id: string, posting = "p1", occurrence = "2025-01-31", streamId = "s1") => ({ id, user_id: "u1", stream_id: streamId, occurrence_date: occurrence, posting_id: posting, received_on: "2025-02-02" });

async function main() {
  await client.execute("PRAGMA foreign_keys = ON");
  const oldFiles = readdirSync(dir).filter((file) => file.endsWith(".sql") && file < migration).sort();
  check("expected previous migration head", oldFiles.at(-1), "0016_exact_lot_cost.sql");
  for (const file of oldFiles) await apply(readFileSync(`${dir}/${file}`, "utf8"));
  for (const user of ["u1", "u2"]) {
    await insert("user", { id: user, name: user, email: `${user}@example.test` });
    await insert("ledger_accounts", { id: `a-${user}`, user_id: user, code: user, name: "Bank", type: "ASSET", currency: "USD" });
    await insert("transactions", { id: `t-${user}`, user_id: user, txn_type: "DEPOSIT", txn_date: "2025-02-02", description: "Income" });
  }
  for (const [id, user] of [["p1", "u1"], ["p2", "u1"], ["p3", "u1"], ["foreign", "u2"]]) {
    await insert("postings", { id, transaction_id: `t-${user}`, account_id: `a-${user}`, direction: "DEBIT", amount_minor: 1234567890123456n, currency: "USD", seq: id === "p1" ? 0 : id === "p2" ? 1 : 2 });
  }
  const originalObjects = await inspectObjects();
  const originalLedger = await ledgerRows();
  const up = readFileSync(`${dir}/${migration}`, "utf8");
  const down = readFileSync(`${dir}/rollback/0017_p1_recurring.down.sql`, "utf8");
  await apply(up);

  section("Drizzle and migration table contracts agree");
  for (const table of tables) {
    const config = getTableConfig(table);
    const actual = (await client.execute(`PRAGMA table_info(${config.name})`)).rows;
    checkDeep(`${config.name} columns`, actual.map((row) => [row.name, String(row.type).toLowerCase()]), config.columns.map((column) => [column.name, column.getSQLType()]));
    check(`${config.name} live view exists`, (await client.execute({ sql: "SELECT count(*) n FROM sqlite_master WHERE type='view' AND name=?", args: [`v_${config.name}`] })).rows[0].n, 1);
    if (config.columns.some((column) => column.name === "currency")) check(`${config.name} currency has no guessed default`, actual.find((row) => row.name === "currency")?.dflt_value, null);
  }
  checkDeep("foreign keys valid after up", (await client.execute("PRAGMA foreign_key_check")).rows, []);
  checkDeep("existing ledger unchanged by up", await ledgerRows(), originalLedger);

  section("explicit null, zero and exact foreign-currency data");
  await insert("income_streams", stream("s1"));
  await insert("income_streams", stream("s2"));
  await insert("income_streams", stream("other-stream", "u2"));
  await insert("insurance_policies", { id: "policy", user_id: "u1", kind: "HEALTH", insurer: "Insurer", insured: "Owner", currency: "USD", sum_insured_minor: null, ...schedule, ends_on: null });
  await insert("recurring_commitments", { id: "commitment", user_id: "u1", name: "Service", kind: "SOFTWARE", currency: "USD", ...schedule, cancel_notice_days: 0, auto_renews: 1, ends_on: "2026-01-31" });
  for (const [table, key, parent] of [["income_price_steps", "stream_id", "s1"], ["insurance_price_steps", "policy_id", "policy"], ["commitment_price_steps", "commitment_id", "commitment"]]) {
    const base = { user_id: "u1", [key]: parent, currency: "USD" };
    await insert(table, { ...base, id: `${table}-null`, from_date: "2025-01-01", amount_minor: null });
    await insert(table, { ...base, id: `${table}-zero`, from_date: "2025-02-01", amount_minor: 0 });
    await insert(table, { ...base, id: `${table}-large`, from_date: "2025-03-01", amount_minor: -1234567890123456n });
    checkDeep(`${table} null/zero/exact signed minor`, (await client.execute(`SELECT amount_minor,currency FROM ${table} ORDER BY from_date`)).rows.map((r) => [r.amount_minor, r.currency]), [[null, "USD"], [0n, "USD"], [-1234567890123456n, "USD"]]);
    await throwsAsync(`${table} cross-owner insert`, () => insert(table, { ...base, id: "bad", user_id: "u2", from_date: "2025-04-01", amount_minor: 1 }), "P1 parent");
    await throwsAsync(`${table} mixed currency insert`, () => insert(table, { ...base, id: "bad", currency: "INR", from_date: "2025-04-01", amount_minor: 1 }), "P1 parent");
    await throwsAsync(`${table} orphan refused`, () => insert(table, { ...base, id: "bad", [key]: "absent", from_date: "2025-04-01", amount_minor: 1 }), "P1 parent");
    await throwsAsync(`${table} fractional money refused`, () => insert(table, { ...base, id: "bad", from_date: "2025-04-01", amount_minor: 0.5 }), "CHECK constraint");
    await throwsAsync(`${table} invalid date refused`, () => insert(table, { ...base, id: "bad", from_date: "2025-02-30", amount_minor: 1 }), "CHECK constraint");
    await throwsAsync(`${table} duplicate live step refused`, () => insert(table, { ...base, id: "bad", from_date: "2025-01-01", amount_minor: 1 }), "UNIQUE constraint");
    await throwsAsync(`${table} cross-owner update`, () => client.execute(`UPDATE ${table} SET user_id='u2' WHERE id='${table}-zero'`), "P1 parent");
    await throwsAsync(`${table} mixed currency update`, () => client.execute(`UPDATE ${table} SET currency='INR' WHERE id='${table}-zero'`), "P1 parent");
    await client.execute(`UPDATE ${table} SET deleted_at=1 WHERE id='${table}-zero'`);
    await insert(table, { ...base, id: `${table}-replacement`, from_date: "2025-02-01", amount_minor: 2 });
    check(`${table} tombstone preserved`, (await client.execute(`SELECT count(*) n FROM ${table} WHERE from_date='2025-02-01'`)).rows[0].n, 2);
  }
  check("unknown notice preserved", (await client.execute("SELECT cancel_notice_days FROM income_streams WHERE id='s1'")).rows[0].cancel_notice_days, null);
  check("zero notice preserved", (await client.execute("SELECT cancel_notice_days FROM recurring_commitments WHERE id='commitment'")).rows[0].cancel_notice_days, 0);
  check("unknown sum insured preserved", (await client.execute("SELECT sum_insured_minor FROM insurance_policies WHERE id='policy'")).rows[0].sum_insured_minor, null);
  for (const [key, value] of [["kind", "INVALID"], ["cadence", "WEEKLY"], ["grace_days", -1], ["grace_days", 0.5], ["cancel_notice_days", -1], ["cancel_notice_days", 0.5], ["anchor_on", "2025-02-30"], ["schedule_ends_on", "2024-01-01"], ["currency", "usd"], ["name", " "]]) {
    await throwsAsync(`invalid stream ${key}=${value}`, () => insert("income_streams", { ...stream("bad"), [key as string]: value }), "CHECK constraint");
  }
  for (const name of ["\t", "\n", "\r\n", "\u00a0", "\u2003", "\ufeff", " \t\n\u00a0"]) {
    await throwsAsync(`whitespace-only name ${JSON.stringify(name)} refused`, () => insert("income_streams", { ...stream("blank"), name }), "CHECK constraint");
  }
  for (const currency of ["USD\0suffix", "US\0", "\0USD"]) {
    await throwsAsync("embedded NUL currency refused", () => insert("income_streams", { ...stream("nul"), currency }), "CHECK constraint");
  }
  await throwsAsync("currency must be supplied", () => client.execute("INSERT INTO income_streams(id,user_id,name,kind,cadence,anchor_on,grace_days) VALUES ('missing','u1','Salary','SALARY','MONTHLY','2025-01-31',0)"), "NOT NULL constraint");
  await throwsAsync("parent currency cannot invalidate price history", () => client.execute("UPDATE income_streams SET currency='INR' WHERE id='s1'"), "P1 parent");
  await throwsAsync("parent owner cannot invalidate price history", () => client.execute("UPDATE income_streams SET user_id='u2' WHERE id='s1'"), "P1 parent");

  section("income receipts link postings without copying amounts");
  await insert("income_receipts", receipt("r1"));
  checkTrue("receipt has no copied money column", !(await client.execute("PRAGMA table_info(income_receipts)")).rows.some((r) => r.name === "amount_minor"));
  await throwsAsync("one posting cannot settle two streams", () => insert("income_receipts", receipt("duplicate-post", "p1", "2025-02-28", "s2")), "UNIQUE constraint");
  await throwsAsync("one occurrence cannot have two receipts", () => insert("income_receipts", receipt("duplicate-date", "p2")), "UNIQUE constraint");
  await throwsAsync("foreign posting refused", () => insert("income_receipts", receipt("bad", "foreign", "2025-02-28")), "P1 receipt");
  await throwsAsync("foreign stream refused", () => insert("income_receipts", receipt("bad", "p2", "2025-02-28", "other-stream")), "P1 receipt");
  await throwsAsync("orphan posting refused", () => insert("income_receipts", receipt("bad", "absent", "2025-02-28")), "P1 receipt");
  await throwsAsync("receipt update cannot borrow foreign posting", () => client.execute("UPDATE income_receipts SET posting_id='foreign' WHERE id='r1'"), "P1 receipt");
  await throwsAsync("posting cannot change owner beneath receipt", () => client.execute("UPDATE postings SET transaction_id='t-u2' WHERE id='p1'"), "P1 posting");
  await throwsAsync("transaction cannot change owner beneath receipt", () => client.execute("UPDATE transactions SET user_id='u2' WHERE id='t-u1'"), "P1 transaction");
  await throwsAsync("account cannot change owner beneath receipt", () => client.execute("UPDATE ledger_accounts SET user_id='u2' WHERE id='a-u1'"), "P1 account");
  await throwsAsync("account cannot change currency beneath receipt", () => client.execute("UPDATE ledger_accounts SET currency='INR' WHERE id='a-u1'"), "P1 account");
  await client.execute("UPDATE income_receipts SET deleted_at=1 WHERE id='r1'");
  await insert("income_receipts", receipt("r2", "p1", "2025-02-28", "s2"));
  check("explicit unlink/relink retains history", (await client.execute("SELECT count(*) n FROM income_receipts WHERE posting_id='p1'")).rows[0].n, 2);
  checkDeep("unlink never changes original posting", await ledgerRows(), originalLedger);
  await client.execute("UPDATE income_streams SET deleted_at=1 WHERE id='s2'");
  check("parent tombstone hides receipt", (await client.execute("SELECT count(*) n FROM v_income_receipts")).rows[0].n, 0);
  await throwsAsync("live receipt cannot link tombstoned parent", () => insert("income_receipts", receipt("bad", "p3", "2025-03-31", "s2")), "P1 receipt");
  await client.execute("UPDATE income_streams SET deleted_at=1 WHERE id='s1'");
  check("parent tombstone hides price steps", (await client.execute("SELECT count(*) n FROM v_income_price_steps")).rows[0].n, 0);
  await throwsAsync("live step cannot link tombstoned parent", () => insert("income_price_steps", { id: "bad", user_id: "u1", stream_id: "s1", from_date: "2025-05-01", amount_minor: 1, currency: "USD" }), "P1 parent");
  await client.execute("UPDATE income_streams SET deleted_at=NULL WHERE id='s1'");
  check("undo parent reveals existing live steps", (await client.execute("SELECT count(*) n FROM v_income_price_steps")).rows[0].n, 3);
  await insert("cover_absence_declarations", { id: "absent1", user_id: "u1", kind: "MOTOR", declared_on: "2025-01-01" });
  await insert("cover_absence_declarations", { id: "absent2", user_id: "u1", kind: "MOTOR", declared_on: "2025-02-01" });
  await throwsAsync("absence same date cannot silently duplicate", () => insert("cover_absence_declarations", { id: "absent3", user_id: "u1", kind: "MOTOR", declared_on: "2025-01-01" }), "UNIQUE constraint");
  check("absence dated history retained", (await client.execute("SELECT count(*) n FROM v_cover_absence_declarations")).rows[0].n, 2);

  section("failed migration transaction rolls back and down/up preserves ledger");
  await client.execute("BEGIN IMMEDIATE");
  let migrationFailed = false;
  try {
    await client.execute("CREATE TABLE p1_failure_probe(id TEXT PRIMARY KEY)");
    await client.execute("INSERT INTO income_streams(id,user_id) VALUES ('invalid','missing')");
  } catch { migrationFailed = true; } finally { await client.execute("ROLLBACK"); }
  check("a failing migration step actually refused", migrationFailed, true);
  check("failed transaction leaves no partial table", (await client.execute("SELECT count(*) n FROM sqlite_master WHERE name='p1_failure_probe'")).rows[0].n, 0);
  checkDeep("all inserted links maintain foreign keys", (await client.execute("PRAGMA foreign_key_check")).rows, []);
  await apply(down);
  checkDeep("down restores every prior schema object", await inspectObjects(), originalObjects);
  checkDeep("down preserves original ledger rows", await ledgerRows(), originalLedger);
  await apply(up);
  checkDeep("up after down remains valid", (await client.execute("PRAGMA foreign_key_check")).rows, []);
  for (const table of tables) check(`${getTableConfig(table).name} recreated empty`, (await client.execute(`SELECT count(*) n FROM ${getTableConfig(table).name}`)).rows[0].n, 0);
  checkDeep("second up preserves original ledger rows", await ledgerRows(), originalLedger);
  client.close();
  done();
}
main().catch((error) => { client.close(); console.error(error); process.exitCode = 1; });

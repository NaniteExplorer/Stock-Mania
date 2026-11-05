/** Physical persistence migration: real SQLite constraints, exactness and recovery. */
import { readFileSync, readdirSync } from "node:fs";
import { createClient, type InValue } from "@libsql/client";
import { getTableConfig } from "drizzle-orm/sqlite-core";
import { physicalAssets, physicalAssetValuations } from "@/infra/db/schema";
import { check, checkDeep, done, section, throwsAsync } from "./harness";

const client = createClient({ url: "file::memory:", intMode: "bigint" });
const dir = "src/infra/db/migrations";
const migration = "0022_physical_assets.sql";
const apply = async (text: string) => {
  for (const part of text.split("--> statement-breakpoint")) if (part.trim()) await client.execute(part);
};
async function insert(table: string, row: Record<string, InValue>) {
  const keys = Object.keys(row);
  await client.execute({ sql: `INSERT INTO ${table} (${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")})`, args: Object.values(row) });
}
const objects = async () => (await client.execute("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name")).rows;
const ledger = async () => (await client.execute("SELECT id,transaction_id,account_id,amount_minor,currency FROM postings ORDER BY id")).rows;
const header = (account: string, kind = "OTHER", extras: Record<string, InValue> = {}) => ({ account_id: account, user_id: "u1", kind, currency: "USD", ...extras });
const valuation = (id: string, extras: Record<string, InValue> = {}) => ({ id, user_id: "u1", asset_account_id: "other", on_date: "2025-03-01", value_minor: 0n, currency: "USD", source: "SELF_ASSESSED", ...extras });
let accountSeq = 0;
async function account(id: string, extras: Record<string, InValue> = {}) {
  await insert("ledger_accounts", { id, user_id: "u1", code: `physical-${++accountSeq}`, name: id, type: "ASSET", subtype: "OTHER", currency: "USD", ...extras });
}
async function rejectHeader(label: string, extras: Record<string, InValue>, fragment = "CHECK constraint") {
  const id = `invalid-${++accountSeq}`;
  await account(id);
  await throwsAsync(label, () => insert("physical_assets", header(id, "OTHER", extras)), fragment);
}
async function main() {
  await client.execute("PRAGMA foreign_keys=ON");
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql") && f < migration).sort()) await apply(readFileSync(`${dir}/${file}`, "utf8"));
  for (const id of ["u1", "u2"]) await insert("user", { id, name: id, email: `${id}@example.test` });
  await account("other");
  await account("vehicle", { subtype: "VEHICLE" });
  await account("estate", { subtype: "REAL_ESTATE" });
  await account("foreign", { user_id: "u2" });
  await account("removed", { deleted_at: 1 });
  await account("system", { is_system: 1 });
  await account("expense", { type: "EXPENSE", subtype: null });
  await account("bank", { subtype: "BANK" });
  await insert("transactions", { id: "purchase", user_id: "u1", txn_type: "WITHDRAWAL", txn_date: "2025-01-02", description: "Purchase" });
  await insert("postings", { id: "purchase-leg", transaction_id: "purchase", account_id: "expense", direction: "DEBIT", amount_minor: 9007199254740993n, currency: "USD", seq: 0 });
  const beforeObjects = await objects();
  const beforeLedger = await ledger();
  const up = readFileSync(`${dir}/${migration}`, "utf8");
  const down = readFileSync(`${dir}/rollback/0022_physical_assets.down.sql`, "utf8");
  await apply(up);

  section("schema parity and additive migration");
  for (const table of [physicalAssets, physicalAssetValuations]) {
    const expected = getTableConfig(table);
    const actual = (await client.execute(`PRAGMA table_info(${expected.name})`)).rows;
    checkDeep(`${expected.name} columns/types`, actual.map((r) => [r.name, String(r.type).toLowerCase()]), expected.columns.map((c) => [c.name, c.getSQLType()]));
    check(`${expected.name} live view`, (await client.execute(`SELECT count(*) n FROM sqlite_master WHERE type='view' AND name='v_${expected.name}'`)).rows[0].n, 1n);
  }
  checkDeep("migration preserves ledger", await ledger(), beforeLedger);
  checkDeep("foreign key check after up", (await client.execute("PRAGMA foreign_key_check")).rows, []);

  section("three kinds, optional unknowns and exact observations");
  await insert("physical_assets", header("other"));
  await insert("physical_assets", header("vehicle", "VEHICLE", { purchase_on: "2025-01-02", purchase_price_minor: 9007199254740993n, model_kind: "SCHEDULE", schedule_id: "MOTOR_IDV" }));
  await insert("physical_assets", header("estate", "REAL_ESTATE", { model_kind: "DECLINING", rate_percent_scaled: 15123456n, model_basis: "Owner estimate" }));
  check("all physical kinds stored", (await client.execute("SELECT count(*) n FROM physical_assets")).rows[0].n, 3n);
  checkDeep("unknown purchase and model remain null", (await client.execute("SELECT purchase_on,purchase_price_minor,model_kind FROM physical_assets WHERE account_id='other'")).rows[0], { purchase_on: null, purchase_price_minor: null, model_kind: null });
  check("purchase beyond safe-number integer exact", (await client.execute("SELECT CAST(purchase_price_minor AS TEXT) p FROM physical_assets WHERE account_id='vehicle'")).rows[0].p, "9007199254740993");
  await insert("physical_asset_valuations", valuation("zero"));
  await insert("physical_asset_valuations", valuation("large", { on_date: "2025-04-01", value_minor: 9223372036854775807n }));
  check("explicit zero survives", (await client.execute("SELECT value_minor FROM physical_asset_valuations WHERE id='zero'")).rows[0].value_minor, 0n);
  check("maximum signed64 survives", (await client.execute("SELECT CAST(value_minor AS TEXT) v FROM physical_asset_valuations WHERE id='large'")).rows[0].v, "9223372036854775807");
  await account("huge");
  const hugeRate = "123456789012345678901234567890123456789";
  // 0022 fix: scaled percentages are INTEGER columns, so a rate beyond signed64 cannot be stored.
  await throwsAsync("rate beyond signed64 refused", () => insert("physical_assets", header("huge", "OTHER", { model_kind: "STRAIGHT", rate_percent_scaled: hugeRate, floor_percent_scaled: 1234567n, model_basis: "Owner estimate" })), "CHECK constraint");

  section("account eligibility and immutable identity");
  for (const [id, kind] of [["foreign", "OTHER"], ["removed", "OTHER"], ["system", "OTHER"], ["expense", "OTHER"], ["bank", "OTHER"]]) {
    await throwsAsync(`${id} account refused`, () => insert("physical_assets", header(id, kind)), "physical asset account");
  }
  await throwsAsync("missing account refused", () => insert("physical_assets", header("absent")), "physical asset account");
  await throwsAsync("parent identity cannot change", () => client.execute("UPDATE physical_assets SET account_id='huge' WHERE account_id='other'"), "identity is immutable");
  await throwsAsync("parent owner cannot change", () => client.execute("UPDATE physical_assets SET user_id='u2' WHERE account_id='other'"), "identity is immutable");
  await throwsAsync("parent kind cannot change", () => client.execute("UPDATE physical_assets SET kind='VEHICLE' WHERE account_id='other'"), "identity is immutable");

  section("account classification stays authoritative even for tombstoned headers");
  for (const assignment of ["user_id='u2'", "currency='INR'", "type='LIABILITY'", "subtype='VEHICLE'", "is_system=1", "id='renamed-physical'"]) {
    await throwsAsync(`live header protects account ${assignment}`, () => client.execute(`UPDATE ledger_accounts SET ${assignment} WHERE id='other'`), "physical asset account owner, currency and classification are immutable");
  }
  await client.execute("UPDATE physical_assets SET deleted_at=1 WHERE account_id='other'");
  for (const assignment of ["user_id='u2'", "currency='INR'", "type='LIABILITY'", "subtype='VEHICLE'", "is_system=1", "id='renamed-physical'"]) {
    await throwsAsync(`tombstoned header still protects account ${assignment}`, () => client.execute(`UPDATE ledger_accounts SET ${assignment} WHERE id='other'`), "physical asset account owner, currency and classification are immutable");
  }
  await client.execute("UPDATE ledger_accounts SET deleted_at=1 WHERE id='other'");
  check("account tombstone is allowed beside historical physical header", (await client.execute("SELECT deleted_at FROM ledger_accounts WHERE id='other'")).rows[0].deleted_at, 1n);
  await client.execute("UPDATE ledger_accounts SET deleted_at=NULL WHERE id='other'");
  await client.execute("UPDATE physical_assets SET deleted_at=NULL WHERE account_id='other'");
  await throwsAsync("tombstoned header cannot bypass account ownership", () => insert("physical_assets", header("foreign", "OTHER", { deleted_at: 1 })), "physical asset account");
  await throwsAsync("tombstoned header cannot bypass account kind", () => insert("physical_assets", header("bank", "OTHER", { deleted_at: 1 })), "physical asset account");
  await throwsAsync("tombstoned assertion cannot bypass account ownership", () => insert("physical_asset_valuations", valuation("foreign-history", { user_id: "u2", deleted_at: 1 })), "parent, owner");

  section("purchase/date/model constraints refuse malformed states");
  const invalidHeaderCases: Readonly<Record<string, Record<string, InValue>>> = {
    "date without price": { purchase_on: "2025-01-01" }, "price without date": { purchase_price_minor: 1 },
    "zero purchase": { purchase_on: "2025-01-01", purchase_price_minor: 0 }, "negative purchase": { purchase_on: "2025-01-01", purchase_price_minor: -1 },
    "fraction purchase": { purchase_on: "2025-01-01", purchase_price_minor: 0.5 }, "impossible purchase": { purchase_on: "2025-02-30", purchase_price_minor: 1 },
    "noncanonical purchase": { purchase_on: "2025-1-01", purchase_price_minor: 1 }, "null model has stray rate": { rate_percent_scaled: 1n },
    "unknown model": { model_kind: "OTHER" }, "schedule missing identifier": { model_kind: "SCHEDULE" },
    "custom schedule": { model_kind: "SCHEDULE", schedule_id: "CUSTOM" },
    "declining missing rate": { model_kind: "DECLINING", model_basis: "b" },
    "declining100percent": { model_kind: "DECLINING", rate_percent_scaled: 100000000n, model_basis: "b" },
    "straight missing floor": { model_kind: "STRAIGHT", rate_percent_scaled: 1n, model_basis: "b" },
    "straight zero rate": { model_kind: "STRAIGHT", rate_percent_scaled: 0n, floor_percent_scaled: 0n, model_basis: "b" },
    "floor above100percent": { model_kind: "STRAIGHT", rate_percent_scaled: 1n, floor_percent_scaled: 100000001n, model_basis: "b" },
  };
  for (const [label, fields] of Object.entries(invalidHeaderCases)) await rejectHeader(label, fields);
  // INTEGER affinity coerces "01", "1.0", "1e6" and padded digits to 1; only non-integers must fail.
  for (const rate of ["-1", "1.5", "NaN", "", "1\0junk"]) await rejectHeader(`noncanonical rate ${JSON.stringify(rate)}`, { model_kind: "STRAIGHT", rate_percent_scaled: rate, floor_percent_scaled: 0n, model_basis: "b" });
  await rejectHeader("embedded NUL floor refused", { model_kind: "STRAIGHT", rate_percent_scaled: 1n, floor_percent_scaled: "1\0junk", model_basis: "b" });
  for (const basis of ["", " ", "\t\n", "\u00a0", "\u2003", "\ufeff"]) await rejectHeader(`blank model basis ${JSON.stringify(basis)}`, { model_kind: "DECLINING", rate_percent_scaled: 0n, model_basis: basis });

  section("valuation history owner/live/date and uniqueness");
  for (const [label, fields, fragment] of [
    ["wrong owner", { user_id: "u2" }, "parent, owner"], ["missing parent", { asset_account_id: "absent" }, "parent, owner"],
    ["negative value", { value_minor: -1 }, "CHECK constraint"], ["fraction value", { value_minor: 0.5 }, "CHECK constraint"],
    ["invalid source", { source: "GUESS" }, "CHECK constraint"], ["impossible date", { on_date: "2025-02-30" }, "CHECK constraint"],
    ["before purchase", { asset_account_id: "vehicle", on_date: "2025-01-01" }, "parent, owner"],
  ] as const) await throwsAsync(label, () => insert("physical_asset_valuations", valuation("bad", fields)), fragment);
  await throwsAsync("duplicate live assertion date refused", () => insert("physical_asset_valuations", valuation("dup")), "UNIQUE constraint");
  await client.execute("UPDATE physical_asset_valuations SET value_minor=10 WHERE id='zero'");
  check("same-date owner correction updates assertion", (await client.execute("SELECT value_minor FROM physical_asset_valuations WHERE id='zero'")).rows[0].value_minor, 10n);
  await throwsAsync("assertion parent cannot change", () => client.execute("UPDATE physical_asset_valuations SET asset_account_id='huge' WHERE id='zero'"), "identity is immutable");
  await throwsAsync("purchase cannot move past assertion", () => client.execute("UPDATE physical_assets SET purchase_on='2025-04-02',purchase_price_minor=100 WHERE account_id='other'"), "assertion precedes purchase");
  await client.execute("UPDATE physical_asset_valuations SET deleted_at=1 WHERE id='zero'");
  await insert("physical_asset_valuations", valuation("replacement"));
  check("old assertion retained under replacement", (await client.execute("SELECT count(*) n FROM physical_asset_valuations WHERE on_date='2025-03-01'")).rows[0].n, 2n);
  await client.execute("UPDATE physical_assets SET deleted_at=1 WHERE account_id='huge'");
  await throwsAsync("removed physical parent refuses assertion", () => insert("physical_asset_valuations", valuation("removed-parent", { asset_account_id: "huge" })), "parent, owner");

  section("linked acquisition consistency in both creation orders");
  await insert("asset_acquisitions", { id: "link", user_id: "u1", asset_account_id: "vehicle", posting_id: "purchase-leg" });
  await throwsAsync("header amount cannot drift from linked posting", () => client.execute("UPDATE physical_assets SET purchase_price_minor=100 WHERE account_id='vehicle'"), "conflicts with linked acquisition");
  await throwsAsync("header date cannot drift from linked posting", () => client.execute("UPDATE physical_assets SET purchase_on='2025-01-03' WHERE account_id='vehicle'"), "conflicts with linked acquisition");
  await throwsAsync("posting amount cannot invalidate header", () => client.execute("UPDATE postings SET amount_minor=100 WHERE id='purchase-leg'"), "conflicts with physical purchase");
  await throwsAsync("transaction date cannot invalidate header", () => client.execute("UPDATE transactions SET txn_date='2025-01-03' WHERE id='purchase'"), "conflicts with physical purchase");
  await account("linked-first");
  await client.execute("UPDATE asset_acquisitions SET deleted_at=1 WHERE id='link'");
  await insert("asset_acquisitions", { id: "link-first", user_id: "u1", asset_account_id: "linked-first", posting_id: "purchase-leg" });
  await throwsAsync("header-after-link mismatched price refused", () => insert("physical_assets", header("linked-first", "OTHER", { purchase_on: "2025-01-02", purchase_price_minor: 100 })), "conflicts with linked acquisition");
  await insert("physical_assets", header("linked-first", "OTHER", { purchase_on: "2025-01-02", purchase_price_minor: 9007199254740993n }));
  check("matching header-after-link succeeds", (await client.execute("SELECT count(*) n FROM physical_assets WHERE account_id='linked-first'")).rows[0].n, 1n);
  await account("mismatch-link");
  await insert("physical_assets", header("mismatch-link", "OTHER", { purchase_on: "2025-01-02", purchase_price_minor: 100 }));
  await client.execute("UPDATE asset_acquisitions SET deleted_at=1 WHERE id='link-first'");
  await throwsAsync("link-after-header mismatched price refused", () => insert("asset_acquisitions", { id: "mismatch", user_id: "u1", asset_account_id: "mismatch-link", posting_id: "purchase-leg" }), "conflicts with physical purchase");
  checkDeep("refusals preserve ledger amounts", await ledger(), beforeLedger);

  section("rollback removes new objects only, then up reapplies");
  // Existing acquisitions remain independent of physical headers on rollback.
  const acquisitionRows = (await client.execute("SELECT * FROM asset_acquisitions ORDER BY id")).rows;
  await apply(down);
  checkDeep("rollback restores exact previous schema objects", await objects(), beforeObjects);
  checkDeep("rollback preserves ledger", await ledger(), beforeLedger);
  checkDeep("rollback preserves acquisition links", (await client.execute("SELECT * FROM asset_acquisitions ORDER BY id")).rows, acquisitionRows);
  await apply(up);
  checkDeep("reapply foreign keys valid", (await client.execute("PRAGMA foreign_key_check")).rows, []);
  check("reapply creates empty header table", (await client.execute("SELECT count(*) n FROM physical_assets")).rows[0].n, 0n);
  client.close();
  done();
}
main().catch((error) => { console.error(error); client.close(); process.exit(1); });

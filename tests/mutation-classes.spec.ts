/**
 * Task 2.0 acceptance (recorded in financial-health-scoring.md before code):
 * every schema table has exactly one class; nothing extra; verbs per §10.
 */
import { getTableName, is } from "drizzle-orm";
import { SQLiteTable } from "drizzle-orm/sqlite-core";
import * as schema from "@/infra/db/schema";
import { allows, MUTATION_CLASSES, TABLE_NAMES, VERBS_BY_CLASS, type TableName } from "@/domain/mutation-classes";
import { check, checkDeep, done, section } from "./harness";

const actual = Object.values(schema)
  .filter((value) => is(value, SQLiteTable))
  .map((table) => getTableName(table as SQLiteTable))
  .sort();
const registered = [...TABLE_NAMES].sort();

section("exhaustive over the real schema");
check("the schema has 66 tables today", actual.length, 66);
checkDeep("every schema table is registered", actual.filter((name) => !registered.includes(name as never)), []);
checkDeep("no registered table is missing from the schema", registered.filter((name) => !actual.includes(name)), []);
check("each registered name has exactly one classification", Object.keys(MUTATION_CLASSES).length, TABLE_NAMES.length);

section("classes follow ARCHITECTURE §10");
checkDeep(
  "class A is exactly §10's ledger list",
  TABLE_NAMES.filter((t) => MUTATION_CLASSES[t].class === "A").sort(),
  ["corporate_actions", "deposit_contributions", "import_batches", "import_rows", "instrument_incomes", "lot_matches", "lots", "postings", "trades", "transactions"],
);
check("the eight P1 tables are all reference data", (["insurance_policies", "insurance_price_steps", "cover_absence_declarations", "income_streams", "income_price_steps", "income_receipts", "recurring_commitments", "commitment_price_steps"] as const satisfies readonly TableName[]).every((t) => MUTATION_CLASSES[t].class === "B"), true);
check("every table §10 does not name carries a reason", (["nps_holdings", "gold_leases", "loan_prepayments", "instrument_provider_mappings", "txn_type_legality", "asset_acquisitions", "tier_history", "target_allocations"] as const satisfies readonly TableName[]).every((t) => (MUTATION_CLASSES[t].reason ?? "").length > 0), true);

section("1.8 and 3.4 tables (2026-11-03)");
check("the expense-to-asset link is owner-stated reference data", MUTATION_CLASSES.asset_acquisitions.class, "B");
check("so a link is tombstoned and restored, never posted", allows("asset_acquisitions", "tombstone") && allows("asset_acquisitions", "restore") && !allows("asset_acquisitions", "post"), true);
check("tier history is system data", MUTATION_CLASSES.tier_history.class, "C");
check("so the owner has no verb on it", VERBS_BY_CLASS.C.length === 0 && !allows("tier_history", "update"), true);

section("verbs");
check("a ledger row is never updated in place", allows("postings", "update"), false);
check("a ledger row is reversed", allows("transactions", "reverse"), true);
check("reference data is updated", allows("insurance_policies", "update"), true);
check("both A and B restore (undo is tombstone + restore)", allows("postings", "restore") && allows("budgets", "restore"), true);
checkDeep("system tables have no verbs at all", VERBS_BY_CLASS.C, []);
check("not even tombstone on prices", allows("price_quotes", "tombstone"), false);

section("QA regression (Codex, 2026-10-30): frozen all the way down");
check("TABLE_NAMES cannot grow an unclassified entry", Object.isFrozen(TABLE_NAMES), true);
check("every classification object is frozen", TABLE_NAMES.every((t) => Object.isFrozen(MUTATION_CLASSES[t])), true);
check("Reflect.set cannot reclassify a table", Reflect.set(MUTATION_CLASSES.loan_prepayments, "class", "C"), false);
check("so loan prepayments still allow update", allows("loan_prepayments", "update"), true);
check("Reflect.set cannot append a table name", Reflect.set(TABLE_NAMES, TABLE_NAMES.length, "rogue"), false);
check("the verb lists are frozen too", Object.values(VERBS_BY_CLASS).every(Object.isFrozen) && Object.isFrozen(VERBS_BY_CLASS), true);

done();

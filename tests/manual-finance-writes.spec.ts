import { readFileSync, readdirSync, rmSync } from "node:fs";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { FixedClock, UserId, newUuid } from "@/core/kernel";
import { Currency, Money } from "@/core/money";
import { PriceSteps, Recurrence } from "@/core/recurrence";
import { CalendarDate } from "@/core/time";
import { Days } from "@/core/units";
import { Commitment } from "@/domain/commitments";
import { IncomeStream } from "@/domain/income";
import { InsurancePolicy } from "@/domain/insurance";
import * as schema from "@/infra/db/schema";
import { DrizzleCommitmentRepository, DrizzleIncomeRepository, DrizzleInsuranceRepository } from "@/infra/manual-finance";
import { DrizzleCommitmentWriter, DrizzleIncomeWriter, DrizzleInsuranceWriter } from "@/infra/manual-finance-writes";
import { newRequestContext } from "@/infra/unit-of-work";
import { check, checkDeep, done, section, throwsAsync } from "./harness";

const file = `tmp/manual-finance-writes-${newUuid()}.db`;
const client = createClient({ url: `file:${file}` });
const db = drizzle(client, { schema });
const owner = UserId.from("writer-owner"), other = UserId.from("writer-other");
const context = newRequestContext(owner.value, new FixedClock(new Date("2026-10-30T12:00:00Z")), { requestId: "create-request" });
const currency = Currency.of("USD"), on = CalendarDate.parse, large = 9007199254740993n;
const schedule = new Recurrence({ cadence: "MONTHLY", anchor: on("2026-01-31"), endsOn: on("2028-12-31"), cancelNotice: Days(0) });
const prices = () => new PriceSteps([{ from: on("2026-01-01"), amount: null }, { from: on("2027-01-01"), amount: Money.zero(currency) }, { from: on("2028-01-01"), amount: Money.fromMinor(large, currency) }]);
const income = (id: string) => new IncomeStream({ id, name: "Salary", kind: "SALARY", payer: null, currency, schedule, expected: prices(), grace: Days(5) });
const insurance = (id: string) => new InsurancePolicy({ id, kind: "HEALTH", insurer: "Insurer", insured: "Self", currency, premiumSchedule: schedule, premium: prices(), sumInsured: Money.fromMinor(large, currency), endsOn: on("2028-10-01") });
const commitment = (id: string) => new Commitment({ id, name: "Course", kind: "EDUCATION", currency, schedule, price: prices(), autoRenews: false, endsOn: on("2028-09-01") });
const iw = new DrizzleIncomeWriter(db, context), pw = new DrizzleInsuranceWriter(db, context), cw = new DrizzleCommitmentWriter(db, context);
const ir = new DrizzleIncomeRepository(db), pr = new DrizzleInsuranceRepository(db), cr = new DrizzleCommitmentRepository(db);
const tables = ["income_streams", "insurance_policies", "recurring_commitments", "income_price_steps", "insurance_price_steps", "commitment_price_steps", "audit_events", "ledger_events", "postings"];
async function counts() {
  return Promise.all(tables.map(async (table) => (await client.execute(`SELECT count(*) AS n FROM ${table}`)).rows[0].n));
}

/** Drizzle wraps driver errors; inspect the cause chain so the expected refusal is proved. */
async function rejectsWith(label: string, operation: () => Promise<void>, fragment: string) {
  try { await operation(); check(label, "accepted", "refused"); }
  catch (error) {
    let current: unknown = error;
    const messages: string[] = [];
    while (current instanceof Error) { messages.push(current.message); current = current.cause; }
    check(label, messages.join(" ").includes(fragment), true);
  }
}

async function main() {
  await client.execute("PRAGMA foreign_keys=ON");
  const dir = "src/infra/db/migrations";
  for (const file of readdirSync(dir).filter((file) => file.endsWith(".sql")).sort()) {
    for (const statement of readFileSync(`${dir}/${file}`, "utf8").split("--> statement-breakpoint")) if (statement.trim()) await client.execute(statement);
  }
  for (const user of [owner, other]) await client.execute({ sql: "INSERT INTO user(id,name,email) VALUES(?,?,?)", args: [user.value, user.value, `${user.value}@example.test`] });
  section("all three creates hydrate exact complete domain history");
  await iw.create(owner, income("income"));
  await pw.create(owner, insurance("insurance"));
  await cw.create(owner, commitment("commitment"));
  const restoredIncome = await ir.find(owner, "income"), restoredPolicy = await pr.find(owner, "insurance"), restoredCommitment = await cr.find(owner, "commitment");
  if (!restoredIncome || !restoredPolicy || !restoredCommitment) throw new Error("Created records did not hydrate");
  for (const history of [restoredIncome.expected, restoredPolicy.premium, restoredCommitment.price]) {
    checkDeep("full history preserves exact unknown, zero and future large minors", history.entries().map((step) => [step.from.toISO(), step.amount?.minor.toString() ?? null]), [["2026-01-01", null], ["2027-01-01", "0"], ["2028-01-01", large.toString()]]);
    check("round-trip currency", history.on(on("2028-02-01"))?.currency.code, "USD");
  }
  check("sum insured exact beyond safe integer", restoredPolicy.sumInsured?.minor.toString(), large.toString());
  check("notice zero preserved", restoredIncome.schedule.cancelNotice, 0);
  check("anchor does not drift", restoredIncome.schedule.nextOnOrAfter(on("2026-03-01"))?.toISO(), "2026-03-31");
  check("payer unknown preserved", restoredIncome.payer, null);
  check("grace preserved", restoredIncome.grace, 5);
  check("commitment end distinct from schedule", restoredCommitment.endsOn?.toISO(), "2028-09-01");
  check("renewal false preserved", restoredCommitment.autoRenews, false);
  checkDeep("one audit and event per aggregate, no postings", await counts(), [1, 1, 1, 3, 3, 3, 3, 3, 0]);
  const audits = await client.execute("SELECT actor_id,request_id,before_json,after_json FROM audit_events ORDER BY entity_type");
  for (const row of audits.rows) {
    check("audit actor is authenticated owner", row.actor_id, owner.value);
    check("audit request identity retained", row.request_id, "create-request");
    check("create before image null", row.before_json, null);
    check("snapshot exact large amount retained", String(row.after_json).includes(large.toString()), true);
  }
  check("context clock timestamps header", (await client.execute("SELECT created_at FROM income_streams")).rows[0].created_at, 1793361600000);
  check("context clock timestamps children", (await client.execute("SELECT created_at FROM income_price_steps LIMIT 1")).rows[0].created_at, 1793361600000);
  section("ownership, duplicates and invalid values have no partial effects");
  const initial = await counts();
  await throwsAsync("cannot write for foreign owner", () => iw.create(other, income("foreign")), "authenticated actor");
  const delegated = new DrizzleIncomeWriter(db, { ...context, actorId: other.value });
  await throwsAsync("no undeclared delegated-actor privilege", () => delegated.create(owner, income("delegated")), "authenticated actor");
  await rejectsWith("duplicate income id refused", () => iw.create(owner, income("income")), "UNIQUE");
  await rejectsWith("duplicate insurance id refused", () => pw.create(owner, insurance("insurance")), "UNIQUE");
  await rejectsWith("duplicate commitment id refused", () => cw.create(owner, commitment("commitment")), "UNIQUE");
  const otherWriter = new DrizzleIncomeWriter(db, newRequestContext(other.value, context.clock));
  await rejectsWith("foreign existing id cannot be taken over", () => otherWriter.create(other, income("income")), "UNIQUE");
  await throwsAsync("mismatched premium currency refused", () => pw.create(owner, new InsurancePolicy({ ...insurance("wrong-currency"), premium: new PriceSteps([{ from: on("2026-01-01"), amount: Money.fromMinor(1n, Currency.of("INR")) }]) })), "currency");
  await throwsAsync("mismatched sum insured currency refused", () => pw.create(owner, new InsurancePolicy({ ...insurance("wrong-sum"), sumInsured: Money.fromMinor(1n, Currency.of("INR")) })), "currency");
  await throwsAsync("SQLite overflow refused before CAST", () => iw.create(owner, new IncomeStream({ ...income("overflow"), expected: new PriceSteps([{ from: on("2026-01-01"), amount: Money.fromMinor(9223372036854775808n, currency) }]) })), "integer range");
  await rejectsWith("blank insured name refused by schema", () => pw.create(owner, new InsurancePolicy({ ...insurance("blank-insured"), insured: "  " })), "CHECK constraint");
  checkDeep("all rejected attempts leave every count unchanged", await counts(), initial);
  check("foreign owner cannot read created policy", await pr.find(other, "insurance"), null);
  section("child and audit failures roll back aggregate and all history");
  await client.execute("CREATE TRIGGER fail_income_child BEFORE INSERT ON income_price_steps WHEN NEW.from_date='2027-01-01' BEGIN SELECT RAISE(ABORT,'injected child failure'); END");
  await rejectsWith("second child failure propagates", () => iw.create(owner, income("child-fails")), "injected child failure");
  checkDeep("header and first child rolled back with audit/events", await counts(), initial);
  await client.execute("DROP TRIGGER fail_income_child");
  await client.execute("CREATE TRIGGER fail_create_audit BEFORE INSERT ON audit_events BEGIN SELECT RAISE(ABORT,'injected audit failure'); END");
  await rejectsWith("audit failure propagates after all policy rows", () => pw.create(owner, insurance("audit-fails")), "injected audit failure");
  checkDeep("all policy rows rolled back when audit refuses", await counts(), initial);
  await client.execute("DROP TRIGGER fail_create_audit");
  await client.execute("CREATE TRIGGER fail_commitment_event BEFORE INSERT ON ledger_events BEGIN SELECT RAISE(ABORT,'injected event failure'); END");
  await rejectsWith("event failure propagates after audit", () => cw.create(owner, commitment("event-fails")), "injected event failure");
  checkDeep("all commitment and audit rows rolled back", await counts(), initial);
  await client.execute("DROP TRIGGER fail_commitment_event");
  const maximum = new IncomeStream({ ...income("max-exact"), expected: new PriceSteps([{ from: on("2026-01-01"), amount: Money.fromMinor(9223372036854775807n, currency) }]) });
  await iw.create(owner, maximum);
  check("maximum SQLite integer round-trips without saturation", (await ir.find(owner, maximum.id))?.expected.entries()[0]?.amount?.minor.toString(), "9223372036854775807");
  check("failed writes left no phantom records", await ir.find(owner, "child-fails"), null);
  check("failed audit left no phantom policy", await pr.find(owner, "audit-fails"), null);
  check("failed event left no phantom commitment", await cr.find(owner, "event-fails"), null);
  check("foreign keys remain intact", (await client.execute("PRAGMA foreign_key_check")).rows.length, 0);
}

main().then(done).catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => {
  client.close();
  for (const suffix of ["", "-shm", "-wal"]) {
    try { rmSync(file + suffix, { force: true }); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "EPERM") throw error; }
  }
});

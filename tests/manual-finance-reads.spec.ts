import { readFileSync, readdirSync } from "node:fs";
import { createClient, type InValue } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { UserId } from "@/core/kernel";
import { CalendarDate, DateRange } from "@/core/time";
import * as schema from "@/infra/db/schema";
import { DrizzleCommitmentRepository, DrizzleIncomeRepository, DrizzleInsuranceRepository } from "@/infra/manual-finance";
import { check, checkDeep, checkTrue, done, section, throws, throwsAsync } from "./harness";

const client = createClient({ url: "file::memory:" });
const db = drizzle(client, { schema });
const owner = UserId.from("u1"), other = UserId.from("u2");
const on = CalendarDate.parse;
const schedule = { cadence: "MONTHLY", anchor_on: "2025-01-31", schedule_ends_on: "2025-12-31", cancel_notice_days: null };
const large = 9007199254740993n;
async function insert(table: string, row: Record<string, InValue>) {
  await client.execute({ sql: `INSERT INTO ${table} (${Object.keys(row).join(",")}) VALUES (${Object.keys(row).map(() => "?").join(",")})`, args: Object.values(row) });
}
async function main() {
  await client.execute("PRAGMA foreign_keys=ON");
  const dir = "src/infra/db/migrations";
  for (const file of readdirSync(dir).filter((file) => file.endsWith(".sql")).sort()) {
    for (const statement of readFileSync(`${dir}/${file}`, "utf8").split("--> statement-breakpoint")) if (statement.trim()) await client.execute(statement);
  }
  for (const user of ["u1", "u2"]) await insert("user", { id: user, name: user, email: `${user}@example.test` });
  for (const user of ["u1", "u2"]) {
    await insert("income_streams", { id: `income-${user}`, user_id: user, name: "Salary", kind: "SALARY", payer: null, currency: "USD", ...schedule, grace_days: 5 });
    await insert("insurance_policies", { id: `insurance-${user}`, user_id: user, kind: "HEALTH", insurer: "Insurer", insured: "Self", currency: "USD", sum_insured_minor: large, ...schedule, ends_on: "2025-09-30" });
    await insert("recurring_commitments", { id: `commitment-${user}`, user_id: user, name: "Membership", kind: "MEMBERSHIP", currency: "USD", ...schedule, cancel_notice_days: 0, auto_renews: 0, ends_on: "2025-10-31" });
    for (const [table, parent, id] of [["income_price_steps", "stream_id", `income-${user}`], ["insurance_price_steps", "policy_id", `insurance-${user}`], ["commitment_price_steps", "commitment_id", `commitment-${user}`]]) {
      await throwsAsync(`${table} refuses negative prices`, () => insert(table, { id: `${table}-${user}-invalid-negative`, user_id: user, [parent]: id, from_date: "2025-05-01", amount_minor: -large, currency: "USD" }), "CHECK constraint");
      for (const [suffix, date, amount] of [["unknown", "2025-01-01", null], ["zero", "2025-02-01", 0], ["positive", "2025-03-01", large], ["deleted", "2025-04-01", 123]]) {
        await insert(table, { id: `${table}-${user}-${suffix}`, user_id: user, [parent]: id, from_date: date, amount_minor: amount, currency: "USD", deleted_at: suffix === "deleted" ? 1 : null });
      }
    }
    await insert("cover_absence_declarations", { id: `absence-${user}`, user_id: user, kind: "TERM_LIFE", declared_on: "2024-01-01" });
  }
  await insert("cover_absence_declarations", { id: "absence-later", user_id: "u1", kind: "MOTOR", declared_on: "2025-01-01" });
  await insert("cover_absence_declarations", { id: "absence-deleted", user_id: "u1", kind: "HOME", declared_on: "2026-01-01", deleted_at: 1 });
  const incomeRepo = new DrizzleIncomeRepository(db), insuranceRepo = new DrizzleInsuranceRepository(db), commitmentRepo = new DrizzleCommitmentRepository(db);
  section("actual domain hydration preserves owner, recurrence and exact price history");
  const income = await incomeRepo.find(owner, "income-u1"), insurance = await insuranceRepo.find(owner, "insurance-u1"), commitment = await commitmentRepo.find(owner, "commitment-u1");
  checkTrue("all owner records hydrate", income !== null && insurance !== null && commitment !== null);
  if (!income || !insurance || !commitment) throw new Error("Expected fixture records");
  check("payer remains unknown", income.payer, null);
  check("unknown notice remains null", income.schedule.cancelNotice, null);
  check("known zero notice remains zero", commitment.schedule.cancelNotice, 0);
  check("income grace retains days", income.grace, 5);
  check("monthly recurrence retains the original anchor", income.schedule.nextOnOrAfter(on("2025-03-01"))?.toString(), "2025-03-31");
  check("recurrence end is separate", commitment.schedule.endsOn?.toString(), "2025-12-31");
  check("commitment end is separate", commitment.endsOn?.toString(), "2025-10-31");
  check("auto-renew false remains false", commitment.autoRenews, false);
  check("sum insured exceeds JS safe integer without loss", insurance.sumInsured?.minor.toString(), large.toString());
  for (const history of [income.expected, insurance.premium, commitment.price]) {
    check("explicit unknown step remains unknown", history.on(on("2025-01-31")), null);
    check("known zero remains exact zero", history.on(on("2025-02-28"))?.minor.toString(), "0");
    check("positive history remains exact past safe integer", history.on(on("2025-03-31"))?.minor.toString(), large.toString());
    check("tombstoned step never overrides history", history.on(on("2025-04-30"))?.minor.toString(), large.toString());
    check("price currency remains USD", history.on(on("2025-03-31"))?.currency.code, "USD");
  }
  for (const [repo, id] of [[incomeRepo, "income-u1"], [insuranceRepo, "insurance-u1"], [commitmentRepo, "commitment-u1"]] as const) {
    check("foreign owner cannot find a known id", await repo.find(other, id), null);
    check("missing id returns null", await repo.find(owner, "missing"), null);
    check("lists include only the owner", (await repo.list(owner)).length, 1);
  }
  checkDeep("declarations preserve dates, order and explicit kinds", (await insuranceRepo.declarations(owner)).map((entry) => [entry.kind, entry.declaredOn.toString()]), [["TERM_LIFE", "2024-01-01"], ["MOTOR", "2025-01-01"]]);
  section("receipts derive exact actual amounts from the explicit live posting");
  await insert("ledger_accounts", { id: "bank", user_id: "u1", code: "bank", name: "Bank", type: "ASSET", currency: "USD" });
  await insert("transactions", { id: "txn", user_id: "u1", txn_type: "DEPOSIT", txn_date: "2025-02-02", description: "Payment" });
  await insert("postings", { id: "posting", transaction_id: "txn", account_id: "bank", direction: "DEBIT", amount_minor: large, currency: "USD", seq: 0 });
  await insert("income_receipts", { id: "receipt", user_id: "u1", stream_id: "income-u1", occurrence_date: "2025-01-31", posting_id: "posting", received_on: "2025-02-02" });
  let receipts = await incomeRepo.receipts(owner, "income-u1");
  check("receipt exact amount comes from posting", receipts[0]?.amount.minor.toString(), large.toString());
  check("receipt currency is preserved", receipts[0]?.amount.currency.code, "USD");
  check("scheduled date remains distinct from arrival", receipts[0]?.occurrence.toString(), "2025-01-31");
  check("arrival date remains explicit", receipts[0]?.receivedOn.toString(), "2025-02-02");
  check("receipt tenant isolation", (await incomeRepo.receipts(other, "income-u1")).length, 0);
  await client.execute({ sql: "UPDATE postings SET amount_minor=? WHERE id='posting'", args: [large + 2n] });
  receipts = await incomeRepo.receipts(owner, "income-u1");
  check("there is no copied receipt amount", receipts[0]?.amount.minor.toString(), (large + 2n).toString());
  await client.execute("UPDATE postings SET direction='CREDIT' WHERE id='posting'");
  const wrongLeg = await incomeRepo.receipts(owner, "income-u1");
  check("CREDIT receipt leg retains its negative direction", wrongLeg[0]?.amount.minor.toString(), (-(large + 2n)).toString());
  throws("wrong-leg income cannot be accepted as a positive receipt", () => income.period(DateRange.of(on("2025-01-01"), on("2025-02-28")), wrongLeg, on("2025-02-28")), "bank-side posting");
  await client.execute("UPDATE postings SET direction='DEBIT' WHERE id='posting'");
  for (const [table, id] of [["income_receipts", "receipt"], ["postings", "posting"], ["transactions", "txn"], ["ledger_accounts", "bank"], ["income_streams", "income-u1"]]) {
    await client.execute({ sql: `UPDATE ${table} SET deleted_at=1 WHERE id=?`, args: [id] });
    check(`${table} tombstone hides receipt`, (await incomeRepo.receipts(owner, "income-u1")).length, 0);
    await client.execute({ sql: `UPDATE ${table} SET deleted_at=NULL WHERE id=?`, args: [id] });
  }
  for (const [table, repo, id] of [["income_streams", incomeRepo, "income-u1"], ["insurance_policies", insuranceRepo, "insurance-u1"], ["recurring_commitments", commitmentRepo, "commitment-u1"]] as const) {
    await client.execute({ sql: `UPDATE ${table} SET deleted_at=1 WHERE id=?`, args: [id] });
    check("tombstoned owner header cannot be found", await repo.find(owner, id), null);
    check("tombstoned owner header leaves list", (await repo.list(owner)).length, 0);
  }
  await insert("income_streams", { id: "incomplete", user_id: "u1", name: "Incomplete", kind: "OTHER", payer: null, currency: "USD", ...schedule, grace_days: 0 });
  await throwsAsync("missing price history refuses instead of inventing unknown", () => incomeRepo.find(owner, "incomplete"), "no live price history");
  await insert("insurance_policies", { id: "unknown-cover", user_id: "u1", kind: "OTHER", insurer: "Insurer", insured: "Self", currency: "USD", sum_insured_minor: null, ...schedule, ends_on: null });
  await insert("insurance_price_steps", { id: "unknown-premium", user_id: "u1", policy_id: "unknown-cover", from_date: "2025-01-01", amount_minor: null, currency: "USD" });
  const unknownCover = await insuranceRepo.find(owner, "unknown-cover");
  checkTrue("explicit unknown history still hydrates a policy", unknownCover !== null);
  check("unknown sum insured stays null", unknownCover?.sumInsured, null);
  check("all-unknown premium retains explicit currency", unknownCover?.currency.code, "USD");
  check("all-unknown premium never becomes zero", unknownCover?.premium.on(on("2025-02-01")), null);
  await client.execute("UPDATE insurance_price_steps SET deleted_at=1 WHERE id='unknown-premium'");
  await throwsAsync("history containing only tombstones refuses hydration", () => insuranceRepo.find(owner, "unknown-cover"), "no live price history");
  client.close();
  done();
}
main().catch((error) => { client.close(); console.error(error); process.exitCode = 1; });

import { CreateCommitment, CreateIncomeStream, CreateInsurancePolicy } from "@/app/manual-finance.usecases";
import { DomainError, UserId } from "@/core/kernel";
import { Currency, Money } from "@/core/money";
import { PriceSteps, Recurrence } from "@/core/recurrence";
import { CalendarDate } from "@/core/time";
import { Days } from "@/core/units";
import { Commitment, type CommitmentWriter } from "@/domain/commitments";
import { IncomeStream, type IncomeWriter } from "@/domain/income";
import { InsurancePolicy, type InsuranceWriter } from "@/domain/insurance";
import { check, checkDeep, done, section } from "./harness";

const owner = UserId.from("manual-usecase-owner");
const currency = Currency.of("USD");
const on = CalendarDate.parse("2026-01-31");
const schedule = new Recurrence({ cadence: "MONTHLY", anchor: on, endsOn: null, cancelNotice: Days(0) });
const history = new PriceSteps([
  { from: on, amount: null },
  { from: CalendarDate.parse("2027-01-31"), amount: Money.zero(currency) },
  { from: CalendarDate.parse("2028-01-31"), amount: Money.fromMinor(9007199254740993n, currency) },
]);

/** Named second implementations of the creation ports, kept entirely in memory. */
class MemoryIncomeWriter implements IncomeWriter {
  readonly rows: { userId: UserId; stream: IncomeStream }[] = [];
  async create(userId: UserId, stream: IncomeStream): Promise<void> { this.rows.push({ userId, stream }); }
}
class MemoryInsuranceWriter implements InsuranceWriter {
  readonly rows: { userId: UserId; policy: InsurancePolicy }[] = [];
  async create(userId: UserId, policy: InsurancePolicy): Promise<void> { this.rows.push({ userId, policy }); }
}
class MemoryCommitmentWriter implements CommitmentWriter {
  readonly rows: { userId: UserId; commitment: Commitment }[] = [];
  async create(userId: UserId, commitment: Commitment): Promise<void> { this.rows.push({ userId, commitment }); }
}

async function main() {
  section("creation boundary owns identity and preserves exact domain input");
  const iw = new MemoryIncomeWriter(), pw = new MemoryInsuranceWriter(), cw = new MemoryCommitmentWriter();
  const incomeFields = { name: "Salary", kind: "SALARY" as const, payer: null, currency, schedule, expected: history, grace: Days(3), id: "untrusted-id" };
  const insuranceFields = { kind: "HEALTH" as const, insurer: "Insurer", insured: "Self", sumInsured: null, currency, premiumSchedule: schedule, premium: history, endsOn: null, id: "untrusted-id" };
  const commitmentFields = { name: "Membership", kind: "MEMBERSHIP" as const, currency, schedule, price: history, autoRenews: false, endsOn: null, id: "untrusted-id" };
  const income = await new CreateIncomeStream(iw).execute({ userId: owner, fields: incomeFields });
  const insurance = await new CreateInsurancePolicy(pw).execute({ userId: owner, fields: insuranceFields });
  const commitment = await new CreateCommitment(cw).execute({ userId: owner, fields: commitmentFields });
  if (!income.ok || !insurance.ok || !commitment.ok) throw new Error("Expected valid creates");
  for (const [result, record, userId] of [
    [income.value, iw.rows[0].stream, iw.rows[0].userId],
    [insurance.value, pw.rows[0].policy, pw.rows[0].userId],
    [commitment.value, cw.rows[0].commitment, cw.rows[0].userId],
  ] as const) {
    check("owner is passed explicitly to persistence", userId, owner);
    check("caller cannot replace generated identity", result.id === "untrusted-id", false);
    check("returned identity equals saved identity", result.id, record.id);
  }
  check("each create generates its own identity", new Set([income.value.id, insurance.value.id, commitment.value.id]).size, 3);
  checkDeep("income retains unknown/zero/exact large future history", iw.rows[0].stream.expected.entries().map((step) => step.amount?.minor.toString() ?? null), [null, "0", "9007199254740993"]);
  check("unknown sum insured remains unknown", pw.rows[0].policy.sumInsured, null);
  check("false auto-renew remains false", cw.rows[0].commitment.autoRenews, false);

  section("invalid domain input never reaches persistence");
  const invalidIncome = await new CreateIncomeStream(iw).execute({ userId: owner, fields: { ...incomeFields, name: " " } });
  const invalidPolicy = await new CreateInsurancePolicy(pw).execute({ userId: owner, fields: { ...insuranceFields, sumInsured: Money.zero(currency) } });
  const invalidCommitment = await new CreateCommitment(cw).execute({ userId: owner, fields: { ...commitmentFields, endsOn: CalendarDate.parse("2025-01-01") } });
  for (const result of [invalidIncome, invalidPolicy, invalidCommitment]) check("domain refusal is a validation result", result.ok ? "success" : result.error.code, "VALIDATION_FAILED");
  checkDeep("no partial persistence on validation failures", [iw.rows.length, pw.rows.length, cw.rows.length], [1, 1, 1]);

  section("persistence completion and failure remain observable");
  const expected = new DomainError("WRITE_REFUSED", "Known write refusal");
  const refused = await new CreateIncomeStream({ create: async () => { throw expected; } }).execute({ userId: owner, fields: incomeFields });
  check("expected persistence error identity preserved", refused.ok ? null : refused.error, expected);
  const outage = new Error("database offline");
  let observed: unknown;
  try { await new CreateIncomeStream({ create: async () => { throw outage; } }).execute({ userId: owner, fields: incomeFields }); } catch (error) { observed = error; }
  check("unexpected failure is not reported as success or invalid input", observed, outage);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let completed = false;
  const pending = new CreateIncomeStream({ create: async () => gate }).execute({ userId: owner, fields: incomeFields }).then((result) => { completed = true; return result; });
  await Promise.resolve();
  check("success waits for persistence", completed, false);
  release();
  check("success follows persistence completion", (await pending).ok, true);
}

main().then(done).catch((error) => { console.error(error); process.exitCode = 1; });

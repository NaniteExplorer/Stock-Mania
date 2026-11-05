import { sql, type SQL } from "drizzle-orm";
import { newUuid, type UserId } from "@/core/kernel";
import { Currency, Money } from "@/core/money";
import { PriceSteps, Recurrence } from "@/core/recurrence";
import { CalendarDate } from "@/core/time";
import { Days } from "@/core/units";
import { Commitment, type CommitmentWriter } from "@/domain/commitments";
import { IncomeStream, type IncomeWriter } from "@/domain/income";
import { InsurancePolicy, type InsuranceWriter } from "@/domain/insurance";
import type { Database } from "./db/client";
import { incomeStreams, insurancePolicies, recurringCommitments } from "./db/schema";
import { UnitOfWork, type RequestContext, type TransactionExecutor } from "./unit-of-work";

const MAX_MINOR = 9223372036854775807n;

/** Bypass number-mapped Drizzle money columns without allowing SQLite CAST saturation. */
function exactMinor(amount: Money | null): SQL | null {
  if (amount === null) return null;
  if (amount.minor < 0n || amount.minor > MAX_MINOR) throw new RangeError("Amount is outside nonnegative SQLite integer range.");
  return sql`CAST(${amount.minor.toString()} AS INTEGER)`;
}

function schedule(value: Recurrence): Recurrence {
  return new Recurrence({ cadence: value.cadence, anchor: CalendarDate.parse(value.anchor.toISO()),
    endsOn: value.endsOn === null ? null : CalendarDate.parse(value.endsOn.toISO()),
    cancelNotice: value.cancelNotice === null ? null : Days(value.cancelNotice) });
}

function history(value: PriceSteps, currency: Currency): PriceSteps {
  return new PriceSteps(value.entries().map((step) => {
    if (step.amount !== null && step.amount.currency.code !== currency.code) throw new RangeError("Price currency differs from aggregate currency.");
    exactMinor(step.amount);
    return { from: CalendarDate.parse(step.from.toISO()), amount: step.amount === null ? null : Money.fromMinor(step.amount.minor, currency) };
  }));
}

function scheduleRow(value: Recurrence) {
  return { cadence: value.cadence, anchorOn: value.anchor.toISO(), scheduleEndsOn: value.endsOn?.toISO() ?? null, cancelNoticeDays: value.cancelNotice };
}

function historySnapshot(value: PriceSteps) {
  return value.entries().map((step) => ({ from: step.from.toISO(), amount: step.amount?.toJSON() ?? null }));
}

type StepTable = "income_price_steps" | "insurance_price_steps" | "commitment_price_steps";
type ParentColumn = "stream_id" | "policy_id" | "commitment_id";

async function insertSteps(tx: TransactionExecutor, table: StepTable, parent: ParentColumn, id: string,
  userId: string, prices: PriceSteps, currency: Currency, timestamp: number): Promise<void> {
  for (const step of prices.entries()) {
    await tx.run(sql`INSERT INTO ${sql.identifier(table)}
      (id,user_id,${sql.identifier(parent)},from_date,amount_minor,currency,created_at,updated_at)
      VALUES (${newUuid()},${userId},${id},${step.from.toISO()},${exactMinor(step.amount)},${currency.code},${timestamp},${timestamp})`);
  }
}

/** Context is supplied by the authenticated composition root, never by a form field. */
abstract class CreationWriter {
  constructor(protected readonly db: Database, protected readonly context: RequestContext) {}

  protected owner(userId: UserId, id: string): void {
    if (this.context.userId !== userId.value || this.context.actorId !== userId.value) throw new Error("Manual finance owner does not match authenticated actor.");
    if (!id.trim()) throw new RangeError("A manual finance record needs an id.");
  }

  protected async createAggregate(userId: UserId, id: string, entityType: string, snapshot: unknown,
    apply: (tx: TransactionExecutor, now: Date) => Promise<void>): Promise<void> {
    this.owner(userId, id);
    const now = this.context.clock.now();
    await new UnitOfWork(this.db, this.context).mutateAtomic({
      action: "CREATE", entityType, entityId: id, before: null, touchedAccountIds: [],
      event: { type: `${entityType}.created`, aggregateType: entityType, aggregateId: id, payload: snapshot, effectiveOn: null },
      apply: async (tx) => { await apply(tx, now); return { result: undefined, after: snapshot }; },
    });
  }
}

export class DrizzleIncomeWriter extends CreationWriter implements IncomeWriter {
  async create(userId: UserId, input: IncomeStream): Promise<void> {
    this.owner(userId, input.id);
    const currency = Currency.of(input.currency.code);
    const stream = new IncomeStream({ ...input, currency, schedule: schedule(input.schedule), expected: history(input.expected, currency), grace: Days(input.grace) });
    const fields = { id: stream.id, name: stream.name, kind: stream.kind, payer: stream.payer, currency: currency.code,
      ...scheduleRow(stream.schedule), graceDays: stream.grace };
    await this.createAggregate(userId, stream.id, "income_stream", { ...fields, expected: historySnapshot(stream.expected) }, async (tx, now) => {
      await tx.insert(incomeStreams).values({ ...fields, userId: userId.value, createdAt: now, updatedAt: now });
      await insertSteps(tx, "income_price_steps", "stream_id", stream.id, userId.value, stream.expected, currency, now.getTime());
    });
  }
}

export class DrizzleInsuranceWriter extends CreationWriter implements InsuranceWriter {
  async create(userId: UserId, input: InsurancePolicy): Promise<void> {
    this.owner(userId, input.id);
    const currency = Currency.of(input.currency.code);
    if (input.sumInsured !== null && input.sumInsured.currency.code !== currency.code) throw new RangeError("Sum insured currency differs from policy currency.");
    exactMinor(input.sumInsured);
    const policy = new InsurancePolicy({ ...input, currency,
      sumInsured: input.sumInsured === null ? null : Money.fromMinor(input.sumInsured.minor, currency),
      endsOn: input.endsOn === null ? null : CalendarDate.parse(input.endsOn.toISO()),
      premiumSchedule: schedule(input.premiumSchedule), premium: history(input.premium, currency) });
    const fields = { id: policy.id, kind: policy.kind, insurer: policy.insurer, insured: policy.insured, currency: currency.code,
      ...scheduleRow(policy.premiumSchedule), endsOn: policy.endsOn?.toISO() ?? null };
    await this.createAggregate(userId, policy.id, "insurance_policy", { ...fields, sumInsured: policy.sumInsured?.toJSON() ?? null, premium: historySnapshot(policy.premium) }, async (tx, now) => {
      await tx.insert(insurancePolicies).values({ ...fields, sumInsuredMinor: exactMinor(policy.sumInsured), userId: userId.value, createdAt: now, updatedAt: now });
      await insertSteps(tx, "insurance_price_steps", "policy_id", policy.id, userId.value, policy.premium, currency, now.getTime());
    });
  }
}

export class DrizzleCommitmentWriter extends CreationWriter implements CommitmentWriter {
  async create(userId: UserId, input: Commitment): Promise<void> {
    this.owner(userId, input.id);
    const currency = Currency.of(input.currency.code);
    const commitment = new Commitment({ ...input, currency,
      endsOn: input.endsOn === null ? null : CalendarDate.parse(input.endsOn.toISO()),
      schedule: schedule(input.schedule), price: history(input.price, currency) });
    const fields = { id: commitment.id, name: commitment.name, kind: commitment.kind, currency: currency.code,
      ...scheduleRow(commitment.schedule), autoRenews: commitment.autoRenews, endsOn: commitment.endsOn?.toISO() ?? null };
    await this.createAggregate(userId, commitment.id, "recurring_commitment", { ...fields, price: historySnapshot(commitment.price) }, async (tx, now) => {
      await tx.insert(recurringCommitments).values({ ...fields, userId: userId.value, createdAt: now, updatedAt: now });
      await insertSteps(tx, "commitment_price_steps", "commitment_id", commitment.id, userId.value, commitment.price, currency, now.getTime());
    });
  }
}

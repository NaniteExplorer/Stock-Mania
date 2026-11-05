import { and, asc, eq, isNull, sql, getTableColumns } from "drizzle-orm";
import type { UserId } from "@/core/kernel";
import { Currency, Money } from "@/core/money";
import { PriceSteps, Recurrence, type Cadence } from "@/core/recurrence";
import { CalendarDate } from "@/core/time";
import { Days } from "@/core/units";
import { Commitment, type CommitmentRepository } from "@/domain/commitments";
import { IncomeStream, type IncomeRepository, type IncomeReceipt } from "@/domain/income";
import { InsurancePolicy, type InsuranceRepository, type AbsenceDeclaration } from "@/domain/insurance";
import type { Database } from "./db/client";
import {
  commitmentPriceSteps, coverAbsenceDeclarations, incomePriceSteps, incomeReceipts,
  incomeStreams, insurancePolicies, insurancePriceSteps, ledgerAccounts, postings,
  recurringCommitments, transactions,
} from "./db/schema";

function recurrence(row: {
  cadence: Cadence; anchorOn: string; scheduleEndsOn: string | null; cancelNoticeDays: number | null;
}): Recurrence {
  return new Recurrence({
    cadence: row.cadence, anchor: CalendarDate.parse(row.anchorOn),
    endsOn: row.scheduleEndsOn === null ? null : CalendarDate.parse(row.scheduleEndsOn),
    cancelNotice: row.cancelNoticeDays === null ? null : Days(row.cancelNoticeDays),
  });
}

function priceHistory(rows: readonly { fromDate: string; amountMinor: string | null; currency: string }[], currency: Currency): PriceSteps {
  if (rows.length === 0) throw new Error("Incomplete manual finance record: no live price history.");
  return new PriceSteps(rows.map((row) => {
    if (row.currency !== currency.code) throw new Error("Manual finance price currency differs from its owner record.");
    return { from: CalendarDate.parse(row.fromDate), amount: row.amountMinor === null ? null : Money.fromMinor(BigInt(row.amountMinor), currency) };
  }));
}

/** Read adapters only. Mutations belong to the audited application write path. */
export class DrizzleIncomeRepository implements IncomeRepository {
  constructor(private readonly db: Database) {}

  async find(userId: UserId, id: string): Promise<IncomeStream | null> {
    const [row] = await this.db.select().from(incomeStreams).where(and(eq(incomeStreams.userId, userId.value), eq(incomeStreams.id, id), isNull(incomeStreams.deletedAt)));
    return row ? this.hydrate(userId, row) : null;
  }

  async list(userId: UserId): Promise<readonly IncomeStream[]> {
    const rows = await this.db.select().from(incomeStreams).where(and(eq(incomeStreams.userId, userId.value), isNull(incomeStreams.deletedAt))).orderBy(asc(incomeStreams.anchorOn), asc(incomeStreams.id));
    return Promise.all(rows.map((row) => this.hydrate(userId, row)));
  }

  private async hydrate(userId: UserId, row: typeof incomeStreams.$inferSelect): Promise<IncomeStream> {
    const currency = Currency.of(row.currency);
    const steps = await this.db.select({ fromDate: incomePriceSteps.fromDate, amountMinor: sql<string | null>`CAST(${incomePriceSteps.amountMinor} AS TEXT)`, currency: incomePriceSteps.currency }).from(incomePriceSteps).where(and(eq(incomePriceSteps.userId, userId.value), eq(incomePriceSteps.streamId, row.id), isNull(incomePriceSteps.deletedAt))).orderBy(asc(incomePriceSteps.fromDate), asc(incomePriceSteps.id));
    return new IncomeStream({ id: row.id, name: row.name, kind: row.kind, payer: row.payer, currency, schedule: recurrence(row), expected: priceHistory(steps, currency), grace: Days(row.graceDays) });
  }

  async receipts(userId: UserId, streamId: string): Promise<readonly IncomeReceipt[]> {
    const rows = await this.db.select({ receipt: incomeReceipts, amountMinor: sql<string>`CAST(${postings.amountMinor} AS TEXT)`, currency: postings.currency, direction: postings.direction }).from(incomeReceipts)
      .innerJoin(incomeStreams, eq(incomeStreams.id, incomeReceipts.streamId))
      .innerJoin(postings, eq(postings.id, incomeReceipts.postingId))
      .innerJoin(transactions, eq(transactions.id, postings.transactionId))
      .innerJoin(ledgerAccounts, eq(ledgerAccounts.id, postings.accountId))
      .where(and(
        eq(incomeReceipts.userId, userId.value), eq(incomeReceipts.streamId, streamId), isNull(incomeReceipts.deletedAt),
        eq(incomeStreams.userId, userId.value), isNull(incomeStreams.deletedAt),
        isNull(postings.deletedAt), eq(transactions.userId, userId.value), isNull(transactions.deletedAt),
        eq(ledgerAccounts.userId, userId.value), isNull(ledgerAccounts.deletedAt),
        eq(postings.currency, incomeStreams.currency), eq(ledgerAccounts.currency, incomeStreams.currency),
      )).orderBy(asc(incomeReceipts.occurrenceDate), asc(incomeReceipts.id));
    return rows.map(({ receipt, amountMinor, currency, direction }) => ({
      streamId: receipt.streamId, occurrence: CalendarDate.parse(receipt.occurrenceDate),
      postingId: receipt.postingId, receivedOn: CalendarDate.parse(receipt.receivedOn),
      amount: Money.fromMinor(direction === "DEBIT" ? BigInt(amountMinor) : -BigInt(amountMinor), Currency.of(currency)),
    }));
  }
}

export class DrizzleInsuranceRepository implements InsuranceRepository {
  constructor(private readonly db: Database) {}

  async find(userId: UserId, id: string): Promise<InsurancePolicy | null> {
    const [row] = await this.db.select({ ...getTableColumns(insurancePolicies), sumInsuredMinor: sql<string | null>`CAST(${insurancePolicies.sumInsuredMinor} AS TEXT)` }).from(insurancePolicies).where(and(eq(insurancePolicies.userId, userId.value), eq(insurancePolicies.id, id), isNull(insurancePolicies.deletedAt)));
    return row ? this.hydrate(userId, row) : null;
  }

  async list(userId: UserId): Promise<readonly InsurancePolicy[]> {
    const rows = await this.db.select({ ...getTableColumns(insurancePolicies), sumInsuredMinor: sql<string | null>`CAST(${insurancePolicies.sumInsuredMinor} AS TEXT)` }).from(insurancePolicies).where(and(eq(insurancePolicies.userId, userId.value), isNull(insurancePolicies.deletedAt))).orderBy(asc(insurancePolicies.anchorOn), asc(insurancePolicies.id));
    return Promise.all(rows.map((row) => this.hydrate(userId, row)));
  }

  private async hydrate(userId: UserId, row: Omit<typeof insurancePolicies.$inferSelect, "sumInsuredMinor"> & { sumInsuredMinor: string | null }): Promise<InsurancePolicy> {
    const currency = Currency.of(row.currency);
    const steps = await this.db.select({ fromDate: insurancePriceSteps.fromDate, amountMinor: sql<string | null>`CAST(${insurancePriceSteps.amountMinor} AS TEXT)`, currency: insurancePriceSteps.currency }).from(insurancePriceSteps).where(and(eq(insurancePriceSteps.userId, userId.value), eq(insurancePriceSteps.policyId, row.id), isNull(insurancePriceSteps.deletedAt))).orderBy(asc(insurancePriceSteps.fromDate), asc(insurancePriceSteps.id));
    return new InsurancePolicy({ id: row.id, kind: row.kind, insurer: row.insurer, insured: row.insured, currency,
      sumInsured: row.sumInsuredMinor === null ? null : Money.fromMinor(BigInt(row.sumInsuredMinor), currency),
      premiumSchedule: recurrence(row), premium: priceHistory(steps, currency), endsOn: row.endsOn === null ? null : CalendarDate.parse(row.endsOn) });
  }

  async declarations(userId: UserId): Promise<readonly AbsenceDeclaration[]> {
    const rows = await this.db.select().from(coverAbsenceDeclarations).where(and(eq(coverAbsenceDeclarations.userId, userId.value), isNull(coverAbsenceDeclarations.deletedAt))).orderBy(asc(coverAbsenceDeclarations.declaredOn), asc(coverAbsenceDeclarations.id));
    return rows.map((row) => ({ kind: row.kind, declaredOn: CalendarDate.parse(row.declaredOn) }));
  }
}

export class DrizzleCommitmentRepository implements CommitmentRepository {
  constructor(private readonly db: Database) {}

  async find(userId: UserId, id: string): Promise<Commitment | null> {
    const [row] = await this.db.select().from(recurringCommitments).where(and(eq(recurringCommitments.userId, userId.value), eq(recurringCommitments.id, id), isNull(recurringCommitments.deletedAt)));
    return row ? this.hydrate(userId, row) : null;
  }

  async list(userId: UserId): Promise<readonly Commitment[]> {
    const rows = await this.db.select().from(recurringCommitments).where(and(eq(recurringCommitments.userId, userId.value), isNull(recurringCommitments.deletedAt))).orderBy(asc(recurringCommitments.anchorOn), asc(recurringCommitments.id));
    return Promise.all(rows.map((row) => this.hydrate(userId, row)));
  }

  private async hydrate(userId: UserId, row: typeof recurringCommitments.$inferSelect): Promise<Commitment> {
    const currency = Currency.of(row.currency);
    const steps = await this.db.select({ fromDate: commitmentPriceSteps.fromDate, amountMinor: sql<string | null>`CAST(${commitmentPriceSteps.amountMinor} AS TEXT)`, currency: commitmentPriceSteps.currency }).from(commitmentPriceSteps).where(and(eq(commitmentPriceSteps.userId, userId.value), eq(commitmentPriceSteps.commitmentId, row.id), isNull(commitmentPriceSteps.deletedAt))).orderBy(asc(commitmentPriceSteps.fromDate), asc(commitmentPriceSteps.id));
    return new Commitment({ id: row.id, name: row.name, kind: row.kind, currency, schedule: recurrence(row), price: priceHistory(steps, currency), autoRenews: row.autoRenews, endsOn: row.endsOn === null ? null : CalendarDate.parse(row.endsOn) });
  }
}

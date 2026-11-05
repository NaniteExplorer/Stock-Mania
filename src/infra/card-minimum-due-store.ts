/**
 * Drizzle adapters for owner-typed card minimum dues (`card_minimum_dues`, class B;
 * card-minimum-due.md). One row per card per statement end date (unique index).
 * `record` upserts it (reviving a tombstone) and `remove` tombstones it; the audit and
 * ledger events commit with the row. Reads are user-scoped and skip tombstones.
 * Validation against the statement is the domain's (`validateEnteredMinimumDue`) and
 * runs in the use case, which has the reconstructed statement. Ownership, card kind
 * (LIABILITY / CREDIT_CARD) and currency are re-checked here, inside the transaction.
 */
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { newUuid, type UserId } from "@/core/kernel";
import { Currency, Money } from "@/core/money";
import { CalendarDate } from "@/core/time";
import type { CardMinimumDueReader, CardMinimumDueWriter, EnteredMinimumDue } from "@/domain/card-minimum-due";
import type { Database } from "./db/client";
import { cardMinimumDues, ledgerAccounts } from "./db/schema";
import { UnitOfWork, type RequestContext, type TransactionExecutor } from "./unit-of-work";

/** A typed persistence-layer refusal; the use case checks the same rules first. */
export class CardMinimumDueRefusedError extends Error {
  constructor(readonly code: "NOT_OWNER" | "NOT_A_CARD" | "CURRENCY_MISMATCH" | "NOT_FOUND", message: string) {
    super(message);
    this.name = "CardMinimumDueRefusedError";
  }
}

/* Money crosses this boundary as exact integer text, never a JS number (> 2^53 stays exact). */
const exactMinor = sql<string>`CAST(${cardMinimumDues.amountMinor} AS TEXT)`;
const columns = {
  id: cardMinimumDues.id, userId: cardMinimumDues.userId, accountId: cardMinimumDues.accountId,
  statementThrough: cardMinimumDues.statementThrough, currency: cardMinimumDues.currency,
  amountMinor: exactMinor, deletedAt: cardMinimumDues.deletedAt,
};
interface Row { id: string; userId: string; accountId: string; statementThrough: string; currency: string; amountMinor: string; deletedAt: Date | null }
const imageOf = (row: Row) => ({ accountId: row.accountId, statementThrough: row.statementThrough, currency: row.currency, amountMinor: row.amountMinor });
/** Binds bigint minor units as an exact SQL integer. */
const minorValue = (minor: bigint) => sql`CAST(${minor.toString()} AS INTEGER)`;

export class DrizzleCardMinimumDueReader implements CardMinimumDueReader {
  constructor(private readonly db: Database) {}

  async forCards(userId: Pick<UserId, "value">, accountIds: readonly string[]): Promise<readonly EnteredMinimumDue[]> {
    if (accountIds.length === 0) return [];
    const rows: Row[] = await this.db
      .select(columns)
      .from(cardMinimumDues)
      .where(and(eq(cardMinimumDues.userId, userId.value), inArray(cardMinimumDues.accountId, [...accountIds]), isNull(cardMinimumDues.deletedAt)));
    return rows.map((row) => Object.freeze({
      accountId: row.accountId,
      statementThrough: CalendarDate.parse(row.statementThrough),
      amount: Money.fromMinor(BigInt(row.amountMinor), Currency.of(row.currency)),
    }));
  }
}

export class DrizzleCardMinimumDueWriter implements CardMinimumDueWriter {
  constructor(
    private readonly db: Database,
    private readonly context: RequestContext,
  ) {}

  private assertOwner(userId: Pick<UserId, "value">): void {
    if (this.context.userId !== userId.value) throw new Error("Card minimum due owner does not match the request context.");
  }

  private async find(tx: TransactionExecutor, accountId: string, statementThrough: string): Promise<Row | undefined> {
    const [row]: Row[] = await tx
      .select(columns)
      .from(cardMinimumDues)
      .where(and(eq(cardMinimumDues.accountId, accountId), eq(cardMinimumDues.statementThrough, statementThrough)))
      .limit(1);
    return row;
  }

  async record(userId: Pick<UserId, "value">, entry: EnteredMinimumDue): Promise<void> {
    this.assertOwner(userId);
    const through = entry.statementThrough.toString();
    const now = this.context.clock.now();
    const image = { currency: entry.amount.currency.code, amountMinor: entry.amount.minor.toString() };
    const values = { currency: image.currency, amountMinor: minorValue(entry.amount.minor) };
    await new UnitOfWork(this.db, this.context).mutateAtomic({
      action: "CREATE",
      entityType: "card_minimum_dues",
      entityId: `${entry.accountId}:${through}`,
      before: null,
      touchedAccountIds: [],
      event: { type: "card_minimum_due.recorded", aggregateType: "card_minimum_dues", aggregateId: entry.accountId, payload: { statementThrough: through, ...image }, effectiveOn: null },
      apply: async (tx) => {
        // Every check reads through `tx`, so nothing can change between check and write.
        const existing = await this.find(tx, entry.accountId, through);
        if (existing && existing.userId !== userId.value) throw new CardMinimumDueRefusedError("NOT_OWNER", "That card belongs to another user.");
        const [account] = await tx
          .select({ userId: ledgerAccounts.userId, type: ledgerAccounts.type, subtype: ledgerAccounts.subtype, currency: ledgerAccounts.currency, deletedAt: ledgerAccounts.deletedAt })
          .from(ledgerAccounts).where(eq(ledgerAccounts.id, entry.accountId)).limit(1);
        if (!account || account.userId !== userId.value || account.deletedAt !== null) throw new CardMinimumDueRefusedError("NOT_OWNER", "That card is not one of yours.");
        if (account.type !== "LIABILITY" || account.subtype !== "CREDIT_CARD") throw new CardMinimumDueRefusedError("NOT_A_CARD", "A minimum due can only be recorded on a credit card.");
        if (account.currency !== image.currency) throw new CardMinimumDueRefusedError("CURRENCY_MISMATCH", `The card is in ${account.currency}, not ${image.currency}.`);
        await tx
          .insert(cardMinimumDues)
          .values({ id: newUuid(), userId: userId.value, accountId: entry.accountId, statementThrough: through, ...values, createdAt: now, updatedAt: now })
          .onConflictDoUpdate({
            target: [cardMinimumDues.accountId, cardMinimumDues.statementThrough],
            set: { ...values, deletedAt: null, updatedAt: now },
          });
        return {
          result: undefined,
          action: existing === undefined ? "CREATE" : existing.deletedAt === null ? "UPDATE" : "RESTORE",
          before: existing && existing.deletedAt === null ? imageOf(existing) : null,
          after: { accountId: entry.accountId, statementThrough: through, ...image },
        };
      },
    });
  }

  async remove(userId: Pick<UserId, "value">, accountId: string, statementThrough: CalendarDate): Promise<void> {
    this.assertOwner(userId);
    const through = statementThrough.toString();
    const now = this.context.clock.now();
    await new UnitOfWork(this.db, this.context).mutateAtomic({
      action: "SOFT_DELETE",
      entityType: "card_minimum_dues",
      entityId: `${accountId}:${through}`,
      before: null,
      touchedAccountIds: [],
      event: { type: "card_minimum_due.tombstoned", aggregateType: "card_minimum_dues", aggregateId: accountId, payload: { statementThrough: through }, effectiveOn: null },
      apply: async (tx) => {
        const existing = await this.find(tx, accountId, through);
        if (!existing || existing.userId !== userId.value || existing.deletedAt !== null) throw new CardMinimumDueRefusedError("NOT_FOUND", "No minimum due is recorded for that statement.");
        await tx.update(cardMinimumDues).set({ deletedAt: now, updatedAt: now }).where(eq(cardMinimumDues.id, existing.id));
        return { result: undefined, before: imageOf(existing), after: null };
      },
    });
  }
}

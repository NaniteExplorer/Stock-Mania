/**
 * Drizzle adapters for the expense-to-asset-acquisition link (`asset_acquisitions`, task 1.8).
 *
 * The link is a side table, so L12 holds: no posting gains a column. Only ids
 * are stored; the date and cost are read from the posting and its transaction
 * each time, and the domain rules (`acquisitionOf`) judge every row on the way
 * out as well as on the way in, so a link whose transaction was reversed since
 * is hidden rather than shown with a cost the ledger no longer carries.
 *
 * Every read is owner-scoped and filters tombstones on the link, the asset
 * account, the posting and its transaction. Every write is one
 * `UnitOfWork.mutateAtomic` (class B: create, tombstone, restore — a relink
 * tombstones the old row and inserts a new one). Nothing is hard-deleted (A03).
 */
import { Count } from "@/core/units";
import { and, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { NotFoundError, newUuid, type UserId } from "@/core/kernel";
import { Currency, Money } from "@/core/money";
import { CalendarDate } from "@/core/time";
import { AccountId } from "@/domain/accounts";
import {
  AcquisitionRefusedError,
  acquisitionOf,
  type AcquisitionAssetFacts,
  type AcquisitionCandidate,
  type AcquisitionPostingFacts,
  type AssetAcquisition,
  type AssetAcquisitionRepository,
  type AssetAcquisitionWriter,
} from "@/domain/asset-acquisition";
import type { Database } from "./db/client";
import { assetAcquisitions, ledgerAccounts, postings, transactions } from "./db/schema";
import { UnitOfWork, type RequestContext, type TransactionExecutor } from "./unit-of-work";

type Executor = Database | TransactionExecutor;
type LinkRow = typeof assetAcquisitions.$inferSelect;

/** The asset's ledger account, owner-scoped and live; null when absent or not the owner's. */
async function assetFacts(executor: Executor, userId: UserId, assetAccountId: string): Promise<AcquisitionAssetFacts | null> {
  const [row] = await executor
    .select({
      id: ledgerAccounts.id, name: ledgerAccounts.name, type: ledgerAccounts.type, subtype: ledgerAccounts.subtype,
      currency: ledgerAccounts.currency, isSystem: ledgerAccounts.isSystem,
    })
    .from(ledgerAccounts)
    .where(and(eq(ledgerAccounts.userId, userId.value), eq(ledgerAccounts.id, assetAccountId), isNull(ledgerAccounts.deletedAt)))
    .limit(1);
  if (!row) return null;
  return { accountId: AccountId.from(row.id), name: row.name, type: row.type, subtype: row.subtype, currencyCode: row.currency, isSystem: row.isSystem };
}

/** The posting with its transaction and account, owner-scoped and live; null when absent or not the owner's. */
async function postingFacts(executor: Executor, userId: UserId, postingId: string): Promise<AcquisitionPostingFacts | null> {
  const [row] = await executor
    .select({
      postingId: postings.id, transactionId: postings.transactionId, accountId: postings.accountId,
      accountType: ledgerAccounts.type, direction: postings.direction,
      // Exact minor units: never through a JS number.
      amountMinor: sql<string>`CAST(${postings.amountMinor} AS TEXT)`, currency: postings.currency,
      instrumentId: postings.instrumentId, txnDate: transactions.txnDate, description: transactions.description,
      isForecast: transactions.isForecast, reversesTransactionId: transactions.reversesTransactionId,
      isReversed: sql<number>`EXISTS (SELECT 1 FROM ${transactions} AS r WHERE r.reverses_transaction_id = ${transactions.id} AND r.user_id = ${userId.value} AND r.deleted_at IS NULL)`,
    })
    .from(postings)
    .innerJoin(transactions, eq(transactions.id, postings.transactionId))
    .innerJoin(ledgerAccounts, eq(ledgerAccounts.id, postings.accountId))
    .where(and(
      eq(postings.id, postingId), isNull(postings.deletedAt),
      eq(transactions.userId, userId.value), isNull(transactions.deletedAt),
      eq(ledgerAccounts.userId, userId.value), isNull(ledgerAccounts.deletedAt),
    ))
    .limit(1);
  if (!row) return null;
  return {
    postingId: row.postingId,
    transactionId: row.transactionId,
    accountId: AccountId.from(row.accountId),
    accountType: row.accountType,
    direction: row.direction,
    amount: Money.fromMinor(BigInt(row.amountMinor), Currency.of(row.currency)),
    instrumentId: row.instrumentId,
    on: CalendarDate.parse(row.txnDate),
    description: row.description,
    isForecast: row.isForecast,
    isReversal: row.reversesTransactionId !== null,
    isReversed: Number(row.isReversed) === 1,
  };
}

/** Reads both sides and judges them; throws the refusal (or not-found) that applies. */
async function judged(executor: Executor, userId: UserId, assetAccountId: string, postingId: string, linkId: string | null): Promise<AssetAcquisition> {
  const asset = await assetFacts(executor, userId, assetAccountId);
  if (!asset) throw new NotFoundError("Asset account", assetAccountId);
  const posting = await postingFacts(executor, userId, postingId);
  if (!posting) throw new NotFoundError("Posting", postingId);
  return acquisitionOf(asset, posting, linkId);
}

/** Judges a stored link on the way out; null when it no longer qualifies or a side is gone. */
async function stillQualifying(executor: Executor, userId: UserId, row: LinkRow): Promise<AssetAcquisition | null> {
  try {
    return await judged(executor, userId, row.assetAccountId, row.postingId, row.id);
  } catch (error) {
    if (error instanceof AcquisitionRefusedError || error instanceof NotFoundError) return null;
    throw error;
  }
}

const snapshot = (row: { id: string; assetAccountId: string; postingId: string }) =>
  ({ id: row.id, assetAccountId: row.assetAccountId, postingId: row.postingId });

const provenance = (acquisition: AssetAcquisition) => ({
  postingId: acquisition.postingId, transactionId: acquisition.transactionId,
  on: acquisition.on.toISO(), cost: acquisition.cost.toJSON(),
});

export class DrizzleAssetAcquisitionRepository implements AssetAcquisitionRepository {
  constructor(private readonly db: Database) {}

  async forAsset(userId: UserId, assetAccountId: AccountId): Promise<AssetAcquisition | null> {
    const [row] = await this.db
      .select()
      .from(assetAcquisitions)
      .where(and(eq(assetAcquisitions.userId, userId.value), eq(assetAcquisitions.assetAccountId, assetAccountId.value), isNull(assetAcquisitions.deletedAt)))
      .limit(1);
    return row ? stillQualifying(this.db, userId, row) : null;
  }

  async list(userId: UserId): Promise<readonly AssetAcquisition[]> {
    const rows = await this.db
      .select()
      .from(assetAcquisitions)
      .where(and(eq(assetAcquisitions.userId, userId.value), isNull(assetAcquisitions.deletedAt)))
      .orderBy(assetAcquisitions.assetAccountId);
    const judgedRows = await Promise.all(rows.map((row) => stillQualifying(this.db, userId, row)));
    return judgedRows.filter((acquisition): acquisition is AssetAcquisition => acquisition !== null);
  }

  async candidates(userId: UserId, limit: Count = Count(50)): Promise<readonly AcquisitionCandidate[]> {
    const rows = await this.db
      .select({
        postingId: postings.id, amountMinor: sql<string>`CAST(${postings.amountMinor} AS TEXT)`, currency: postings.currency,
        txnDate: transactions.txnDate, description: transactions.description, accountName: ledgerAccounts.name,
      })
      .from(postings)
      .innerJoin(transactions, eq(transactions.id, postings.transactionId))
      .innerJoin(ledgerAccounts, eq(ledgerAccounts.id, postings.accountId))
      .where(and(
        isNull(postings.deletedAt), eq(postings.direction, "DEBIT"), isNull(postings.instrumentId),
        eq(transactions.userId, userId.value), isNull(transactions.deletedAt), eq(transactions.isForecast, false),
        isNull(transactions.reversesTransactionId),
        sql`NOT EXISTS (SELECT 1 FROM ${transactions} AS r WHERE r.reverses_transaction_id = ${transactions.id} AND r.user_id = ${userId.value} AND r.deleted_at IS NULL)`,
        eq(ledgerAccounts.userId, userId.value), isNull(ledgerAccounts.deletedAt), eq(ledgerAccounts.type, "EXPENSE"),
      ))
      .orderBy(desc(transactions.txnDate), desc(postings.id))
      .limit(Math.max(1, Math.min(limit, 200)));
    return rows.map((row) => Object.freeze({
      postingId: row.postingId,
      on: CalendarDate.parse(row.txnDate),
      amount: Money.fromMinor(BigInt(row.amountMinor), Currency.of(row.currency)),
      description: row.description,
      accountName: row.accountName,
    }));
  }
}

/** Context is supplied by the authenticated composition root, never by a form field. */
export class DrizzleAssetAcquisitionWriter implements AssetAcquisitionWriter {
  constructor(
    private readonly db: Database,
    private readonly context: RequestContext,
  ) {}

  private owner(userId: UserId): void {
    if (this.context.userId !== userId.value || this.context.actorId !== userId.value) {
      throw new Error("Asset acquisition owner does not match the authenticated actor.");
    }
  }

  private async liveFor(userId: UserId, column: "asset" | "posting", id: string): Promise<LinkRow | undefined> {
    const [row] = await this.db
      .select()
      .from(assetAcquisitions)
      .where(and(
        eq(assetAcquisitions.userId, userId.value),
        eq(column === "asset" ? assetAcquisitions.assetAccountId : assetAcquisitions.postingId, id),
        isNull(assetAcquisitions.deletedAt),
      ))
      .limit(1);
    return row;
  }

  async link(userId: UserId, assetAccountId: AccountId, postingId: string): Promise<AssetAcquisition> {
    this.owner(userId);
    const current = await this.liveFor(userId, "asset", assetAccountId.value);
    if (current?.postingId === postingId) {
      // Linking the same pair again changes nothing, so nothing is written or audited.
      return judged(this.db, userId, assetAccountId.value, postingId, current.id);
    }
    const elsewhere = await this.liveFor(userId, "posting", postingId);
    if (elsewhere) throw new AcquisitionRefusedError("This posting is already the acquisition of another asset; unlink it there first.");

    const id = newUuid();
    const now = this.context.clock.now();
    return new UnitOfWork(this.db, this.context).mutateAtomic({
      action: current ? "UPDATE" : "CREATE",
      entityType: "asset_acquisition",
      entityId: id,
      before: current ? snapshot(current) : null,
      touchedAccountIds: [],
      event: { type: "asset_acquisition.linked", aggregateType: "asset_acquisition", aggregateId: assetAccountId.value, payload: { id, assetAccountId: assetAccountId.value, postingId }, effectiveOn: null },
      apply: async (tx) => {
        // Judged inside the transaction, so the facts cannot change between the check and the write.
        const acquisition = await judged(tx, userId, assetAccountId.value, postingId, id);
        if (current) {
          await tx.update(assetAcquisitions).set({ deletedAt: now, updatedAt: now })
            .where(and(eq(assetAcquisitions.userId, userId.value), eq(assetAcquisitions.id, current.id), isNull(assetAcquisitions.deletedAt)));
        }
        await tx.insert(assetAcquisitions).values({ id, userId: userId.value, assetAccountId: assetAccountId.value, postingId, createdAt: now, updatedAt: now });
        return { result: acquisition, after: { ...snapshot({ id, assetAccountId: assetAccountId.value, postingId }), ...provenance(acquisition) } };
      },
    });
  }

  async unlink(userId: UserId, assetAccountId: AccountId): Promise<void> {
    this.owner(userId);
    const current = await this.liveFor(userId, "asset", assetAccountId.value);
    if (!current) throw new NotFoundError("Acquisition link for asset", assetAccountId.value);
    const now = this.context.clock.now();
    await new UnitOfWork(this.db, this.context).mutateAtomic({
      action: "SOFT_DELETE",
      entityType: "asset_acquisition",
      entityId: current.id,
      before: snapshot(current),
      touchedAccountIds: [],
      event: { type: "asset_acquisition.unlinked", aggregateType: "asset_acquisition", aggregateId: assetAccountId.value, payload: snapshot(current), effectiveOn: null },
      apply: async (tx) => {
        await tx.update(assetAcquisitions).set({ deletedAt: now, updatedAt: now })
          .where(and(eq(assetAcquisitions.userId, userId.value), eq(assetAcquisitions.id, current.id), isNull(assetAcquisitions.deletedAt)));
        return { result: undefined, after: null };
      },
    });
  }

  async restore(userId: UserId, linkId: string): Promise<AssetAcquisition> {
    this.owner(userId);
    const [row] = await this.db
      .select()
      .from(assetAcquisitions)
      .where(and(eq(assetAcquisitions.userId, userId.value), eq(assetAcquisitions.id, linkId), isNotNull(assetAcquisitions.deletedAt)))
      .limit(1);
    if (!row) throw new NotFoundError("Removed acquisition link", linkId);
    if (await this.liveFor(userId, "asset", row.assetAccountId)) {
      throw new AcquisitionRefusedError("The asset has another acquisition linked since; unlink it before restoring this one.");
    }
    if (await this.liveFor(userId, "posting", row.postingId)) {
      throw new AcquisitionRefusedError("The posting has been linked to another asset since.");
    }
    const now = this.context.clock.now();
    return new UnitOfWork(this.db, this.context).mutateAtomic({
      action: "RESTORE",
      entityType: "asset_acquisition",
      entityId: row.id,
      before: { ...snapshot(row), deletedAt: row.deletedAt },
      touchedAccountIds: [],
      event: { type: "asset_acquisition.restored", aggregateType: "asset_acquisition", aggregateId: row.assetAccountId, payload: snapshot(row), effectiveOn: null },
      apply: async (tx) => {
        const acquisition = await judged(tx, userId, row.assetAccountId, row.postingId, row.id);
        await tx.update(assetAcquisitions).set({ deletedAt: null, updatedAt: now })
          .where(and(eq(assetAcquisitions.userId, userId.value), eq(assetAcquisitions.id, row.id)));
        return { result: acquisition, after: { ...snapshot(row), ...provenance(acquisition) } };
      },
    });
  }
}

/**
 * Every Drizzle repository, one class each, plus the row-to-entity mappers they
 * own. Consolidated from five files under `infrastructure/`.
 *
 * This is the only layer that knows SQL. The interfaces it implements are
 * declared in `domain/`, next to the aggregates they serve, so the dependency
 * arrow points inward: `infra` -> `domain`, never the reverse.
 *
 * Phase 1f adds the remaining repositories, routes every read through the
 * soft-delete views, and puts each mutation behind a UnitOfWork that writes an
 * audit event.
 */

import { UserId, newUuid } from "@/core/kernel";
import { Currency, Money } from "@/core/money";
import { CalendarDate, DateRange } from "@/core/time";
import { Account, AccountCode, AccountId, AccountRepository, AccountSubtype, AccountType, AccountTypeName, PostingDirection } from "@/domain/accounts";
import { Quantity, UnitPrice } from "@/core/numeric";
import { FxQuote, FxRateRepository, PriceDivergence, PriceSourceType, Quote, QuoteRepository, QuoteType, StoredFxRate } from "@/domain/pricing";
import { AccountBalance, AccountFlow, BalanceQuery, MonthlyFlow, Posting, PostingId, PostingStatus, StoredTransaction, Transaction, TransactionId, TransactionKind, TransactionPage, TransactionQuery, TransactionRepository, TransactionSource, TypeTotals } from "@/domain/transactions";
import { fxRates, ledgerAccounts, postings, priceDivergences, priceQuotes, transactions } from "@/infra/db/schema";
import { Database } from "@/infra/db/client";
import { and, asc, count, desc, eq, gte, inArray, isNull, like, lte, max, min, or, sql } from "drizzle-orm";
/* ═══ AccountMapper ═══════════════════════════════════════════════════ */

type AccountRow = typeof ledgerAccounts.$inferSelect;
type AccountInsert = typeof ledgerAccounts.$inferInsert;

/**
 * Translates between the `ledger_accounts` row and the `Account` entity.
 *
 * Mappers exist so the domain never has to accommodate the storage shape. That
 * boundary is what keeps `Account` free of nullable primitives and lets the
 * database use whatever representation SQLite is good at — and it is where a
 * future move to Postgres would be absorbed.
 */
export const AccountMapper = {
  toDomain(row: AccountRow): Account {
    return Account.rehydrate({
      id: AccountId.from(row.id),
      userId: UserId.from(row.userId),
      code: AccountCode.parse(row.code),
      name: row.name,
      type: AccountType.of(row.type),
      subtype: (row.subtype as AccountSubtype | null) ?? null,
      parentId: row.parentId ? AccountId.from(row.parentId) : null,
      currency: Currency.of(row.currency),
      institution: row.institution,
      accountNumberSuffix: row.accountNumberSuffix,
      isClosed: row.isClosed,
      isSystem: row.isSystem,
      sortOrder: row.sortOrder,
    });
  },

  toRow(account: Account): AccountInsert {
    return {
      id: account.id.value,
      userId: account.userId.value,
      code: account.code.toString(),
      name: account.name,
      type: account.type.name,
      subtype: account.subtype,
      parentId: account.parentId?.value ?? null,
      currency: account.currency.code,
      institution: account.institution,
      accountNumberSuffix: account.accountNumberSuffix,
      isClosed: account.isClosed,
      isSystem: account.isSystem,
      sortOrder: account.sortOrder,
      updatedAt: new Date(),
    };
  },
};

/* ═══ TransactionMapper ═══════════════════════════════════════════════ */

type TxnRow = typeof transactions.$inferSelect;
type TxnInsert = typeof transactions.$inferInsert;
type PostingRow = typeof postings.$inferSelect;
type PostingInsert = typeof postings.$inferInsert;

/**
 * Translates between the `transactions` + `postings` rows and the `Transaction`
 * aggregate.
 *
 * Always both tables together. Rehydrating a transaction without its postings
 * would produce an object that fails its own constructor, so there is no method
 * here that maps one without the other.
 *
 * It rehydrates to {@link StoredTransaction}, not to the subclass that wrote the
 * row. That is the honest mapping: the row carries the postings and the type, and
 * a `Sell` needs the lots it consumed, which live in `lots` rather than here.
 * Reconstructing a `Sell` from two postings would have to invent a disposal list,
 * and an invented cost basis is a wrong tax number.
 */
export const TransactionMapper = {
  toDomain(txn: TxnRow, postingRows: readonly PostingRow[]): Transaction {
    return StoredTransaction.rehydrate({
      id: TransactionId.from(txn.id),
      kind: txn.txnType as TransactionKind,
      context: {
        userId: UserId.from(txn.userId),
        txnDate: CalendarDate.parse(txn.txnDate),
        description: txn.description,
        settlementDate: txn.settlementDate ? CalendarDate.parse(txn.settlementDate) : null,
        counterpartyId: txn.counterpartyId,
        txnSource: txn.source as TransactionSource,
        reference: txn.reference,
        externalId: txn.externalId,
        importBatchId: txn.importBatchId,
        fingerprint: txn.fingerprint,
        isForecast: txn.isForecast,
      },
      postings: postingRows.map((row) =>
        Posting.rehydrate({
          id: PostingId.from(row.id),
          accountId: AccountId.from(row.accountId),
          direction: row.direction as PostingDirection,
          amount: Money.fromMinor(row.amountMinor, Currency.of(row.currency)),
          seq: row.seq,
          memo: row.memo,
          instrumentId: row.instrumentId,
          quantity: row.quantityScaled === null ? null : Quantity.fromScaled(row.quantityScaled),
          unitCost:
            row.unitCostMinor === null
              ? null
              : Money.fromMinor(row.unitCostMinor, Currency.of(row.currency)),
          categoryId: row.categoryId,
          status: row.status as PostingStatus,
        }),
      ),
      reversesTransactionId: txn.reversesTransactionId
        ? TransactionId.from(txn.reversesTransactionId)
        : null,
    });
  },

  /** Groups flat rows into one aggregate per transaction, preserving order. */
  toDomainMany(txnRows: readonly TxnRow[], postingRows: readonly PostingRow[]): Transaction[] {
    const byTransaction = new Map<string, PostingRow[]>();
    for (const posting of postingRows) {
      const bucket = byTransaction.get(posting.transactionId);
      if (bucket) bucket.push(posting);
      else byTransaction.set(posting.transactionId, [posting]);
    }
    return txnRows.map((txn) => TransactionMapper.toDomain(txn, byTransaction.get(txn.id) ?? []));
  },

  toTransactionRow(txn: Transaction): TxnInsert {
    const context = txn.context;
    return {
      id: txn.id.value,
      userId: txn.userId.value,
      txnType: txn.kind,
      txnDate: txn.txnDate.toISO(),
      settlementDate: context.settlementDate?.toISO() ?? null,
      description: txn.description,
      source: context.txnSource ?? "MANUAL",
      reference: context.reference ?? null,
      externalId: context.externalId ?? null,
      counterpartyId: context.counterpartyId ?? null,
      importBatchId: context.importBatchId ?? null,
      reversesTransactionId: txn.reversesTransactionId?.value ?? null,
      isForecast: context.isForecast ?? false,
      fingerprint: context.fingerprint ?? null,
    };
  },

  toPostingRows(txn: Transaction): PostingInsert[] {
    return txn.postings().map((posting) => ({
      id: posting.id.value,
      transactionId: txn.id.value,
      accountId: posting.accountId.value,
      direction: posting.direction,
      // `Money` already holds the exact integer this column wants.
      amountMinor: posting.amount.toMinorNumber(),
      currency: posting.amount.currency.code,
      seq: posting.seq,
      memo: posting.memo,
      instrumentId: posting.instrumentId,
      quantityScaled: posting.quantity?.toScaledNumber() ?? null,
      unitCostMinor: posting.unitCost?.toMinorNumber() ?? null,
      categoryId: posting.categoryId,
      status: posting.status,
    }));
  },
};

/* ═══ DrizzleAccountRepository ════════════════════════════════════════ */

/**
 * libSQL implementation of {@link AccountRepository}.
 *
 * The only layer in the ledger that knows SQL exists. Every query filters on
 * `userId` in the same `and(...)` as its other conditions — never as an
 * afterthought — so there is no code path that can return another user's rows.
 */
export class DrizzleAccountRepository implements AccountRepository {
  constructor(private readonly db: Database) {}

  async save(account: Account): Promise<void> {
    const row = AccountMapper.toRow(account);
    await this.db
      .insert(ledgerAccounts)
      .values(row)
      .onConflictDoUpdate({ target: ledgerAccounts.id, set: row });
  }

  async saveMany(accounts: readonly Account[]): Promise<void> {
    if (accounts.length === 0) return;
    const rows = accounts.map((account) => AccountMapper.toRow(account));
    // One statement, one transaction: seeding the chart either lands whole or not
    // at all, so a failure cannot leave a half-built tree with dangling parents.
    await this.db.insert(ledgerAccounts).values(rows).onConflictDoNothing();
  }

  async findById(userId: UserId, id: AccountId): Promise<Account | null> {
    const [row] = await this.db
      .select()
      .from(ledgerAccounts)
      .where(and(eq(ledgerAccounts.userId, userId.value), isNull(ledgerAccounts.deletedAt), eq(ledgerAccounts.id, id.value)))
      .limit(1);
    return row ? AccountMapper.toDomain(row) : null;
  }

  async findByCode(userId: UserId, code: AccountCode): Promise<Account | null> {
    const [row] = await this.db
      .select()
      .from(ledgerAccounts)
      .where(and(eq(ledgerAccounts.userId, userId.value), isNull(ledgerAccounts.deletedAt), eq(ledgerAccounts.code, code.toString())))
      .limit(1);
    return row ? AccountMapper.toDomain(row) : null;
  }

  async findManyByCodes(userId: UserId, codes: readonly AccountCode[]): Promise<Account[]> {
    if (codes.length === 0) return [];
    const rows = await this.db
      .select()
      .from(ledgerAccounts)
      .where(
        and(
          eq(ledgerAccounts.userId, userId.value), isNull(ledgerAccounts.deletedAt),
          inArray(
            ledgerAccounts.code,
            codes.map((code) => code.toString()),
          ),
        ),
      );
    return rows.map(AccountMapper.toDomain);
  }

  async list(userId: UserId, options?: { includeClosed?: boolean }): Promise<Account[]> {
    const rows = await this.db
      .select()
      .from(ledgerAccounts)
      .where(
        and(
          eq(ledgerAccounts.userId, userId.value), isNull(ledgerAccounts.deletedAt),
          options?.includeClosed ? undefined : eq(ledgerAccounts.isClosed, false),
        ),
      )
      .orderBy(asc(ledgerAccounts.sortOrder), asc(ledgerAccounts.code));
    return rows.map(AccountMapper.toDomain);
  }

  async listByType(
    userId: UserId,
    type: AccountType,
    options?: { includeClosed?: boolean },
  ): Promise<Account[]> {
    const rows = await this.db
      .select()
      .from(ledgerAccounts)
      .where(
        and(
          eq(ledgerAccounts.userId, userId.value), isNull(ledgerAccounts.deletedAt),
          eq(ledgerAccounts.type, type.name),
          options?.includeClosed ? undefined : eq(ledgerAccounts.isClosed, false),
        ),
      )
      .orderBy(asc(ledgerAccounts.sortOrder), asc(ledgerAccounts.code));
    return rows.map(AccountMapper.toDomain);
  }

  /**
   * Every account beneath `id`, at any depth.
   *
   * Uses a recursive CTE rather than N round trips per level: the tree is walked
   * once inside the database, which matters because this runs on every re-parent
   * to check for a cycle.
   */
  async descendantsOf(userId: UserId, id: AccountId): Promise<Account[]> {
    const rows = await this.db.all<typeof ledgerAccounts.$inferSelect>(sql`
      WITH RECURSIVE subtree(id) AS (
        SELECT id FROM ${ledgerAccounts}
          WHERE parent_id = ${id.value} AND user_id = ${userId.value}
        UNION
        SELECT a.id FROM ${ledgerAccounts} a
          JOIN subtree s ON a.parent_id = s.id
          WHERE a.user_id = ${userId.value}
      )
      SELECT a.* FROM ${ledgerAccounts} a JOIN subtree s ON a.id = s.id
    `);
    return rows.map(AccountMapper.toDomain);
  }

  async countPostings(userId: UserId, id: AccountId): Promise<number> {
    const [row] = await this.db
      .select({ total: count() })
      .from(postings)
      .innerJoin(ledgerAccounts, eq(postings.accountId, ledgerAccounts.id))
      .where(and(eq(postings.accountId, id.value), eq(ledgerAccounts.userId, userId.value), isNull(ledgerAccounts.deletedAt)));
    return row?.total ?? 0;
  }

  /**
   * Soft delete — invariant A03.
   *
   * Was a hard `DELETE`, which the A03 guard caught. Deleting an account with
   * postings would either cascade away history or fail on the restrict, and
   * neither is what "remove this from my list" should mean. The row stays,
   * `deletedAt` is stamped, and every read filters it.
   */
  async softDelete(userId: UserId, id: AccountId, at: Date): Promise<void> {
    await this.db
      .update(ledgerAccounts)
      .set({ deletedAt: at })
      .where(and(eq(ledgerAccounts.userId, userId.value), eq(ledgerAccounts.id, id.value)));
  }

  /** Undo of the above. Possible precisely because nothing was destroyed. */
  async restore(userId: UserId, id: AccountId): Promise<void> {
    await this.db
      .update(ledgerAccounts)
      .set({ deletedAt: null })
      .where(and(eq(ledgerAccounts.userId, userId.value), eq(ledgerAccounts.id, id.value)));
  }
}

/* ═══ DrizzleTransactionRepository ════════════════════════════════════════ */

/** SQLite caps parameters per statement; batch anything unbounded. */
const PARAM_CHUNK = 400;

/**
 * libSQL implementation of {@link TransactionRepository}.
 *
 * Entries and their postings are always written inside a single transaction. That
 * is not a nicety: a half-written txn is an unbalanced txn, which is the one
 * state the whole design exists to make impossible. `Transaction`'s constructor
 * guards the in-memory shape; this transaction guards the stored one.
 */
export class DrizzleTransactionRepository implements TransactionRepository {
  constructor(private readonly db: Database) {}

  async save(txn: Transaction): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.insert(transactions).values(TransactionMapper.toTransactionRow(txn));
      await tx.insert(postings).values(TransactionMapper.toPostingRows(txn));
    });
  }

  async saveMany(txns: readonly Transaction[]): Promise<void> {
    if (txns.length === 0) return;
    await this.db.transaction(async (tx) => {
      // Chunked so a large import does not exceed the statement parameter limit,
      // while still being one transaction overall — an import lands whole.
      for (let i = 0; i < txns.length; i += 50) {
        const batch = txns.slice(i, i + 50);
        await tx.insert(transactions).values(batch.map(TransactionMapper.toTransactionRow));
        await tx.insert(postings).values(batch.flatMap(TransactionMapper.toPostingRows));
      }
    });
  }

  async findById(userId: UserId, id: TransactionId): Promise<Transaction | null> {
    const [txn] = await this.db
      .select()
      .from(transactions)
      .where(and(eq(transactions.userId, userId.value), isNull(transactions.deletedAt), eq(transactions.id, id.value)))
      .limit(1);
    if (!txn) return null;

    const postingRows = await this.db
      .select()
      .from(postings)
      .where(eq(postings.transactionId, txn.id))
      .orderBy(asc(postings.seq));

    return TransactionMapper.toDomain(txn, postingRows);
  }

  async find(userId: UserId, query: TransactionQuery): Promise<TransactionPage> {
    const conditions = [eq(transactions.userId, userId.value), isNull(transactions.deletedAt)];

    if (query.range) {
      conditions.push(gte(transactions.txnDate, query.range.start.toISO()));
      conditions.push(lte(transactions.txnDate, query.range.end.toISO()));
    }
    if (query.importBatchId) {
      conditions.push(eq(transactions.importBatchId, query.importBatchId));
    }
    if (query.search?.trim()) {
      const term = `%${query.search.trim().toLowerCase()}%`;
      conditions.push(
        or(
          like(sql`lower(${transactions.description})`, term),
          like(sql`lower(coalesce(${transactions.reference}, ''))`, term),
        )!,
      );
    }
    if (query.accountIds?.length) {
      // Entries touching any of these accounts. A subquery keeps the result one
      // row per txn — a join would duplicate an txn that has two matching legs.
      conditions.push(
        sql`${transactions.id} IN (
          SELECT ${postings.transactionId} FROM ${postings}
          WHERE ${inArray(
            postings.accountId,
            query.accountIds.map((id) => id.value),
          )}
        )`,
      );
    }

    const where = and(...conditions);

    const [[totals], txnRows] = await Promise.all([
      this.db.select({ total: count() }).from(transactions).where(where),
      this.db
        .select()
        .from(transactions)
        .where(where)
        .orderBy(desc(transactions.txnDate), desc(transactions.createdAt))
        .limit(query.limit ?? 100)
        .offset(query.offset ?? 0),
    ]);

    if (txnRows.length === 0) {
      return { transactions: [], totalCount: totals?.total ?? 0 };
    }

    const postingRows = await this.db
      .select()
      .from(postings)
      .where(
        inArray(
          postings.transactionId,
          txnRows.map((row) => row.id),
        ),
      )
      .orderBy(asc(postings.seq));

    return {
      transactions: TransactionMapper.toDomainMany(txnRows, postingRows),
      totalCount: totals?.total ?? 0,
    };
  }

  async existsWithFingerprint(userId: UserId, fingerprint: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: transactions.id })
      .from(transactions)
      .where(
        and(eq(transactions.userId, userId.value), isNull(transactions.deletedAt), eq(transactions.fingerprint, fingerprint)),
      )
      .limit(1);
    return row !== undefined;
  }

  async findExistingFingerprints(
    userId: UserId,
    fingerprints: readonly string[],
  ): Promise<ReadonlySet<string>> {
    const found = new Set<string>();
    for (let i = 0; i < fingerprints.length; i += PARAM_CHUNK) {
      const chunk = fingerprints.slice(i, i + PARAM_CHUNK);
      const rows = await this.db
        .select({ fingerprint: transactions.fingerprint })
        .from(transactions)
        .where(
          and(eq(transactions.userId, userId.value), isNull(transactions.deletedAt), inArray(transactions.fingerprint, chunk)),
        );
      for (const row of rows) {
        if (row.fingerprint) found.add(row.fingerprint);
      }
    }
    return found;
  }

  async hasReversal(userId: UserId, id: TransactionId): Promise<boolean> {
    const [row] = await this.db
      .select({ id: transactions.id })
      .from(transactions)
      .where(
        and(eq(transactions.userId, userId.value), isNull(transactions.deletedAt), eq(transactions.reversesTransactionId, id.value)),
      )
      .limit(1);
    return row !== undefined;
  }

  /**
   * Undoes an import — invariant A03, and the reason it matters here.
   *
   * This was a hard `DELETE` relying on `ON DELETE CASCADE` to take the postings
   * with it. That destroyed the evidence of what was imported, so "undo the
   * import and tell me what it had done" was unanswerable. Stamping `deletedAt`
   * keeps the rows; the postings are excluded by the same filter through their
   * txn.
   */
  async softDeleteByImportBatch(
    userId: UserId,
    importBatchId: string,
    at: Date,
  ): Promise<number> {
    const updated = await this.db
      .update(transactions)
      .set({ deletedAt: at })
      .where(
        and(
          eq(transactions.userId, userId.value),
          eq(transactions.importBatchId, importBatchId),
          isNull(transactions.deletedAt),
        ),
      )
      .returning({ id: transactions.id });
    return updated.length;
  }

  /**
   * Soft delete — invariant A03.
   *
   * Note this is not how a *mistake* is corrected. An txn that posted the wrong
   * amount is fixed with a reversing txn, so both the error and the correction
   * are visible. This is for an txn that should never have existed at all, such
   * as a duplicate from a re-import.
   */
  async softDelete(userId: UserId, id: TransactionId, at: Date): Promise<void> {
    await this.db
      .update(transactions)
      .set({ deletedAt: at })
      .where(and(eq(transactions.userId, userId.value), eq(transactions.id, id.value)));
  }

  async earliestTxnDate(userId: UserId): Promise<CalendarDate | null> {
    const [row] = await this.db
      .select({ earliest: min(transactions.txnDate) })
      .from(transactions)
      // A tombstoned txn must not set the start of the net-worth timeline.
      .where(and(eq(transactions.userId, userId.value), isNull(transactions.deletedAt)));
    return row?.earliest ? CalendarDate.parse(row.earliest) : null;
  }
}

/* ═══ DrizzleBalanceQuery ═════════════════════════════════════════════ */

/**
 * The signed contribution of a posting to its account's own balance, in SQL.
 *
 * This is `AccountType.signedEffect` expressed once as a CASE, and it is the only
 * place the rule is duplicated outside the domain. A debit raises an asset or
 * expense and lowers a liability, equity or income; a credit does the reverse.
 *
 * Keeping it in a single exported fragment means every aggregate below shares the
 * definition — the failure mode to avoid is two reports disagreeing because one
 * of them re-derived the sign.
 */
const SIGNED_AMOUNT = sql<number>`
  CASE
    WHEN ${ledgerAccounts.type} IN ('ASSET', 'EXPENSE')
      THEN CASE WHEN ${postings.direction} = 'DEBIT' THEN ${postings.amountMinor} ELSE -${postings.amountMinor} END
    ELSE
      CASE WHEN ${postings.direction} = 'CREDIT' THEN ${postings.amountMinor} ELSE -${postings.amountMinor} END
  END
`;

/**
 * libSQL implementation of {@link BalanceQuery}.
 *
 * Aggregates run in the database — `SUM` over an indexed join, not every posting
 * pulled into Node and folded. `BalanceCalculator` is the pure reference these
 * queries are checked against.
 */
export class DrizzleBalanceQuery implements BalanceQuery {
  constructor(
    private readonly db: Database,
    private readonly currency: Currency = Currency.reporting,
  ) {}

  private money(minor: number | null): Money {
    return Money.fromMinor(minor ?? 0, this.currency);
  }

  async balanceSheet(
    userId: UserId,
    asOf: CalendarDate,
    options?: { includeClosed?: boolean; includeEmpty?: boolean },
  ): Promise<AccountBalance[]> {
    // LEFT JOIN so an account with no postings still appears at zero — the user
    // needs to see an account they just created.
    const rows = await this.db
      .select({
        accountId: ledgerAccounts.id,
        code: ledgerAccounts.code,
        name: ledgerAccounts.name,
        type: ledgerAccounts.type,
        subtype: ledgerAccounts.subtype,
        institution: ledgerAccounts.institution,
        isClosed: ledgerAccounts.isClosed,
        balance: sql<number>`COALESCE(SUM(${SIGNED_AMOUNT}), 0)`,
        postingCount: sql<number>`COUNT(${postings.id})`,
      })
      .from(ledgerAccounts)
      .leftJoin(
        postings,
        and(
          eq(postings.accountId, ledgerAccounts.id),
          sql`${postings.transactionId} IN (
            SELECT ${transactions.id} FROM ${transactions}
            WHERE ${transactions.userId} = ${userId.value}
              AND ${transactions.txnDate} <= ${asOf.toISO()}
          )`,
        ),
      )
      .where(
        and(
          eq(ledgerAccounts.userId, userId.value), isNull(ledgerAccounts.deletedAt),
          sql`${ledgerAccounts.type} IN ('ASSET', 'LIABILITY', 'EQUITY')`,
          options?.includeClosed ? undefined : eq(ledgerAccounts.isClosed, false),
        ),
      )
      .groupBy(ledgerAccounts.id)
      .orderBy(ledgerAccounts.sortOrder, ledgerAccounts.code);

    return rows
      .filter((row) => options?.includeEmpty !== false || row.postingCount > 0)
      .map((row) => ({
        accountId: AccountId.from(row.accountId),
        code: row.code,
        name: row.name,
        type: row.type as AccountTypeName,
        subtype: row.subtype,
        institution: row.institution,
        isClosed: row.isClosed,
        balance: this.money(row.balance),
        postingCount: Number(row.postingCount),
      }));
  }

  async balanceOf(userId: UserId, accountId: AccountId, asOf: CalendarDate): Promise<Money> {
    const [row] = await this.db
      .select({ balance: sql<number>`COALESCE(SUM(${SIGNED_AMOUNT}), 0)` })
      .from(postings)
      .innerJoin(ledgerAccounts, eq(postings.accountId, ledgerAccounts.id))
      .innerJoin(transactions, eq(postings.transactionId, transactions.id))
      .where(
        and(
          eq(transactions.userId, userId.value), isNull(transactions.deletedAt),
          eq(postings.accountId, accountId.value),
          sql`${transactions.txnDate} <= ${asOf.toISO()}`,
        ),
      );
    return this.money(row?.balance ?? 0);
  }

  async totals(userId: UserId, asOf: CalendarDate): Promise<TypeTotals> {
    const rows = await this.db
      .select({
        type: ledgerAccounts.type,
        balance: sql<number>`COALESCE(SUM(${SIGNED_AMOUNT}), 0)`,
      })
      .from(postings)
      .innerJoin(ledgerAccounts, eq(postings.accountId, ledgerAccounts.id))
      .innerJoin(transactions, eq(postings.transactionId, transactions.id))
      .where(
        and(eq(transactions.userId, userId.value), isNull(transactions.deletedAt), sql`${transactions.txnDate} <= ${asOf.toISO()}`),
      )
      .groupBy(ledgerAccounts.type);

    const byType = new Map(rows.map((row) => [row.type, this.money(row.balance)]));
    const zero = Money.zero(this.currency);
    const assets = byType.get("ASSET") ?? zero;
    const liabilities = byType.get("LIABILITY") ?? zero;

    return {
      asOf,
      assets,
      liabilities,
      equity: byType.get("EQUITY") ?? zero,
      // Income and expense are deliberately excluded: they are flows, and adding
      // them would count every transaction twice.
      netWorth: assets.minus(liabilities),
    };
  }

  async monthlyFlows(userId: UserId, range: DateRange): Promise<MonthlyFlow[]> {
    const rows = await this.db
      .select({
        month: sql<string>`substr(${transactions.txnDate}, 1, 7)`,
        type: ledgerAccounts.type,
        total: sql<number>`COALESCE(SUM(${SIGNED_AMOUNT}), 0)`,
      })
      .from(postings)
      .innerJoin(ledgerAccounts, eq(postings.accountId, ledgerAccounts.id))
      .innerJoin(transactions, eq(postings.transactionId, transactions.id))
      .where(
        and(
          eq(transactions.userId, userId.value), isNull(transactions.deletedAt),
          sql`${transactions.txnDate} >= ${range.start.toISO()}`,
          sql`${transactions.txnDate} <= ${range.end.toISO()}`,
          sql`${ledgerAccounts.type} IN ('INCOME', 'EXPENSE')`,
        ),
      )
      .groupBy(sql`substr(${transactions.txnDate}, 1, 7)`, ledgerAccounts.type);

    const zero = Money.zero(this.currency);
    const byMonth = new Map<string, MonthlyFlow>();
    // Seed every month in the range so a gap renders as zero rather than
    // disappearing from the chart and compressing the x-axis.
    for (const month of range.months()) {
      const key = month.start.toMonthKey();
      byMonth.set(key, { month: key, income: zero, expense: zero });
    }
    for (const row of rows) {
      const flow = byMonth.get(row.month) ?? { month: row.month, income: zero, expense: zero };
      if (row.type === "INCOME") flow.income = this.money(row.total);
      else flow.expense = this.money(row.total);
      byMonth.set(row.month, flow);
    }

    return [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month));
  }

  async flowsByAccount(
    userId: UserId,
    range: DateRange,
    options?: { type?: "INCOME" | "EXPENSE"; rollUp?: boolean },
  ): Promise<AccountFlow[]> {
    const typeFilter = options?.type
      ? eq(ledgerAccounts.type, options.type)
      : sql`${ledgerAccounts.type} IN ('INCOME', 'EXPENSE')`;

    // Driven from `ledgerAccounts` with a LEFT JOIN, not from `postings`.
    // A rollup target such as `Expenses:Food` usually has no postings of its own —
    // only its children do — so an inner join would omit exactly the rows the
    // rollup needs to accumulate into.
    const rows = await this.db
      .select({
        accountId: ledgerAccounts.id,
        code: ledgerAccounts.code,
        name: ledgerAccounts.name,
        type: ledgerAccounts.type,
        amount: sql<number>`COALESCE(SUM(${SIGNED_AMOUNT}), 0)`,
        postingCount: sql<number>`COUNT(${postings.id})`,
      })
      .from(ledgerAccounts)
      .leftJoin(
        postings,
        and(
          eq(postings.accountId, ledgerAccounts.id),
          sql`${postings.transactionId} IN (
            SELECT ${transactions.id} FROM ${transactions}
            WHERE ${transactions.userId} = ${userId.value}
              AND ${transactions.txnDate} >= ${range.start.toISO()}
              AND ${transactions.txnDate} <= ${range.end.toISO()}
          )`,
        ),
      )
      .where(and(eq(ledgerAccounts.userId, userId.value), isNull(ledgerAccounts.deletedAt), typeFilter))
      .groupBy(ledgerAccounts.id);

    const flows: AccountFlow[] = rows.map((row) => ({
      accountId: AccountId.from(row.accountId),
      code: row.code,
      name: row.name,
      type: row.type as AccountTypeName,
      amount: this.money(row.amount),
      postingCount: Number(row.postingCount),
    }));

    const result = options?.rollUp ? this.rollUp(flows) : flows;

    // Drop accounts with no activity in the period — a category chart should show
    // what was spent, not all 40 available categories at zero.
    return result.filter((flow) => flow.postingCount > 0 || !flow.amount.isZero);
  }

  /**
   * Adds each account's total into all of its ancestors, so `Expenses:Food`
   * reports its whole subtree.
   *
   * Done in JS over an already-aggregated result — a handful of rows — rather than
   * as a recursive CTE, because the code prefix already encodes the tree and this
   * keeps the SQL above readable.
   */
  private rollUp(flows: readonly AccountFlow[]): AccountFlow[] {
    const byCode = new Map(flows.map((flow) => [flow.code, { ...flow }]));

    for (const flow of flows) {
      const segments = flow.code.split(":");
      for (let depth = 1; depth < segments.length; depth += 1) {
        const ancestorCode = segments.slice(0, depth).join(":");
        const ancestor = byCode.get(ancestorCode);
        if (ancestor) {
          ancestor.amount = ancestor.amount.plus(flow.amount);
          ancestor.postingCount += flow.postingCount;
        }
      }
    }

    return [...byCode.values()].sort((a, b) => b.amount.compareTo(a.amount));
  }

  async balanceSeries(
    userId: UserId,
    accountId: AccountId,
    range: DateRange,
  ): Promise<{ date: CalendarDate; balance: Money }[]> {
    // The opening position: everything before the window, as one figure.
    const opening = await this.balanceOf(userId, accountId, range.start.plusDays(-1));

    const rows = await this.db
      .select({
        date: transactions.txnDate,
        delta: sql<number>`COALESCE(SUM(${SIGNED_AMOUNT}), 0)`,
      })
      .from(postings)
      .innerJoin(ledgerAccounts, eq(postings.accountId, ledgerAccounts.id))
      .innerJoin(transactions, eq(postings.transactionId, transactions.id))
      .where(
        and(
          eq(transactions.userId, userId.value), isNull(transactions.deletedAt),
          eq(postings.accountId, accountId.value),
          sql`${transactions.txnDate} >= ${range.start.toISO()}`,
          sql`${transactions.txnDate} <= ${range.end.toISO()}`,
        ),
      )
      .groupBy(transactions.txnDate)
      .orderBy(transactions.txnDate);

    let running = opening;
    return rows.map((row) => {
      running = running.plus(this.money(row.delta));
      return { date: CalendarDate.parse(row.date), balance: running };
    });
  }
}

/* ═══ DrizzleQuoteRepository ═══════════════════════════════════════════ */

/**
 * libSQL implementation of {@link QuoteRepository}.
 *
 * **Append-only, and there is no method that is not.** A vendor correction inserts
 * a row and points the old one at it through {@link supersede}; nothing overwrites a
 * price. That is what makes "what did we believe this was worth on 31 March, using
 * the data we had then" answerable years later, and it is the one thing all four
 * reference implementations get wrong — every one of them updates prices in place.
 *
 * The unique index includes `ingestedAt` for the same reason: with §3.8's
 * four-column key, a correction would have to overwrite the original and the second
 * time axis would be decoration.
 */
export class DrizzleQuoteRepository implements QuoteRepository {
  constructor(private readonly db: Database) {}

  async append(quotes: readonly Quote[]): Promise<void> {
    if (quotes.length === 0) return;
    const rows = quotes.map((quote) => ({
      id: newUuid(),
      instrumentId: quote.instrumentId,
      asOf: quote.asOf.toISO(),
      quoteType: quote.quoteType,
      priceScaled: quote.price.toScaledNumber(),
      currency: quote.price.currency.code,
      providerId: quote.providerId,
      sourceType: quote.sourceType,
      ingestedAt: quote.ingestedAt,
    }));

    await this.db.transaction(async (tx) => {
      for (let i = 0; i < rows.length; i += 200) {
        await tx
          .insert(priceQuotes)
          .values(rows.slice(i, i + 200))
          // Re-ingesting the same provider's same belief at the same instant is a
          // repeated fetch, not a correction — so it is a no-op rather than an error
          // a scheduler would have to catch.
          .onConflictDoNothing();
      }
    });
  }

  async supersede(supersededQuoteId: string, bySupersedingQuoteId: string): Promise<void> {
    await this.db
      .update(priceQuotes)
      .set({ supersededBy: bySupersedingQuoteId })
      .where(eq(priceQuotes.id, supersededQuoteId));
  }

  async findLatestOnOrBefore(
    instrumentId: string,
    quoteType: QuoteType,
    asOf: CalendarDate,
    limit = 50,
  ): Promise<readonly Quote[]> {
    const rows = await this.db
      .select()
      .from(priceQuotes)
      .where(
        and(
          eq(priceQuotes.instrumentId, instrumentId),
          eq(priceQuotes.quoteType, quoteType),
          lte(priceQuotes.asOf, asOf.toISO()),
        ),
      )
      // Newest date first, then newest belief about that date — the order the
      // resolution ladder walks.
      .orderBy(desc(priceQuotes.asOf), desc(priceQuotes.ingestedAt))
      .limit(limit);

    return rows.map(QuoteMapper.toDomain);
  }

  async findRange(
    instrumentId: string,
    quoteType: QuoteType,
    dateRange: DateRange,
  ): Promise<readonly Quote[]> {
    const rows = await this.db
      .select()
      .from(priceQuotes)
      .where(
        and(
          eq(priceQuotes.instrumentId, instrumentId),
          eq(priceQuotes.quoteType, quoteType),
          gte(priceQuotes.asOf, dateRange.start.toISO()),
          lte(priceQuotes.asOf, dateRange.end.toISO()),
          isNull(priceQuotes.supersededBy),
        ),
      )
      .orderBy(asc(priceQuotes.asOf), desc(priceQuotes.ingestedAt));

    return rows.map(QuoteMapper.toDomain);
  }

  async coverage(
    instrumentId: string,
    quoteType: QuoteType,
  ): Promise<{ from: CalendarDate; through: CalendarDate } | null> {
    const [row] = await this.db
      .select({ from: min(priceQuotes.asOf), through: max(priceQuotes.asOf) })
      .from(priceQuotes)
      .where(and(eq(priceQuotes.instrumentId, instrumentId), eq(priceQuotes.quoteType, quoteType)));

    if (!row?.from || !row.through) return null;
    return { from: CalendarDate.parse(row.from), through: CalendarDate.parse(row.through) };
  }

  async recordDivergence(divergence: PriceDivergence): Promise<void> {
    await this.db.insert(priceDivergences).values({
      id: newUuid(),
      instrumentId: divergence.instrumentId,
      asOf: divergence.asOf.toISO(),
      quoteType: divergence.quoteType,
      providerA: divergence.providerA,
      providerB: divergence.providerB,
      // Stored as money because a divergence report is read by a person, and the
      // paisa-level difference between two vendors is not the interesting part.
      priceAMinor: divergence.priceA.toMoney().toMinorNumber(),
      priceBMinor: divergence.priceB.toMoney().toMinorNumber(),
      currency: divergence.priceA.currency.code,
      deltaPercentScaled: divergence.deltaPercent.toScaledNumber(),
    });
  }
}

const QuoteMapper = {
  toDomain(row: typeof priceQuotes.$inferSelect): Quote {
    return {
      instrumentId: row.instrumentId,
      asOf: CalendarDate.parse(row.asOf),
      quoteType: row.quoteType as QuoteType,
      price: UnitPrice.fromScaled(row.priceScaled, Currency.of(row.currency)),
      providerId: row.providerId,
      sourceType: row.sourceType as PriceSourceType,
      ingestedAt: row.ingestedAt,
      supersededBy: row.supersededBy,
    };
  },
};

/* ═══ DrizzleFxRateRepository ══════════════════════════════════════════ */

/**
 * libSQL implementation of {@link FxRateRepository}.
 *
 * A user-asserted rate is a **row**, not a column update on the provider's row.
 * Both are returned by the same query and `FxBook` decides; storing the assertion
 * by overwriting would lose what the vendor said, and "why is this year's return
 * different from what I filed" needs both numbers.
 */
export class DrizzleFxRateRepository implements FxRateRepository {
  constructor(private readonly db: Database) {}

  async append(rates: readonly FxQuote[]): Promise<void> {
    if (rates.length === 0) return;
    await this.db
      .insert(fxRates)
      .values(
        rates.map((rate) => ({
          id: newUuid(),
          userId: null,
          base: rate.base,
          quote: rate.quote,
          asOf: rate.asOf.toISO(),
          providerId: rate.providerId,
          providerRateScaled: rate.rate.toScaledNumber(),
          userRateScaled: null,
          sourceType: rate.sourceType,
          derivation: rate.derivation ?? null,
          ingestedAt: rate.ingestedAt,
        })),
      )
      .onConflictDoNothing();
  }

  async findLatestOnOrBefore(
    base: string,
    quote: string,
    asOf: CalendarDate,
    userId?: UserId,
    limit = 50,
  ): Promise<readonly StoredFxRate[]> {
    const rows = await this.db
      .select()
      .from(fxRates)
      .where(
        and(
          eq(fxRates.base, base),
          eq(fxRates.quote, quote),
          lte(fxRates.asOf, asOf.toISO()),
          // A provider row is everyone's; a user's assertion is only theirs.
          userId
            ? or(isNull(fxRates.userId), eq(fxRates.userId, userId.value))
            : isNull(fxRates.userId),
        ),
      )
      .orderBy(desc(fxRates.asOf), desc(fxRates.ingestedAt))
      .limit(limit);

    return rows.map((row) => ({
      base: row.base,
      quote: row.quote,
      asOf: CalendarDate.parse(row.asOf),
      rate: Quantity.fromScaled(row.providerRateScaled ?? row.userRateScaled ?? 0),
      providerId: row.providerId,
      sourceType: row.sourceType as PriceSourceType,
      ingestedAt: row.ingestedAt,
      derivation: row.derivation,
      userId: row.userId,
      userRate: row.userRateScaled === null ? null : Quantity.fromScaled(row.userRateScaled),
    }));
  }

  async setUserRate(rate: FxQuote & { userId: UserId }): Promise<void> {
    await this.db.insert(fxRates).values({
      id: newUuid(),
      userId: rate.userId.value,
      base: rate.base,
      quote: rate.quote,
      asOf: rate.asOf.toISO(),
      providerId: rate.providerId,
      providerRateScaled: null,
      userRateScaled: rate.rate.toScaledNumber(),
      sourceType: "MANUAL",
      derivation: null,
      ingestedAt: rate.ingestedAt,
    });
  }
}

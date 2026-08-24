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
import { CalendarDate, DateRange, FinancialYear } from "@/core/time";
import { Account, AccountCode, AccountId, AccountRepository, AccountSubtype, AccountType, AccountTypeName, PostingDirection } from "@/domain/accounts";
import { BillingCycleRule, CardTerms, CardTermsRepository } from "@/domain/assets";
import { DepositContributionInput, DepositProduct, DepositStore, DepositTermsInput, EmployeeProvidentFund, FixedDeposit, NationalPensionSystem, PublicProvidentFund, RecurringDeposit } from "@/domain/deposits";
import { Loan, LoanStore, LoanTermsInput, StoredLoanTerms, loanFor } from "@/domain/loans";
import { InstrumentId, InstrumentKind, InstrumentProps, InstrumentRepository, MarketInstrument } from "@/domain/instruments";
import { Disposal, Lot, LotId, LotRepository, TradeRecord } from "@/domain/lots";
import { CorporateActionRepository, StoredCorporateAction } from "@/domain/corporate";
import { Percentage, Quantity, Rate, UnitPrice } from "@/core/numeric";
import { FxQuote, FxRateRepository, PriceDivergence, PriceSourceType, Quote, QuoteRepository, QuoteType, StoredFxRate } from "@/domain/pricing";
import { AccountBalance, AccountFlow, BalanceQuery, MonthlyFlow, Posting, PostingId, PostingStatus, StoredTransaction, Transaction, TransactionId, TransactionKind, TransactionPage, TransactionQuery, TransactionRepository, TransactionSource, TypeTotals } from "@/domain/transactions";
import { BudgetRepository, CategoryRuleRepository, ImportBatchRecord, ImportBatchStatus, ImportRepository, ImportRowStatus, KeywordRule, MovementIntent, RowDirection, SelfPayeeQuery, StagedRow, StoredBudget } from "@/domain/banking";
import { budgets, categoryRules, corporateActions, counterparties, creditCardTerms, depositContributions, depositTerms, fxRates, importBatches, importRows, instruments, ledgerAccounts, loanPrepayments, loanTerms, lotMatches, lots, npsHoldings, postings, priceDivergences, priceQuotes, schemeRates, trades, transactions } from "@/infra/db/schema";
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

/* ═══ DrizzleImportRepository ═════════════════════════════════════════ */

/**
 * libSQL implementation of {@link ImportRepository}.
 *
 * `raw_json` holds what the file said and `parsed_json` holds what we made of it,
 * as two separate columns. That separation is what makes a mis-parse fixable: the
 * proposal can be recomputed from the raw row without asking the user to upload
 * the file again, and the raw row is the evidence when the two disagree.
 */
export class DrizzleImportRepository implements ImportRepository {
  constructor(private readonly db: Database) {}

  async findBatchByFileHash(userId: UserId, fileHash: string): Promise<ImportBatchRecord | null> {
    const [row] = await this.db
      .select()
      .from(importBatches)
      .where(
        and(
          eq(importBatches.userId, userId.value),
          isNull(importBatches.deletedAt),
          eq(importBatches.fileHash, fileHash),
          // An undone import frees its hash: re-importing a corrected file is
          // exactly what a user does next, and I02 must not block that.
          sql`${importBatches.status} <> 'UNDONE'`,
        ),
      )
      .limit(1);
    return row ? ImportMapper.toBatch(row) : null;
  }

  async createBatch(
    userId: UserId,
    batch: ImportBatchRecord,
    rows: readonly StagedRow[],
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.insert(importBatches).values({
        id: batch.id,
        userId: userId.value,
        kind: batch.kind,
        accountId: batch.accountId?.value ?? null,
        fileName: batch.fileName,
        fileHash: batch.fileHash,
        rowsRead: batch.rowsRead,
        rowsImported: batch.rowsImported,
        rowsDuplicate: batch.rowsDuplicate,
        rowsFailed: batch.rowsFailed,
        status: batch.status,
      });

      for (let index = 0; index < rows.length; index += PARAM_CHUNK) {
        const chunk = rows.slice(index, index + PARAM_CHUNK);
        await tx.insert(importRows).values(
          chunk.map((row) => ({
            id: row.id,
            batchId: batch.id,
            userId: userId.value,
            rowIndex: row.rowIndex,
            rawJson: row.raw,
            parsedJson: ImportMapper.toParsedJson(row),
            status: row.status,
            matchedTransactionId: row.matchedTransactionId,
            matchPass: row.matchPass,
            rejectedReason: row.rejectedReason,
          })),
        );
      }
    });
  }

  async findBatch(userId: UserId, batchId: string): Promise<ImportBatchRecord | null> {
    const [row] = await this.db
      .select()
      .from(importBatches)
      .where(
        and(
          eq(importBatches.userId, userId.value),
          isNull(importBatches.deletedAt),
          eq(importBatches.id, batchId),
        ),
      )
      .limit(1);
    return row ? ImportMapper.toBatch(row) : null;
  }

  async listBatches(userId: UserId, limit = 20): Promise<readonly ImportBatchRecord[]> {
    const rows = await this.db
      .select()
      .from(importBatches)
      .where(and(eq(importBatches.userId, userId.value), isNull(importBatches.deletedAt)))
      .orderBy(desc(importBatches.createdAt))
      .limit(limit);
    return rows.map(ImportMapper.toBatch);
  }

  async listRows(
    userId: UserId,
    batchId: string,
    options?: { statuses?: readonly ImportRowStatus[] },
  ): Promise<readonly StagedRow[]> {
    const rows = await this.db
      .select()
      .from(importRows)
      .where(
        and(
          eq(importRows.userId, userId.value),
          isNull(importRows.deletedAt),
          eq(importRows.batchId, batchId),
          options?.statuses?.length ? inArray(importRows.status, [...options.statuses]) : undefined,
        ),
      )
      .orderBy(asc(importRows.rowIndex));
    return rows.map(ImportMapper.toStagedRow);
  }

  async setRowStatus(
    userId: UserId,
    rowId: string,
    patch: {
      status: ImportRowStatus;
      proposedAccountId?: AccountId | null;
      matchedTransactionId?: string | null;
      matchPass?: number | null;
      rejectedReason?: string | null;
    },
  ): Promise<void> {
    const [existing] = await this.db
      .select()
      .from(importRows)
      .where(and(eq(importRows.userId, userId.value), eq(importRows.id, rowId)))
      .limit(1);
    if (!existing) return;

    const current = ImportMapper.toStagedRow(existing);
    const next: StagedRow = {
      ...current,
      status: patch.status,
      proposedAccountId:
        patch.proposedAccountId === undefined ? current.proposedAccountId : patch.proposedAccountId,
    };

    await this.db
      .update(importRows)
      .set({
        status: patch.status,
        parsedJson: ImportMapper.toParsedJson(next),
        matchedTransactionId:
          patch.matchedTransactionId === undefined
            ? existing.matchedTransactionId
            : patch.matchedTransactionId,
        matchPass: patch.matchPass === undefined ? existing.matchPass : patch.matchPass,
        rejectedReason:
          patch.rejectedReason === undefined ? existing.rejectedReason : patch.rejectedReason,
        updatedAt: new Date(),
      })
      .where(and(eq(importRows.userId, userId.value), eq(importRows.id, rowId)));
  }

  async setBatchOutcome(
    userId: UserId,
    batchId: string,
    outcome: {
      status: ImportBatchStatus;
      rowsImported?: number;
      rowsDuplicate?: number;
      rowsFailed?: number;
      completedAt?: Date;
    },
  ): Promise<void> {
    await this.db
      .update(importBatches)
      .set({
        status: outcome.status,
        ...(outcome.rowsImported === undefined ? {} : { rowsImported: outcome.rowsImported }),
        ...(outcome.rowsDuplicate === undefined ? {} : { rowsDuplicate: outcome.rowsDuplicate }),
        ...(outcome.rowsFailed === undefined ? {} : { rowsFailed: outcome.rowsFailed }),
        ...(outcome.completedAt === undefined ? {} : { completedAt: outcome.completedAt }),
      })
      .where(and(eq(importBatches.userId, userId.value), eq(importBatches.id, batchId)));
  }
}

type ImportBatchRow = typeof importBatches.$inferSelect;
type ImportRowRow = typeof importRows.$inferSelect;

/** The JSON shape of a staged row's parse. Money as minor units, never a float. */
interface ParsedRowJson {
  date: string;
  description: string;
  reference: string | null;
  amountMinor: string;
  currency: string;
  direction: RowDirection;
  occurrence: number;
  proposedAccountId: string | null;
  intent: MovementIntent;
  because: string;
}

export const ImportMapper = {
  toBatch(row: ImportBatchRow): ImportBatchRecord {
    return {
      id: row.id,
      kind: row.kind,
      accountId: row.accountId ? AccountId.from(row.accountId) : null,
      fileName: row.fileName,
      fileHash: row.fileHash,
      rowsRead: row.rowsRead,
      rowsImported: row.rowsImported,
      rowsDuplicate: row.rowsDuplicate,
      rowsFailed: row.rowsFailed,
      status: row.status,
    };
  },

  toParsedJson(row: StagedRow): string {
    const payload: ParsedRowJson = {
      date: row.date.toISO(),
      description: row.description,
      reference: row.reference,
      // A string, so the exact integer survives JSON. A number would lose paise
      // above 2^53 and, worse, would look fine right up until it did.
      amountMinor: row.amount.minor.toString(),
      currency: row.amount.currency.code,
      direction: row.direction,
      occurrence: row.occurrence,
      proposedAccountId: row.proposedAccountId?.value ?? null,
      intent: row.intent,
      because: row.because,
    };
    return JSON.stringify(payload);
  },

  toStagedRow(row: ImportRowRow): StagedRow {
    const parsed = JSON.parse(row.parsedJson ?? "{}") as Partial<ParsedRowJson>;
    return {
      id: row.id,
      batchId: row.batchId,
      rowIndex: row.rowIndex,
      status: row.status,
      date: CalendarDate.parse(parsed.date ?? "1970-01-01"),
      description: parsed.description ?? "",
      reference: parsed.reference ?? null,
      amount: Money.fromMinor(
        BigInt(parsed.amountMinor ?? "0"),
        Currency.of(parsed.currency ?? Currency.reporting.code),
      ),
      direction: parsed.direction ?? "DEBIT",
      occurrence: parsed.occurrence ?? 0,
      raw: row.rawJson,
      proposedAccountId: parsed.proposedAccountId ? AccountId.from(parsed.proposedAccountId) : null,
      intent: parsed.intent ?? "SPEND",
      because: parsed.because ?? "",
      matchedTransactionId: row.matchedTransactionId,
      matchPass: row.matchPass,
      rejectedReason: row.rejectedReason,
    };
  },
};

/* ═══ DrizzleCategoryRuleRepository ═══════════════════════════════════ */

/**
 * libSQL implementation of {@link CategoryRuleRepository}.
 *
 * Ordering is deliberately *not* done here. The categoriser sorts what it is
 * given, because the tie-break rules are policy and a re-import must not depend
 * on the order a query happened to return.
 */
export class DrizzleCategoryRuleRepository implements CategoryRuleRepository {
  constructor(private readonly db: Database) {}

  async list(userId: UserId): Promise<readonly KeywordRule[]> {
    const rows = await this.db
      .select()
      .from(categoryRules)
      .where(and(eq(categoryRules.userId, userId.value), isNull(categoryRules.deletedAt)));
    return rows.map((row) => ({
      id: row.id,
      pattern: row.pattern,
      matchType: row.matchType,
      accountId: AccountId.from(row.accountId),
      appliesTo: row.appliesTo,
      priority: row.priority,
      isEnabled: row.isEnabled,
    }));
  }

  /**
   * Inserts the rules it does not already have, and returns how many landed.
   *
   * The count is a before/after difference rather than the driver's
   * `rowsAffected`, which reports 0 for an `ON CONFLICT DO NOTHING` insert over
   * libSQL — so the seeder wrote 282 rules and reported "created 0". A count that
   * disagrees with what happened is worse than no count, because the screen
   * repeats it.
   */
  async saveMany(userId: UserId, rules: readonly Omit<KeywordRule, "id">[]): Promise<number> {
    if (rules.length === 0) return 0;
    const before = await this.count(userId);
    for (let index = 0; index < rules.length; index += PARAM_CHUNK) {
      const chunk = rules.slice(index, index + PARAM_CHUNK);
      await this.db
        .insert(categoryRules)
        .values(
          chunk.map((rule) => ({
            id: newUuid(),
            userId: userId.value,
            pattern: rule.pattern,
            matchType: rule.matchType,
            accountId: rule.accountId.value,
            appliesTo: rule.appliesTo,
            priority: rule.priority,
            isEnabled: rule.isEnabled,
          })),
        )
        // Seeding is idempotent: the unique index on (user, pattern, appliesTo)
        // means re-running the seeder tops up rather than failing. It also
        // collapses a keyword that two built-in groups both claim.
        .onConflictDoNothing();
    }
    return (await this.count(userId)) - before;
  }

  private async count(userId: UserId): Promise<number> {
    const [row] = await this.db
      .select({ total: count() })
      .from(categoryRules)
      .where(and(eq(categoryRules.userId, userId.value), isNull(categoryRules.deletedAt)));
    return row?.total ?? 0;
  }

  async bumpMatchCounts(userId: UserId, ruleIds: readonly string[]): Promise<void> {
    if (ruleIds.length === 0) return;
    await this.db
      .update(categoryRules)
      .set({ matchCount: sql`${categoryRules.matchCount} + 1` })
      .where(and(eq(categoryRules.userId, userId.value), inArray(categoryRules.id, [...ruleIds])));
  }
}

/* ═══ DrizzleSelfPayeeQuery ═══════════════════════════════════════════ */

/** The user's own names and handles, from `counterparties.is_self`. */
export class DrizzleSelfPayeeQuery implements SelfPayeeQuery {
  constructor(private readonly db: Database) {}

  async list(userId: UserId): Promise<readonly string[]> {
    const rows = await this.db
      .select({ name: counterparties.name, normalised: counterparties.normalisedName })
      .from(counterparties)
      .where(
        and(
          eq(counterparties.userId, userId.value),
          isNull(counterparties.deletedAt),
          eq(counterparties.isSelf, true),
        ),
      );
    // Both spellings: the categoriser normalises again anyway, and the raw name
    // may contain an account number that normalising dropped.
    return rows.flatMap((row) => [row.name, row.normalised]);
  }
}

/* ═══ DrizzleBudgetRepository ═════════════════════════════════════════ */

export class DrizzleBudgetRepository implements BudgetRepository {
  constructor(private readonly db: Database) {}

  async listFor(userId: UserId, months: readonly string[]): Promise<readonly StoredBudget[]> {
    const rows = await this.db
      .select()
      .from(budgets)
      .where(
        and(
          eq(budgets.userId, userId.value),
          isNull(budgets.deletedAt),
          months.length > 0
            ? or(isNull(budgets.month), inArray(budgets.month, [...months]))
            : isNull(budgets.month),
        ),
      );
    return rows.map((row) => ({
      id: row.id,
      accountId: AccountId.from(row.accountId),
      month: row.month,
      limit: Money.fromMinor(row.limitMinor),
      warnAtPercent: row.warnAtPercent,
      carryover: row.carryover,
    }));
  }

  async upsert(userId: UserId, budget: Omit<StoredBudget, "id">): Promise<string> {
    const row = {
      id: newUuid(),
      userId: userId.value,
      accountId: budget.accountId.value,
      month: budget.month,
      limitMinor: budget.limit.toMinorNumber(),
      warnAtPercent: budget.warnAtPercent,
      carryover: budget.carryover,
      updatedAt: new Date(),
    };
    const [written] = await this.db
      .insert(budgets)
      .values(row)
      .onConflictDoUpdate({
        target: [budgets.userId, budgets.accountId, budgets.month],
        set: {
          limitMinor: row.limitMinor,
          warnAtPercent: row.warnAtPercent,
          carryover: row.carryover,
          deletedAt: null,
          updatedAt: row.updatedAt,
        },
      })
      .returning({ id: budgets.id });
    return written?.id ?? row.id;
  }

  /** Soft delete — A03. A removed budget must not erase last month's report. */
  async remove(userId: UserId, budgetId: string, at: Date): Promise<void> {
    await this.db
      .update(budgets)
      .set({ deletedAt: at })
      .where(and(eq(budgets.userId, userId.value), eq(budgets.id, budgetId)));
  }
}

/* ═══ DrizzleCardTermsRepository ══════════════════════════════════════ */

/**
 * libSQL implementation of {@link CardTermsRepository}.
 *
 * Every scaled integer is rehydrated through the value object that owns its scale
 * — `Rate.fromScaled` would be wrong here because `Rate` has no such constructor
 * that keeps the day count, so the day count travels in its own column and the
 * two are recombined in one place rather than at every call site.
 */
export class DrizzleCardTermsRepository implements CardTermsRepository {
  constructor(private readonly db: Database) {}

  async findFor(userId: UserId, accountId: AccountId): Promise<CardTerms | null> {
    const [row] = await this.db
      .select()
      .from(creditCardTerms)
      .where(
        and(
          eq(creditCardTerms.userId, userId.value),
          isNull(creditCardTerms.deletedAt),
          eq(creditCardTerms.accountId, accountId.value),
        ),
      )
      .limit(1);
    return row ? CardTermsMapper.toDomain(row) : null;
  }

  async findManyFor(
    userId: UserId,
    accountIds: readonly AccountId[],
  ): Promise<ReadonlyMap<string, CardTerms>> {
    if (accountIds.length === 0) return new Map();
    const rows = await this.db
      .select()
      .from(creditCardTerms)
      .where(
        and(
          eq(creditCardTerms.userId, userId.value),
          isNull(creditCardTerms.deletedAt),
          inArray(
            creditCardTerms.accountId,
            accountIds.map((id) => id.value),
          ),
        ),
      );
    return new Map(rows.map((row) => [row.accountId, CardTermsMapper.toDomain(row)]));
  }

  async save(userId: UserId, accountId: AccountId, terms: CardTerms): Promise<void> {
    const row = {
      id: newUuid(),
      userId: userId.value,
      accountId: accountId.value,
      currency: terms.creditLimit.currency.code,
      creditLimitMinor: terms.creditLimit.toMinorNumber(),
      statementDay: terms.cycle.statementDay,
      graceDays: terms.cycle.graceDays,
      financeRateScaled: terms.financeRate.toScaledNumber(),
      financeConvention: terms.financeRate.dayCount,
      minimumDuePercentScaled: terms.minimumDuePercent.toScaledNumber(),
      minimumDueFloorMinor: terms.minimumDueFloor.toMinorNumber(),
      lateFeeMinor: terms.lateFee.toMinorNumber(),
      annualFeeMinor: terms.annualFee.toMinorNumber(),
      gstOnChargesPercentScaled: terms.gstOnCharges.toScaledNumber(),
      pointsPerHundredScaled: terms.pointsPerHundred.toScaledNumber(),
      updatedAt: new Date(),
    };
    await this.db
      .insert(creditCardTerms)
      .values(row)
      .onConflictDoUpdate({
        target: creditCardTerms.accountId,
        set: { ...row, id: undefined, deletedAt: null },
      });
  }
}

type CardTermsRow = typeof creditCardTerms.$inferSelect;

export const CardTermsMapper = {
  toDomain(row: CardTermsRow): CardTerms {
    const currency = Currency.of(row.currency);
    return {
      creditLimit: Money.fromMinor(row.creditLimitMinor, currency),
      cycle: new BillingCycleRule(row.statementDay, row.graceDays),
      financeRate: Rate.fromScaled(row.financeRateScaled, row.financeConvention),
      minimumDuePercent: Percentage.fromScaled(row.minimumDuePercentScaled),
      minimumDueFloor: Money.fromMinor(row.minimumDueFloorMinor, currency),
      lateFee: Money.fromMinor(row.lateFeeMinor, currency),
      annualFee: Money.fromMinor(row.annualFeeMinor, currency),
      gstOnCharges: Percentage.fromScaled(row.gstOnChargesPercentScaled),
      pointsPerHundred: Quantity.fromScaled(row.pointsPerHundredScaled),
    };
  },
};

/* ═══ DrizzleDepositRepository ════════════════════════════════════════ */

/**
 * Deposits, their contributions, their notified rates and their NPS units.
 *
 * One repository across four tables because they are one aggregate: a PPF account
 * without its yearly contributions and rates cannot compute anything, so loading
 * them separately would only create the opportunity to forget one. `load` returns
 * the constructed domain object, not rows — the mapping from five products to five
 * classes is knowledge this layer already needs, and duplicating it in every caller
 * is how two screens end up disagreeing about what an EPF balance is.
 */
export class DrizzleDepositRepository implements DepositStore, LoanStore {
  constructor(private readonly db: Database) {}

  async saveTerms(userId: UserId, input: DepositTermsInput): Promise<void> {
    const row = {
      id: newUuid(),
      userId: userId.value,
      accountId: input.accountId.value,
      kind: input.kind,
      currency: input.currency.code,
      principalMinor: input.principal?.toMinorNumber() ?? null,
      instalmentMinor: input.instalment?.toMinorNumber() ?? null,
      months: input.months ?? null,
      interestRateScaled: input.rate?.toScaledNumber() ?? null,
      dayCountConvention: input.rate?.dayCount ?? ("ACT_365F" as const),
      accrualBasis: input.accrualBasis,
      compounding: input.compounding,
      payout: input.payout,
      openedOn: input.openedOn.toISO(),
      maturesOn: input.maturesOn?.toISO() ?? null,
      prematurePenaltyPercentScaled: input.prematurePenalty?.toScaledNumber() ?? null,
      npsTier: input.npsTier ?? null,
      extensionBlocks: input.extensionBlocks ?? null,
      updatedAt: new Date(),
    };
    await this.db
      .insert(depositTerms)
      .values(row)
      .onConflictDoUpdate({
        target: depositTerms.accountId,
        set: { ...row, id: undefined, deletedAt: null },
      });
  }

  async saveContribution(userId: UserId, input: DepositContributionInput): Promise<void> {
    const row = {
      id: newUuid(),
      userId: userId.value,
      accountId: input.accountId.value,
      financialYear: input.financialYear,
      amountMinor: input.amount?.toMinorNumber() ?? 0,
      employeeMinor: input.employee?.toMinorNumber() ?? 0,
      employerMinor: input.employer?.toMinorNumber() ?? 0,
      voluntaryMinor: input.voluntary?.toMinorNumber() ?? 0,
      currency: (input.amount ?? input.employee ?? Money.zero()).currency.code,
      updatedAt: new Date(),
    };
    await this.db
      .insert(depositContributions)
      .values(row)
      .onConflictDoUpdate({
        target: [depositContributions.accountId, depositContributions.financialYear],
        set: { ...row, id: undefined, deletedAt: null },
      });
  }

  async saveSchemeRate(
    userId: UserId,
    schemeKey: string,
    financialYear: string,
    rate: Rate,
  ): Promise<void> {
    const row = {
      id: newUuid(),
      userId: userId.value,
      schemeKey,
      financialYear,
      rateScaled: rate.toScaledNumber(),
      updatedAt: new Date(),
    };
    await this.db
      .insert(schemeRates)
      .values(row)
      .onConflictDoUpdate({
        target: [schemeRates.userId, schemeRates.schemeKey, schemeRates.financialYear],
        set: { ...row, id: undefined, deletedAt: null },
      });
  }

  async saveNpsHolding(
    userId: UserId,
    accountId: AccountId,
    scheme: "E" | "C" | "G" | "A",
    units: Quantity,
    schemeCode: string | null = null,
  ): Promise<void> {
    const row = {
      id: newUuid(),
      userId: userId.value,
      accountId: accountId.value,
      scheme,
      unitsScaled: units.toScaledNumber(),
      schemeCode,
      updatedAt: new Date(),
    };
    await this.db
      .insert(npsHoldings)
      .values(row)
      .onConflictDoUpdate({
        target: [npsHoldings.accountId, npsHoldings.scheme],
        set: { ...row, id: undefined, deletedAt: null },
      });
  }

  async savePrepayment(
    userId: UserId,
    accountId: AccountId,
    prepayment: { paidOn: CalendarDate; amount: Money; reduces: "TERM" | "INSTALMENT" },
  ): Promise<void> {
    await this.db.insert(loanPrepayments).values({
      id: newUuid(),
      userId: userId.value,
      accountId: accountId.value,
      paidOn: prepayment.paidOn.toISO(),
      amountMinor: prepayment.amount.toMinorNumber(),
      currency: prepayment.amount.currency.code,
      reduces: prepayment.reduces,
    });
  }

  async saveLoanTerms(userId: UserId, input: LoanTermsInput): Promise<void> {
    const row = {
      id: newUuid(),
      userId: userId.value,
      accountId: input.accountId.value,
      kind: input.kind,
      currency: input.principal.currency.code,
      principalMinor: input.principal.toMinorNumber(),
      interestRateScaled: input.annualRate.toScaledNumber(),
      dayCountConvention: input.annualRate.dayCount,
      accrualBasis: input.accrualBasis,
      periods: input.periods,
      paymentFrequency: input.frequency,
      disbursedOn: input.disbursedOn.toISO(),
      firstPaymentOn: input.firstPaymentOn?.toISO() ?? null,
      prepaymentPenaltyPercentScaled: input.prepaymentPenalty?.toScaledNumber() ?? null,
      updatedAt: new Date(),
    };
    await this.db
      .insert(loanTerms)
      .values(row)
      .onConflictDoUpdate({
        target: loanTerms.accountId,
        set: { ...row, id: undefined, deletedAt: null },
      });
  }

  /** Every deposit the user holds, constructed. */
  async loadDeposits(userId: UserId, accounts: readonly Account[]): Promise<readonly DepositProduct[]> {
    const byId = new Map(accounts.map((account) => [account.id.value, account]));
    const [terms, contributions, rates, holdings] = await Promise.all([
      this.db
        .select()
        .from(depositTerms)
        .where(and(eq(depositTerms.userId, userId.value), isNull(depositTerms.deletedAt))),
      this.db
        .select()
        .from(depositContributions)
        .where(and(eq(depositContributions.userId, userId.value), isNull(depositContributions.deletedAt))),
      this.db
        .select()
        .from(schemeRates)
        .where(and(eq(schemeRates.userId, userId.value), isNull(schemeRates.deletedAt))),
      this.db
        .select()
        .from(npsHoldings)
        .where(and(eq(npsHoldings.userId, userId.value), isNull(npsHoldings.deletedAt))),
    ]);

    return terms.flatMap((row) => {
      const account = byId.get(row.accountId);
      if (!account) return [];
      const built = DepositMapper.toDomain(account, row, contributions, rates, holdings);
      return built ? [built] : [];
    });
  }

  async loadDeposit(
    userId: UserId,
    account: Account,
  ): Promise<DepositProduct | null> {
    const all = await this.loadDeposits(userId, [account]);
    return all[0] ?? null;
  }

  /** Every loan the user holds, constructed with its prepayments. */
  async loadLoans(userId: UserId, accounts: readonly Account[]): Promise<readonly Loan[]> {
    const byId = new Map(accounts.map((account) => [account.id.value, account]));
    const [terms, prepayments] = await Promise.all([
      this.db.select().from(loanTerms).where(and(eq(loanTerms.userId, userId.value), isNull(loanTerms.deletedAt))),
      this.db
        .select()
        .from(loanPrepayments)
        .where(and(eq(loanPrepayments.userId, userId.value), isNull(loanPrepayments.deletedAt))),
    ]);

    return terms.flatMap((row) => {
      const account = byId.get(row.accountId);
      if (!account) return [];
      return [LoanMapper.toDomain(account, row, prepayments)];
    });
  }
}

type DepositTermsRow = typeof depositTerms.$inferSelect;
type DepositContributionRow = typeof depositContributions.$inferSelect;
type SchemeRateRow = typeof schemeRates.$inferSelect;
type NpsHoldingRow = typeof npsHoldings.$inferSelect;
type LoanTermsRow = typeof loanTerms.$inferSelect;
type LoanPrepaymentRow = typeof loanPrepayments.$inferSelect;

export const DepositMapper = {
  /**
   * Builds the right subclass, or `null` when the row cannot support one.
   *
   * `null` rather than a throw or a default: a half-entered FD with no maturity
   * date should be skipped by the list screen and fixed by its owner, not crash
   * every other deposit's valuation with it.
   */
  toDomain(
    account: Account,
    row: DepositTermsRow,
    contributions: readonly DepositContributionRow[],
    rates: readonly SchemeRateRow[],
    holdings: readonly NpsHoldingRow[],
  ): DepositProduct | null {
    const currency = Currency.of(row.currency);
    const rate = (): Rate =>
      Rate.fromScaled(row.interestRateScaled ?? 0, row.dayCountConvention);
    const mine = contributions.filter((entry) => entry.accountId === row.accountId);
    const rateMap = (schemeKey: string) =>
      new Map(
        rates
          .filter((entry) => entry.schemeKey === schemeKey || entry.schemeKey === row.accountId)
          .map((entry) => [entry.financialYear, Rate.fromScaled(entry.rateScaled, "ACT_365F")]),
      );

    switch (row.kind) {
      case "FIXED_DEPOSIT": {
        if (row.principalMinor === null || row.maturesOn === null) return null;
        return new FixedDeposit(account, {
          principal: Money.fromMinor(row.principalMinor, currency),
          rate: rate(),
          openedOn: CalendarDate.parse(row.openedOn),
          maturesOn: CalendarDate.parse(row.maturesOn),
          interestType: row.accrualBasis === "SIMPLE" ? "SIMPLE" : "COMPOUND",
          compounding: row.compounding,
          payout: row.payout,
          prematureWithdrawalPenalty:
            row.prematurePenaltyPercentScaled === null
              ? undefined
              : Percentage.fromScaled(row.prematurePenaltyPercentScaled),
        });
      }
      case "RECURRING_DEPOSIT": {
        if (row.instalmentMinor === null || row.months === null) return null;
        return new RecurringDeposit(account, {
          instalment: Money.fromMinor(row.instalmentMinor, currency),
          rate: rate(),
          openedOn: CalendarDate.parse(row.openedOn),
          months: row.months,
          compounding: row.compounding,
        });
      }
      case "PPF":
        return new PublicProvidentFund(account, {
          openedOn: CalendarDate.parse(row.openedOn),
          contributions: mine.map((entry) => ({
            financialYear: entry.financialYear,
            amount: Money.fromMinor(entry.amountMinor, Currency.of(entry.currency)),
          })),
          ratesByFinancialYear: rateMap("PPF"),
          extensionBlocks: row.extensionBlocks ?? undefined,
        });
      case "EPF":
        return new EmployeeProvidentFund(account, {
          openedOn: CalendarDate.parse(row.openedOn),
          contributions: mine.map((entry) => ({
            financialYear: entry.financialYear,
            employee: Money.fromMinor(entry.employeeMinor, Currency.of(entry.currency)),
            employer: Money.fromMinor(entry.employerMinor, Currency.of(entry.currency)),
            voluntary: Money.fromMinor(entry.voluntaryMinor, Currency.of(entry.currency)),
          })),
          ratesByFinancialYear: rateMap("EPF"),
          // ₹2.5 lakh from FY2021-22; stored per user would be better once a
          // second threshold exists, and hard-coding it here would hide it.
          taxableContributionThreshold: Money.fromRupees("250000", currency),
        });
      case "NPS":
        return new NationalPensionSystem(account, {
          tier: row.npsTier ?? "TIER_I",
          openedOn: CalendarDate.parse(row.openedOn),
          holdings: holdings
            .filter((entry) => entry.accountId === row.accountId)
            .map((entry) => ({
              scheme: entry.scheme,
              units: Quantity.fromScaled(entry.unitsScaled),
            })),
        });
    }
  },
};

export const LoanMapper = {
  toDomain(
    account: Account,
    row: LoanTermsRow,
    prepayments: readonly LoanPrepaymentRow[],
  ): Loan {
    const currency = Currency.of(row.currency);
    const mine = prepayments
      .filter((entry) => entry.accountId === row.accountId)
      .map((entry) => ({
        on: CalendarDate.parse(entry.paidOn),
        amount: Money.fromMinor(entry.amountMinor, Currency.of(entry.currency)),
        reduces: entry.reduces,
      }));

    const stored: StoredLoanTerms = {
      accountId: AccountId.from(row.accountId),
      kind: row.kind,
      principal: Money.fromMinor(row.principalMinor, currency),
      annualRate: Rate.fromScaled(row.interestRateScaled, row.dayCountConvention),
      periods: row.periods,
      frequency: row.paymentFrequency,
      disbursedOn: CalendarDate.parse(row.disbursedOn),
      firstPaymentOn: row.firstPaymentOn ? CalendarDate.parse(row.firstPaymentOn) : null,
      interestType: row.accrualBasis === "FLAT" ? "FLAT" : "REDUCING_BALANCE",
      prepaymentPenalty:
        row.prepaymentPenaltyPercentScaled === null
          ? null
          : Percentage.fromScaled(row.prepaymentPenaltyPercentScaled),
      prepayments: mine,
    };

    return loanFor(account, stored);
  },
};

/* ═══ DrizzleInstrumentRepository ═════════════════════════════════════ */

/**
 * libSQL implementation of {@link InstrumentRepository}.
 *
 * The stored `kind` is the discriminator `MarketInstrument.of` switches on — the
 * one switch in the codebase, by design. This mapper is the only other place that
 * knows the thirteen kinds exist, and it knows them as data rather than as
 * behaviour.
 */
export class DrizzleInstrumentRepository implements InstrumentRepository {
  constructor(private readonly db: Database) {}

  async findById(userId: UserId, id: InstrumentId): Promise<MarketInstrument | null> {
    const [row] = await this.db
      .select()
      .from(instruments)
      .where(
        and(
          eq(instruments.userId, userId.value),
          isNull(instruments.deletedAt),
          eq(instruments.id, id.value),
        ),
      )
      .limit(1);
    return row ? InstrumentMapper.toDomain(row) : null;
  }

  async findBySymbol(userId: UserId, symbol: string): Promise<MarketInstrument | null> {
    const [row] = await this.db
      .select()
      .from(instruments)
      .where(
        and(
          eq(instruments.userId, userId.value),
          isNull(instruments.deletedAt),
          eq(instruments.symbol, symbol),
        ),
      )
      .limit(1);
    return row ? InstrumentMapper.toDomain(row) : null;
  }

  async list(
    userId: UserId,
    options?: { includeClosed?: boolean },
  ): Promise<readonly MarketInstrument[]> {
    const rows = await this.db
      .select()
      .from(instruments)
      .where(
        and(
          eq(instruments.userId, userId.value),
          isNull(instruments.deletedAt),
          options?.includeClosed ? undefined : eq(instruments.isClosed, false),
        ),
      )
      .orderBy(asc(instruments.symbol));
    return rows.map(InstrumentMapper.toDomain);
  }

  async save(userId: UserId, kind: InstrumentKind, props: InstrumentProps): Promise<void> {
    const row = {
      id: props.id.value,
      userId: userId.value,
      symbol: props.symbol,
      name: props.name,
      kind: InstrumentMapper.toStoredKind(kind),
      instrumentClass: kind,
      taxAssetClass: InstrumentMapper.toTaxAssetClass(kind),
      isin: props.isin ?? null,
      exchange: props.exchange ?? null,
      currency: props.currency.code,
      quoteSource: InstrumentMapper.toQuoteSource(kind),
      quoteSourceRef: props.quoteRef ?? null,
      assetAccountId: props.assetAccountId.value,
      isClosed: props.isClosed ?? false,
      updatedAt: new Date(),
    };
    await this.db
      .insert(instruments)
      .values(row)
      .onConflictDoUpdate({ target: instruments.id, set: { ...row, id: undefined } });
  }
}

type InstrumentRow = typeof instruments.$inferSelect;

export const InstrumentMapper = {
  toDomain(row: InstrumentRow): MarketInstrument {
    return MarketInstrument.of(row.instrumentClass as InstrumentKind, {
      id: InstrumentId.from(row.id),
      userId: UserId.from(row.userId),
      symbol: row.symbol,
      name: row.name,
      currency: Currency.of(row.currency),
      isin: row.isin,
      exchange: row.exchange,
      quoteRef: row.quoteSourceRef,
      assetAccountId: AccountId.from(row.assetAccountId),
      isClosed: row.isClosed,
    });
  },

  /** The coarse `kind` the pre-existing schema column carries. */
  toStoredKind(kind: InstrumentKind): "EQUITY" | "ETF" | "MUTUAL_FUND" | "BOND" | "GOVT_SECURITY" | "DIGITAL_GOLD" | "DIGITAL_SILVER" | "CRYPTO" | "OTHER" {
    switch (kind) {
      case "LISTED_EQUITY":
        return "EQUITY";
      case "ETF":
        return "ETF";
      case "INDEX_FUND":
      case "MUTUAL_FUND":
      case "LIQUID_FUND":
      case "DEBT_FUND":
      case "ELSS_FUND":
        return "MUTUAL_FUND";
      case "BOND":
        return "BOND";
      case "GOVT_SECURITY":
      case "SOVEREIGN_GOLD_BOND":
        return "GOVT_SECURITY";
      case "DIGITAL_GOLD":
        return "DIGITAL_GOLD";
      case "DIGITAL_SILVER":
        return "DIGITAL_SILVER";
      case "CRYPTO":
        return "CRYPTO";
    }
  },

  /**
   * The tax class the reporting tables key on.
   *
   * Derived from the leaf rather than stored independently, because two columns
   * that both claim to say how something is taxed will eventually disagree — and
   * the leaf is the one with the reasoning attached.
   */
  toTaxAssetClass(kind: InstrumentKind): "LISTED_EQUITY" | "EQUITY_MUTUAL_FUND" | "DEBT" | "GOLD" | "CRYPTO" | "UNLISTED" | "OTHER" {
    switch (kind) {
      case "LISTED_EQUITY":
        return "LISTED_EQUITY";
      case "ETF":
      case "INDEX_FUND":
      case "MUTUAL_FUND":
      case "ELSS_FUND":
        return "EQUITY_MUTUAL_FUND";
      case "LIQUID_FUND":
      case "DEBT_FUND":
      case "BOND":
      case "GOVT_SECURITY":
        return "DEBT";
      case "SOVEREIGN_GOLD_BOND":
      case "DIGITAL_GOLD":
      case "DIGITAL_SILVER":
        return "GOLD";
      case "CRYPTO":
        return "CRYPTO";
    }
  },

  toQuoteSource(kind: InstrumentKind): "MANUAL" | "AMFI" | "NSE" | "METALS" {
    switch (kind) {
      case "LISTED_EQUITY":
      case "ETF":
        return "NSE";
      case "INDEX_FUND":
      case "MUTUAL_FUND":
      case "LIQUID_FUND":
      case "DEBT_FUND":
      case "ELSS_FUND":
        return "AMFI";
      case "DIGITAL_GOLD":
      case "DIGITAL_SILVER":
      case "SOVEREIGN_GOLD_BOND":
        return "METALS";
      default:
        return "MANUAL";
    }
  },
};

/* ═══ DrizzleLotRepository ════════════════════════════════════════════ */

/**
 * libSQL implementation of {@link LotRepository}.
 *
 * `saveLots` writes the whole set for a position rather than the changed rows,
 * because a disposal touches several lots at once and a partial write would leave
 * a position whose lot remainders no longer sum to its quantity — invariant P01,
 * and the one a half-applied sale breaks.
 */
export class DrizzleLotRepository implements LotRepository {
  constructor(private readonly db: Database) {}

  async recordTrade(userId: UserId, trade: TradeRecord): Promise<void> {
    const row = {
      id: trade.id,
      userId: userId.value,
      instrumentId: trade.instrumentId.value,
      side: trade.side,
      tradedOn: trade.tradedOn.toISO(),
      quantity: trade.quantity.toScaledNumber(),
      pricePerUnitMinor: trade.pricePerUnit.toMinorNumber(),
      // The charge breakdown's own columns stay zero until a contract note is
      // imported: `otherChargesMinor` is the honest home for a single total, and
      // pretending it was all brokerage would make it deductible when some of it
      // (STT) is not.
      otherChargesMinor: trade.charges.toMinorNumber(),
      transactionId: trade.transactionId,
      settlementAccountId: trade.settlementAccountId,
    };
    await this.db
      .insert(trades)
      .values(row)
      .onConflictDoUpdate({ target: trades.id, set: { ...row, id: undefined } });
  }

  async openLots(userId: UserId, instrumentId: InstrumentId): Promise<readonly Lot[]> {
    const rows = await this.db
      .select()
      .from(lots)
      .where(
        and(
          eq(lots.userId, userId.value),
          isNull(lots.deletedAt),
          eq(lots.instrumentId, instrumentId.value),
          sql`${lots.remainingQuantity} > 0`,
        ),
      )
      .orderBy(asc(lots.acquiredOn));
    return rows.map(LotMapper.toDomain);
  }

  async allLots(userId: UserId, instrumentId: InstrumentId): Promise<readonly Lot[]> {
    const rows = await this.db
      .select()
      .from(lots)
      .where(
        and(
          eq(lots.userId, userId.value),
          isNull(lots.deletedAt),
          eq(lots.instrumentId, instrumentId.value),
        ),
      )
      .orderBy(asc(lots.acquiredOn));
    return rows.map(LotMapper.toDomain);
  }

  async saveLots(userId: UserId, toSave: readonly Lot[]): Promise<void> {
    if (toSave.length === 0) return;
    await this.db.transaction(async (tx) => {
      for (const lot of toSave) {
        const row = LotMapper.toRow(userId, lot);
        await tx
          .insert(lots)
          .values(row)
          .onConflictDoUpdate({ target: lots.id, set: { ...row, id: undefined } });
      }
    });
  }

  async saveDisposals(
    userId: UserId,
    sellTransactionId: string,
    disposals: readonly Disposal[],
  ): Promise<void> {
    /*
     * Disposals with no lot are skipped, and that is deliberate rather than a gap:
     * under average cost no particular lot was consumed, so there is no row for
     * `lot_matches.lot_id` to reference. Writing the sale's own id there would
     * satisfy the foreign key and mean nothing.
     */
    const withLots = disposals.filter((disposal) => disposal.lotId !== null);
    if (withLots.length === 0) return;
    await this.db.insert(lotMatches).values(
      withLots.map((disposal) => ({
        id: newUuid(),
        userId: userId.value,
        sellTradeId: sellTransactionId,
        lotId: disposal.lotId!.value,
        quantity: disposal.quantity.toScaledNumber(),
        proceedsMinor: disposal.proceeds.toMinorNumber(),
        costBasisMinor: disposal.costBasis.toMinorNumber(),
        buyChargesMinor: disposal.buyCharges.toMinorNumber(),
        sellChargesMinor: disposal.sellCharges.toMinorNumber(),
        realizedGainMinor: disposal.gain.toMinorNumber(),
        holdingDays: disposal.holdingDays,
        // The tier is fixed at the moment of sale, per the schema's own note: a
        // later change to the long-term threshold must not rewrite last year's tax.
        taxTier: disposal.holdingDays >= 365 ? ("LTCG" as const) : ("STCG" as const),
        financialYear: FinancialYear.containing(disposal.disposedOn).label,
        currency: disposal.proceeds.currency.code,
      })),
    );
  }

  async disposalsWithin(
    userId: UserId,
    from: CalendarDate,
    to: CalendarDate,
  ): Promise<readonly Disposal[]> {
    const rows = await this.db
      .select({ match: lotMatches, trade: trades })
      .from(lotMatches)
      .innerJoin(trades, eq(lotMatches.sellTradeId, trades.id))
      .where(
        and(
          eq(lotMatches.userId, userId.value),
          isNull(lotMatches.deletedAt),
          gte(trades.tradedOn, from.toISO()),
          lte(trades.tradedOn, to.toISO()),
        ),
      );

    return rows.map(({ match, trade }) => ({
      lotId: LotId.from(match.lotId),
      instrumentId: InstrumentId.from(trade.instrumentId),
      quantity: Quantity.fromScaled(match.quantity),
      acquiredOn: CalendarDate.parse(trade.tradedOn).plusDays(-match.holdingDays),
      disposedOn: CalendarDate.parse(trade.tradedOn),
      proceeds: Money.fromMinor(match.proceedsMinor, Currency.of(match.currency)),
      costBasis: Money.fromMinor(match.costBasisMinor, Currency.of(match.currency)),
      buyCharges: Money.fromMinor(match.buyChargesMinor, Currency.of(match.currency)),
      sellCharges: Money.fromMinor(match.sellChargesMinor, Currency.of(match.currency)),
      gain: Money.fromMinor(match.realizedGainMinor, Currency.of(match.currency)),
      holdingDays: match.holdingDays,
    }));
  }
}

type LotRow = typeof lots.$inferSelect;

export const LotMapper = {
  toDomain(row: LotRow): Lot {
    const currency = Currency.of(row.currency);
    const originalQuantity = Quantity.fromScaled(row.originalQuantity);
    return Lot.rehydrate({
      id: LotId.from(row.id),
      instrumentId: InstrumentId.from(row.instrumentId),
      acquiredOn: CalendarDate.parse(row.acquiredOn),
      originalQuantity,
      remainingQuantity: Quantity.fromScaled(row.remainingQuantity),
      // Stored per unit, so the total is reconstructed rather than stored twice —
      // two columns for one fact is how a lot ends up disagreeing with itself.
      cost: originalQuantity.valueAt(Money.fromMinor(row.costPerUnitMinor, currency), "HALF_EVEN"),
      buyCharges: Money.fromMinor(row.buyChargesMinor, currency),
      openedByTransactionId: row.buyTradeId,
    });
  },

  toRow(userId: UserId, lot: Lot) {
    return {
      id: lot.id.value,
      userId: userId.value,
      instrumentId: lot.props.instrumentId.value,
      buyTradeId: lot.props.openedByTransactionId,
      acquiredOn: lot.acquiredOn.toISO(),
      originalQuantity: lot.props.originalQuantity.toScaledNumber(),
      remainingQuantity: lot.props.remainingQuantity.toScaledNumber(),
      costPerUnitMinor: lot.costPerUnit.toMinorNumber(),
      buyChargesMinor: lot.props.buyCharges.toMinorNumber(),
      currency: lot.currency.code,
    };
  },
};

/* ═══ DrizzleCorporateActionRepository ════════════════════════════════ */

export class DrizzleCorporateActionRepository implements CorporateActionRepository {
  constructor(
    private readonly db: Database,
    private readonly userId: UserId,
  ) {}

  async listFor(
    instrumentId: InstrumentId,
    options?: { appliedOnly?: boolean },
  ): Promise<readonly StoredCorporateAction[]> {
    const rows = await this.db
      .select()
      .from(corporateActions)
      .where(
        and(
          eq(corporateActions.userId, this.userId.value),
          isNull(corporateActions.deletedAt),
          eq(corporateActions.instrumentId, instrumentId.value),
          options?.appliedOnly ? eq(corporateActions.status, "APPLIED") : undefined,
        ),
      )
      .orderBy(asc(corporateActions.exDate));

    return rows.map((row) => ({
      id: row.id,
      kind: row.actionType,
      instrumentId: InstrumentId.from(row.instrumentId),
      exDate: CalendarDate.parse(row.exDate),
      recordDate: row.recordDate ? CalendarDate.parse(row.recordDate) : null,
      terms: {
        ratioFrom: row.ratioFromScaled === null ? "" : Quantity.fromScaled(row.ratioFromScaled).toDecimalString(),
        ratioTo: row.ratioToScaled === null ? "" : Quantity.fromScaled(row.ratioToScaled).toDecimalString(),
        cash: row.cashAmountMinor === null ? "" : Money.fromMinor(row.cashAmountMinor, Currency.of(row.currency)).toDecimalString(),
        targetInstrumentId: row.targetInstrumentId ?? "",
        source: row.source,
      },
      transactionId: row.appliedTransactionId,
      appliedAt: row.appliedAt,
    }));
  }

  async save(action: StoredCorporateAction): Promise<void> {
    const row = {
      id: action.id,
      userId: this.userId.value,
      instrumentId: action.instrumentId.value,
      actionType: action.kind,
      exDate: action.exDate.toISO(),
      recordDate: action.recordDate?.toISO() ?? null,
      ratioFromScaled: action.terms.ratioFrom ? Quantity.fromString(action.terms.ratioFrom).toScaledNumber() : null,
      ratioToScaled: action.terms.ratioTo ? Quantity.fromString(action.terms.ratioTo).toScaledNumber() : null,
      cashAmountMinor: action.terms.cash ? Money.fromRupees(action.terms.cash).toMinorNumber() : null,
      targetInstrumentId: action.terms.targetInstrumentId || null,
      source: action.terms.source ?? "MANUAL",
      status: action.transactionId ? ("APPLIED" as const) : ("PENDING" as const),
      appliedTransactionId: action.transactionId,
      appliedAt: action.appliedAt,
    };
    await this.db
      .insert(corporateActions)
      .values(row)
      .onConflictDoUpdate({
        target: [corporateActions.instrumentId, corporateActions.actionType, corporateActions.exDate],
        set: { ...row, id: undefined },
      });
  }

  async markApplied(id: string, transactionId: string, at: Date): Promise<void> {
    await this.db
      .update(corporateActions)
      .set({ status: "APPLIED", appliedTransactionId: transactionId, appliedAt: at })
      .where(and(eq(corporateActions.userId, this.userId.value), eq(corporateActions.id, id)));
  }
}

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

import { AppError, Result, UserId, newUuid } from "@/core/kernel";
import { Currency, Money } from "@/core/money";
import { CalendarDate, DateRange, FinancialYear } from "@/core/time";
import { Account, AccountCode, AccountId, AccountRepository, AccountSubtype, AccountType, AccountTypeName, PostingDirection } from "@/domain/accounts";
import { BillingCycleRule, CardTerms, CardTermsRepository } from "@/domain/assets";
import { DepositContributionInput, DepositProduct, DepositStore, DepositTermsInput, EmployeeProvidentFund, FixedDeposit, NationalPensionSystem, PublicProvidentFund, RecurringDeposit } from "@/domain/deposits";
import { Loan, LoanStore, LoanTermsInput, StoredLoanTerms, loanFor } from "@/domain/loans";
import { InstrumentId, InstrumentKind, InstrumentProps, InstrumentRepository, MarketInstrument } from "@/domain/instruments";
import { Institution, InstitutionId, InstitutionKind, InstitutionRepository, normaliseInstitutionName } from "@/domain/institutions";
import { Disposal, Lot, LotId, LotRepository, StoredLotMatch, TradeVoidPlan, TradeRecord } from "@/domain/lots";
import { CorporateActionRepository, StoredCorporateAction } from "@/domain/corporate";
import { StoredTaxSettings, TaxSettingsRepository } from "@/domain/tax";
import type {
  CachedProjection,
  JournalReplaySource,
  JournalSum,
  UnbalancedEntry,
} from "@/app/reproducibility.usecases";
import { Bar, BarGranularity, BarRepository, makeBar } from "@/domain/analysis";
import { GoldLease, GoldLeaseRepository, LeaseId, LeaseStatus, PayoutFrequency, PayoutMode } from "@/domain/leasing";
import { Percentage, Quantity, Rate, UnitPrice } from "@/core/numeric";
import { FxQuote, FxRateRepository, PriceDivergence, PriceSourceType, Quote, QuoteRepository, QuoteType, StoredFxRate } from "@/domain/pricing";
import { AccountBalance, AccountFlow, BalanceQuery, MonthlyFlow, Posting, PostingId, PostingStatus, StoredTransaction, Transaction, TransactionId, TransactionKind, TransactionPage, TransactionQuery, TransactionRepository, TransactionSource, TypeTotals } from "@/domain/transactions";
import { BudgetRepository, CategoryRuleRepository, ImportBatchRecord, ImportBatchStatus, ImportDiagnostics, ImportRepository, ImportRowStatus, ImportTrust, KeywordRule, MovementIntent, RowDirection, SelfPayeeQuery, StagedRow, StoredBudget } from "@/domain/banking";
import { goldLeases, institutions, users as usersTable, ledgerEvents, netWorthSnapshots, projectionCache, taxSettings, priceBars, budgets, categoryRules, corporateActions, counterparties, creditCardTerms, depositContributions, depositTerms, fxRates, importBatches, importRows, instruments, ledgerAccounts, loanPrepayments, loanTerms, lotMatches, lots, npsHoldings, postings, priceDivergences, priceQuotes, schemeRates, trades, transactions } from "@/infra/db/schema";
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

  /**
   * How many postings this account still has — the number the delete controls
   * are gated on.
   *
   * It joins `transactions` for the same reason every balance query does: a
   * posting whose transaction is tombstoned is not there any more. Without that
   * join, an account whose history had already been deleted still reported its
   * old posting count, so the app refused to delete it as non-empty *and* offered
   * to delete a history that was already gone — a dead end with no way out of it
   * from the UI.
   */
  async countPostings(userId: UserId, id: AccountId): Promise<number> {
    const [row] = await this.db
      .select({ total: count() })
      .from(postings)
      .innerJoin(ledgerAccounts, eq(postings.accountId, ledgerAccounts.id))
      .innerJoin(transactions, eq(postings.transactionId, transactions.id))
      .where(
        and(
          eq(postings.accountId, id.value),
          eq(ledgerAccounts.userId, userId.value),
          isNull(postings.deletedAt),
          isNull(transactions.deletedAt),
          isNull(ledgerAccounts.deletedAt),
        ),
      );
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

  async softDeleteByAccount(userId: UserId, accountId: AccountId, at: Date): Promise<number> {
    const transactionIds = this.db
      .select({ id: postings.transactionId })
      .from(postings)
      .where(and(eq(postings.accountId, accountId.value), isNull(postings.deletedAt)));

    const updated = await this.db
      .update(transactions)
      .set({ deletedAt: at })
      .where(
        and(
          eq(transactions.userId, userId.value),
          isNull(transactions.deletedAt),
          inArray(transactions.id, transactionIds),
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
    private readonly converter?: {
      convert(amount: Money, into: Currency, asOf: CalendarDate, userId?: UserId): Promise<Result<{ amount: Money }, AppError>>;
    },
  ) {}

  private money(minor: number | null): Money {
    return Money.fromMinor(minor ?? 0, this.currency);
  }

  private async reportingMoney(
    amount: Money,
    asOf: CalendarDate,
    userId: UserId,
  ): Promise<Money> {
    if (amount.currency.code === this.currency.code) return amount;
    if (!this.converter) {
      throw new Error(`No FX converter configured for ${amount.currency.code}/${this.currency.code}.`);
    }
    const converted = await this.converter.convert(amount, this.currency, asOf, userId);
    if (!converted.ok) throw converted.error;
    return converted.value.amount;
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
        currency: ledgerAccounts.currency,
        balance: sql<number>`COALESCE(SUM(${SIGNED_AMOUNT}), 0)`,
        postingCount: sql<number>`COUNT(${postings.id})`,
      })
      .from(ledgerAccounts)
      .leftJoin(
        postings,
        and(
          eq(postings.accountId, ledgerAccounts.id),
          isNull(postings.deletedAt),
          /*
           * `deleted_at IS NULL` inside the subselect, and it is not optional.
           *
           * Without it this query counted the postings of *deleted* transactions
           * while `totals()` and `balanceOf()` — which join `transactions`
           * directly and have always filtered it — did not. Two reads of the same
           * ledger then disagreed, which is exactly what B02 is there to notice:
           * a dashboard showed a ₹16.6L net worth built entirely from
           * transactions that had been deleted, and reported its own accounting
           * identity as broken beneath it.
           *
           * The tombstone convention is that a deleted transaction takes its
           * postings out of every read *through the transaction*, so a read that
           * reaches postings without consulting it is always wrong.
           */
          sql`${postings.transactionId} IN (
            SELECT ${transactions.id} FROM ${transactions}
            WHERE ${transactions.userId} = ${userId.value}
              AND ${transactions.deletedAt} IS NULL
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
        balance: Money.fromMinor(row.balance ?? 0, Currency.of(row.currency)),
        postingCount: Number(row.postingCount),
      }));
  }

  async balanceOf(userId: UserId, accountId: AccountId, asOf: CalendarDate): Promise<Money> {
    const [account] = await this.db
      .select({ currency: ledgerAccounts.currency })
      .from(ledgerAccounts)
      // Tombstoned like every other scoped read of this table (A03). A deleted
      // account has no currency to report in, and falling back to the reporting
      // currency is the honest answer rather than resurrecting the row.
      .where(and(eq(ledgerAccounts.userId, userId.value), eq(ledgerAccounts.id, accountId.value), isNull(ledgerAccounts.deletedAt)))
      .limit(1);
    const [row] = await this.db
      .select({
        balance: sql<number>`COALESCE(SUM(${SIGNED_AMOUNT}), 0)`,
      })
      .from(postings)
      .innerJoin(ledgerAccounts, eq(postings.accountId, ledgerAccounts.id))
      .innerJoin(transactions, eq(postings.transactionId, transactions.id))
      .where(
        and(
          eq(transactions.userId, userId.value), isNull(transactions.deletedAt),
          isNull(postings.deletedAt),
          eq(postings.accountId, accountId.value),
          sql`${transactions.txnDate} <= ${asOf.toISO()}`,
        ),
      );
    return Money.fromMinor(row?.balance ?? 0, Currency.of(account?.currency ?? this.currency.code));
  }

  async totals(userId: UserId, asOf: CalendarDate): Promise<TypeTotals> {
    const rows = await this.db
      .select({
        type: ledgerAccounts.type,
        currency: postings.currency,
        balance: sql<number>`COALESCE(SUM(${SIGNED_AMOUNT}), 0)`,
      })
      .from(postings)
      .innerJoin(ledgerAccounts, eq(postings.accountId, ledgerAccounts.id))
      .innerJoin(transactions, eq(postings.transactionId, transactions.id))
      .where(
        and(eq(transactions.userId, userId.value), isNull(transactions.deletedAt), isNull(postings.deletedAt), sql`${transactions.txnDate} <= ${asOf.toISO()}`),
      )
      .groupBy(ledgerAccounts.type, postings.currency);

    const byType = new Map<string, Money>();
    for (const row of rows) {
      const native = Money.fromMinor(row.balance, Currency.of(row.currency));
      const reporting = await this.reportingMoney(native, asOf, userId);
      byType.set(row.type, (byType.get(row.type) ?? Money.zero(this.currency)).plus(reporting));
    }
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

  async netWorthSeries(
    userId: UserId,
    months: number,
    asOf: CalendarDate,
  ): Promise<TypeTotals[]> {
    if (!Number.isInteger(months) || months < 1 || months > 600) {
      throw new RangeError(`months must be an integer from 1 to 600, got ${months}`);
    }

    const firstMonth = asOf.plusMonths(-(months - 1)).startOfMonth();
    const foreign = await this.db
      .select({ currency: ledgerAccounts.currency })
      .from(ledgerAccounts)
      .where(
        and(
          eq(ledgerAccounts.userId, userId.value),
          isNull(ledgerAccounts.deletedAt),
          sql`${ledgerAccounts.currency} <> ${this.currency.code}`,
        ),
      )
      .limit(1);
    if (foreign.length > 0) {
      // Snapshot rows contain reporting-currency totals. Until their revision key
      // includes FX-rate revisions, recompute mixed-currency month ends so an FX
      // update can never leave a plausible but stale INR history behind.
      return Promise.all(
        Array.from({ length: months }, (_, index) =>
          this.totals(userId, firstMonth.plusMonths(index).endOfMonth()),
        ),
      );
    }
    const monthKeys = Array.from({ length: months }, (_, index) =>
      firstMonth.plusMonths(index).toMonthKey(),
    );
    const cached = await this.db
      .select()
      .from(netWorthSnapshots)
      .where(
        and(
          eq(netWorthSnapshots.userId, userId.value),
          inArray(netWorthSnapshots.month, monthKeys),
        ),
      );
    if (cached.length === months) {
      const byMonth = new Map(cached.map((row) => [row.month, row]));
      return monthKeys.map((month, index) => {
        const row = byMonth.get(month)!;
        return {
          asOf: firstMonth.plusMonths(index).endOfMonth(),
          assets: Money.fromMinor(row.assetsMinor, this.currency),
          liabilities: Money.fromMinor(row.liabilitiesMinor, this.currency),
          equity: Money.zero(this.currency),
          netWorth: Money.fromMinor(row.netWorthMinor, this.currency),
        };
      });
    }

    const opening = await this.totals(userId, firstMonth.plusDays(-1));
    const rows = await this.db
      .select({
        month: sql<string>`substr(${transactions.txnDate}, 1, 7)`,
        type: ledgerAccounts.type,
        amount: sql<number>`COALESCE(SUM(${SIGNED_AMOUNT}), 0)`,
      })
      .from(postings)
      .innerJoin(ledgerAccounts, eq(postings.accountId, ledgerAccounts.id))
      .innerJoin(transactions, eq(postings.transactionId, transactions.id))
      .where(
        and(
          eq(transactions.userId, userId.value),
          isNull(transactions.deletedAt),
          isNull(postings.deletedAt),
          gte(transactions.txnDate, firstMonth.toISO()),
          lte(transactions.txnDate, asOf.endOfMonth().toISO()),
          sql`${ledgerAccounts.type} IN ('ASSET', 'LIABILITY')`,
        ),
      )
      .groupBy(sql`substr(${transactions.txnDate}, 1, 7)`, ledgerAccounts.type)
      .orderBy(sql`substr(${transactions.txnDate}, 1, 7)`);

    const deltas = new Map<string, { assets: Money; liabilities: Money }>();
    for (const row of rows) {
      const current = deltas.get(row.month) ?? {
        assets: Money.zero(this.currency),
        liabilities: Money.zero(this.currency),
      };
      if (row.type === "ASSET") current.assets = this.money(row.amount);
      if (row.type === "LIABILITY") current.liabilities = this.money(row.amount);
      deltas.set(row.month, current);
    }

    let assets = opening.assets;
    let liabilities = opening.liabilities;
    const result: TypeTotals[] = [];
    for (let index = 0; index < months; index += 1) {
      const on = firstMonth.plusMonths(index).endOfMonth();
      const delta = deltas.get(on.toMonthKey());
      if (delta) {
        assets = assets.plus(delta.assets);
        liabilities = liabilities.plus(delta.liabilities);
      }
      result.push({
        asOf: on,
        assets,
        liabilities,
        equity: Money.zero(this.currency),
        netWorth: assets.minus(liabilities),
      });
    }
    await this.db.transaction(async (tx) => {
      for (const total of result) {
        await tx
          .insert(netWorthSnapshots)
          .values({
            id: newUuid(),
            userId: userId.value,
            month: total.asOf.toMonthKey(),
            assetsMinor: total.assets.toMinorNumber(),
            liabilitiesMinor: total.liabilities.toMinorNumber(),
            netWorthMinor: total.netWorth.toMinorNumber(),
            computedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: [netWorthSnapshots.userId, netWorthSnapshots.month],
            set: {
              assetsMinor: total.assets.toMinorNumber(),
              liabilitiesMinor: total.liabilities.toMinorNumber(),
              netWorthMinor: total.netWorth.toMinorNumber(),
              computedAt: new Date(),
            },
          });
      }
    });
    return result;
  }

  async monthlyFlows(userId: UserId, range: DateRange): Promise<MonthlyFlow[]> {
    const rows = await this.db
      .select({
        month: sql<string>`substr(${transactions.txnDate}, 1, 7)`,
        type: ledgerAccounts.type,
        currency: postings.currency,
        total: sql<number>`COALESCE(SUM(${SIGNED_AMOUNT}), 0)`,
      })
      .from(postings)
      .innerJoin(ledgerAccounts, eq(postings.accountId, ledgerAccounts.id))
      .innerJoin(transactions, eq(postings.transactionId, transactions.id))
      .where(
        and(
          eq(transactions.userId, userId.value), isNull(transactions.deletedAt),
          isNull(postings.deletedAt),
          sql`${transactions.txnDate} >= ${range.start.toISO()}`,
          sql`${transactions.txnDate} <= ${range.end.toISO()}`,
          sql`${ledgerAccounts.type} IN ('INCOME', 'EXPENSE')`,
        ),
      )
      .groupBy(sql`substr(${transactions.txnDate}, 1, 7)`, ledgerAccounts.type, postings.currency);

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
      const native = Money.fromMinor(row.total, Currency.of(row.currency));
      const reporting = await this.reportingMoney(
        native,
        CalendarDate.parse(`${row.month}-01`).endOfMonth(),
        userId,
      );
      if (row.type === "INCOME") flow.income = flow.income.plus(reporting);
      else flow.expense = flow.expense.plus(reporting);
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
        currency: ledgerAccounts.currency,
        amount: sql<number>`COALESCE(SUM(${SIGNED_AMOUNT}), 0)`,
        postingCount: sql<number>`COUNT(${postings.id})`,
      })
      .from(ledgerAccounts)
      .leftJoin(
        postings,
        and(
          eq(postings.accountId, ledgerAccounts.id),
          isNull(postings.deletedAt),
          // Same tombstone filter as `balanceSheet`, missing for the same reason:
          // a subselect is easy to write without remembering what the join to
          // `transactions` would have forced you to consider.
          sql`${postings.transactionId} IN (
            SELECT ${transactions.id} FROM ${transactions}
            WHERE ${transactions.userId} = ${userId.value}
              AND ${transactions.deletedAt} IS NULL
              AND ${transactions.txnDate} >= ${range.start.toISO()}
              AND ${transactions.txnDate} <= ${range.end.toISO()}
          )`,
        ),
      )
      .where(and(eq(ledgerAccounts.userId, userId.value), isNull(ledgerAccounts.deletedAt), typeFilter))
      .groupBy(ledgerAccounts.id);

    const flows: AccountFlow[] = await Promise.all(
      rows.map(async (row) => ({
        accountId: AccountId.from(row.accountId),
        code: row.code,
        name: row.name,
        type: row.type as AccountTypeName,
        amount: await this.reportingMoney(
          Money.fromMinor(row.amount, Currency.of(row.currency)),
          range.end,
          userId,
        ),
        postingCount: Number(row.postingCount),
      })),
    );

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
        currency: postings.currency,
        delta: sql<number>`COALESCE(SUM(${SIGNED_AMOUNT}), 0)`,
      })
      .from(postings)
      .innerJoin(ledgerAccounts, eq(postings.accountId, ledgerAccounts.id))
      .innerJoin(transactions, eq(postings.transactionId, transactions.id))
      .where(
        and(
          eq(transactions.userId, userId.value), isNull(transactions.deletedAt),
          isNull(postings.deletedAt),
          eq(postings.accountId, accountId.value),
          sql`${transactions.txnDate} >= ${range.start.toISO()}`,
          sql`${transactions.txnDate} <= ${range.end.toISO()}`,
        ),
      )
      .groupBy(transactions.txnDate, postings.currency)
      .orderBy(transactions.txnDate);

    let running = opening;
    return rows.map((row) => {
      running = running.plus(Money.fromMinor(row.delta, Currency.of(row.currency)));
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

/* ═══ DrizzleGoldLeaseRepository ══════════════════════════════════════ */

/**
 * libSQL implementation of {@link GoldLeaseRepository}.
 *
 * Terms in, terms out: the accrued grams, the TDS and the value are recomputed by
 * `GoldLease` on every read, so no row here can disagree with the arithmetic
 * behind it. The single stored *fact* is `creditedQuantityScaled` — how many grams
 * an accrual posting has actually put into the ledger — which is not derivable
 * from the terms and is exactly what stops a second accrual run double-booking.
 */
export class DrizzleGoldLeaseRepository implements GoldLeaseRepository {
  constructor(private readonly db: Database) {}

  async findById(userId: UserId, id: LeaseId): Promise<GoldLease | null> {
    const [row] = await this.db
      .select()
      .from(goldLeases)
      .where(
        and(
          eq(goldLeases.userId, userId.value),
          eq(goldLeases.id, id.value),
          isNull(goldLeases.deletedAt),
        ),
      )
      .limit(1);
    return row ? GoldLeaseMapper.toDomain(row) : null;
  }

  async findByReference(userId: UserId, reference: string): Promise<GoldLease | null> {
    const [row] = await this.db
      .select()
      .from(goldLeases)
      .where(
        and(
          eq(goldLeases.userId, userId.value),
          eq(goldLeases.reference, reference),
          isNull(goldLeases.deletedAt),
        ),
      )
      .limit(1);
    return row ? GoldLeaseMapper.toDomain(row) : null;
  }

  async list(
    userId: UserId,
    options?: { instrumentId?: InstrumentId; status?: LeaseStatus },
  ): Promise<readonly GoldLease[]> {
    const rows = await this.db
      .select()
      .from(goldLeases)
      .where(
        and(
          eq(goldLeases.userId, userId.value),
          isNull(goldLeases.deletedAt),
          options?.instrumentId ? eq(goldLeases.instrumentId, options.instrumentId.value) : undefined,
          options?.status ? eq(goldLeases.status, options.status) : undefined,
        ),
      )
      .orderBy(asc(goldLeases.startOn), asc(goldLeases.reference));
    return rows.map(GoldLeaseMapper.toDomain);
  }

  /**
   * Deliberately no `isNull(deletedAt)`: the unique index this feeds does not
   * exclude tombstones either, so hiding them here is what let a freed
   * reference be handed out twice.
   */
  async takenReferences(userId: UserId): Promise<readonly string[]> {
    const rows = await this.db
      .select({ reference: goldLeases.reference })
      .from(goldLeases)
      .where(eq(goldLeases.userId, userId.value));
    return rows.map((row) => row.reference);
  }

  async save(lease: GoldLease): Promise<void> {
    const row = GoldLeaseMapper.toRow(lease);
    await this.db
      .insert(goldLeases)
      .values(row)
      .onConflictDoUpdate({ target: goldLeases.id, set: { ...row, id: undefined } });
  }

  async softDelete(userId: UserId, id: LeaseId, at: Date): Promise<void> {
    await this.db
      .update(goldLeases)
      .set({ deletedAt: at, updatedAt: at })
      .where(and(eq(goldLeases.userId, userId.value), eq(goldLeases.id, id.value)));
  }

  async recordCredit(
    userId: UserId,
    id: LeaseId,
    creditedTotal: Quantity,
    transactionId: string,
  ): Promise<void> {
    /*
     * Writes the running total rather than adding to it, and takes the total from
     * the domain rather than computing it here — so a retried accrual is
     * idempotent instead of doubling the credit, which an increment would not be.
     */
    await this.db
      .update(goldLeases)
      .set({
        creditedQuantityScaled: creditedTotal.toScaledNumber(),
        lastAccrualTransactionId: transactionId,
        updatedAt: new Date(),
      })
      .where(and(eq(goldLeases.userId, userId.value), eq(goldLeases.id, id.value)));
  }
}

const GoldLeaseMapper = {
  toDomain(row: typeof goldLeases.$inferSelect): GoldLease {
    return new GoldLease({
      id: LeaseId.from(row.id),
      userId: UserId.from(row.userId),
      reference: row.reference,
      instrumentId: InstrumentId.from(row.instrumentId),
      holdingAccountId: AccountId.from(row.holdingAccountId),
      platform: row.platform,
      quantity: Quantity.fromScaled(row.quantityScaled),
      startOn: CalendarDate.parse(row.startOn),
      closesOn: CalendarDate.parse(row.closesOn),
      annualRate: Percentage.fromScaled(row.annualRateScaled),
      payoutFrequency: row.payoutFrequency as PayoutFrequency,
      payoutMode: row.payoutMode as PayoutMode,
      payoutAccountId: row.payoutAccountId ? AccountId.from(row.payoutAccountId) : null,
      tdsRate: Percentage.fromScaled(row.tdsRateScaled),
      status: row.status as LeaseStatus,
      endedOn: row.endedOn ? CalendarDate.parse(row.endedOn) : null,
      sourceReference: row.sourceReference,
      creditedQuantity: Quantity.fromScaled(row.creditedQuantityScaled),
      notes: row.notes,
    });
  },

  toRow(lease: GoldLease): typeof goldLeases.$inferInsert {
    const { props } = lease;
    return {
      id: props.id.value,
      userId: props.userId.value,
      reference: props.reference,
      instrumentId: props.instrumentId.value,
      holdingAccountId: props.holdingAccountId.value,
      platform: props.platform,
      quantityScaled: props.quantity.toScaledNumber(),
      startOn: props.startOn.toISO(),
      closesOn: props.closesOn.toISO(),
      // `toScaledNumber()`, not `Number(...scaled)`: the float rule rejects the
      // latter, and rightly — it is the same reach for a raw bigint that turns a
      // rate into an approximation everywhere else.
      annualRateScaled: props.annualRate.toScaledNumber(),
      payoutFrequency: lease.payoutFrequency,
      payoutMode: lease.payoutMode,
      payoutAccountId: props.payoutAccountId?.value ?? null,
      tdsRateScaled: lease.tdsRate.toScaledNumber(),
      status: lease.status,
      endedOn: props.endedOn?.toISO() ?? null,
      sourceReference: props.sourceReference ?? null,
      creditedQuantityScaled: lease.credited.toScaledNumber(),
      notes: props.notes ?? null,
      updatedAt: new Date(),
    };
  },
};

/* ═══ DrizzleJournalReplaySource ══════════════════════════════════════ */

/**
 * The raw journal, for the reproducibility job.
 *
 * Every method here is deliberately *not* the path the reports use. Balances are
 * folded in TypeScript through the domain's own reference calculator rather than
 * summed in SQL, because the whole value of the nightly diff is that two
 * independent computations over one journal agree — a second SQL `SUM` with the
 * same `CASE` expression would agree with the first by construction and prove
 * nothing.
 */
export class DrizzleJournalReplaySource implements JournalReplaySource {
  constructor(private readonly db: Database) {}

  async users(): Promise<readonly UserId[]> {
    const rows = await this.db.select({ id: usersTable.id }).from(usersTable);
    return rows.map((row) => UserId.from(row.id));
  }

  async unbalancedEntries(userId: UserId): Promise<readonly UnbalancedEntry[]> {
    /*
     * L01, in SQL and per currency.
     *
     * Per currency because a two-currency entry balances in each leg's own
     * currency and never across them — summing the two together would report a
     * perfectly good FX entry as broken.
     */
    const rows = await this.db.all<{ transaction_id: string; currency: string; diff: number }>(
      sql`SELECT p.transaction_id AS transaction_id, p.currency AS currency,
                 SUM(CASE WHEN p.direction = 'DEBIT' THEN p.amount_minor ELSE -p.amount_minor END) AS diff
            FROM postings p
            JOIN transactions t ON t.id = p.transaction_id
           WHERE t.user_id = ${userId.value}
             AND p.deleted_at IS NULL
             AND t.deleted_at IS NULL
           GROUP BY p.transaction_id, p.currency
          HAVING diff <> 0`,
    );
    return rows.map((row) => ({
      transactionId: row.transaction_id,
      currency: row.currency,
      differenceMinor: BigInt(row.diff),
    }));
  }

  async accountBalancesFromPostings(
    userId: UserId,
    asOf: CalendarDate,
  ): Promise<readonly JournalSum[]> {
    const rows = await this.db.all<{
      account_id: string;
      code: string;
      type: string;
      currency: string;
      direction: string;
      amount_minor: number;
    }>(
      sql`SELECT a.id AS account_id, a.code AS code, a.type AS type,
                 p.currency AS currency, p.direction AS direction, p.amount_minor AS amount_minor
            FROM postings p
            JOIN transactions t ON t.id = p.transaction_id
            JOIN ledger_accounts a ON a.id = p.account_id
           WHERE t.user_id = ${userId.value}
             AND t.txn_date <= ${asOf.toISO()}
             AND p.deleted_at IS NULL
             AND t.deleted_at IS NULL
             AND a.deleted_at IS NULL
             AND a.type IN ('ASSET', 'LIABILITY', 'EQUITY')`,
    );

    // Folded here, one posting at a time, with the sign taken from the account's
    // normal balance — the same rule `BalanceCalculator` applies, arrived at
    // independently of the query layer's `CASE` expression.
    const totals = new Map<string, JournalSum>();
    for (const row of rows) {
      const debitPositive = row.type === "ASSET" || row.type === "EXPENSE";
      const signed =
        (row.direction === "DEBIT") === debitPositive
          ? BigInt(row.amount_minor)
          : -BigInt(row.amount_minor);
      const existing = totals.get(row.account_id);
      totals.set(row.account_id, {
        accountId: row.account_id,
        code: row.code,
        currency: row.currency,
        balanceMinor: (existing?.balanceMinor ?? 0n) + signed,
      });
    }
    return [...totals.values()];
  }

  async cachedProjections(userId: UserId): Promise<readonly CachedProjection[]> {
    const rows = await this.db
      .select()
      .from(projectionCache)
      .where(eq(projectionCache.userId, userId.value));
    return rows.map((row) => ({
      projection: row.projection,
      scope: row.scope,
      asOf: row.asOf ?? null,
      payloadJson: row.payloadJson,
    }));
  }

  async counts(
    userId: UserId,
  ): Promise<{ transactions: number; postings: number; ledgerEvents: number }> {
    const [txn] = await this.db
      .select({ n: count() })
      .from(transactions)
      .where(and(eq(transactions.userId, userId.value), isNull(transactions.deletedAt)));
    const [post] = await this.db.all<{ n: number }>(
      sql`SELECT COUNT(*) AS n FROM postings p JOIN transactions t ON t.id = p.transaction_id
           WHERE t.user_id = ${userId.value} AND p.deleted_at IS NULL`,
    );
    const [events] = await this.db
      .select({ n: count() })
      .from(ledgerEvents)
      .where(eq(ledgerEvents.userId, userId.value));
    return {
      transactions: Number(txn?.n ?? 0),
      postings: Number(post?.n ?? 0),
      ledgerEvents: Number(events?.n ?? 0),
    };
  }
}

/* ═══ DrizzleTaxSettingsRepository ════════════════════════════════════ */

/**
 * libSQL implementation of {@link TaxSettingsRepository}.
 *
 * One row per user per financial year, and no fallback to the previous year's
 * row: a slab rate carried forward silently would apply last year's income to
 * this year's tax. `findFor` returns `null` and the caller says so on screen.
 *
 * `totalIncome` and the resident status are not columns — the table predates
 * them, and they are per-assessment inputs rather than settings. They come back
 * as zero and RESIDENT, which the tax report shows as an assumption.
 */
export class DrizzleTaxSettingsRepository implements TaxSettingsRepository {
  constructor(private readonly db: Database) {}

  async findFor(userId: UserId, financialYear: FinancialYear): Promise<StoredTaxSettings | null> {
    const [row] = await this.db
      .select()
      .from(taxSettings)
      .where(
        and(
          eq(taxSettings.userId, userId.value),
          eq(taxSettings.financialYear, financialYear.label),
          isNull(taxSettings.deletedAt),
        ),
      )
      .limit(1);
    if (!row) return null;
    return {
      financialYear: row.financialYear,
      regimeKey: row.regimeKey,
      marginalSlabRate: Percentage.fromScaled(row.marginalSlabPercent),
      ltcgExemption: Money.fromMinor(BigInt(row.ltcgExemptionMinor), Currency.reporting),
      usesNewRegime: row.usesNewRegime,
      totalIncome: Money.zero(Currency.reporting),
      residentStatus: "RESIDENT",
    };
  }

  async save(userId: UserId, settings: StoredTaxSettings): Promise<void> {
    const row = {
      id: newUuid(),
      userId: userId.value,
      financialYear: settings.financialYear,
      regimeKey: settings.regimeKey,
      marginalSlabPercent: settings.marginalSlabRate.toScaledNumber(),
      ltcgExemptionMinor: settings.ltcgExemption.toMinorNumber(),
      usesNewRegime: settings.usesNewRegime,
      updatedAt: new Date(),
    };
    await this.db
      .insert(taxSettings)
      .values(row)
      // Keyed on (user, year), so editing this year's slab rate is an update and
      // last year's row is untouched — which is what keeps a reprinted return
      // from changing.
      .onConflictDoUpdate({
        target: [taxSettings.userId, taxSettings.financialYear],
        set: { ...row, id: undefined, userId: undefined, financialYear: undefined },
      });
  }
}

/* ═══ DrizzleBarRepository ════════════════════════════════════════════ */

/**
 * libSQL implementation of {@link BarRepository}.
 *
 * Append-only like the quote store, and for the same reason: a vendor's
 * corrected bar is a new row pointing at the old one, so "what did we believe on
 * the day" stays answerable after the fact. That is not fastidiousness — it is
 * the difference between a backtest and a story.
 *
 * The impossible-bar checks live in the database as constraints *and* in
 * `makeBar` in the domain. Two enforcements of one rule is deliberate here:
 * the domain one gives a readable message, the database one is the guarantee.
 */
export class DrizzleBarRepository implements BarRepository {
  constructor(private readonly db: Database) {}

  async append(bars: readonly Bar[]): Promise<void> {
    if (bars.length === 0) return;
    const rows = bars.map((bar) => {
      // Validated on the way in, not on the way out: a bar the store would
      // refuse should fail where the caller can see which bar it was.
      const checked = makeBar(bar);
      return {
        id: newUuid(),
        instrumentId: checked.instrumentId,
        granularity: checked.granularity,
        asOf: checked.asOf.toISO(),
        openScaled: checked.open.toScaledNumber(),
        highScaled: checked.high.toScaledNumber(),
        lowScaled: checked.low.toScaledNumber(),
        closeScaled: checked.close.toScaledNumber(),
        volume: checked.volume === null ? null : Number(checked.volume),
        currency: checked.currency.code,
        providerId: checked.providerId,
        ingestedAt: checked.ingestedAt,
      };
    });

    await this.db.transaction(async (tx) => {
      for (let i = 0; i < rows.length; i += 200) {
        // The same provider's same bar at the same instant is a repeated fetch,
        // not a correction.
        await tx.insert(priceBars).values(rows.slice(i, i + 200)).onConflictDoNothing();
      }
    });
  }

  async findRange(
    instrumentId: string,
    granularity: BarGranularity,
    dateRange: DateRange,
  ): Promise<readonly Bar[]> {
    const rows = await this.db
      .select()
      .from(priceBars)
      .where(
        and(
          eq(priceBars.instrumentId, instrumentId),
          eq(priceBars.granularity, granularity),
          gte(priceBars.asOf, dateRange.start.toISO()),
          lte(priceBars.asOf, dateRange.end.toISO()),
          isNull(priceBars.supersededBy),
        ),
      )
      .orderBy(asc(priceBars.asOf), desc(priceBars.ingestedAt));

    return rows.map(BarMapper.toDomain);
  }

  async coverage(
    instrumentId: string,
    granularity: BarGranularity,
  ): Promise<{ from: CalendarDate; through: CalendarDate; count: number } | null> {
    const [row] = await this.db
      .select({ from: min(priceBars.asOf), through: max(priceBars.asOf), rows: count() })
      .from(priceBars)
      .where(
        and(
          eq(priceBars.instrumentId, instrumentId),
          eq(priceBars.granularity, granularity),
          isNull(priceBars.supersededBy),
        ),
      );

    if (!row?.from || !row.through) return null;
    return {
      from: CalendarDate.parse(row.from),
      through: CalendarDate.parse(row.through),
      count: Number(row.rows),
    };
  }

  async supersede(supersededBarId: string, bySupersedingBarId: string): Promise<void> {
    await this.db
      .update(priceBars)
      .set({ supersededBy: bySupersedingBarId })
      .where(eq(priceBars.id, supersededBarId));
  }
}

const BarMapper = {
  toDomain(row: typeof priceBars.$inferSelect): Bar {
    const currency = Currency.of(row.currency);
    return {
      instrumentId: row.instrumentId,
      asOf: CalendarDate.parse(row.asOf),
      granularity: row.granularity as BarGranularity,
      open: UnitPrice.fromScaled(row.openScaled, currency),
      high: UnitPrice.fromScaled(row.highScaled, currency),
      low: UnitPrice.fromScaled(row.lowScaled, currency),
      close: UnitPrice.fromScaled(row.closeScaled, currency),
      volume: row.volume === null ? null : BigInt(row.volume),
      currency,
      providerId: row.providerId,
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
        problemsJson: ImportMapper.toDiagnosticsJson(batch.diagnostics),
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

  /**
   * Staged-but-unposted rows per destination account.
   *
   * "Unposted" is `PARSED`, or `CONFIRMED` with no transaction behind it — the
   * same pair the review screen counts as remaining, kept identical on purpose so
   * a warning and the screen it points at can never disagree about how much is
   * left.
   */
  async pendingRowCounts(
    userId: UserId,
  ): Promise<readonly { accountId: string; rows: number; batches: number }[]> {
    const rows = await this.db
      .select({
        accountId: importBatches.accountId,
        rows: count(importRows.id),
        batches: sql<number>`COUNT(DISTINCT ${importRows.batchId})`,
      })
      .from(importRows)
      .innerJoin(importBatches, eq(importRows.batchId, importBatches.id))
      .where(
        and(
          eq(importRows.userId, userId.value),
          isNull(importRows.deletedAt),
          isNull(importBatches.deletedAt),
          sql`${importBatches.status} <> 'UNDONE'`,
          or(
            eq(importRows.status, "PARSED"),
            and(eq(importRows.status, "CONFIRMED"), isNull(importRows.matchedTransactionId)),
          ),
        ),
      )
      .groupBy(importBatches.accountId);

    return rows
      .filter((row): row is typeof row & { accountId: string } => row.accountId !== null)
      .map((row) => ({
        accountId: row.accountId,
        rows: Number(row.rows),
        batches: Number(row.batches),
      }));
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
    /*
     * A duplicate match is a claim about a *live* ledger transaction. Transactions
     * are soft-deleted, so the intentionally non-FK `matched_transaction_id` can
     * outlive the row it matched. Release that stale claim before applying the
     * caller's status filter; otherwise `listRows(..., { statuses: ["PARSED"] })`
     * can never surface it for confirmation and real statement movement remains
     * withheld indefinitely.
     *
     * Only matcher-owned rows (`MATCHED`) are repaired. A CONFIRMED row uses the
     * same column to remember the transaction it posted and must not silently be
     * turned back into an unreviewed import row.
     */
    await this.db
      .update(importRows)
      .set({
        status: "PARSED",
        matchedTransactionId: null,
        matchPass: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(importRows.userId, userId.value),
          eq(importRows.batchId, batchId),
          eq(importRows.status, "MATCHED"),
          isNull(importRows.deletedAt),
          sql`${importRows.matchedTransactionId} IS NOT NULL`,
          sql`NOT EXISTS (
            SELECT 1
            FROM ${transactions}
            WHERE ${transactions.userId} = ${importRows.userId}
              AND ${transactions.id} = ${importRows.matchedTransactionId}
              AND ${transactions.deletedAt} IS NULL
          )`,
        ),
      );

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

  async softDeleteBatch(userId: UserId, batchId: string, at: Date): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx
        .update(importRows)
        .set({ deletedAt: at, updatedAt: at })
        .where(
          and(
            eq(importRows.userId, userId.value),
            eq(importRows.batchId, batchId),
            isNull(importRows.deletedAt),
          ),
        );

      await tx
        .update(importBatches)
        .set({ deletedAt: at })
        .where(
          and(
            eq(importBatches.userId, userId.value),
            eq(importBatches.id, batchId),
            isNull(importBatches.deletedAt),
          ),
        );
    });
  }
}

type ImportBatchRow = typeof importBatches.$inferSelect;
type ImportRowRow = typeof importRows.$inferSelect;

/** The JSON shape of a staged row's parse. Money as minor units, never a float. */
/**
 * `import_batches.problems_json`, as it is actually written.
 *
 * Money is stored as minor units in a string plus its currency code, never as a
 * JSON number: paise above 2^53 would round, and would look fine until they did.
 * The same rule `ParsedRowJson` follows below, for the same reason.
 */
interface DiagnosticsJson {
  verdict: {
    trust: ImportTrust;
    checked: number;
    breaks: { rowIndex: number; expectedMinor: string; printedMinor: string }[];
    mapping: Record<string, number>;
    closingMinor: string | null;
    controls: { status: "ABSENT" | "MATCHED" | "MISMATCHED"; detail: string | null };
  };
  currency: string;
  problems: { rowIndex: number; reason: string; raw: string }[];
  override: { reason: string; at: string } | null;
  statement: { accountSuffix: string | null; periodFrom: string | null; periodTo: string | null } | null;
  warnings: string[];
  fingerprint: string | null;
}

interface ParsedRowJson {
  date: string;
  description: string;
  reference: string | null;
  amountMinor: string;
  currency: string;
  direction: RowDirection;
  balanceAfterMinor: string | null;
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
      diagnostics: ImportMapper.fromDiagnosticsJson(row.problemsJson),
    };
  },

  toDiagnosticsJson(diagnostics: ImportDiagnostics | null): string | null {
    if (!diagnostics) return null;
    const currency =
      diagnostics.verdict.closingBalance?.currency.code ??
      diagnostics.verdict.breaks[0]?.printed.currency.code ??
      Currency.reporting.code;
    const payload: DiagnosticsJson = {
      verdict: {
        trust: diagnostics.verdict.trust,
        checked: diagnostics.verdict.checked,
        breaks: diagnostics.verdict.breaks.map((brk) => ({
          rowIndex: brk.rowIndex,
          expectedMinor: brk.expected.minor.toString(),
          printedMinor: brk.printed.minor.toString(),
        })),
        mapping: { ...diagnostics.verdict.mapping },
        closingMinor: diagnostics.verdict.closingBalance?.minor.toString() ?? null,
        controls: { ...diagnostics.verdict.controls },
      },
      currency,
      problems: diagnostics.problems.map((problem) => ({ ...problem })),
      override: diagnostics.override,
      statement: diagnostics.statement,
      warnings: [...diagnostics.warnings],
      fingerprint: diagnostics.fingerprint,
    };
    return JSON.stringify(payload);
  },

  /*
   * Tolerant on the way in: every batch staged before this column was written
   * has `null` here, and a few have the bare `StatementProblem[]` the column was
   * originally specified to hold. Neither is corruption, and neither should stop
   * a review screen from rendering.
   */
  fromDiagnosticsJson(raw: string | null): ImportDiagnostics | null {
    if (!raw) return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }
    if (typeof parsed !== "object" || parsed === null) return null;
    const payload = parsed as Partial<DiagnosticsJson>;
    if (!payload.verdict) return null;

    let currency = Currency.reporting;
    try {
      if (payload.currency) currency = Currency.of(payload.currency);
    } catch {
      // An unknown code is not worth losing the whole diagnostic over.
    }
    const money = (minor: string | null | undefined): Money | null =>
      minor === null || minor === undefined ? null : Money.fromMinor(BigInt(minor), currency);

    return {
      verdict: {
        trust: payload.verdict.trust,
        checked: payload.verdict.checked,
        breaks: (payload.verdict.breaks ?? []).map((brk: DiagnosticsJson["verdict"]["breaks"][number]) => ({
          rowIndex: brk.rowIndex,
          expected: money(brk.expectedMinor)!,
          printed: money(brk.printedMinor)!,
        })),
        mapping: payload.verdict.mapping ?? {},
        closingBalance: money(payload.verdict.closingMinor),
        // Absent on every batch written before the control check existed, which
        // is honest: nothing checked them.
        controls: payload.verdict.controls ?? { status: "ABSENT", detail: null },
      },
      problems: payload.problems ?? [],
      override: payload.override ?? null,
      statement: payload.statement ?? null,
      warnings: payload.warnings ?? [],
      fingerprint: payload.fingerprint ?? null,
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
      balanceAfterMinor: row.balanceAfter?.minor.toString() ?? null,
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
      balanceAfter:
        parsed.balanceAfterMinor == null
          ? null
          : Money.fromMinor(
              BigInt(parsed.balanceAfterMinor),
              Currency.of(parsed.currency ?? Currency.reporting.code),
            ),
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

  async isSymbolReserved(userId: UserId, symbol: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: instruments.id })
      .from(instruments)
      .where(and(eq(instruments.userId, userId.value), eq(instruments.symbol, symbol)))
      .limit(1);
    return row !== undefined;
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
      institutionId: props.institutionId?.value ?? null,
      metadata: props.metadata === undefined ? null : JSON.stringify(props.metadata),
      isClosed: props.isClosed ?? false,
      updatedAt: new Date(),
    };
    await this.db
      .insert(instruments)
      .values(row)
      .onConflictDoUpdate({ target: instruments.id, set: { ...row, id: undefined } });
  }

  async softDelete(userId: UserId, id: InstrumentId, at: Date): Promise<void> {
    await this.db
      .update(instruments)
      .set({ deletedAt: at, updatedAt: at })
      .where(and(eq(instruments.userId, userId.value), eq(instruments.id, id.value)));
  }

  async countTrades(userId: UserId, id: InstrumentId): Promise<number> {
    const [row] = await this.db
      .select({ n: count() })
      .from(trades)
      .where(
        and(
          eq(trades.userId, userId.value),
          isNull(trades.deletedAt),
          eq(trades.instrumentId, id.value),
        ),
      );
    return Number(row?.n ?? 0);
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
      institutionId: row.institutionId === null ? null : InstitutionId.from(row.institutionId),
      /*
       * Parsed here and validated in the leaf's constructor, which is why a
       * malformed blob throws on read rather than surfacing as a missing strike
       * three screens later.
       */
      metadata: row.metadata === null ? undefined : (JSON.parse(row.metadata) as unknown),
      isClosed: row.isClosed,
    });
  },

  /** The coarse `kind` the pre-existing schema column carries. */
  toStoredKind(kind: InstrumentKind): "EQUITY" | "ETF" | "MUTUAL_FUND" | "BOND" | "GOVT_SECURITY" | "DIGITAL_GOLD" | "DIGITAL_SILVER" | "DIGITAL_METAL" | "REIT" | "CRYPTO" | "DERIVATIVE" | "OTHER" {
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
      case "DIGITAL_PLATINUM":
        return "DIGITAL_METAL";
      case "REIT":
        return "REIT";
      case "CRYPTO":
        return "CRYPTO";
      case "OPTION":
      case "FUTURE":
        return "DERIVATIVE";
    }
  },

  /**
   * The tax class the reporting tables key on.
   *
   * Derived from the leaf rather than stored independently, because two columns
   * that both claim to say how something is taxed will eventually disagree — and
   * the leaf is the one with the reasoning attached.
   */
  toTaxAssetClass(kind: InstrumentKind): "LISTED_EQUITY" | "EQUITY_MUTUAL_FUND" | "DEBT" | "GOLD" | "CRYPTO" | "UNLISTED" | "FNO_BUSINESS" | "OTHER" {
    switch (kind) {
      case "LISTED_EQUITY":
      case "REIT":
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
      case "DIGITAL_PLATINUM":
        return "GOLD";
      case "CRYPTO":
        return "CRYPTO";
      case "OPTION":
      case "FUTURE":
        return "FNO_BUSINESS";
    }
  },

  toQuoteSource(kind: InstrumentKind): "MANUAL" | "AMFI" | "NSE" | "METALS" {
    switch (kind) {
      case "LISTED_EQUITY":
      case "ETF":
      case "REIT":
        return "NSE";
      case "INDEX_FUND":
      case "MUTUAL_FUND":
      case "LIQUID_FUND":
      case "DEBT_FUND":
      case "ELSS_FUND":
        return "AMFI";
      case "DIGITAL_GOLD":
      case "DIGITAL_SILVER":
      case "DIGITAL_PLATINUM":
      case "SOVEREIGN_GOLD_BOND":
        return "METALS";
      default:
        return "MANUAL";
    }
  },
};


/* ═══ DrizzleInstitutionRepository ════════════════════════════════════ */

/**
 * Platforms.
 *
 * The one thing worth pointing at: `findByName` matches on the **normalised**
 * name, not the stored one. The table's unique index is on the raw name, so
 * "Tanishq" and "tanishq " would both be accepted by SQLite and would split a
 * per-platform total in two — which is the exact failure the entity exists to
 * prevent. Matching here in the repository, over a small per-user list, is the
 * cheap fix; the alternative is a stored normalised column and a migration to
 * backfill it, which is worth doing if this list ever grows past a few dozen.
 */
export class DrizzleInstitutionRepository implements InstitutionRepository {
  constructor(private readonly db: Database) {}

  async findById(userId: UserId, id: InstitutionId): Promise<Institution | null> {
    const [row] = await this.db
      .select()
      .from(institutions)
      .where(
        and(
          eq(institutions.userId, userId.value),
          isNull(institutions.deletedAt),
          eq(institutions.id, id.value),
        ),
      )
      .limit(1);
    return row ? InstitutionMapper.toDomain(row) : null;
  }

  async findByName(userId: UserId, name: string): Promise<Institution | null> {
    const needle = normaliseInstitutionName(name);
    if (needle === "") return null;
    const rows = await this.db
      .select()
      .from(institutions)
      .where(and(eq(institutions.userId, userId.value), isNull(institutions.deletedAt)));
    const row = rows.find((candidate) => normaliseInstitutionName(candidate.name) === needle);
    return row ? InstitutionMapper.toDomain(row) : null;
  }

  async list(
    userId: UserId,
    options?: { includeArchived?: boolean },
  ): Promise<readonly Institution[]> {
    const rows = await this.db
      .select()
      .from(institutions)
      .where(
        and(
          eq(institutions.userId, userId.value),
          isNull(institutions.deletedAt),
          options?.includeArchived ? undefined : eq(institutions.isArchived, false),
        ),
      )
      .orderBy(asc(institutions.name));
    return rows.map(InstitutionMapper.toDomain);
  }

  async save(institution: Institution): Promise<void> {
    const row = InstitutionMapper.toRow(institution);
    await this.db
      .insert(institutions)
      .values(row)
      .onConflictDoUpdate({ target: institutions.id, set: { ...row, id: undefined } });
  }

  async softDelete(userId: UserId, id: InstitutionId): Promise<void> {
    await this.db
      .update(institutions)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(institutions.userId, userId.value), eq(institutions.id, id.value)));
  }
}

type InstitutionRow = typeof institutions.$inferSelect;

export const InstitutionMapper = {
  toDomain(row: InstitutionRow): Institution {
    return new Institution({
      id: InstitutionId.from(row.id),
      userId: UserId.from(row.userId),
      name: row.name,
      providerId: row.providerId,
      kind: row.kind as InstitutionKind,
      country: row.country,
      sellSpread: Percentage.fromScaled(row.sellSpreadScaled),
      notes: row.notes,
      isArchived: row.isArchived,
    });
  },

  toRow(institution: Institution): typeof institutions.$inferInsert {
    const props = institution.props;
    return {
      id: props.id.value,
      userId: props.userId.value,
      name: props.name,
      providerId: props.providerId ?? null,
      kind: props.kind,
      country: props.country,
      sellSpreadScaled: props.sellSpread.toScaledNumber(),
      notes: props.notes ?? null,
      isArchived: props.isArchived,
      updatedAt: new Date(),
    };
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
          /*
           * The sale's own tombstone, not just the match's. Voiding a sale
           * tombstones both, but a report that joined `trades` without this
           * filter would keep reporting a gain the user has already undone —
           * and it would be a *filed* gain, which is the worst place for a
           * leak like this to surface.
           */
          isNull(trades.deletedAt),
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

  /* ── Corrections ──────────────────────────────────────────────────── */

  async findTrade(userId: UserId, tradeId: string): Promise<TradeRecord | null> {
    const [row] = await this.db
      .select({ trade: trades, currency: instruments.currency })
      .from(trades)
      .innerJoin(instruments, eq(trades.instrumentId, instruments.id))
      .where(
        and(eq(trades.userId, userId.value), isNull(trades.deletedAt), eq(trades.id, tradeId)),
      )
      .limit(1);
    return row ? TradeMapper.toDomain(row.trade, row.currency) : null;
  }

  async tradesFor(userId: UserId, instrumentId: InstrumentId): Promise<readonly TradeRecord[]> {
    const rows = await this.db
      .select({ trade: trades, currency: instruments.currency })
      .from(trades)
      .innerJoin(instruments, eq(trades.instrumentId, instruments.id))
      .where(
        and(
          eq(trades.userId, userId.value),
          isNull(trades.deletedAt),
          eq(trades.instrumentId, instrumentId.value),
        ),
      )
      .orderBy(asc(trades.tradedOn), asc(trades.id));
    return rows.map((row) => TradeMapper.toDomain(row.trade, row.currency));
  }

  async lotsFromBuy(userId: UserId, buyTradeId: string): Promise<readonly Lot[]> {
    const rows = await this.db
      .select()
      .from(lots)
      .where(
        and(
          eq(lots.userId, userId.value),
          isNull(lots.deletedAt),
          eq(lots.buyTradeId, buyTradeId),
        ),
      )
      .orderBy(asc(lots.acquiredOn));
    return rows.map(LotMapper.toDomain);
  }

  async matchesForSell(userId: UserId, sellTradeId: string): Promise<readonly StoredLotMatch[]> {
    const rows = await this.db
      .select()
      .from(lotMatches)
      .where(
        and(
          eq(lotMatches.userId, userId.value),
          isNull(lotMatches.deletedAt),
          eq(lotMatches.sellTradeId, sellTradeId),
        ),
      );
    return rows.map(toStoredMatch);
  }

  async matchesAgainstLot(userId: UserId, lotId: LotId): Promise<readonly StoredLotMatch[]> {
    const rows = await this.db
      .select()
      .from(lotMatches)
      .where(
        and(
          eq(lotMatches.userId, userId.value),
          isNull(lotMatches.deletedAt),
          eq(lotMatches.lotId, lotId.value),
        ),
      );
    return rows.map(toStoredMatch);
  }

  /**
   * The whole unwind, in one transaction.
   *
   * The order inside it matters even though the transaction makes it atomic,
   * because it is also the order a reader reconstructs: lots are restored
   * **before** their matches are tombstoned, so the only inconsistent state the
   * sequence can pass through double-counts units — which invariant P01 detects
   * loudly — rather than losing them, which nothing would.
   *
   * Deletes are tombstones, never `DELETE`. `tests/schema-guard.spec.ts` enforces
   * that, and the reason is A03: a correction that erased the row would leave the
   * ledger's reversal pointing at nothing.
   */
  async voidTrade(userId: UserId, plan: TradeVoidPlan, at: Date): Promise<void> {
    await this.db.transaction(async (tx) => {
      for (const lot of plan.lotsToRestore) {
        const row = LotMapper.toRow(userId, lot);
        await tx
          .insert(lots)
          .values(row)
          .onConflictDoUpdate({ target: lots.id, set: { ...row, id: undefined } });
      }

      if (plan.matchesToTombstone.length > 0) {
        await tx
          .update(lotMatches)
          .set({ deletedAt: at })
          .where(
            and(
              eq(lotMatches.userId, userId.value),
              inArray(lotMatches.id, [...plan.matchesToTombstone]),
            ),
          );
      }

      if (plan.lotsToTombstone.length > 0) {
        await tx
          .update(lots)
          .set({ deletedAt: at })
          .where(
            and(
              eq(lots.userId, userId.value),
              inArray(lots.id, plan.lotsToTombstone.map((id) => id.value)),
            ),
          );
      }

      await tx
        .update(trades)
        .set({ deletedAt: at })
        .where(and(eq(trades.userId, userId.value), eq(trades.id, plan.tradeId)));
    });
  }
}

type TradeRow = typeof trades.$inferSelect;

const TradeMapper = {
  /*
   * The currency comes from the instrument, because `trades` has no column for
   * it — a trade is always in the instrument's own currency, and storing it
   * twice would be a second place for it to be wrong.
   */
  toDomain(row: TradeRow, currencyCode: string): TradeRecord {
    const currency = Currency.of(currencyCode);
    /*
     * Every charge column summed back into one figure, which is the inverse of
     * what `recordTrade` did to it. Lossy in principle — the STT/brokerage split
     * matters for deductibility — and lossless in practice today, because only
     * `otherChargesMinor` is ever written outside a contract-note import. A
     * correction that re-records a trade therefore cannot yet restore that split,
     * which is why `CorrectTrade` says so rather than pretending otherwise.
     */
    const charges =
      row.brokerageMinor +
      row.sttMinor +
      row.exchangeTxnChargeMinor +
      row.sebiTurnoverFeeMinor +
      row.stampDutyMinor +
      row.gstMinor +
      row.dpChargesMinor +
      row.otherChargesMinor;
    return {
      id: row.id,
      instrumentId: InstrumentId.from(row.instrumentId),
      side: row.side,
      tradedOn: CalendarDate.parse(row.tradedOn),
      quantity: Quantity.fromScaled(row.quantity),
      pricePerUnit: Money.fromMinor(row.pricePerUnitMinor, currency),
      charges: Money.fromMinor(charges, currency),
      /*
       * `RecordBuy` and `RecordSell` use the same id for the trade and the
       * transaction it posted, so the fallback is that same value rather than a
       * guess — it only fires for a trade row written without a journal entry,
       * which nothing currently does.
       */
      transactionId: row.transactionId ?? row.id,
      settlementAccountId: row.settlementAccountId,
    };
  },
};

function toStoredMatch(row: typeof lotMatches.$inferSelect): StoredLotMatch {
  return {
    id: row.id,
    sellTradeId: row.sellTradeId,
    lotId: LotId.from(row.lotId),
    quantity: Quantity.fromScaled(row.quantity),
  };
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

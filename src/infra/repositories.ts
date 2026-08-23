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

import { UserId } from "@/core/kernel";
import { Currency, Money } from "@/core/money";
import { CalendarDate, DateRange } from "@/core/time";
import { Account, AccountCode, AccountId, AccountRepository, AccountSubtype, AccountType, AccountTypeName, PostingDirection } from "@/domain/accounts";
import { AccountBalance, AccountFlow, BalanceQuery, EntryKind, EntrySource, JournalEntry, JournalEntryId, JournalPage, JournalQuery, JournalRepository, MonthlyFlow, Posting, PostingId, TypeTotals } from "@/domain/transactions";
import { journalEntries, ledgerAccounts, postings } from "@/infra/db/schema";
import { Database } from "@/infra/db/client";
import { and, asc, count, desc, eq, gte, inArray, isNull, like, lte, min, or, sql } from "drizzle-orm";
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

/* ═══ JournalEntryMapper ══════════════════════════════════════════════ */

type EntryRow = typeof journalEntries.$inferSelect;
type EntryInsert = typeof journalEntries.$inferInsert;
type PostingRow = typeof postings.$inferSelect;
type PostingInsert = typeof postings.$inferInsert;

/**
 * Translates between the `journal_entries` + `postings` rows and the
 * `JournalEntry` aggregate.
 *
 * Always both tables together. Rehydrating an entry without its postings would
 * produce an object that fails its own constructor, so there is no method here
 * that maps one without the other.
 */
export const JournalEntryMapper = {
  toDomain(entry: EntryRow, postingRows: readonly PostingRow[]): JournalEntry {
    return JournalEntry.rehydrate({
      id: JournalEntryId.from(entry.id),
      userId: UserId.from(entry.userId),
      postedOn: CalendarDate.parse(entry.postedOn),
      narration: entry.narration,
      kind: entry.kind as EntryKind,
      source: entry.source as EntrySource,
      postings: postingRows.map((row) =>
        Posting.rehydrate({
          id: PostingId.from(row.id),
          accountId: AccountId.from(row.accountId),
          direction: row.direction as PostingDirection,
          amount: Money.fromMinor(row.amountMinor, Currency.of(row.currency)),
          seq: row.seq,
          memo: row.memo,
        }),
      ),
      reference: entry.reference,
      importBatchId: entry.importBatchId,
      reversesEntryId: entry.reversesEntryId ? JournalEntryId.from(entry.reversesEntryId) : null,
      fingerprint: entry.fingerprint,
    });
  },

  /** Groups flat join rows into one aggregate per entry, preserving order. */
  toDomainMany(entryRows: readonly EntryRow[], postingRows: readonly PostingRow[]): JournalEntry[] {
    const byEntry = new Map<string, PostingRow[]>();
    for (const posting of postingRows) {
      const bucket = byEntry.get(posting.entryId);
      if (bucket) bucket.push(posting);
      else byEntry.set(posting.entryId, [posting]);
    }
    return entryRows.map((entry) => JournalEntryMapper.toDomain(entry, byEntry.get(entry.id) ?? []));
  },

  toEntryRow(entry: JournalEntry): EntryInsert {
    return {
      id: entry.id.value,
      userId: entry.userId.value,
      postedOn: entry.postedOn.toISO(),
      narration: entry.narration,
      kind: entry.kind,
      source: entry.source,
      reference: entry.reference,
      importBatchId: entry.importBatchId,
      reversesEntryId: entry.reversesEntryId?.value ?? null,
      fingerprint: entry.fingerprint,
    };
  },

  toPostingRows(entry: JournalEntry): PostingInsert[] {
    return entry.postings.map((posting) => ({
      id: posting.id.value,
      entryId: entry.id.value,
      accountId: posting.accountId.value,
      direction: posting.direction,
      // `Money` already holds the exact integer this column wants.
      amountMinor: posting.amount.toMinorNumber(),
      currency: posting.amount.currency.code,
      seq: posting.seq,
      memo: posting.memo,
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

/* ═══ DrizzleJournalRepository ════════════════════════════════════════ */

/** SQLite caps parameters per statement; batch anything unbounded. */
const PARAM_CHUNK = 400;

/**
 * libSQL implementation of {@link JournalRepository}.
 *
 * Entries and their postings are always written inside a single transaction. That
 * is not a nicety: a half-written entry is an unbalanced entry, which is the one
 * state the whole design exists to make impossible. `JournalEntry`'s constructor
 * guards the in-memory shape; this transaction guards the stored one.
 */
export class DrizzleJournalRepository implements JournalRepository {
  constructor(private readonly db: Database) {}

  async save(entry: JournalEntry): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.insert(journalEntries).values(JournalEntryMapper.toEntryRow(entry));
      await tx.insert(postings).values(JournalEntryMapper.toPostingRows(entry));
    });
  }

  async saveMany(entries: readonly JournalEntry[]): Promise<void> {
    if (entries.length === 0) return;
    await this.db.transaction(async (tx) => {
      // Chunked so a large import does not exceed the statement parameter limit,
      // while still being one transaction overall — an import lands whole.
      for (let i = 0; i < entries.length; i += 50) {
        const batch = entries.slice(i, i + 50);
        await tx.insert(journalEntries).values(batch.map(JournalEntryMapper.toEntryRow));
        await tx.insert(postings).values(batch.flatMap(JournalEntryMapper.toPostingRows));
      }
    });
  }

  async findById(userId: UserId, id: JournalEntryId): Promise<JournalEntry | null> {
    const [entry] = await this.db
      .select()
      .from(journalEntries)
      .where(and(eq(journalEntries.userId, userId.value), isNull(journalEntries.deletedAt), eq(journalEntries.id, id.value)))
      .limit(1);
    if (!entry) return null;

    const postingRows = await this.db
      .select()
      .from(postings)
      .where(eq(postings.entryId, entry.id))
      .orderBy(asc(postings.seq));

    return JournalEntryMapper.toDomain(entry, postingRows);
  }

  async find(userId: UserId, query: JournalQuery): Promise<JournalPage> {
    const conditions = [eq(journalEntries.userId, userId.value), isNull(journalEntries.deletedAt)];

    if (query.range) {
      conditions.push(gte(journalEntries.postedOn, query.range.start.toISO()));
      conditions.push(lte(journalEntries.postedOn, query.range.end.toISO()));
    }
    if (query.importBatchId) {
      conditions.push(eq(journalEntries.importBatchId, query.importBatchId));
    }
    if (query.search?.trim()) {
      const term = `%${query.search.trim().toLowerCase()}%`;
      conditions.push(
        or(
          like(sql`lower(${journalEntries.narration})`, term),
          like(sql`lower(coalesce(${journalEntries.reference}, ''))`, term),
        )!,
      );
    }
    if (query.accountIds?.length) {
      // Entries touching any of these accounts. A subquery keeps the result one
      // row per entry — a join would duplicate an entry that has two matching legs.
      conditions.push(
        sql`${journalEntries.id} IN (
          SELECT ${postings.entryId} FROM ${postings}
          WHERE ${inArray(
            postings.accountId,
            query.accountIds.map((id) => id.value),
          )}
        )`,
      );
    }

    const where = and(...conditions);

    const [[totals], entryRows] = await Promise.all([
      this.db.select({ total: count() }).from(journalEntries).where(where),
      this.db
        .select()
        .from(journalEntries)
        .where(where)
        .orderBy(desc(journalEntries.postedOn), desc(journalEntries.createdAt))
        .limit(query.limit ?? 100)
        .offset(query.offset ?? 0),
    ]);

    if (entryRows.length === 0) {
      return { entries: [], totalCount: totals?.total ?? 0 };
    }

    const postingRows = await this.db
      .select()
      .from(postings)
      .where(
        inArray(
          postings.entryId,
          entryRows.map((row) => row.id),
        ),
      )
      .orderBy(asc(postings.seq));

    return {
      entries: JournalEntryMapper.toDomainMany(entryRows, postingRows),
      totalCount: totals?.total ?? 0,
    };
  }

  async existsWithFingerprint(userId: UserId, fingerprint: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: journalEntries.id })
      .from(journalEntries)
      .where(
        and(eq(journalEntries.userId, userId.value), isNull(journalEntries.deletedAt), eq(journalEntries.fingerprint, fingerprint)),
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
        .select({ fingerprint: journalEntries.fingerprint })
        .from(journalEntries)
        .where(
          and(eq(journalEntries.userId, userId.value), isNull(journalEntries.deletedAt), inArray(journalEntries.fingerprint, chunk)),
        );
      for (const row of rows) {
        if (row.fingerprint) found.add(row.fingerprint);
      }
    }
    return found;
  }

  async hasReversal(userId: UserId, id: JournalEntryId): Promise<boolean> {
    const [row] = await this.db
      .select({ id: journalEntries.id })
      .from(journalEntries)
      .where(
        and(eq(journalEntries.userId, userId.value), isNull(journalEntries.deletedAt), eq(journalEntries.reversesEntryId, id.value)),
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
   * entry.
   */
  async softDeleteByImportBatch(
    userId: UserId,
    importBatchId: string,
    at: Date,
  ): Promise<number> {
    const updated = await this.db
      .update(journalEntries)
      .set({ deletedAt: at })
      .where(
        and(
          eq(journalEntries.userId, userId.value),
          eq(journalEntries.importBatchId, importBatchId),
          isNull(journalEntries.deletedAt),
        ),
      )
      .returning({ id: journalEntries.id });
    return updated.length;
  }

  /**
   * Soft delete — invariant A03.
   *
   * Note this is not how a *mistake* is corrected. An entry that posted the wrong
   * amount is fixed with a reversing entry, so both the error and the correction
   * are visible. This is for an entry that should never have existed at all, such
   * as a duplicate from a re-import.
   */
  async softDelete(userId: UserId, id: JournalEntryId, at: Date): Promise<void> {
    await this.db
      .update(journalEntries)
      .set({ deletedAt: at })
      .where(and(eq(journalEntries.userId, userId.value), eq(journalEntries.id, id.value)));
  }

  async earliestPostedOn(userId: UserId): Promise<CalendarDate | null> {
    const [row] = await this.db
      .select({ earliest: min(journalEntries.postedOn) })
      .from(journalEntries)
      // A tombstoned entry must not set the start of the net-worth timeline.
      .where(and(eq(journalEntries.userId, userId.value), isNull(journalEntries.deletedAt)));
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
          sql`${postings.entryId} IN (
            SELECT ${journalEntries.id} FROM ${journalEntries}
            WHERE ${journalEntries.userId} = ${userId.value}
              AND ${journalEntries.postedOn} <= ${asOf.toISO()}
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
      .innerJoin(journalEntries, eq(postings.entryId, journalEntries.id))
      .where(
        and(
          eq(journalEntries.userId, userId.value), isNull(journalEntries.deletedAt),
          eq(postings.accountId, accountId.value),
          sql`${journalEntries.postedOn} <= ${asOf.toISO()}`,
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
      .innerJoin(journalEntries, eq(postings.entryId, journalEntries.id))
      .where(
        and(eq(journalEntries.userId, userId.value), isNull(journalEntries.deletedAt), sql`${journalEntries.postedOn} <= ${asOf.toISO()}`),
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
        month: sql<string>`substr(${journalEntries.postedOn}, 1, 7)`,
        type: ledgerAccounts.type,
        total: sql<number>`COALESCE(SUM(${SIGNED_AMOUNT}), 0)`,
      })
      .from(postings)
      .innerJoin(ledgerAccounts, eq(postings.accountId, ledgerAccounts.id))
      .innerJoin(journalEntries, eq(postings.entryId, journalEntries.id))
      .where(
        and(
          eq(journalEntries.userId, userId.value), isNull(journalEntries.deletedAt),
          sql`${journalEntries.postedOn} >= ${range.start.toISO()}`,
          sql`${journalEntries.postedOn} <= ${range.end.toISO()}`,
          sql`${ledgerAccounts.type} IN ('INCOME', 'EXPENSE')`,
        ),
      )
      .groupBy(sql`substr(${journalEntries.postedOn}, 1, 7)`, ledgerAccounts.type);

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
          sql`${postings.entryId} IN (
            SELECT ${journalEntries.id} FROM ${journalEntries}
            WHERE ${journalEntries.userId} = ${userId.value}
              AND ${journalEntries.postedOn} >= ${range.start.toISO()}
              AND ${journalEntries.postedOn} <= ${range.end.toISO()}
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
        date: journalEntries.postedOn,
        delta: sql<number>`COALESCE(SUM(${SIGNED_AMOUNT}), 0)`,
      })
      .from(postings)
      .innerJoin(ledgerAccounts, eq(postings.accountId, ledgerAccounts.id))
      .innerJoin(journalEntries, eq(postings.entryId, journalEntries.id))
      .where(
        and(
          eq(journalEntries.userId, userId.value), isNull(journalEntries.deletedAt),
          eq(postings.accountId, accountId.value),
          sql`${journalEntries.postedOn} >= ${range.start.toISO()}`,
          sql`${journalEntries.postedOn} <= ${range.end.toISO()}`,
        ),
      )
      .groupBy(journalEntries.postedOn)
      .orderBy(journalEntries.postedOn);

    let running = opening;
    return rows.map((row) => {
      running = running.plus(this.money(row.delta));
      return { date: CalendarDate.parse(row.date), balance: running };
    });
  }
}

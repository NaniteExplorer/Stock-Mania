/**
 * Transactions: postings, the journal entry that balances them, and the
 * projections read back off them.
 *
 * Consolidated from eight files under `src/modules/ledger/domain/`.
 *
 * `JournalEntry.assertBalances` is the load-bearing invariant of the whole system
 * — an unbalanced entry cannot be constructed. Phase 1b lifts it into the base
 * class of a `Transaction` hierarchy and generalises it to balance per currency;
 * until then it stays exactly as it is.
 *
 * The `JournalRepository` and `BalanceQuery` ports are declared here with the
 * aggregate they serve, so `domain/` never imports `infra/`.
 */

import { AggregateRoot, DomainError, Entity, UniqueId, UserId, newUuid } from "@/core/kernel";
import { Currency, Money } from "@/core/money";
import { CalendarDate, DateRange } from "@/core/time";
import { Account, AccountId, AccountType, AccountTypeName, PostingDirection, oppositeOf } from "@/domain/accounts";
/* ═══ Identity ════════════════════════════════════════════════════════ */

export class JournalEntryId extends UniqueId {
  private readonly __journalEntryId = true;

  static create(): JournalEntryId {
    return new JournalEntryId(newUuid());
  }

  static from(value: string): JournalEntryId {
    return new JournalEntryId(value);
  }
}

export class PostingId extends UniqueId {
  private readonly __postingId = true;

  static create(): PostingId {
    return new PostingId(newUuid());
  }

  static from(value: string): PostingId {
    return new PostingId(value);
  }
}

/* ═══ Errors ══════════════════════════════════════════════════════════ */

/**
 * The ledger's invariant violations.
 *
 * `UnbalancedEntryError` is thrown from `JournalEntry`'s constructor rather than
 * returned as a `Result`, because an unbalanced entry is not a user-facing
 * outcome to render — it means the code that built the postings is wrong. Use
 * cases validate their inputs *before* constructing, so users see a
 * `ValidationError` instead.
 */
export class UnbalancedEntryError extends DomainError {
  constructor(debits: Money, credits: Money) {
    const difference = debits.minus(credits);
    super(
      "LEDGER_ENTRY_UNBALANCED",
      `Journal entry does not balance: debits ${debits.toDecimalString()} vs credits ` +
        `${credits.toDecimalString()} (off by ${difference.toDecimalString()}).`,
    );
  }
}

export class InsufficientPostingsError extends DomainError {
  constructor(count: number) {
    super(
      "LEDGER_ENTRY_TOO_FEW_POSTINGS",
      `A journal entry needs at least two postings, got ${count}. ` +
        `Money always moves from somewhere to somewhere.`,
    );
  }
}

export class MixedCurrencyEntryError extends DomainError {
  constructor(currencies: readonly string[]) {
    super(
      "LEDGER_ENTRY_MIXED_CURRENCY",
      `All postings in an entry must share one currency, found: ${currencies.join(", ")}. ` +
        `Record a cross-currency movement as two entries joined by a conversion account.`,
      );
  }
}

export class EntryAlreadyReversedError extends DomainError {
  constructor() {
    super(
      "LEDGER_ENTRY_ALREADY_REVERSED",
      "That transaction has already been reversed.",
    );
  }
}

/* ═══ Posting ═════════════════════════════════════════════════════════ */

/**
 * One leg of a journal entry: an amount, a side, and the account it lands on.
 *
 * A posting is never valid on its own — it exists only inside a
 * {@link JournalEntry}, which is what enforces that the legs balance. It is
 * therefore constructed through the entry, not saved or loaded independently.
 *
 * The amount is always positive. Direction carries the sign, and
 * {@link signedEffectOn} is the single place that turns a debit or credit into a
 * movement, given the account's type.
 */
export class Posting extends Entity<PostingId> {
  private constructor(
    id: PostingId,
    readonly accountId: AccountId,
    readonly direction: PostingDirection,
    readonly amount: Money,
    readonly seq: number,
    readonly memo: string | null,
  ) {
    super(id);
    if (!amount.isPositive) {
      throw new DomainError(
        "LEDGER_POSTING_NOT_POSITIVE",
        `A posting's amount must be positive, got ${amount.toDecimalString()}. ` +
          `Flip the direction to ${oppositeOf(direction)} instead of negating the amount.`,
      );
    }
  }

  static create(props: {
    accountId: AccountId;
    direction: PostingDirection;
    amount: Money;
    seq?: number;
    memo?: string | null;
  }): Posting {
    return new Posting(
      PostingId.create(),
      props.accountId,
      props.direction,
      props.amount,
      props.seq ?? 0,
      props.memo ?? null,
    );
  }

  static debit(accountId: AccountId, amount: Money, memo?: string | null): Posting {
    return Posting.create({ accountId, direction: "DEBIT", amount, memo });
  }

  static credit(accountId: AccountId, amount: Money, memo?: string | null): Posting {
    return Posting.create({ accountId, direction: "CREDIT", amount, memo });
  }

  /** Rehydration from a stored row. Only mappers should call this. */
  static rehydrate(props: {
    id: PostingId;
    accountId: AccountId;
    direction: PostingDirection;
    amount: Money;
    seq: number;
    memo: string | null;
  }): Posting {
    return new Posting(props.id, props.accountId, props.direction, props.amount, props.seq, props.memo);
  }

  get isDebit(): boolean {
    return this.direction === "DEBIT";
  }

  /**
   * The amount under the debit-positive convention, used to prove the entry
   * balances: debits are positive, credits negative, and a valid entry sums to
   * zero. This is independent of any account's type.
   */
  get balancingAmount(): Money {
    return this.isDebit ? this.amount : this.amount.negated();
  }

  /**
   * How much this posting moves the target account's own balance — positive when
   * it increases the account, negative when it decreases it.
   *
   * The same ₹1,240 credit lowers a bank balance and raises a credit-card debt;
   * that difference lives entirely in {@link AccountType.signedEffect}.
   */
  signedEffectOn(accountType: AccountType): Money {
    return accountType.signedEffect(this.direction) === 1 ? this.amount : this.amount.negated();
  }

  withSeq(seq: number): Posting {
    return new Posting(this.id, this.accountId, this.direction, this.amount, seq, this.memo);
  }

  toString(): string {
    return `${this.direction.padEnd(6)} ${this.accountId.value} ${this.amount.toDecimalString()}`;
  }
}

/* ═══ JournalEntry ════════════════════════════════════════════════════ */

/** What kind of event the entry records. Drives grouping and iconography only. */
export type EntryKind =
  | "OPENING"
  | "EXPENSE"
  | "INCOME"
  | "TRANSFER"
  | "TRADE"
  | "ADJUSTMENT"
  | "REVERSAL";

/** How the entry got here — hand-entered, imported, or written by a trade. */
export type EntrySource = "MANUAL" | "IMPORT" | "TRADE";

/**
 * A journal entry: the atomic financial event, and the ledger's aggregate root.
 *
 * **The invariant is enforced in the constructor**, so an entry whose legs do not
 * sum to zero cannot be brought into existence — there is no setter, no
 * `validate()` a caller might forget, and no partially-built state to persist.
 * That is the property that makes drift unrepresentable rather than merely
 * unlikely, and it is the direct fix for v1 storing a balance beside an unrelated
 * list of transactions.
 *
 * Entries are **append-only**. Correcting one produces a REVERSAL via
 * {@link reverse}; nothing rewrites history, so a report run twice gives the same
 * answer.
 *
 * @example
 * JournalEntry.twoLegged({
 *   userId, postedOn, narration: "Big Bazaar — groceries", kind: "EXPENSE",
 *   debitAccountId: groceries, creditAccountId: hdfc, amount: Money.fromRupees("1240"),
 * });
 */
export class JournalEntry extends AggregateRoot<JournalEntryId> {
  private constructor(
    id: JournalEntryId,
    readonly userId: UserId,
    readonly postedOn: CalendarDate,
    readonly narration: string,
    readonly kind: EntryKind,
    readonly source: EntrySource,
    readonly postings: readonly Posting[],
    readonly reference: string | null,
    readonly importBatchId: string | null,
    readonly reversesEntryId: JournalEntryId | null,
    readonly fingerprint: string | null,
  ) {
    super(id);
    JournalEntry.assertBalances(postings);
  }

  /**
   * The three conditions that make an entry well-formed. Checked together because
   * they are not independent: you cannot sum amounts across currencies to prove a
   * balance, so the currency check must come first.
   */
  private static assertBalances(postings: readonly Posting[]): void {
    if (postings.length < 2) {
      throw new InsufficientPostingsError(postings.length);
    }

    const currencies = [...new Set(postings.map((posting) => posting.amount.currency.code))];
    if (currencies.length > 1) {
      throw new MixedCurrencyEntryError(currencies);
    }

    const currency = postings[0].amount.currency;
    const debits = JournalEntry.sumWhere(postings, (posting) => posting.isDebit, currency);
    const credits = JournalEntry.sumWhere(postings, (posting) => !posting.isDebit, currency);

    if (!debits.equals(credits)) {
      throw new UnbalancedEntryError(debits, credits);
    }
  }

  private static sumWhere(
    postings: readonly Posting[],
    predicate: (posting: Posting) => boolean,
    currency: Currency,
  ): Money {
    return Money.total(
      postings.filter(predicate).map((posting) => posting.amount),
      currency,
    );
  }

  static create(props: {
    userId: UserId;
    postedOn: CalendarDate;
    narration: string;
    kind: EntryKind;
    postings: readonly Posting[];
    source?: EntrySource;
    reference?: string | null;
    importBatchId?: string | null;
    fingerprint?: string | null;
  }): JournalEntry {
    return new JournalEntry(
      JournalEntryId.create(),
      props.userId,
      props.postedOn,
      props.narration.trim(),
      props.kind,
      props.source ?? "MANUAL",
      // Renumber so stored order always reflects written order.
      props.postings.map((posting, index) => posting.withSeq(index)),
      props.reference?.trim() || null,
      props.importBatchId ?? null,
      null,
      props.fingerprint ?? null,
    );
  }

  /**
   * The common case: money leaving one account and arriving in another.
   *
   * Every user-facing transaction the app records — an expense, income, a
   * transfer, a card payment — is this shape. Naming it once keeps use cases from
   * hand-assembling posting pairs and getting a direction backwards.
   */
  static twoLegged(props: {
    userId: UserId;
    postedOn: CalendarDate;
    narration: string;
    kind: EntryKind;
    debitAccountId: AccountId;
    creditAccountId: AccountId;
    amount: Money;
    source?: EntrySource;
    reference?: string | null;
    importBatchId?: string | null;
    fingerprint?: string | null;
    memo?: string | null;
  }): JournalEntry {
    return JournalEntry.create({
      ...props,
      postings: [
        Posting.debit(props.debitAccountId, props.amount, props.memo ?? null),
        Posting.credit(props.creditAccountId, props.amount, props.memo ?? null),
      ],
    });
  }

  /** Rehydration from stored rows. Only mappers should call this. */
  static rehydrate(props: {
    id: JournalEntryId;
    userId: UserId;
    postedOn: CalendarDate;
    narration: string;
    kind: EntryKind;
    source: EntrySource;
    postings: readonly Posting[];
    reference: string | null;
    importBatchId: string | null;
    reversesEntryId: JournalEntryId | null;
    fingerprint: string | null;
  }): JournalEntry {
    return new JournalEntry(
      props.id,
      props.userId,
      props.postedOn,
      props.narration,
      props.kind,
      props.source,
      [...props.postings].sort((a, b) => a.seq - b.seq),
      props.reference,
      props.importBatchId,
      props.reversesEntryId,
      props.fingerprint,
    );
  }

  get currency(): Currency {
    return this.postings[0].amount.currency;
  }

  /**
   * The entry's headline amount — the total debited, which by the invariant also
   * equals the total credited. This is the number shown in a transaction list.
   */
  get amount(): Money {
    return JournalEntry.sumWhere(this.postings, (posting) => posting.isDebit, this.currency);
  }

  get isReversal(): boolean {
    return this.kind === "REVERSAL";
  }

  /** True for a transfer between two of the user's own balance-sheet accounts. */
  get isTransfer(): boolean {
    return this.kind === "TRANSFER";
  }

  involves(accountId: AccountId): boolean {
    return this.postings.some((posting) => posting.accountId.equals(accountId));
  }

  postingsFor(accountId: AccountId): readonly Posting[] {
    return this.postings.filter((posting) => posting.accountId.equals(accountId));
  }

  /**
   * Net movement this entry causes in one account. Sums all matching legs, so a
   * split transaction that touches the same account twice is handled correctly.
   */
  effectOn(accountId: AccountId, accountType: AccountType): Money {
    return Money.total(
      this.postingsFor(accountId).map((posting) => posting.signedEffectOn(accountType)),
      this.currency,
    );
  }

  /**
   * The correcting entry: the same legs with debits and credits swapped.
   *
   * Reversing rather than editing is what keeps the ledger auditable — the
   * original stays visible, and the pair nets to zero in every report. A reversal
   * posts on `reversedOn` (default: the original date) so the correction lands in
   * the period the mistake was made, not the period it was noticed.
   */
  reverse(props?: { reversedOn?: CalendarDate; narration?: string }): JournalEntry {
    const flipped = this.postings.map((posting, index) =>
      (posting.isDebit
        ? Posting.credit(posting.accountId, posting.amount, posting.memo)
        : Posting.debit(posting.accountId, posting.amount, posting.memo)
      ).withSeq(index),
    );

    return new JournalEntry(
      JournalEntryId.create(),
      this.userId,
      props?.reversedOn ?? this.postedOn,
      props?.narration ?? `Reversal of: ${this.narration}`,
      "REVERSAL",
      this.source,
      flipped,
      this.reference,
      this.importBatchId,
      this.id,
      // A reversal must not inherit the original's import fingerprint, or the
      // unique index would reject it as a duplicate of what it is undoing.
      null,
    );
  }

  /** Multi-line rendering, for debugging and for error messages. */
  toString(): string {
    const legs = this.postings.map((posting) => `  ${posting.toString()}`).join("\n");
    return `${this.postedOn.toISO()}  "${this.narration}" [${this.kind}]\n${legs}`;
  }
}

/* ═══ BalanceCalculator ═══════════════════════════════════════════════ */

/**
 * The reference implementation of "what is this account's balance?" — a pure fold
 * over entries, with no I/O.
 *
 * The production read path is SQL (`BalanceQuery`), because summing every posting
 * in JavaScript does not scale. This class is why that SQL can be trusted: it is
 * the same definition expressed in ~40 obviously-correct lines, so the aggregate
 * queries can be checked against it instead of being taken on faith. It is also
 * what tests and the in-memory fake use.
 *
 * Definitions, in one place:
 *   - balance-sheet accounts (asset/liability/equity) accumulate over all time up
 *     to a date;
 *   - income and expense accounts are only meaningful over a period;
 *   - a balance is signed in the account's own favour, via
 *     {@link AccountType.signedEffect}.
 */
export class BalanceCalculator {
  constructor(private readonly currency: Currency = Currency.reporting) {}

  /**
   * Cumulative balances up to and including `asOf`, keyed by account id.
   * Accounts with no postings are present with a zero balance.
   */
  balancesAsOf(
    accounts: readonly Account[],
    entries: readonly JournalEntry[],
    asOf: CalendarDate,
  ): Map<string, Money> {
    return this.fold(accounts, entries, (entry) => entry.postedOn.isOnOrBefore(asOf));
  }

  /** Totals posted within `range` — the right question for income and expense. */
  balancesWithin(
    accounts: readonly Account[],
    entries: readonly JournalEntry[],
    range: DateRange,
  ): Map<string, Money> {
    return this.fold(accounts, entries, (entry) => range.contains(entry.postedOn));
  }

  private fold(
    accounts: readonly Account[],
    entries: readonly JournalEntry[],
    include: (entry: JournalEntry) => boolean,
  ): Map<string, Money> {
    const typeById = new Map<string, AccountType>(
      accounts.map((account) => [account.id.value, account.type]),
    );
    const balances = new Map<string, Money>(
      accounts.map((account) => [account.id.value, Money.zero(this.currency)]),
    );

    for (const entry of entries) {
      if (!include(entry)) continue;
      for (const posting of entry.postings) {
        const key = posting.accountId.value;
        const type = typeById.get(key);
        // A posting to an account outside `accounts` is skipped rather than
        // guessed at — the caller chose the account set.
        if (!type) continue;
        balances.set(key, (balances.get(key) ?? Money.zero(this.currency)).plus(posting.signedEffectOn(type)));
      }
    }

    return balances;
  }

  balanceOf(
    account: Account,
    entries: readonly JournalEntry[],
    asOf: CalendarDate,
  ): Money {
    return this.balancesAsOf([account], entries, asOf).get(account.id.value) ?? Money.zero(this.currency);
  }

  /**
   * Net worth as of a date: assets minus liabilities.
   *
   * Income and expense accounts are excluded because they are flows, not
   * holdings — including them would double-count every transaction, once in the
   * category and once in the bank balance it came out of.
   */
  netWorthAsOf(
    accounts: readonly Account[],
    entries: readonly JournalEntry[],
    asOf: CalendarDate,
  ): { assets: Money; liabilities: Money; netWorth: Money } {
    const balances = this.balancesAsOf(accounts, entries, asOf);
    const zero = Money.zero(this.currency);

    let assets = zero;
    let liabilities = zero;
    for (const account of accounts) {
      const balance = balances.get(account.id.value) ?? zero;
      if (account.type === AccountType.ASSET) assets = assets.plus(balance);
      else if (account.type === AccountType.LIABILITY) liabilities = liabilities.plus(balance);
    }

    return { assets, liabilities, netWorth: assets.minus(liabilities) };
  }

  /**
   * Proves the ledger is internally consistent: across every posting ever made,
   * total debits equal total credits.
   *
   * Each entry guarantees this for itself at construction, so a failure here means
   * the *store* is corrupt — a partial write, or a row edited outside the app.
   * Cheap enough to run as a maintenance check, and it is the one assertion that
   * would have caught v1's drift.
   */
  verifyIntegrity(entries: readonly JournalEntry[]): {
    ok: boolean;
    debits: Money;
    credits: Money;
    offendingEntryIds: string[];
  } {
    const zero = Money.zero(this.currency);
    let debits = zero;
    let credits = zero;
    const offendingEntryIds: string[] = [];

    for (const entry of entries) {
      let entryDebits = zero;
      let entryCredits = zero;
      for (const posting of entry.postings) {
        if (posting.isDebit) entryDebits = entryDebits.plus(posting.amount);
        else entryCredits = entryCredits.plus(posting.amount);
      }
      if (!entryDebits.equals(entryCredits)) offendingEntryIds.push(entry.id.value);
      debits = debits.plus(entryDebits);
      credits = credits.plus(entryCredits);
    }

    return { ok: debits.equals(credits) && offendingEntryIds.length === 0, debits, credits, offendingEntryIds };
  }

  /** Sum of the given accounts' balances — used for subtree rollups. */
  totalOf(
    accountIds: readonly AccountId[],
    balances: ReadonlyMap<string, Money>,
  ): Money {
    return Money.total(
      accountIds.map((id) => balances.get(id.value) ?? Money.zero(this.currency)),
      this.currency,
    );
  }
}

/* ═══ JournalRepository (port) ════════════════════════════════════════ */

export interface JournalQuery {
  /** Only entries touching one of these accounts. */
  accountIds?: readonly AccountId[];
  range?: DateRange;
  /** Free-text match against the narration and reference. */
  search?: string;
  importBatchId?: string;
  limit?: number;
  offset?: number;
}

export interface JournalPage {
  entries: readonly JournalEntry[];
  /** Total matching the query, ignoring limit/offset — for pagination. */
  totalCount: number;
}

/**
 * Persistence for journal entries.
 *
 * Whole aggregates only: `save` writes the entry and all its postings in one
 * database transaction, and there is deliberately no way to add, edit or remove a
 * single posting. A partial write would leave an unbalanced entry in the table,
 * which is exactly the state {@link JournalEntry}'s constructor exists to prevent.
 *
 * There is no `update`. Entries are append-only; corrections go through
 * `JournalEntry.reverse()` and are saved as new entries.
 */
export interface JournalRepository {
  /** Writes the entry and its postings atomically. */
  save(entry: JournalEntry): Promise<void>;

  /** Writes many entries in one transaction — an import either lands or doesn't. */
  saveMany(entries: readonly JournalEntry[]): Promise<void>;

  findById(userId: UserId, id: JournalEntryId): Promise<JournalEntry | null>;

  find(userId: UserId, query: JournalQuery): Promise<JournalPage>;

  /**
   * Whether an imported row is already present. Checked before building the
   * entry so a duplicate is a friendly skip rather than a unique-index error.
   */
  existsWithFingerprint(userId: UserId, fingerprint: string): Promise<boolean>;

  /** Which of these fingerprints already exist — one round trip per import. */
  findExistingFingerprints(
    userId: UserId,
    fingerprints: readonly string[],
  ): Promise<ReadonlySet<string>>;

  /** True when this entry has already been reversed, so it is not reversed twice. */
  hasReversal(userId: UserId, id: JournalEntryId): Promise<boolean>;

  /**
   * Undo an import. Returns how many entries were tombstoned.
   *
   * Previously a hard delete that relied on `ON DELETE CASCADE` to take the
   * postings with it — which destroyed the evidence of what the import had done,
   * so "undo it and tell me what changed" was unanswerable.
   */
  softDeleteByImportBatch(userId: UserId, importBatchId: string, at: Date): Promise<number>;

  /**
   * Stamps `deletedAt` on an entry — invariant A03.
   *
   * Not how a *mistake* is corrected: an entry that posted the wrong amount is
   * fixed with a reversing entry, so both the error and the correction stay
   * visible. This is for an entry that should never have existed, such as a
   * duplicate from a re-import.
   */
  softDelete(userId: UserId, id: JournalEntryId, at: Date): Promise<void>;

  /** The earliest posted date, used to size the net-worth timeline. */
  earliestPostedOn(userId: UserId): Promise<CalendarDate | null>;
}

/* ═══ BalanceQuery (port) ═════════════════════════════════════════════ */

/**
 * An account's balance, signed in the account's own favour: a positive figure
 * means "more asset" or "more debt", never a raw debit total.
 */
export interface AccountBalance {
  accountId: AccountId;
  code: string;
  name: string;
  type: AccountTypeName;
  subtype: string | null;
  institution: string | null;
  isClosed: boolean;
  /** Cumulative to the as-of date for balance-sheet accounts. */
  balance: Money;
  /** Postings behind this balance — distinguishes "₹0" from "never used". */
  postingCount: number;
}

/** Cumulative totals per account type, as of a date. */
export interface TypeTotals {
  asOf: CalendarDate;
  assets: Money;
  liabilities: Money;
  equity: Money;
  /** assets − liabilities. */
  netWorth: Money;
}

/** Income and expense for one month — the savings-rate series. */
export interface MonthlyFlow {
  /** `YYYY-MM`. */
  month: string;
  income: Money;
  expense: Money;
}

/** Total posted to one account over a period, for category comparisons. */
export interface AccountFlow {
  accountId: AccountId;
  code: string;
  name: string;
  type: AccountTypeName;
  amount: Money;
  postingCount: number;
}

/**
 * The ledger's read side.
 *
 * Separate from {@link JournalRepository} on purpose. Balances are aggregates over
 * potentially every posting a user has ever made, so they belong in SQL —
 * `SUM(...)` with a `GROUP BY`, not a million entries loaded into memory and
 * folded in JavaScript. Pretending these queries went through the aggregate
 * repository would either be a lie or a performance cliff.
 *
 * Nothing here returns a domain entity: these are read models, consumed directly
 * by reports and the dashboard.
 *
 * Every implementation must agree with {@link BalanceCalculator}, the pure fold
 * over the same data. That equivalence is what makes the fast SQL path
 * trustworthy, and it is checked by test rather than assumed.
 */
export interface BalanceQuery {
  /** Balances for all balance-sheet accounts, cumulative to `asOf`. */
  balanceSheet(
    userId: UserId,
    asOf: CalendarDate,
    options?: { includeClosed?: boolean; includeEmpty?: boolean },
  ): Promise<AccountBalance[]>;

  balanceOf(userId: UserId, accountId: AccountId, asOf: CalendarDate): Promise<Money>;

  /** Assets, liabilities and net worth as of a date. */
  totals(userId: UserId, asOf: CalendarDate): Promise<TypeTotals>;

  /** Income and expense totals for each month in `range`. */
  monthlyFlows(userId: UserId, range: DateRange): Promise<MonthlyFlow[]>;

  /**
   * Totals per income/expense account over a period — the category breakdown.
   * `rollUp` sums descendants into their parent, so `Expenses:Food` reports the
   * whole subtree rather than only what was posted to it directly.
   */
  flowsByAccount(
    userId: UserId,
    range: DateRange,
    options?: { type?: "INCOME" | "EXPENSE"; rollUp?: boolean },
  ): Promise<AccountFlow[]>;

  /** Running balance of one account over a period, for its detail chart. */
  balanceSeries(
    userId: UserId,
    accountId: AccountId,
    range: DateRange,
  ): Promise<{ date: CalendarDate; balance: Money }[]>;
}

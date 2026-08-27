/**
 * Accounts: the chart of accounts and the algebra of debit and credit.
 *
 * Consolidated from nine files under `src/modules/ledger/domain/`. Ordering runs
 * from the smallest value object outward, so nothing forward-references.
 *
 * `PostingDirection` lives here rather than with postings because `AccountType`
 * consumes it — `signedEffect(direction)` is what makes a debit mean "increase"
 * for an asset and "decrease" for a liability. Putting it in `transactions.ts`
 * would make this file import that one and invert the dependency arrow.
 *
 * The `AccountRepository` port is declared here too, with the aggregate it serves:
 * in `infra/` it would be a dependency pointing the wrong way.
 */

import { AggregateRoot, DomainError, UniqueId, UserId, ValueObject, newUuid } from "@/core/kernel";
import { Currency } from "@/core/money";
/* ═══ PostingDirection ════════════════════════════════════════════════ */

/**
 * Which side of the entry a posting sits on.
 *
 * A posting's amount is always positive and its side carries the meaning. The
 * alternative — a signed amount — makes "-500 on Groceries" ambiguous between a
 * refund and a correction, and lets a typo flip a debit into a credit without
 * failing any check.
 */
export type PostingDirection = "DEBIT" | "CREDIT";

export function oppositeOf(direction: PostingDirection): PostingDirection {
  return direction === "DEBIT" ? "CREDIT" : "DEBIT";
}

/* ═══ AccountType ═════════════════════════════════════════════════════ */

export type AccountTypeName = "ASSET" | "LIABILITY" | "EQUITY" | "INCOME" | "EXPENSE";

/**
 * One of the five account types, together with the behaviour that follows from it.
 *
 * An enum of five strings would push the interesting part — "does a debit make
 * this go up or down?" — out into `if` chains at every call site, which is how
 * sign errors get in. Encoding the normal balance here means there is exactly one
 * answer in the codebase, and `signedEffect` is the only place a debit or credit
 * is turned into a direction of movement.
 */
export class AccountType extends ValueObject {
  private constructor(
    readonly name: AccountTypeName,
    /** The direction that *increases* this account. */
    readonly normalBalance: PostingDirection,
    readonly label: string,
  ) {
    super();
  }

  static readonly ASSET = new AccountType("ASSET", "DEBIT", "Assets");
  static readonly LIABILITY = new AccountType("LIABILITY", "CREDIT", "Liabilities");
  static readonly EQUITY = new AccountType("EQUITY", "CREDIT", "Equity");
  static readonly INCOME = new AccountType("INCOME", "CREDIT", "Income");
  static readonly EXPENSE = new AccountType("EXPENSE", "DEBIT", "Expenses");

  private static readonly ALL = [
    AccountType.ASSET,
    AccountType.LIABILITY,
    AccountType.EQUITY,
    AccountType.INCOME,
    AccountType.EXPENSE,
  ] as const;

  static of(name: AccountTypeName): AccountType {
    const found = AccountType.ALL.find((type) => type.name === name);
    if (!found) throw new RangeError(`Unknown account type: ${name}`);
    return found;
  }

  static all(): readonly AccountType[] {
    return AccountType.ALL;
  }

  /**
   * How a posting in `direction` moves this account's balance: `1` up, `-1` down.
   *
   * A debit raises an asset but lowers a liability — this single expression is
   * what makes that true everywhere, rather than being re-derived per report.
   */
  signedEffect(direction: PostingDirection): 1 | -1 {
    return direction === this.normalBalance ? 1 : -1;
  }

  /**
   * Balance-sheet accounts: they carry a running balance across all time, and
   * they are what net worth is computed from.
   */
  get isBalanceSheet(): boolean {
    return this === AccountType.ASSET || this === AccountType.LIABILITY || this === AccountType.EQUITY;
  }

  /**
   * Income-statement accounts: meaningful only over a period, and always reported
   * for a date range rather than as a cumulative total.
   */
  get isIncomeStatement(): boolean {
    return this === AccountType.INCOME || this === AccountType.EXPENSE;
  }

  /** Assets count positively toward net worth, liabilities negatively. */
  get netWorthSign(): 1 | -1 | 0 {
    if (this === AccountType.ASSET) return 1;
    if (this === AccountType.LIABILITY) return -1;
    return 0;
  }

  /** Whether a user may create accounts of this type by hand. */
  get isUserCreatable(): boolean {
    // Equity is bookkeeping machinery (opening balances, retained earnings); the
    // app maintains it, and letting a user post to it by hand invites a silently
    // unbalanced net worth.
    return this !== AccountType.EQUITY;
  }

  protected components(): readonly unknown[] {
    return [this.name];
  }

  toString(): string {
    return this.name;
  }
}

/* ═══ AccountCode ═════════════════════════════════════════════════════ */

const SEGMENT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 &.'()-]*$/;
const SEPARATOR = ":";
const MAX_DEPTH = 6;

/**
 * A colon-delimited path naming an account: `Assets:Bank:HDFC`.
 *
 * Exists so that seed data, imports and tests can reference an account without
 * knowing its generated uuid, and so a rollup ("everything under
 * `Expenses:Food`") is a prefix match rather than a recursive query. The code is
 * unique per user, which is what makes an import idempotent across runs.
 */
export class AccountCode extends ValueObject {
  private constructor(readonly segments: readonly string[]) {
    super();
  }

  static parse(value: string): AccountCode {
    const segments = value
      .split(SEPARATOR)
      .map((segment) => segment.trim())
      .filter((segment) => segment.length > 0);

    if (segments.length === 0) {
      throw new TypeError("An account code needs at least one segment");
    }
    if (segments.length > MAX_DEPTH) {
      throw new RangeError(
        `Account code is ${segments.length} levels deep; the maximum is ${MAX_DEPTH}: "${value}"`,
      );
    }
    for (const segment of segments) {
      if (!SEGMENT_PATTERN.test(segment)) {
        throw new TypeError(`"${segment}" is not a valid account code segment`);
      }
    }

    return new AccountCode(segments);
  }

  static of(...segments: readonly string[]): AccountCode {
    return AccountCode.parse(segments.join(SEPARATOR));
  }

  /** The last segment — what the account is called on its own. */
  get leaf(): string {
    return this.segments[this.segments.length - 1];
  }

  get depth(): number {
    return this.segments.length;
  }

  /** The code of the parent account, or null at the root. */
  get parent(): AccountCode | null {
    if (this.segments.length === 1) return null;
    return new AccountCode(this.segments.slice(0, -1));
  }

  child(segment: string): AccountCode {
    return AccountCode.parse([...this.segments, segment].join(SEPARATOR));
  }

  /** True when `this` is `other` or sits beneath it — the rollup test. */
  isUnder(other: AccountCode): boolean {
    if (other.segments.length > this.segments.length) return false;
    return other.segments.every(
      (segment, index) => segment.toLowerCase() === this.segments[index].toLowerCase(),
    );
  }

  /** All ancestor codes, root first — the breadcrumb trail. */
  ancestors(): AccountCode[] {
    return this.segments
      .slice(0, -1)
      .map((_, index) => new AccountCode(this.segments.slice(0, index + 1)));
  }

  protected components(): readonly unknown[] {
    return [this.toString().toLowerCase()];
  }

  toString(): string {
    return this.segments.join(SEPARATOR);
  }

  toJSON(): string {
    return this.toString();
  }
}

/* ═══ Identity ════════════════════════════════════════════════════════ */

/**
 * The ledger's identifier types.
 *
 * Each carries a private marker field, which makes them mutually incompatible at
 * compile time — passing a `JournalEntryId` where an `AccountId` belongs will not
 * type-check, even though both wrap a uuid string.
 */

export class AccountId extends UniqueId {
  private readonly __accountId = true;

  static create(): AccountId {
    return new AccountId(newUuid());
  }

  static from(value: string): AccountId {
    return new AccountId(value);
  }
}

/* ═══ Errors ══════════════════════════════════════════════════════════ */

export class AccountClosedError extends DomainError {
  constructor(accountName: string) {
    super("LEDGER_ACCOUNT_CLOSED", `${accountName} is closed, so it cannot be posted to.`);
  }
}

export class SystemAccountError extends DomainError {
  constructor(accountName: string, action: string) {
    super(
      "LEDGER_SYSTEM_ACCOUNT",
      `${accountName} is maintained by the app and cannot be ${action}.`,
    );
  }
}

export class AccountHasPostingsError extends DomainError {
  constructor(accountName: string, postingCount: number) {
    super(
      "LEDGER_ACCOUNT_HAS_POSTINGS",
      `${accountName} has ${postingCount} transaction(s) and cannot be deleted. ` +
        `Close it instead — that keeps its history and hides it from pickers.`,
    );
  }
}

export class AccountCycleError extends DomainError {
  constructor(accountName: string) {
    super(
      "LEDGER_ACCOUNT_CYCLE",
      `${accountName} cannot be moved under one of its own descendants.`,
    );
  }
}

/* ═══ Account ═════════════════════════════════════════════════════════ */

/**
 * What real-world thing an account represents. Presentational only — grouping and
 * icons. Every arithmetic decision keys off {@link AccountType} instead, so adding
 * a subtype can never change a total.
 */
export type AccountSubtype =
  | "BANK"
  | "SAVINGS"
  | "CASH"
  | "WALLET"
  | "DEPOSIT"
  | "CREDIT_CARD"
  | "LOAN"
  | "MORTGAGE"
  | "BROKERAGE"
  | "RETIREMENT"
  | "REAL_ESTATE"
  | "VEHICLE"
  | "PRECIOUS_METAL"
  | "RECEIVABLE"
  | "OPENING"
  | "ADJUSTMENT"
  | "OTHER";

/**
 * The 16 values `txn_type_legality` keys on — `20-DOMAIN-MODEL.md` §2.1.
 *
 * Derived rather than stored. The document models this as a single 16-value
 * `account_type` column; we keep the five-value {@link AccountType} (which owns
 * the debit/credit algebra) and {@link AccountSubtype} (which owns presentation)
 * and compute the role from the pair. One column cannot then disagree with the
 * other, and the sign of a posting still depends on `type` alone.
 */
export type LegalityRole =
  | "ASSET_CASH"
  | "ASSET_BANK"
  | "ASSET_SAVINGS"
  | "ASSET_BROKERAGE"
  | "ASSET_RETIREMENT"
  | "ASSET_DEPOSIT"
  | "ASSET_PROPERTY"
  | "ASSET_OTHER"
  | "LIABILITY_CREDIT_CARD"
  | "LIABILITY_LOAN"
  | "LIABILITY_MORTGAGE"
  | "LIABILITY_OTHER"
  | "INCOME"
  | "EXPENSE"
  | "EQUITY_OPENING"
  | "EQUITY_ADJUSTMENT";

export const LEGALITY_ROLES: readonly LegalityRole[] = [
  "ASSET_CASH",
  "ASSET_BANK",
  "ASSET_SAVINGS",
  "ASSET_BROKERAGE",
  "ASSET_RETIREMENT",
  "ASSET_DEPOSIT",
  "ASSET_PROPERTY",
  "ASSET_OTHER",
  "LIABILITY_CREDIT_CARD",
  "LIABILITY_LOAN",
  "LIABILITY_MORTGAGE",
  "LIABILITY_OTHER",
  "INCOME",
  "EXPENSE",
  "EQUITY_OPENING",
  "EQUITY_ADJUSTMENT",
];

const ASSET_ROLE: Partial<Record<AccountSubtype, LegalityRole>> = {
  CASH: "ASSET_CASH",
  WALLET: "ASSET_CASH",
  BANK: "ASSET_BANK",
  SAVINGS: "ASSET_SAVINGS",
  BROKERAGE: "ASSET_BROKERAGE",
  RETIREMENT: "ASSET_RETIREMENT",
  DEPOSIT: "ASSET_DEPOSIT",
  REAL_ESTATE: "ASSET_PROPERTY",
};

const LIABILITY_ROLE: Partial<Record<AccountSubtype, LegalityRole>> = {
  CREDIT_CARD: "LIABILITY_CREDIT_CARD",
  LOAN: "LIABILITY_LOAN",
  MORTGAGE: "LIABILITY_MORTGAGE",
};

/**
 * The legality role for an account.
 *
 * Falls back to the `_OTHER` member of its side rather than throwing: a new
 * subtype should not make an account unpostable, it should just not gain a
 * special legality rule until one is seeded for it.
 */
export function legalityRoleOf(
  type: AccountTypeName,
  subtype: AccountSubtype | null,
): LegalityRole {
  switch (type) {
    case "ASSET":
      return (subtype && ASSET_ROLE[subtype]) ?? "ASSET_OTHER";
    case "LIABILITY":
      return (subtype && LIABILITY_ROLE[subtype]) ?? "LIABILITY_OTHER";
    case "INCOME":
      return "INCOME";
    case "EXPENSE":
      return "EXPENSE";
    case "EQUITY":
      return subtype === "ADJUSTMENT" ? "EQUITY_ADJUSTMENT" : "EQUITY_OPENING";
  }
}

/**
 * An account in the chart of accounts.
 *
 * Note what is *not* here: a balance. An account is a label on a bucket; what is
 * in the bucket is the sum of its postings, computed on read. v1 stored a balance
 * on the account and a list of transactions elsewhere, and nothing kept the two
 * agreeing — so the field is deliberately absent rather than merely unused.
 */
export class Account extends AggregateRoot<AccountId> {
  private constructor(
    id: AccountId,
    readonly userId: UserId,
    readonly code: AccountCode,
    readonly name: string,
    readonly type: AccountType,
    readonly subtype: AccountSubtype | null,
    readonly parentId: AccountId | null,
    readonly currency: Currency,
    readonly institution: string | null,
    readonly accountNumberSuffix: string | null,
    readonly isClosed: boolean,
    readonly isSystem: boolean,
    readonly sortOrder: number,
  ) {
    super(id);
  }

  static open(props: {
    userId: UserId;
    code: AccountCode;
    name: string;
    type: AccountType;
    subtype?: AccountSubtype | null;
    parentId?: AccountId | null;
    currency?: Currency;
    institution?: string | null;
    accountNumberSuffix?: string | null;
    isSystem?: boolean;
    sortOrder?: number;
  }): Account {
    const name = props.name.trim();
    if (name.length === 0) {
      throw new TypeError("An account needs a name");
    }

    const suffix = props.accountNumberSuffix?.trim() || null;
    if (suffix !== null && !/^\d{4}$/.test(suffix)) {
      throw new TypeError(
        `Account number suffix must be exactly 4 digits, got "${suffix}". ` +
          `Only the last four are stored — never the full number.`,
      );
    }

    return new Account(
      AccountId.create(),
      props.userId,
      props.code,
      name,
      props.type,
      props.subtype ?? null,
      props.parentId ?? null,
      props.currency ?? Currency.reporting,
      props.institution?.trim() || null,
      suffix,
      false,
      props.isSystem ?? false,
      props.sortOrder ?? 0,
    );
  }

  /** Rehydration from a stored row. Only mappers should call this. */
  static rehydrate(props: {
    id: AccountId;
    userId: UserId;
    code: AccountCode;
    name: string;
    type: AccountType;
    subtype: AccountSubtype | null;
    parentId: AccountId | null;
    currency: Currency;
    institution: string | null;
    accountNumberSuffix: string | null;
    isClosed: boolean;
    isSystem: boolean;
    sortOrder: number;
  }): Account {
    return new Account(
      props.id,
      props.userId,
      props.code,
      props.name,
      props.type,
      props.subtype,
      props.parentId,
      props.currency,
      props.institution,
      props.accountNumberSuffix,
      props.isClosed,
      props.isSystem,
      props.sortOrder,
    );
  }

  /** Whether new transactions may be posted here. */
  get acceptsPostings(): boolean {
    return !this.isClosed;
  }

  /** How this account's balance affects net worth: assets `+`, liabilities `-`. */
  get netWorthSign(): 1 | -1 | 0 {
    return this.type.netWorthSign;
  }

  /** Display label: `"HDFC Savings ••1234"`. */
  get displayName(): string {
    return this.accountNumberSuffix ? `${this.name} ••${this.accountNumberSuffix}` : this.name;
  }

  rename(name: string): Account {
    const trimmed = name.trim();
    if (trimmed.length === 0) throw new TypeError("An account needs a name");
    return this.copyWith({ name: trimmed });
  }

  /**
   * Hides the account from pickers while keeping every posting it ever had.
   *
   * Closing rather than deleting is the only safe option for an account with
   * history: deleting it would orphan postings and silently change past totals.
   */
  close(): Account {
    if (this.isSystem) throw new SystemAccountError(this.name, "closed");
    return this.copyWith({ isClosed: true });
  }

  reopen(): Account {
    return this.copyWith({ isClosed: false });
  }

  /**
   * Re-parents the account. `descendantIds` is supplied by the caller (which has
   * the tree) so the check can happen here, in the domain, rather than in a
   * repository — moving an account under its own child would create a cycle that
   * makes every rollup query non-terminating.
   */
  moveUnder(parentId: AccountId | null, descendantIds: readonly AccountId[]): Account {
    if (parentId !== null) {
      if (parentId.equals(this.id)) throw new AccountCycleError(this.name);
      if (descendantIds.some((id) => id.equals(parentId))) {
        throw new AccountCycleError(this.name);
      }
    }
    return this.copyWith({ parentId });
  }

  updateDetails(props: {
    institution?: string | null;
    accountNumberSuffix?: string | null;
    subtype?: AccountSubtype | null;
    sortOrder?: number;
  }): Account {
    const suffix = props.accountNumberSuffix?.trim() || null;
    if (suffix !== null && !/^\d{4}$/.test(suffix)) {
      throw new TypeError(
        `Account number suffix must be exactly 4 digits, got "${suffix}". ` +
          `Only the last four are stored — never the full number.`,
      );
    }

    return this.copyWith({
      institution: props.institution === undefined ? this.institution : props.institution?.trim() || null,
      accountNumberSuffix:
        props.accountNumberSuffix === undefined ? this.accountNumberSuffix : suffix,
      subtype: props.subtype === undefined ? this.subtype : props.subtype,
      sortOrder: props.sortOrder ?? this.sortOrder,
    });
  }

  private copyWith(changes: {
    name?: string;
    subtype?: AccountSubtype | null;
    parentId?: AccountId | null;
    institution?: string | null;
    accountNumberSuffix?: string | null;
    isClosed?: boolean;
    sortOrder?: number;
  }): Account {
    return new Account(
      this.id,
      this.userId,
      this.code,
      changes.name ?? this.name,
      this.type,
      changes.subtype === undefined ? this.subtype : changes.subtype,
      changes.parentId === undefined ? this.parentId : changes.parentId,
      this.currency,
      changes.institution === undefined ? this.institution : changes.institution,
      changes.accountNumberSuffix === undefined ? this.accountNumberSuffix : changes.accountNumberSuffix,
      changes.isClosed ?? this.isClosed,
      this.isSystem,
      changes.sortOrder ?? this.sortOrder,
    );
  }

  toString(): string {
    return `${this.code.toString()} (${this.type.name})`;
  }
}

/* ═══ ChartOfAccounts ═════════════════════════════════════════════════ */

/**
 * Accounts the application itself depends on, referenced by code.
 *
 * Code needs to post to "the opening-balance account" or "the account investing
 * charges go to" without asking the user to nominate one. These are marked
 * `isSystem`, so they cannot be renamed out from under the code that looks them
 * up or deleted while entries point at them.
 */
export const SystemAccountCodes = {
  /** The counterweight for a starting balance — see `RecordOpeningBalance`. */
  openingBalances: "Equity:Opening Balances",
  /** Brokerage, STT, GST and the rest. Kept out of the cost basis of a holding. */
  investingCharges: "Expenses:Investing:Charges",
  /** Where an import puts a row no keyword rule matched. */
  uncategorizedExpense: "Expenses:Uncategorized",
  uncategorizedIncome: "Income:Uncategorized",
  dividends: "Income:Investing:Dividends",
  interestIncome: "Income:Investing:Interest",
  /** Parent of the per-holding asset accounts the investments module creates. */
  investments: "Assets:Investments",
  /** Where tax withheld at source is booked — recoverable, so an asset. */
  taxDeductedAtSource: "Assets:Receivables:TDS",
} as const;

export type SystemAccountKey = keyof typeof SystemAccountCodes;

interface SeedAccount {
  code: string;
  name: string;
  type: AccountTypeName;
  subtype?: AccountSubtype;
  isSystem?: boolean;
}

/**
 * The chart of accounts a new user starts with.
 *
 * Opinionated toward Indian personal finance — the categories are the ones that
 * actually show up on an Indian bank statement (UPI, fuel, mobile recharge, rent,
 * insurance premiums) rather than a generic set the user would have to rewrite.
 * They are ordinary accounts, so anything unwanted can be renamed or closed.
 *
 * Parents come before children: the seeder relies on that ordering to resolve
 * `parentId` in one pass.
 */
export const DEFAULT_CHART: readonly SeedAccount[] = [
  // ── Assets ────────────────────────────────────────────────────────────────
  { code: "Assets", name: "Assets", type: "ASSET" },
  { code: "Assets:Bank", name: "Bank Accounts", type: "ASSET", subtype: "BANK" },
  { code: "Assets:Cash", name: "Cash in Hand", type: "ASSET", subtype: "CASH" },
  { code: "Assets:Wallets", name: "Wallets & UPI", type: "ASSET", subtype: "WALLET" },
  {
    code: SystemAccountCodes.investments,
    name: "Investments",
    type: "ASSET",
    subtype: "BROKERAGE",
    isSystem: true,
  },
  { code: "Assets:Retirement", name: "EPF, PPF & NPS", type: "ASSET", subtype: "RETIREMENT" },
  { code: "Assets:Property", name: "Property", type: "ASSET", subtype: "REAL_ESTATE" },
  { code: "Assets:Vehicles", name: "Vehicles", type: "ASSET", subtype: "VEHICLE" },
  { code: "Assets:Jewellery", name: "Jewellery & Metals", type: "ASSET", subtype: "PRECIOUS_METAL" },
  { code: "Assets:Receivables", name: "Money Owed to Me", type: "ASSET", subtype: "RECEIVABLE" },
  /*
   * Tax withheld at source, by a bank on interest or by a gold platform on lease
   * interest paid in grams. An **asset**, not an expense: it is money already paid
   * towards the user's own tax bill and reclaimed in the return, so expensing it
   * would understate net worth by exactly the refund due.
   */
  {
    code: "Assets:Receivables:TDS",
    name: "Tax Deducted at Source",
    type: "ASSET",
    subtype: "RECEIVABLE",
    isSystem: true,
  },

  // ── Liabilities ───────────────────────────────────────────────────────────
  { code: "Liabilities", name: "Liabilities", type: "LIABILITY" },
  { code: "Liabilities:Credit Cards", name: "Credit Cards", type: "LIABILITY", subtype: "CREDIT_CARD" },
  { code: "Liabilities:Loans", name: "Loans", type: "LIABILITY", subtype: "LOAN" },
  { code: "Liabilities:Payables", name: "Money I Owe", type: "LIABILITY", subtype: "OTHER" },

  // ── Equity ────────────────────────────────────────────────────────────────
  { code: "Equity", name: "Equity", type: "EQUITY", isSystem: true },
  {
    code: SystemAccountCodes.openingBalances,
    name: "Opening Balances",
    type: "EQUITY",
    isSystem: true,
  },

  // ── Income ────────────────────────────────────────────────────────────────
  { code: "Income", name: "Income", type: "INCOME" },
  { code: "Income:Salary", name: "Salary", type: "INCOME" },
  { code: "Income:Business", name: "Business & Freelance", type: "INCOME" },
  { code: "Income:Rent", name: "Rental Income", type: "INCOME" },
  { code: "Income:Investing", name: "Investment Income", type: "INCOME" },
  { code: SystemAccountCodes.dividends, name: "Dividends", type: "INCOME", isSystem: true },
  { code: SystemAccountCodes.interestIncome, name: "Interest", type: "INCOME", isSystem: true },
  { code: "Income:Refunds", name: "Refunds & Cashback", type: "INCOME" },
  { code: "Income:Gifts", name: "Gifts Received", type: "INCOME" },
  {
    code: SystemAccountCodes.uncategorizedIncome,
    name: "Uncategorized Income",
    type: "INCOME",
    isSystem: true,
  },

  // ── Expenses ──────────────────────────────────────────────────────────────
  { code: "Expenses", name: "Expenses", type: "EXPENSE" },
  { code: "Expenses:Food", name: "Food", type: "EXPENSE" },
  { code: "Expenses:Food:Groceries", name: "Groceries", type: "EXPENSE" },
  { code: "Expenses:Food:Eating Out", name: "Eating Out & Delivery", type: "EXPENSE" },
  { code: "Expenses:Housing", name: "Housing", type: "EXPENSE" },
  { code: "Expenses:Housing:Rent", name: "Rent", type: "EXPENSE" },
  { code: "Expenses:Housing:Maintenance", name: "Society & Maintenance", type: "EXPENSE" },
  { code: "Expenses:Utilities", name: "Utilities", type: "EXPENSE" },
  { code: "Expenses:Utilities:Electricity", name: "Electricity", type: "EXPENSE" },
  { code: "Expenses:Utilities:Gas", name: "Gas", type: "EXPENSE" },
  { code: "Expenses:Utilities:Water", name: "Water", type: "EXPENSE" },
  { code: "Expenses:Utilities:Internet", name: "Internet & Broadband", type: "EXPENSE" },
  { code: "Expenses:Utilities:Mobile", name: "Mobile & Recharge", type: "EXPENSE" },
  { code: "Expenses:Transport", name: "Transport", type: "EXPENSE" },
  { code: "Expenses:Transport:Fuel", name: "Fuel", type: "EXPENSE" },
  { code: "Expenses:Transport:Cabs", name: "Cabs & Auto", type: "EXPENSE" },
  { code: "Expenses:Transport:Public", name: "Metro, Bus & Rail", type: "EXPENSE" },
  { code: "Expenses:Transport:Vehicle", name: "Servicing & Parking", type: "EXPENSE" },
  { code: "Expenses:Health", name: "Health", type: "EXPENSE" },
  { code: "Expenses:Health:Medical", name: "Doctor & Medicines", type: "EXPENSE" },
  { code: "Expenses:Health:Fitness", name: "Fitness", type: "EXPENSE" },
  { code: "Expenses:Insurance", name: "Insurance Premiums", type: "EXPENSE" },
  { code: "Expenses:Education", name: "Education", type: "EXPENSE" },
  { code: "Expenses:Shopping", name: "Shopping", type: "EXPENSE" },
  { code: "Expenses:Shopping:Clothing", name: "Clothing", type: "EXPENSE" },
  { code: "Expenses:Shopping:Electronics", name: "Electronics", type: "EXPENSE" },
  { code: "Expenses:Shopping:Home", name: "Home & Furniture", type: "EXPENSE" },
  { code: "Expenses:Entertainment", name: "Entertainment", type: "EXPENSE" },
  { code: "Expenses:Entertainment:Subscriptions", name: "Subscriptions", type: "EXPENSE" },
  { code: "Expenses:Travel", name: "Travel & Holidays", type: "EXPENSE" },
  { code: "Expenses:Personal", name: "Personal Care", type: "EXPENSE" },
  { code: "Expenses:Household Help", name: "Household Help", type: "EXPENSE" },
  { code: "Expenses:Gifts", name: "Gifts & Donations", type: "EXPENSE" },
  { code: "Expenses:Family", name: "Family Support", type: "EXPENSE" },
  { code: "Expenses:Fees", name: "Fees & Charges", type: "EXPENSE" },
  { code: "Expenses:Fees:Bank", name: "Bank Charges", type: "EXPENSE" },
  { code: "Expenses:Fees:Interest", name: "Interest Paid", type: "EXPENSE" },
  { code: "Expenses:Taxes", name: "Taxes", type: "EXPENSE" },
  { code: "Expenses:Taxes:Income Tax", name: "Income Tax & TDS", type: "EXPENSE" },
  { code: "Expenses:Investing", name: "Investing Costs", type: "EXPENSE" },
  {
    code: SystemAccountCodes.investingCharges,
    name: "Brokerage & Charges",
    type: "EXPENSE",
    isSystem: true,
  },
  {
    code: SystemAccountCodes.uncategorizedExpense,
    name: "Uncategorized",
    type: "EXPENSE",
    isSystem: true,
  },
];

/** A seed row with its strings turned into value objects. */
export interface ResolvedSeedAccount {
  code: AccountCode;
  name: string;
  type: AccountType;
  subtype: AccountSubtype | null;
  isSystem: boolean;
  sortOrder: number;
}

export function resolveDefaultChart(): ResolvedSeedAccount[] {
  return DEFAULT_CHART.map((seed, index) => ({
    code: AccountCode.parse(seed.code),
    name: seed.name,
    type: AccountType.of(seed.type),
    subtype: seed.subtype ?? null,
    isSystem: seed.isSystem ?? false,
    // Preserve the declaration order above as the display order.
    sortOrder: index,
  }));
}

/* ═══ AccountRepository (port) ════════════════════════════════════════ */

/**
 * Persistence for accounts, as the domain needs it.
 *
 * Declared here, in `domain/`, and implemented in `infrastructure/` — so the
 * dependency points inward and the domain never learns that SQL exists. This is
 * the interface v1's `Repository<T>` failed to be: it is shaped by what the use
 * cases actually ask for (`findByCode`, `descendantsOf`, `countPostings`) rather
 * than a generic `findMany(filter?: Partial<T>)` that nothing could implement
 * usefully.
 *
 * Every method takes a `UserId`. Scoping is not optional and not defaulted, so a
 * query that forgets it does not compile.
 */
export interface AccountRepository {
  /** Insert or update. The account's `id` decides which. */
  save(account: Account): Promise<void>;

  /** Bulk insert, in one transaction — used to seed the default chart. */
  saveMany(accounts: readonly Account[]): Promise<void>;

  findById(userId: UserId, id: AccountId): Promise<Account | null>;

  /** Lookup by path, for seeds, imports and system-account resolution. */
  findByCode(userId: UserId, code: AccountCode): Promise<Account | null>;

  findManyByCodes(userId: UserId, codes: readonly AccountCode[]): Promise<Account[]>;

  list(userId: UserId, options?: { includeClosed?: boolean }): Promise<Account[]>;

  listByType(
    userId: UserId,
    type: AccountType,
    options?: { includeClosed?: boolean },
  ): Promise<Account[]>;

  /** Every account beneath `id`, at any depth. Needed for the cycle check. */
  descendantsOf(userId: UserId, id: AccountId): Promise<Account[]>;

  /** How many postings reference this account — decides close-vs-delete. */
  countPostings(userId: UserId, id: AccountId): Promise<number>;

  /** Hide an unused account without destroying its audit trail. */
  softDelete(userId: UserId, id: AccountId, at: Date): Promise<void>;

  /** Restore a soft-deleted account. */
  restore(userId: UserId, id: AccountId): Promise<void>;

}

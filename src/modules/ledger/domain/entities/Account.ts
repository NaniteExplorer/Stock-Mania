import { AggregateRoot, type UserId } from "@/core/kernel";
import { Currency } from "@/core/money";
import { AccountCycleError, SystemAccountError } from "../errors";
import { AccountId } from "../ids";
import { AccountCode } from "../value-objects/AccountCode";
import { AccountType } from "../value-objects/AccountType";

/**
 * What real-world thing an account represents. Presentational only — grouping and
 * icons. Every arithmetic decision keys off {@link AccountType} instead, so adding
 * a subtype can never change a total.
 */
export type AccountSubtype =
  | "BANK"
  | "CASH"
  | "WALLET"
  | "CREDIT_CARD"
  | "LOAN"
  | "BROKERAGE"
  | "RETIREMENT"
  | "REAL_ESTATE"
  | "VEHICLE"
  | "PRECIOUS_METAL"
  | "RECEIVABLE"
  | "OTHER";

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
    subtype?: AccountSubtype | null;
    sortOrder?: number;
  }): Account {
    return this.copyWith({
      institution: props.institution === undefined ? this.institution : props.institution?.trim() || null,
      subtype: props.subtype === undefined ? this.subtype : props.subtype,
      sortOrder: props.sortOrder ?? this.sortOrder,
    });
  }

  private copyWith(changes: {
    name?: string;
    subtype?: AccountSubtype | null;
    parentId?: AccountId | null;
    institution?: string | null;
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
      this.accountNumberSuffix,
      changes.isClosed ?? this.isClosed,
      this.isSystem,
      changes.sortOrder ?? this.sortOrder,
    );
  }

  toString(): string {
    return `${this.code.toString()} (${this.type.name})`;
  }
}

import { ValueObject } from "@/core/kernel";
import type { PostingDirection } from "./PostingDirection";

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

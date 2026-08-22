import type { UserId } from "@/shared/kernel/UserId";
import type { Money } from "@/shared/money/Money";
import type { CalendarDate } from "@/shared/time/CalendarDate";
import type { DateRange } from "@/shared/time/DateRange";
import type { AccountId } from "../ids";
import type { AccountTypeName } from "../value-objects/AccountType";

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

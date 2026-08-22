import { Money } from "@/shared/money/Money";
import { Currency } from "@/shared/money/Currency";
import type { CalendarDate } from "@/shared/time/CalendarDate";
import type { DateRange } from "@/shared/time/DateRange";
import type { Account } from "../entities/Account";
import type { JournalEntry } from "../entities/JournalEntry";
import type { AccountId } from "../ids";
import { AccountType } from "../value-objects/AccountType";

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

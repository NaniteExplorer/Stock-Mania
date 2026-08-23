/**
 * Cash-like assets: the things a bank statement is *about*.
 *
 * These are deliberately thin wrappers around {@link Account} rather than a
 * parallel entity hierarchy with its own rows. An account already carries the
 * identity, the currency and the debit/credit algebra; what a `BankAccount` adds
 * over a bare account is the behaviour that only makes sense for that kind of
 * money — that a wallet cannot go negative, that cash in hand is reconciled by
 * counting it, that a bank account can be overdrawn and that this is a fact worth
 * showing rather than an error.
 *
 * **There is no `balance` field here, and there is no balance column anywhere.**
 * `valueOn()` takes a {@link BalanceSource} and asks it. That is the whole point
 * of the class: v1 stored a balance on the account and the transactions
 * elsewhere, and nothing kept them agreeing, so every screen quoted a number no
 * history could reproduce. Making the balance an argument-driven computation
 * means a wrong balance is impossible to persist — there is nowhere to put it.
 */

import { UserId } from "@/core/kernel";
import { Currency, Money } from "@/core/money";
import { CalendarDate } from "@/core/time";
import { Account, AccountId, AccountSubtype, AccountType } from "@/domain/accounts";

/* ═══ BalanceSource (port) ════════════════════════════════════════════ */

/**
 * "What is this account's balance on this date?" — the only thing a cash asset
 * needs from the ledger.
 *
 * A narrow port rather than the whole `BalanceQuery`: these classes must not be
 * able to reach the balance sheet, the monthly flows or the category rollups, and
 * a one-method port makes that structural. `BalanceQuery` satisfies it, so
 * production passes the SQL implementation and tests pass a fold over
 * transactions.
 */
export interface BalanceSource {
  balanceOf(userId: UserId, accountId: AccountId, asOf: CalendarDate): Promise<Money>;
}

/* ═══ CashAsset ═══════════════════════════════════════════════════════ */

export type CashAssetKind = "BANK_ACCOUNT" | "WALLET" | "CASH_IN_HAND";

/**
 * How quickly the money can be spent. Not cosmetic: liquid net worth in
 * `30-CALCULATIONS.md` is the total of `IMMEDIATE` holdings, so this value ends
 * up in a reported figure.
 */
export type Liquidity = "IMMEDIATE" | "SAME_DAY" | "DELAYED";

/** A finding about a balance that is not an error but is not right either. */
export interface BalanceAnomaly {
  readonly code: "NEGATIVE_BALANCE" | "OVERDRAWN" | "BELOW_MINIMUM";
  readonly message: string;
}

/**
 * A holding of spendable money.
 *
 * The three subclasses differ in exactly two ways that matter — whether a
 * negative balance is possible, and how it is verified against the outside world
 * — and both are expressed as methods rather than as flags read by an `if` chain
 * somewhere else.
 */
export abstract class CashAsset {
  protected constructor(readonly account: Account) {
    if (account.type !== AccountType.ASSET) {
      throw new TypeError(
        `${account.displayName} is ${account.type.label.toLowerCase()}, not an asset — ` +
          `a cash asset wraps an asset account.`,
      );
    }
  }

  abstract readonly kind: CashAssetKind;

  abstract readonly liquidity: Liquidity;

  /** Whether the real-world thing can hold less than nothing. */
  abstract readonly canBeNegative: boolean;

  /**
   * How this asset is checked against reality: a bank sends a statement, a wallet
   * shows a balance in its app, cash is counted by hand.
   */
  abstract readonly verifiedBy: "STATEMENT" | "PROVIDER_BALANCE" | "PHYSICAL_COUNT";

  get id(): AccountId {
    return this.account.id;
  }

  get currency(): Currency {
    return this.account.currency;
  }

  get displayName(): string {
    return this.account.displayName;
  }

  /**
   * The balance on `asOf`, summed from postings.
   *
   * `async` because the sum lives in the database. That is the honest signature:
   * a synchronous `get balance()` would have to be fed from a cached field, which
   * is the field this class exists to not have.
   */
  async valueOn(asOf: CalendarDate, balances: BalanceSource): Promise<Money> {
    return balances.balanceOf(this.account.userId, this.account.id, asOf);
  }

  /**
   * What is wrong with this balance, if anything.
   *
   * Returned as findings rather than thrown, because the ledger is right and the
   * world is what disagrees: a wallet showing minus forty rupees means an import
   * double-posted or a refund is missing, and the user needs to see the number to
   * work out which. Refusing to display it would hide the only evidence.
   */
  anomaliesIn(balance: Money): readonly BalanceAnomaly[] {
    if (balance.isNegative && !this.canBeNegative) {
      return [
        {
          code: "NEGATIVE_BALANCE",
          message:
            `${this.displayName} shows ${balance.toString()}, which is impossible — ` +
            `${this.impossibleNegativeReason}. Expect a duplicated debit or a missing credit.`,
        },
      ];
    }
    return [];
  }

  protected abstract get impossibleNegativeReason(): string;

  /**
   * Builds the right subclass for an account, or `null` if the account is not
   * cash-like.
   *
   * `null` rather than a `CashAsset` fallback: a brokerage or a fixed deposit is
   * an asset but not spendable, and quietly treating it as cash would inflate
   * liquid net worth — the one figure this classification feeds.
   */
  static classify(account: Account): CashAsset | null {
    if (account.type !== AccountType.ASSET) return null;
    switch (account.subtype) {
      case "BANK":
      case "SAVINGS":
        return new BankAccount(account);
      case "WALLET":
        return new Wallet(account);
      case "CASH":
        return new CashInHand(account);
      default:
        return null;
    }
  }

  /** The cash-like members of a set of accounts, in the order given. */
  static classifyAll(accounts: readonly Account[]): readonly CashAsset[] {
    return accounts.flatMap((account) => {
      const asset = CashAsset.classify(account);
      return asset ? [asset] : [];
    });
  }

  /** The subtypes {@link classify} recognises — used to build account pickers. */
  static get cashSubtypes(): readonly AccountSubtype[] {
    return ["BANK", "SAVINGS", "WALLET", "CASH"];
  }

  toString(): string {
    return `${this.kind} ${this.account.code.toString()}`;
  }
}

/* ═══ BankAccount ═════════════════════════════════════════════════════ */

/**
 * A savings or current account at a bank.
 *
 * The one that *can* be negative, via an overdraft — and the distinction between
 * "overdrawn within the arranged limit" and "beyond it" is the interesting part,
 * because the second is what costs money.
 */
export class BankAccount extends CashAsset {
  readonly kind = "BANK_ACCOUNT" as const;
  readonly liquidity = "IMMEDIATE" as const;
  readonly canBeNegative = true;
  readonly verifiedBy = "STATEMENT" as const;

  constructor(
    account: Account,
    /**
     * The arranged overdraft, as a positive amount. Zero means none arranged, so
     * any negative balance is unauthorised.
     */
    readonly overdraftLimit: Money = Money.zero(account.currency),
    /** A minimum-balance requirement, which Indian banks charge for breaching. */
    readonly minimumBalance: Money | null = null,
  ) {
    super(account);
    if (overdraftLimit.isNegative) {
      throw new TypeError("An overdraft limit is a positive amount, or zero for none.");
    }
    if (overdraftLimit.currency.code !== account.currency.code) {
      throw new TypeError(
        `The overdraft limit on ${account.displayName} is in ${overdraftLimit.currency.code}, ` +
          `but the account is in ${account.currency.code}.`,
      );
    }
    if (minimumBalance && minimumBalance.currency.code !== account.currency.code) {
      throw new TypeError(
        `The minimum balance on ${account.displayName} is in ${minimumBalance.currency.code}, ` +
          `but the account is in ${account.currency.code}.`,
      );
    }
  }

  /** How much can be spent right now: the balance plus any arranged overdraft. */
  availableFrom(balance: Money): Money {
    return balance.plus(this.overdraftLimit);
  }

  override anomaliesIn(balance: Money): readonly BalanceAnomaly[] {
    const findings: BalanceAnomaly[] = [];
    if (balance.isNegative) {
      const beyondLimit = balance.negated().isGreaterThan(this.overdraftLimit);
      findings.push({
        code: "OVERDRAWN",
        message: beyondLimit
          ? `${this.displayName} is overdrawn by ${balance.negated().toString()}, beyond the ` +
            `arranged ${this.overdraftLimit.toString()}.`
          : `${this.displayName} is using ${balance.negated().toString()} of its ` +
            `${this.overdraftLimit.toString()} overdraft.`,
      });
    }
    if (this.minimumBalance && balance.isLessThan(this.minimumBalance) && !balance.isNegative) {
      findings.push({
        code: "BELOW_MINIMUM",
        message:
          `${this.displayName} is below its ${this.minimumBalance.toString()} minimum ` +
          `balance, which is usually charged for.`,
      });
    }
    return findings;
  }

  protected get impossibleNegativeReason(): string {
    /* Unreachable: `canBeNegative` is true, so the base never asks. */
    return "a bank account may be overdrawn";
  }
}

/* ═══ Wallet ══════════════════════════════════════════════════════════ */

/**
 * A prepaid instrument — Paytm, PhonePe, a metro card, a gift card.
 *
 * Closed-loop by regulation: you cannot spend what you have not loaded, so a
 * negative balance is not an overdraft, it is a bookkeeping error.
 */
export class Wallet extends CashAsset {
  readonly kind = "WALLET" as const;
  readonly liquidity = "IMMEDIATE" as const;
  readonly canBeNegative = false;
  readonly verifiedBy = "PROVIDER_BALANCE" as const;

  protected get impossibleNegativeReason(): string {
    return "a prepaid wallet can only spend what was loaded into it";
  }
}

/* ═══ CashInHand ══════════════════════════════════════════════════════ */

/**
 * Notes and coins.
 *
 * Reconciled by counting, which is why {@link reconcileTo} exists here and
 * nowhere else: cash is the one asset with no external record, so the count *is*
 * the authority and the difference is a real, bookable adjustment rather than a
 * mismatch to investigate.
 */
export class CashInHand extends CashAsset {
  readonly kind = "CASH_IN_HAND" as const;
  readonly liquidity = "IMMEDIATE" as const;
  readonly canBeNegative = false;
  readonly verifiedBy = "PHYSICAL_COUNT" as const;

  /**
   * The adjustment needed to make the ledger agree with a physical count.
   *
   * Returns the signed movement, not a new balance: a positive result means money
   * must be booked in (found), a negative one booked out (spent and never
   * recorded). A zero difference returns zero, and the caller posts nothing — an
   * adjustment transaction for nil would be noise in the register forever.
   */
  reconcileTo(counted: Money, ledgerBalance: Money): Money {
    if (counted.isNegative) {
      throw new TypeError("A cash count cannot be negative — you cannot hold less than no notes.");
    }
    if (counted.currency.code !== this.currency.code) {
      throw new TypeError(
        `Counted ${counted.currency.code} against a ${this.currency.code} account.`,
      );
    }
    return counted.minus(ledgerBalance);
  }

  protected get impossibleNegativeReason(): string {
    return "you cannot hold fewer than zero notes";
  }
}

/* ═══ Net worth, derived ══════════════════════════════════════════════ */

export interface LiquidPosition {
  readonly asset: CashAsset;
  readonly balance: Money;
  readonly anomalies: readonly BalanceAnomaly[];
}

/**
 * Every cash asset's balance on a date, with anomalies attached.
 *
 * One `Promise.all` over the accounts rather than a bespoke query, because the
 * balance definition must not fork: this is the same `balanceOf` the register and
 * the balance sheet use, so a cash total and a balance-sheet total cannot
 * disagree.
 */
export async function liquidPositions(
  accounts: readonly Account[],
  asOf: CalendarDate,
  balances: BalanceSource,
): Promise<readonly LiquidPosition[]> {
  const assets = CashAsset.classifyAll(accounts);
  return Promise.all(
    assets.map(async (asset) => {
      const balance = await asset.valueOn(asOf, balances);
      return { asset, balance, anomalies: asset.anomaliesIn(balance) };
    }),
  );
}

/**
 * Total spendable money on a date, in one currency.
 *
 * Positions in another currency are excluded, not converted: converting at
 * today's rate would report a rupee figure that no statement can confirm, and the
 * FX ladder that could do it honestly belongs to the reporting layer, not here.
 */
export function totalLiquid(
  positions: readonly LiquidPosition[],
  currency: Currency = Currency.reporting,
): Money {
  return Money.total(
    positions
      .filter((position) => position.balance.currency.code === currency.code)
      .map((position) => position.balance),
    currency,
  );
}

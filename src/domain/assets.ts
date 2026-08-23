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

import { UserId, ValueObject } from "@/core/kernel";
import { Currency, Money } from "@/core/money";
import { Percentage, Quantity, Rate, UnitPrice } from "@/core/numeric";
import { CalendarDate, DateRange } from "@/core/time";
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

/* ═══ CreditProduct ═══════════════════════════════════════════════════ */

/**
 * Borrowed money: the liability side of the asset hierarchy.
 *
 * The one behaviour that matters here and nowhere else is the sign. A credit
 * product's balance is stored and reported as a **positive amount owed** —
 * ₹18,240 of debt is `+18240`, not `−18240` — because `AccountType.LIABILITY`
 * already knows that a credit increases it, and a second sign convention on top
 * of that is how a payment ends up increasing a debt. Net worth then subtracts,
 * which `AccountType.netWorthSign` does for every liability without this class
 * being involved at all.
 */
export abstract class CreditProduct {
  protected constructor(readonly account: Account) {
    if (account.type !== AccountType.LIABILITY) {
      throw new TypeError(
        `${account.displayName} is ${account.type.label.toLowerCase()}, not a liability — ` +
          `a credit product wraps a liability account.`,
      );
    }
  }

  abstract readonly kind: "CREDIT_CARD" | "LOAN" | "OTHER_CREDIT";

  get id(): AccountId {
    return this.account.id;
  }

  get currency(): Currency {
    return this.account.currency;
  }

  get displayName(): string {
    return this.account.displayName;
  }

  /** The amount owed on `asOf`, summed from postings. Positive means debt. */
  async valueOn(asOf: CalendarDate, balances: BalanceSource): Promise<Money> {
    return balances.balanceOf(this.account.userId, this.account.id, asOf);
  }

  /**
   * What this contributes to net worth: the negation of what is owed.
   *
   * Spelled out as a method so no screen has to remember to negate — and so the
   * plan's "a card balance reduces net worth without a special case anywhere" is
   * literally true: the sign comes from the account type, and this is the only
   * place it is applied.
   */
  netWorthContribution(owed: Money): Money {
    return owed.times(this.account.netWorthSign);
  }
}

/* ═══ Billing cycles ══════════════════════════════════════════════════ */

/**
 * One statement period, and when its bill falls due.
 *
 * A closed range plus a due date, and the reason it is a value object rather than
 * three loose dates is that "spent this month" and "billed this cycle" are
 * different questions with different answers. A purchase on the 19th of a cycle
 * that closes on the 18th is this month's spending and *next* month's bill; code
 * that has only a month to work with cannot express that, and every card app that
 * gets the due amount wrong gets it wrong here.
 */
export class BillingCycle extends ValueObject {
  constructor(
    /** First day included in the statement. */
    readonly from: CalendarDate,
    /** Statement date: the last day included. */
    readonly through: CalendarDate,
    /** When payment is due — always after `through`. */
    readonly dueOn: CalendarDate,
  ) {
    super();
    if (through.isBefore(from)) {
      throw new TypeError(`A billing cycle cannot end (${through.toISO()}) before it starts (${from.toISO()}).`);
    }
    if (!dueOn.isAfter(through)) {
      throw new TypeError(
        `The due date (${dueOn.toISO()}) must fall after the statement date (${through.toISO()}) — ` +
          `a bill cannot be due before it is generated.`,
      );
    }
  }

  get range(): DateRange {
    return DateRange.of(this.from, this.through);
  }

  contains(date: CalendarDate): boolean {
    return date.isOnOrAfter(this.from) && date.isOnOrBefore(this.through);
  }

  /** Days from the statement date to the due date — the interest-free window. */
  get graceDays(): number {
    return this.through.daysUntil(this.dueOn);
  }

  /** `YYYY-MM` of the statement date, which is how issuers label a statement. */
  get label(): string {
    return this.through.toMonthKey();
  }

  protected components(): readonly unknown[] {
    return [this.from.toISO(), this.through.toISO(), this.dueOn.toISO()];
  }

  toString(): string {
    return `${this.from.toISO()}..${this.through.toISO()} due ${this.dueOn.toISO()}`;
  }
}

/**
 * The rule that generates cycles: "statement on the 18th, due 20 days later".
 *
 * Kept separate from {@link BillingCycle} because the rule is a property of the
 * card and the cycle is a period of time. Generating cycles from a rule rather
 * than storing them means a statement for any past month can be reconstructed —
 * including months before the app existed, which is exactly what importing a
 * year of card statements needs.
 */
export class BillingCycleRule extends ValueObject {
  constructor(
    /** Day of month the statement is generated. 29–31 are clamped per month. */
    readonly statementDay: number,
    /** Days after the statement date that payment is due. */
    readonly graceDays: number,
  ) {
    super();
    if (!Number.isInteger(statementDay) || statementDay < 1 || statementDay > 31) {
      throw new RangeError(`A statement day must be 1–31, got ${statementDay}.`);
    }
    if (!Number.isInteger(graceDays) || graceDays < 1 || graceDays > 60) {
      throw new RangeError(`A grace period must be 1–60 days, got ${graceDays}.`);
    }
  }

  /**
   * The cycle a date falls in.
   *
   * February is why `statementDay` is clamped rather than assumed valid: a card
   * with a 31st statement date has a 28th statement date in February, and a rule
   * that produced 31 February would either throw or roll into March and lose a
   * day of spending out of every statement.
   */
  cycleContaining(date: CalendarDate): BillingCycle {
    const thisMonthStatement = this.statementDateIn(date.year, date.month);
    const through = date.isOnOrBefore(thisMonthStatement)
      ? thisMonthStatement
      : this.statementDateIn(date.plusMonths(1).year, date.plusMonths(1).month);
    const previous = through.plusMonths(-1);
    const from = this.statementDateIn(previous.year, previous.month).plusDays(1);
    return new BillingCycle(from, through, through.plusDays(this.graceDays));
  }

  /** The cycle after this one — used to walk a year of statements. */
  next(cycle: BillingCycle): BillingCycle {
    return this.cycleContaining(cycle.through.plusDays(1));
  }

  private statementDateIn(year: number, month: number): CalendarDate {
    const lastDay = CalendarDate.daysInMonth(year, month);
    return CalendarDate.of(year, month, Math.min(this.statementDay, lastDay));
  }

  protected components(): readonly unknown[] {
    return [this.statementDay, this.graceDays];
  }
}

/* ═══ Card statements ═════════════════════════════════════════════════ */

/** One movement on the card, in statement terms. */
export interface CardMovement {
  readonly on: CalendarDate;
  readonly amount: Money;
  /**
   * `SPEND` and `CHARGE` increase the debt; `PAYMENT` and `REFUND` reduce it.
   *
   * A charge is distinguished from a spend because it is the issuer's money, not
   * the cardholder's spending: rolling a ₹590 late fee into "spent on food" is a
   * wrong budget for a reason nobody can see.
   */
  readonly kind: "SPEND" | "CHARGE" | "PAYMENT" | "REFUND";
  readonly description?: string;
}

/**
 * A generated statement.
 *
 * The identity `opening + spends + charges − payments − refunds = closing` is
 * asserted in the constructor, not merely computed. That identity *is* the Phase 3
 * gate, and a statement object that could hold a closing balance disagreeing with
 * its own movements would make the gate untestable.
 */
export class CardStatement {
  readonly spends: Money;
  readonly charges: Money;
  readonly payments: Money;
  readonly refunds: Money;
  readonly closing: Money;

  constructor(
    readonly cycle: BillingCycle,
    /** Amount owed at the start of the cycle. */
    readonly opening: Money,
    readonly movements: readonly CardMovement[],
    /** The issuer's minimum-due calculation, supplied by the card. */
    readonly minimumDue: Money,
  ) {
    const zero = Money.zero(opening.currency);
    const totalOf = (kind: CardMovement["kind"]) =>
      Money.total(
        movements.filter((movement) => movement.kind === kind).map((movement) => movement.amount),
        opening.currency,
      );

    this.spends = totalOf("SPEND");
    this.charges = totalOf("CHARGE");
    this.payments = totalOf("PAYMENT");
    this.refunds = totalOf("REFUND");
    this.closing = opening
      .plus(this.spends)
      .plus(this.charges)
      .minus(this.payments)
      .minus(this.refunds);

    for (const movement of movements) {
      if (movement.amount.isNegative) {
        throw new TypeError(
          `A statement movement carries a positive amount and a kind; ${movement.description ?? "a row"} ` +
            `has ${movement.amount.toString()}. Use PAYMENT or REFUND rather than a negative spend.`,
        );
      }
      if (!cycle.contains(movement.on)) {
        throw new TypeError(
          `${movement.description ?? "A movement"} dated ${movement.on.toISO()} is outside the ` +
            `cycle ${cycle.toString()} — a purchase after the statement date belongs to the next one.`,
        );
      }
    }
    if (minimumDue.isNegative || minimumDue.isGreaterThan(this.closing.isNegative ? zero : this.closing)) {
      throw new TypeError(
        `The minimum due (${minimumDue.toString()}) cannot exceed the closing balance ` +
          `(${this.closing.toString()}).`,
      );
    }
  }

  /** Total the cardholder must pay to avoid interest. Zero when in credit. */
  get totalDue(): Money {
    return this.closing.isNegative ? Money.zero(this.closing.currency) : this.closing;
  }

  /**
   * Whether the statement's own arithmetic matches what the issuer printed.
   *
   * The gate's assertion, as a method rather than as a test helper, because a user
   * importing a card statement wants exactly this answer about exactly their file.
   */
  reconcilesWith(printedClosing: Money): boolean {
    return this.closing.equals(printedClosing);
  }

  toString(): string {
    return `${this.cycle.label}: ${this.opening.toString()} + ${this.spends.toString()} + ${this.charges.toString()} − ${this.payments.toString()} − ${this.refunds.toString()} = ${this.closing.toString()}`;
  }
}

/* ═══ Reward points ═══════════════════════════════════════════════════ */

/**
 * Points, tracked as a {@link Quantity} and valued only when redeemed.
 *
 * A `Quantity`, not a `Money`, and the distinction is load-bearing: points are
 * not money until an issuer agrees to exchange them, the rate is theirs to change,
 * and it differs by redemption route (₹0.25 per point against a statement, ₹0.50
 * against a flight). Carrying them in a money column would put an unrealised,
 * issuer-controlled number into net worth — the one figure that must never be a
 * guess. `valueIfRedeemedAt` exists for the screen that wants to show the
 * possibility, and it takes the rate as an argument every time.
 */
export class RewardPointBalance extends ValueObject {
  constructor(readonly points: Quantity) {
    super();
    if (points.isNegative) {
      throw new TypeError(`A points balance cannot be negative, got ${points.toString()}.`);
    }
  }

  static zero(): RewardPointBalance {
    return new RewardPointBalance(Quantity.ZERO);
  }

  earn(points: Quantity): RewardPointBalance {
    if (points.isNegative) throw new TypeError("Earning takes a positive number of points.");
    return new RewardPointBalance(this.points.plus(points));
  }

  /** Redeeming more than the balance is refused rather than clamped. */
  redeem(points: Quantity): RewardPointBalance {
    if (points.isNegative) throw new TypeError("Redeeming takes a positive number of points.");
    if (points.isGreaterThan(this.points)) {
      throw new TypeError(
        `Cannot redeem ${points.toString()} points against a balance of ${this.points.toString()}.`,
      );
    }
    return new RewardPointBalance(this.points.minus(points));
  }

  /**
   * What the balance would be worth at a given per-point rate.
   *
   * Returns `Money`, so the conversion happens exactly once, at the boundary
   * where a rate is supplied — never stored, never summed into a balance.
   */
  valueIfRedeemedAt(perPoint: UnitPrice): Money {
    return perPoint.times(this.points);
  }

  protected components(): readonly unknown[] {
    return [this.points.toString()];
  }

  toString(): string {
    return `${this.points.toDecimalString()} pts`;
  }
}

/* ═══ CreditCard ══════════════════════════════════════════════════════ */

/** The terms an issuer sets, all of which end up in an arithmetic answer. */
export interface CardTerms {
  readonly creditLimit: Money;
  readonly cycle: BillingCycleRule;
  /** Annual finance rate on a revolved balance — usually 36%–45% p.a. in India. */
  readonly financeRate: Rate;
  /** Minimum due as a share of the closing balance. */
  readonly minimumDuePercent: Percentage;
  /** The floor an issuer applies when the percentage is trivial. */
  readonly minimumDueFloor: Money;
  readonly lateFee: Money;
  readonly annualFee: Money;
  /** GST on interest and fees — 18% in India, and it is charged on both. */
  readonly gstOnCharges: Percentage;
  /** Points earned per hundred rupees spent. */
  readonly pointsPerHundred: Quantity;
}

export interface FinanceChargeInput {
  /**
   * The balance owed on each day interest accrues, in date order.
   *
   * Daily balances rather than a single average, because that is how an issuer
   * actually bills: interest runs on each purchase from its transaction date, so a
   * ₹50,000 spend on day 2 and the same spend on day 28 of a revolved cycle carry
   * very different interest. Feeding one "average balance" in would be a different
   * — and lower — number than the bill.
   */
  readonly dailyBalances: readonly { readonly on: CalendarDate; readonly owed: Money }[];
}

export interface FinanceChargeBreakdown {
  readonly interest: Money;
  readonly gstOnInterest: Money;
  readonly total: Money;
  readonly days: number;
}

/**
 * A credit card.
 *
 * Everything here is a *computation over terms plus movements*. No statement, no
 * minimum due and no interest figure is stored, for the same reason no balance is:
 * the moment a stored statement can disagree with the postings behind it, one of
 * the two is wrong and nothing says which.
 */
export class CreditCard extends CreditProduct {
  readonly kind = "CREDIT_CARD" as const;

  constructor(
    account: Account,
    readonly terms: CardTerms,
  ) {
    super(account);
    if (terms.creditLimit.isNegative) {
      throw new TypeError("A credit limit is a positive amount.");
    }
    if (terms.creditLimit.currency.code !== account.currency.code) {
      throw new TypeError(
        `The limit on ${account.displayName} is in ${terms.creditLimit.currency.code}, ` +
          `but the account is in ${account.currency.code}.`,
      );
    }
    if (terms.financeRate.isNegative) {
      throw new TypeError("A finance rate cannot be negative.");
    }
  }

  /** How much of the limit is used. Over 100% is possible and is reported as such. */
  utilisation(owed: Money): Percentage {
    if (this.terms.creditLimit.isZero) return Percentage.ZERO;
    if (owed.isNegative) return Percentage.ZERO;
    return Percentage.ratio(owed, this.terms.creditLimit);
  }

  /** What is still spendable. Never negative: an over-limit card has nothing left. */
  availableCredit(owed: Money): Money {
    const remaining = this.terms.creditLimit.minus(owed.isNegative ? Money.zero(this.currency) : owed);
    return remaining.isNegative ? Money.zero(this.currency) : remaining;
  }

  cycleFor(date: CalendarDate): BillingCycle {
    return this.terms.cycle.cycleContaining(date);
  }

  /** The `count` cycles ending on or before `date`, oldest first. */
  recentCycles(date: CalendarDate, count: number): readonly BillingCycle[] {
    const cycles: BillingCycle[] = [];
    let cursor = this.cycleFor(date);
    for (let index = 0; index < count; index += 1) {
      cycles.unshift(cursor);
      cursor = this.terms.cycle.cycleContaining(cursor.from.plusDays(-1));
    }
    return cycles;
  }

  /**
   * The minimum due on a closing balance.
   *
   * The floor is applied only when something is owed, and never above the balance
   * itself: a ₹120 balance on a card with a ₹500 floor has a ₹120 minimum, not
   * ₹500 — billing more than the debt is the kind of arithmetic that erodes trust
   * in every other figure on the screen.
   */
  minimumDueOn(closing: Money): Money {
    if (!closing.isPositive) return Money.zero(this.currency);
    const share = this.terms.minimumDuePercent.applyTo(closing);
    const floored = share.isLessThan(this.terms.minimumDueFloor) ? this.terms.minimumDueFloor : share;
    return floored.isGreaterThan(closing) ? closing : floored;
  }

  /** Builds the statement for a cycle from the movements that fall inside it. */
  statementFor(
    cycle: BillingCycle,
    opening: Money,
    movements: readonly CardMovement[],
  ): CardStatement {
    const inCycle = movements.filter((movement) => cycle.contains(movement.on));
    const closing = inCycle.reduce(
      (running, movement) =>
        movement.kind === "SPEND" || movement.kind === "CHARGE"
          ? running.plus(movement.amount)
          : running.minus(movement.amount),
      opening,
    );
    return new CardStatement(cycle, opening, inCycle, this.minimumDueOn(closing));
  }

  /**
   * Interest on a revolved balance, day by day, plus the GST on it.
   *
   * `Rate.accrualFactor(1)` per day and `Money.timesRatio` means the whole
   * calculation is exact integer arithmetic: an annual rate never becomes a float
   * on its way to a rupee figure. Summing per-day rather than applying a
   * period factor to an average is what makes this reproduce the issuer's bill
   * instead of approximating it.
   */
  financeChargeFor(input: FinanceChargeInput): FinanceChargeBreakdown {
    /*
     * Balance-days first, the rate once.
     *
     * The obvious implementation — accrue and round each day, then sum — was
     * wrong by nine paise on the flat 30-day case in `tests/cards.spec.ts`, and
     * wrong in the same direction every time: rounding 42%/365 of a balance up to
     * the paisa on 30 separate days overstates the bill by up to half a paisa a
     * day. Summing the (balance × days) product exactly and applying the rate
     * once reproduces the issuer's own `principal × rate × days / 365` and rounds
     * exactly once.
     */
    let balanceDays = Money.zero(this.currency);
    let days = 0;

    for (const day of input.dailyBalances) {
      if (!day.owed.isPositive) continue;
      balanceDays = balanceDays.plus(day.owed);
      days += 1;
    }

    const factor = this.terms.financeRate.accrualFactor(1);
    const interest = balanceDays.timesRatio(factor.numerator, factor.denominator);
    const gst = this.terms.gstOnCharges.applyTo(interest);
    return { interest, gstOnInterest: gst, total: interest.plus(gst), days };
  }

  /**
   * A fee and its GST, as the two movements an issuer actually posts.
   *
   * Two movements rather than one gross figure, because the tax is separately
   * reportable and a single ₹590 line cannot be split back into ₹500 + ₹90
   * without re-deriving it — and a re-derivation is a second place for the rate to
   * be wrong.
   */
  feeWithGst(fee: Money, on: CalendarDate, description: string): readonly CardMovement[] {
    if (!fee.isPositive) return [];
    const gst = this.terms.gstOnCharges.applyTo(fee);
    return [
      { on, amount: fee, kind: "CHARGE", description },
      { on, amount: gst, kind: "CHARGE", description: `GST on ${description}` },
    ];
  }

  /** Points earned on a spend: `pointsPerHundred` for each complete hundred. */
  pointsFor(spend: Money): Quantity {
    if (!spend.isPositive || this.terms.pointsPerHundred.isZero) return Quantity.ZERO;
    const hundreds = spend.minor / (100n * spend.currency.minorUnitsPerMajor);
    return Quantity.fromScaled(this.terms.pointsPerHundred.scaled * hundreds);
  }

  /**
   * Builds a card from an account plus terms, or `null` if the account is not one.
   *
   * Mirrors `CashAsset.classify`: a loan is also a liability, and treating it as a
   * card would invent a billing cycle it does not have.
   */
  static classify(account: Account, terms: CardTerms): CreditCard | null {
    if (account.type !== AccountType.LIABILITY) return null;
    if (account.subtype !== "CREDIT_CARD") return null;
    return new CreditCard(account, terms);
  }

  /** Sensible Indian defaults, so a card can be opened before its terms are known. */
  static defaultTerms(currency: Currency = Currency.reporting): CardTerms {
    return {
      creditLimit: Money.zero(currency),
      cycle: new BillingCycleRule(18, 20),
      financeRate: Rate.annual("42"),
      minimumDuePercent: Percentage.of("5"),
      minimumDueFloor: Money.fromRupees("500", currency),
      lateFee: Money.fromRupees("500", currency),
      annualFee: Money.zero(currency),
      gstOnCharges: Percentage.of("18"),
      pointsPerHundred: Quantity.ZERO,
    };
  }
}

/* ═══ CardTermsRepository (port) ══════════════════════════════════════ */

/**
 * Persistence for a card's terms.
 *
 * Declared here, beside {@link CreditCard}, for the same reason `AccountRepository`
 * lives beside `Account`: in `infra/` it would be a dependency pointing the wrong
 * way. Terms are the only card state that is *stored* — every statement, minimum
 * due and interest figure is computed from them.
 */
export interface CardTermsRepository {
  findFor(userId: UserId, accountId: AccountId): Promise<CardTerms | null>;

  /** Terms for many cards at once, keyed by account id — one round trip per screen. */
  findManyFor(
    userId: UserId,
    accountIds: readonly AccountId[],
  ): Promise<ReadonlyMap<string, CardTerms>>;

  save(userId: UserId, accountId: AccountId, terms: CardTerms): Promise<void>;
}

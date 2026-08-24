/**
 * Deposits and retirement products: FD, RD, PPF, EPF, NPS.
 *
 * **Nothing here stores a balance, and nothing accrues on a schedule.**
 * `valueOn(asOf)` computes the value from first principles every time — principal,
 * rate, compounding convention, elapsed periods. That replaces v1's nightly job
 * that mutated a stored balance, and the difference is not tidiness: a job that
 * failed on the 3rd left every deposit reporting a value no formula could
 * reproduce, and nothing detected it. The plan's done-when is that deleting the
 * accrual job changes no reported number; there is no job to delete.
 *
 * A note on the file: the target shape in `70-UPGRADE-PLAN.md` puts the whole
 * asset hierarchy in `domain/assets.ts`. Deposits and loans live in their own
 * files instead, because "one file per concept" is the rule and these are two
 * concepts with a great deal of arithmetic each — `assets.ts` would otherwise be
 * three thousand lines covering cash, credit, deposits, retirement and property.
 *
 * **Every calculation is exact integer arithmetic.** Compounding is the place a
 * float would be most tempting and most wrong: `(1 + r/4)^60` in floating point
 * drifts, and a maturity value that disagrees with the bank's certificate by ₹3 is
 * indistinguishable from one that disagrees by ₹3,000 in terms of trust. The
 * factor is computed as an exact bigint rational and applied through
 * `Money.timesRatio`, so the rounding happens once, at the end, where it is
 * visible.
 */

import { UserId } from "@/core/kernel";
import { Currency, Money, type RoundingMode } from "@/core/money";
import { Percentage, Quantity, Rate, UnitPrice } from "@/core/numeric";
import { CalendarDate, DateRange, FinancialYear } from "@/core/time";
import { Account, AccountId, AccountType } from "@/domain/accounts";
import type { BalanceSource } from "@/domain/assets";

/* ═══ Exact compounding ═══════════════════════════════════════════════ */

/** How often interest is added to the principal. */
export type CompoundingFrequency =
  | "DAILY"
  | "MONTHLY"
  | "QUARTERLY"
  | "HALF_YEARLY"
  | "ANNUALLY"
  | "AT_MATURITY";

export type InterestType = "SIMPLE" | "COMPOUND" | "FLAT" | "REDUCING_BALANCE";

/** Compounding periods per year. `AT_MATURITY` compounds once over the term. */
export function periodsPerYear(frequency: CompoundingFrequency): number {
  switch (frequency) {
    case "DAILY":
      return 365;
    case "MONTHLY":
      return 12;
    case "QUARTERLY":
      return 4;
    case "HALF_YEARLY":
      return 2;
    case "ANNUALLY":
    case "AT_MATURITY":
      return 1;
  }
}

const RATE_DENOMINATOR = 10n ** 10n * 100n;

/**
 * The exact rational `(1 + r/m)^n`, as `{ numerator, denominator }`.
 *
 * The whole point of this function is that it never leaves the integers. `r/m` is
 * `scaled / (m × 1e10 × 100)`, so `1 + r/m` is `(m·D + scaled) / (m·D)` with
 * `D = 1e10 × 100`, and raising a rational to an integer power is raising each
 * side. The numbers get large — a 20-year monthly compounding is a 240th power, so
 * roughly 3,000 digits — which `bigint` handles exactly and a `number` does not
 * handle at all.
 */
export function compoundFactor(
  rate: Rate,
  frequency: CompoundingFrequency,
  periods: number,
): { numerator: bigint; denominator: bigint } {
  if (!Number.isInteger(periods) || periods < 0) {
    throw new RangeError(`Compounding periods must be a non-negative whole number, got ${periods}.`);
  }
  const m = BigInt(periodsPerYear(frequency));
  const base = m * RATE_DENOMINATOR;
  const step = base + rate.scaled;
  return { numerator: step ** BigInt(periods), denominator: base ** BigInt(periods) };
}

/**
 * Simple interest over a number of days: `P × r × days / daysInYear`.
 *
 * Uses the rate's own day count, so an ACT/360 quote is not silently reported as
 * ACT/365F — the two differ by 1.4%, which is more than the spread between two
 * banks' FD rates.
 */
export function simpleInterest(
  principal: Money,
  rate: Rate,
  days: number,
  mode: RoundingMode = "HALF_UP",
): Money {
  const factor = rate.accrualFactor(days);
  return principal.timesRatio(factor.numerator, factor.denominator, mode);
}

/* ═══ Schedules ═══════════════════════════════════════════════════════ */

/** One line of a deposit's growth: what it was worth, and what was added. */
export interface AccrualRow {
  readonly on: CalendarDate;
  /** Value at the start of the period. */
  readonly opening: Money;
  /** Money the holder put in during the period. */
  readonly contribution: Money;
  /** Interest credited at the end of the period. */
  readonly interest: Money;
  readonly closing: Money;
  /** What produced this row, so a figure on screen can be explained. */
  readonly note: string;
}

/** A deposit's whole life, period by period. */
export interface AccrualSchedule {
  readonly rows: readonly AccrualRow[];
  readonly totalContributed: Money;
  readonly totalInterest: Money;
  readonly maturityValue: Money;
}

function summarise(rows: readonly AccrualRow[], currency: Currency): AccrualSchedule {
  return {
    rows,
    totalContributed: Money.total(rows.map((row) => row.contribution), currency),
    totalInterest: Money.total(rows.map((row) => row.interest), currency),
    maturityValue: rows.length > 0 ? rows[rows.length - 1].closing : Money.zero(currency),
  };
}

/* ═══ DepositProduct ══════════════════════════════════════════════════ */

export type DepositKind =
  | "FIXED_DEPOSIT"
  | "RECURRING_DEPOSIT"
  | "PPF"
  | "EPF"
  | "NPS";

/**
 * Money placed with an institution that grows by a stated rule.
 *
 * The abstract class owns three things: the account it belongs to, the invariant
 * that a deposit is an asset, and the contract that a value is *computed*. Each
 * subclass supplies its own growth rule, and that rule is the only thing that
 * differs — which is why they are subclasses rather than a `kind` field read by an
 * `if` chain that every new product has to be added to.
 */
export abstract class DepositProduct {
  protected constructor(readonly account: Account) {
    if (account.type !== AccountType.ASSET) {
      throw new TypeError(
        `${account.displayName} is ${account.type.label.toLowerCase()}, not an asset — ` +
          `a deposit wraps an asset account.`,
      );
    }
  }

  abstract readonly kind: DepositKind;

  /** Whether the money can be taken out before maturity, and at what cost. */
  abstract readonly liquidity: "LOCKED" | "PENALTY_ON_EARLY_EXIT" | "PARTIAL_WITHDRAWAL" | "FREE";

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
   * The deposit's value on a date, computed.
   *
   * `asOf` before the deposit started returns zero rather than throwing: a net
   * worth timeline runs over months in which the deposit did not exist, and
   * throwing would make the chart unrenderable rather than the number honest.
   */
  abstract valueOn(asOf: CalendarDate): Money;

  /** The whole life of the deposit, for the detail screen and for tests. */
  abstract schedule(): AccrualSchedule;

  /** Interest earned within a period — what a tax return needs. */
  interestWithin(range: DateRange): Money {
    return Money.total(
      this.schedule()
        .rows.filter((row) => range.contains(row.on))
        .map((row) => row.interest),
      this.currency,
    );
  }

  /**
   * Interest for a financial year, which is the unit Indian tax works in.
   *
   * Separate from {@link interestWithin} because the FY boundary is the one that
   * matters and constructing it by hand at each call site is how a March deposit
   * ends up in the wrong year.
   */
  interestInFinancialYear(year: FinancialYear): Money {
    return this.interestWithin(year.range);
  }

  toString(): string {
    return `${this.kind} ${this.account.code.toString()}`;
  }
}

/* ═══ FixedDeposit ════════════════════════════════════════════════════ */

export interface FixedDepositTerms {
  readonly principal: Money;
  readonly rate: Rate;
  readonly openedOn: CalendarDate;
  readonly maturesOn: CalendarDate;
  readonly interestType: Extract<InterestType, "SIMPLE" | "COMPOUND">;
  readonly compounding: CompoundingFrequency;
  /**
   * Whether interest is added to the deposit or paid out.
   *
   * A payout FD's value never grows: the interest leaves. Modelling it as growth
   * and then subtracting a withdrawal would count the same rupee twice, once as
   * value and once as income.
   */
  readonly payout: "CUMULATIVE" | "PERIODIC_PAYOUT";
  /** Penalty rate reduction on breaking early — typically 1% in India. */
  readonly prematureWithdrawalPenalty?: Percentage;
}

/**
 * A bank fixed deposit.
 *
 * Indian FDs compound **quarterly** by convention, which is why the frequency is
 * a required term rather than an assumption: the same 7.1% for five years pays
 * ₹1,41,478 compounded quarterly and ₹1,35,500 as simple interest on ₹1,00,000,
 * and a certificate quotes one of them.
 */
export class FixedDeposit extends DepositProduct {
  readonly kind = "FIXED_DEPOSIT" as const;
  readonly liquidity = "PENALTY_ON_EARLY_EXIT" as const;

  constructor(
    account: Account,
    readonly terms: FixedDepositTerms,
  ) {
    super(account);
    if (!terms.principal.isPositive) {
      throw new TypeError("A deposit needs a positive principal.");
    }
    if (!terms.maturesOn.isAfter(terms.openedOn)) {
      throw new TypeError(
        `A deposit must mature (${terms.maturesOn.toISO()}) after it opens (${terms.openedOn.toISO()}).`,
      );
    }
    if (terms.principal.currency.code !== account.currency.code) {
      throw new TypeError(
        `The principal is in ${terms.principal.currency.code} but the account is in ` +
          `${account.currency.code}.`,
      );
    }
  }

  /** Whole compounding periods elapsed between two dates. */
  private periodsBetween(from: CalendarDate, to: CalendarDate): number {
    const perYear = periodsPerYear(this.terms.compounding);
    if (this.terms.compounding === "DAILY") return Math.max(0, from.daysUntil(to));
    if (this.terms.compounding === "AT_MATURITY") {
      return to.isOnOrAfter(this.terms.maturesOn) ? 1 : 0;
    }
    const monthsPerPeriod = 12 / perYear;
    const months = (to.year - from.year) * 12 + (to.month - from.month) - (to.day < from.day ? 1 : 0);
    return Math.max(0, Math.floor(months / monthsPerPeriod));
  }

  override valueOn(asOf: CalendarDate): Money {
    if (asOf.isBefore(this.terms.openedOn)) return Money.zero(this.currency);
    const effective = CalendarDate.min(asOf, this.terms.maturesOn);

    if (this.terms.interestType === "SIMPLE") {
      const days = this.terms.openedOn.daysUntil(effective);
      const interest = simpleInterest(this.terms.principal, this.terms.rate, days);
      return this.terms.payout === "PERIODIC_PAYOUT"
        ? this.terms.principal
        : this.terms.principal.plus(interest);
    }

    const periods = this.periodsBetween(this.terms.openedOn, effective);
    if (this.terms.payout === "PERIODIC_PAYOUT") return this.terms.principal;

    const factor = compoundFactor(this.terms.rate, this.terms.compounding, periods);
    const compounded = this.terms.principal.timesRatio(factor.numerator, factor.denominator, "HALF_UP");

    /*
     * The stub period: banks pay simple interest on the days that do not complete
     * a compounding period. Ignoring it understates a deposit opened mid-quarter by
     * up to three months of interest — the most common way a computed maturity
     * value fails to match a certificate.
     */
    const wholePeriodsEnd = this.periodEnd(periods);
    const stubDays = Math.max(0, wholePeriodsEnd.daysUntil(effective));
    if (stubDays === 0) return compounded;
    return compounded.plus(simpleInterest(compounded, this.terms.rate, stubDays));
  }

  /** The date `periods` whole compounding periods after the deposit opened. */
  private periodEnd(periods: number): CalendarDate {
    if (this.terms.compounding === "DAILY") return this.terms.openedOn.plusDays(periods);
    if (this.terms.compounding === "AT_MATURITY") {
      return periods === 0 ? this.terms.openedOn : this.terms.maturesOn;
    }
    const monthsPerPeriod = 12 / periodsPerYear(this.terms.compounding);
    return this.terms.openedOn.plusMonths(periods * monthsPerPeriod);
  }

  /** The value at maturity — the figure a certificate prints. */
  maturityValue(): Money {
    return this.valueOn(this.terms.maturesOn);
  }

  /**
   * What breaking the deposit today pays.
   *
   * The penalty is a *rate reduction*, not a fee: Indian banks recompute the whole
   * period at the lower rate rather than deducting a charge, which produces a
   * different (smaller) number than subtracting a percentage of the interest.
   */
  prematureWithdrawalValue(asOf: CalendarDate): Money {
    const penalty = this.terms.prematureWithdrawalPenalty;
    if (!penalty || asOf.isOnOrAfter(this.terms.maturesOn)) return this.valueOn(asOf);

    /*
     * `Percentage` is scaled 1e6 and `Rate` 1e10, so the penalty is widened by
     * 1e4 rather than converted through a decimal string — a 1% penalty must
     * subtract exactly 1.0000000000 from the rate, not 0.9999999999.
     */
    const reduced = Rate.fromScaled(
      this.terms.rate.scaled - BigInt(penalty.toScaledNumber()) * 10n ** 4n,
      this.terms.rate.dayCount,
    );
    const penalised = new FixedDeposit(this.account, { ...this.terms, rate: reduced });
    return penalised.valueOn(asOf);
  }

  override schedule(): AccrualSchedule {
    const rows: AccrualRow[] = [];
    const perYear = periodsPerYear(this.terms.compounding);
    const totalPeriods = this.periodsBetween(this.terms.openedOn, this.terms.maturesOn);

    let opening = this.terms.principal;
    for (let period = 1; period <= Math.max(1, totalPeriods); period += 1) {
      const on = this.periodEnd(period);
      const value = this.valueOn(on);
      const interest = value.minus(opening);
      rows.push({
        on,
        opening,
        contribution: period === 1 ? this.terms.principal : Money.zero(this.currency),
        interest: this.terms.payout === "PERIODIC_PAYOUT" ? this.periodicPayout() : interest,
        closing: this.terms.payout === "PERIODIC_PAYOUT" ? this.terms.principal : value,
        note:
          this.terms.interestType === "SIMPLE"
            ? "Simple interest"
            : `Compounded ${this.terms.compounding.toLowerCase().replace("_", " ")} (${perYear}×/yr)`,
      });
      if (this.terms.payout === "CUMULATIVE") opening = value;
    }

    // The maturity row, when the term does not divide evenly into periods.
    const last = rows[rows.length - 1];
    if (last && last.on.isBefore(this.terms.maturesOn)) {
      const value = this.valueOn(this.terms.maturesOn);
      rows.push({
        on: this.terms.maturesOn,
        opening: last.closing,
        contribution: Money.zero(this.currency),
        interest: value.minus(last.closing),
        closing: value,
        note: "Maturity — simple interest on the part period",
      });
    }

    return summarise(rows, this.currency);
  }

  private periodicPayout(): Money {
    const factor = compoundFactor(this.terms.rate, this.terms.compounding, 1);
    return this.terms.principal
      .timesRatio(factor.numerator, factor.denominator, "HALF_UP")
      .minus(this.terms.principal);
  }
}

/* ═══ RecurringDeposit ════════════════════════════════════════════════ */

export interface RecurringDepositTerms {
  readonly instalment: Money;
  readonly rate: Rate;
  readonly openedOn: CalendarDate;
  /** Number of monthly instalments. */
  readonly months: number;
  /** Indian RDs compound quarterly on each instalment. */
  readonly compounding: CompoundingFrequency;
  /**
   * Instalments the holder missed, by 1-based number.
   *
   * Modelled explicitly because a missed instalment is not just less money in: the
   * bank charges a penalty and the instalment earns nothing, so a schedule that
   * quietly assumed every instalment arrived would overstate the maturity value.
   */
  readonly missedInstalments?: readonly number[];
  /** Penalty per missed instalment — commonly ₹1–₹2 per ₹100 per month. */
  readonly missedInstalmentPenalty?: Money;
}

/**
 * A recurring deposit.
 *
 * Each instalment compounds for its own remaining term, which is why the maturity
 * value is a sum over instalments rather than a single formula: instalment 1
 * compounds for the whole term and instalment 60 for none, and the "average
 * balance" shortcut that looks equivalent is not.
 */
export class RecurringDeposit extends DepositProduct {
  readonly kind = "RECURRING_DEPOSIT" as const;
  readonly liquidity = "PENALTY_ON_EARLY_EXIT" as const;

  constructor(
    account: Account,
    readonly terms: RecurringDepositTerms,
  ) {
    super(account);
    if (!terms.instalment.isPositive) throw new TypeError("An RD needs a positive instalment.");
    if (!Number.isInteger(terms.months) || terms.months < 1) {
      throw new RangeError(`An RD runs for a whole number of months, got ${terms.months}.`);
    }
  }

  get maturesOn(): CalendarDate {
    return this.terms.openedOn.plusMonths(this.terms.months);
  }

  private missed(instalment: number): boolean {
    return (this.terms.missedInstalments ?? []).includes(instalment);
  }

  /** Instalment `n` is paid at the start of month `n`. */
  private instalmentDate(n: number): CalendarDate {
    return this.terms.openedOn.plusMonths(n - 1);
  }

  override valueOn(asOf: CalendarDate): Money {
    if (asOf.isBefore(this.terms.openedOn)) return Money.zero(this.currency);
    const effective = CalendarDate.min(asOf, this.maturesOn);

    let total = Money.zero(this.currency);
    for (let n = 1; n <= this.terms.months; n += 1) {
      const paidOn = this.instalmentDate(n);
      if (paidOn.isAfter(effective)) break;
      if (this.missed(n)) continue;

      // Whole compounding periods this instalment has completed.
      const perYear = periodsPerYear(this.terms.compounding);
      const monthsPerPeriod = 12 / perYear;
      const monthsHeld =
        (effective.year - paidOn.year) * 12 + (effective.month - paidOn.month) -
        (effective.day < paidOn.day ? 1 : 0);
      const periods = Math.max(0, Math.floor(monthsHeld / monthsPerPeriod));

      const factor = compoundFactor(this.terms.rate, this.terms.compounding, periods);
      let value = this.terms.instalment.timesRatio(factor.numerator, factor.denominator, "HALF_UP");

      // Simple interest on the months that do not complete a period, as banks pay.
      const stubMonths = Math.max(0, monthsHeld - periods * monthsPerPeriod);
      if (stubMonths > 0) {
        const stubDays = paidOn.plusMonths(periods * monthsPerPeriod).daysUntil(effective);
        value = value.plus(simpleInterest(value, this.terms.rate, Math.max(0, stubDays)));
      }
      total = total.plus(value);
    }

    const penalty = this.terms.missedInstalmentPenalty;
    if (penalty && this.terms.missedInstalments) {
      const charged = this.terms.missedInstalments.filter((n) =>
        this.instalmentDate(n).isOnOrBefore(effective),
      ).length;
      total = total.minus(penalty.times(charged));
    }

    return total;
  }

  maturityValue(): Money {
    return this.valueOn(this.maturesOn);
  }

  override schedule(): AccrualSchedule {
    const rows: AccrualRow[] = [];
    let previous = Money.zero(this.currency);

    for (let n = 1; n <= this.terms.months; n += 1) {
      const on = this.instalmentDate(n).plusMonths(1);
      const value = this.valueOn(on);
      const contribution = this.missed(n) ? Money.zero(this.currency) : this.terms.instalment;
      rows.push({
        on,
        opening: previous,
        contribution,
        interest: value.minus(previous).minus(contribution),
        closing: value,
        note: this.missed(n) ? `Instalment ${n} missed` : `Instalment ${n}`,
      });
      previous = value;
    }

    return summarise(rows, this.currency);
  }
}

/* ═══ PublicProvidentFund ═════════════════════════════════════════════ */

export interface PpfTerms {
  readonly openedOn: CalendarDate;
  /** Contributions, by financial-year label (`"2026-27"`). */
  readonly contributions: readonly { readonly financialYear: string; readonly amount: Money }[];
  /** Rate per financial year — PPF is re-notified quarterly, effectively annually. */
  readonly ratesByFinancialYear: ReadonlyMap<string, Rate>;
  /** Extensions taken after the initial 15 years, in 5-year blocks. */
  readonly extensionBlocks?: number;
}

/** The statutory ceiling on a year's PPF contribution. */
export const PPF_ANNUAL_LIMIT = Money.fromRupees("150000");
/** The statutory minimum, below which the account is treated as discontinued. */
export const PPF_ANNUAL_MINIMUM = Money.fromRupees("500");
const PPF_INITIAL_YEARS = 15;
const PPF_EXTENSION_YEARS = 5;

/**
 * A Public Provident Fund account.
 *
 * Three statutory facts are enforced rather than documented: the ₹1.5 lakh annual
 * ceiling, the 15-year lock, and extension only in whole 5-year blocks. They are
 * enforced because breaching them is not a rounding difference — a contribution
 * above the ceiling earns no interest at all and is returned, so a projection that
 * accepted ₹2 lakh would overstate the balance for fifteen years.
 *
 * Interest is credited **annually**, on the lowest balance between the 5th and the
 * end of the month, but the annual credit is what the passbook shows and what a
 * tax return needs, so that is what this computes.
 */
export class PublicProvidentFund extends DepositProduct {
  readonly kind = "PPF" as const;
  readonly liquidity = "LOCKED" as const;

  constructor(
    account: Account,
    readonly terms: PpfTerms,
  ) {
    super(account);
    for (const contribution of terms.contributions) {
      if (contribution.amount.isGreaterThan(PPF_ANNUAL_LIMIT)) {
        throw new TypeError(
          `A PPF contribution of ${contribution.amount.toString()} in ${contribution.financialYear} ` +
            `exceeds the ${PPF_ANNUAL_LIMIT.toString()} statutory limit — the excess earns no ` +
            `interest and is returned, so it must not be modelled as invested.`,
        );
      }
    }
    if (terms.extensionBlocks !== undefined && !Number.isInteger(terms.extensionBlocks)) {
      throw new TypeError("PPF extends in whole five-year blocks.");
    }
  }

  /** When the account matures, including any extension blocks taken. */
  get maturesOn(): CalendarDate {
    const base = FinancialYear.containing(this.terms.openedOn).end.plusYears(PPF_INITIAL_YEARS);
    return base.plusYears((this.terms.extensionBlocks ?? 0) * PPF_EXTENSION_YEARS);
  }

  /** Whether money can be taken out at all on a date. */
  canWithdrawOn(asOf: CalendarDate): boolean {
    return asOf.isOnOrAfter(this.maturesOn);
  }

  /**
   * Whether a year's contribution keeps the account active.
   *
   * A year below the ₹500 minimum makes the account "discontinued": it stops
   * earning until a penalty is paid. Reporting that as a normal year would show a
   * balance the passbook does not.
   */
  yearsBelowMinimum(): readonly string[] {
    return this.terms.contributions
      .filter((contribution) => contribution.amount.isLessThan(PPF_ANNUAL_MINIMUM))
      .map((contribution) => contribution.financialYear);
  }

  override schedule(): AccrualSchedule {
    const rows: AccrualRow[] = [];
    const byYear = new Map(
      this.terms.contributions.map((contribution) => [contribution.financialYear, contribution.amount]),
    );

    let year = FinancialYear.containing(this.terms.openedOn);
    let balance = Money.zero(this.currency);
    const end = this.maturesOn;

    while (year.end.isOnOrBefore(end)) {
      const contribution = byYear.get(year.label) ?? Money.zero(this.currency);
      const rate = this.terms.ratesByFinancialYear.get(year.label);
      const opening = balance;
      const withContribution = balance.plus(contribution);

      /*
       * A full year's interest on this year's contribution, which assumes it was
       * paid before the 5th of April.
       *
       * That is the standard advice and what every PPF calculator assumes, but it
       * is an assumption: PPF pays on the lowest balance between the 5th and the
       * month end, so a contribution made in March earns one month, not twelve.
       * Modelling the month of each contribution would be more faithful; it needs
       * a contribution date the passbook import does not yet carry, so the
       * assumption is stated here rather than hidden.
       */
      const interest = rate
        ? withContribution.timesRatio(rate.scaled, RATE_DENOMINATOR, "HALF_UP")
        : Money.zero(this.currency);

      balance = withContribution.plus(interest);
      rows.push({
        on: year.end,
        opening,
        contribution,
        interest,
        closing: balance,
        note: rate ? `${year.label} at ${rate.percent.toFixed(2)}%` : `${year.label} — no rate notified`,
      });
      year = year.next();
    }

    return summarise(rows, this.currency);
  }

  override valueOn(asOf: CalendarDate): Money {
    const rows = this.schedule().rows.filter((row) => row.on.isOnOrBefore(asOf));
    return rows.length === 0 ? Money.zero(this.currency) : rows[rows.length - 1].closing;
  }

  /**
   * PPF is EEE — exempt on contribution, on accrual and on withdrawal.
   *
   * Stated as a method rather than a comment because the tax engine asks, and the
   * answer being wrong for one product is a wrong tax return rather than a wrong
   * label.
   */
  taxTreatment(): { contribution: "EXEMPT"; accrual: "EXEMPT"; withdrawal: "EXEMPT" } {
    return { contribution: "EXEMPT", accrual: "EXEMPT", withdrawal: "EXEMPT" };
  }
}

/* ═══ EmployeeProvidentFund ═══════════════════════════════════════════ */

export interface EpfContribution {
  readonly financialYear: string;
  readonly employee: Money;
  readonly employer: Money;
  /** Voluntary Provident Fund — the employee's own top-up, taxed like the rest. */
  readonly voluntary: Money;
}

export interface EpfTerms {
  readonly openedOn: CalendarDate;
  readonly contributions: readonly EpfContribution[];
  readonly ratesByFinancialYear: ReadonlyMap<string, Rate>;
  /**
   * The threshold above which interest on employee contributions is taxable —
   * ₹2.5 lakh a year (₹5 lakh where the employer does not contribute), from
   * FY2021-22.
   */
  readonly taxableContributionThreshold?: Money;
}

export interface EpfBalances {
  readonly employee: Money;
  readonly employer: Money;
  readonly voluntary: Money;
  readonly total: Money;
}

/**
 * An EPF account, with its three sub-balances tracked separately.
 *
 * Separately because they behave differently and the difference is money: the
 * employer's share has its own withdrawal rules, and interest on employee plus
 * voluntary contributions above ₹2.5 lakh a year is **taxable** while the rest is
 * not. One combined balance cannot answer the taxable-interest question at all,
 * which is the plan's done-when.
 */
export class EmployeeProvidentFund extends DepositProduct {
  readonly kind = "EPF" as const;
  readonly liquidity = "LOCKED" as const;

  constructor(
    account: Account,
    readonly terms: EpfTerms,
  ) {
    super(account);
  }

  /** The three balances as of a date, each grown at its own year's rate. */
  balancesOn(asOf: CalendarDate): EpfBalances {
    const zero = Money.zero(this.currency);
    let employee = zero;
    let employer = zero;
    let voluntary = zero;

    for (const row of this.yearRows()) {
      if (row.year.end.isAfter(asOf)) break;
      employee = employee.plus(row.employee.contribution).plus(row.employee.interest);
      employer = employer.plus(row.employer.contribution).plus(row.employer.interest);
      voluntary = voluntary.plus(row.voluntary.contribution).plus(row.voluntary.interest);
    }

    return { employee, employer, voluntary, total: employee.plus(employer).plus(voluntary) };
  }

  override valueOn(asOf: CalendarDate): Money {
    return this.balancesOn(asOf).total;
  }

  /**
   * Interest that is taxable, by financial year.
   *
   * Only the part attributable to employee plus voluntary contributions **above**
   * the threshold is taxable, so this is a proportion of that year's interest on
   * those two balances — not the whole of it, and not the employer's.
   */
  taxableInterestByYear(): readonly { financialYear: string; taxable: Money; exempt: Money }[] {
    const threshold = this.terms.taxableContributionThreshold;
    return this.yearRows().map((row) => {
      const ownContribution = row.employee.contribution.plus(row.voluntary.contribution);
      const ownInterest = row.employee.interest.plus(row.voluntary.interest);
      if (!threshold || !ownContribution.isGreaterThan(threshold)) {
        return { financialYear: row.year.label, taxable: Money.zero(this.currency), exempt: ownInterest };
      }
      const excess = ownContribution.minus(threshold);
      const taxable = ownInterest.timesRatio(excess.minor, ownContribution.minor, "HALF_UP");
      return { financialYear: row.year.label, taxable, exempt: ownInterest.minus(taxable) };
    });
  }

  override schedule(): AccrualSchedule {
    const rows = this.yearRows().map((row) => {
      const contribution = row.employee.contribution
        .plus(row.employer.contribution)
        .plus(row.voluntary.contribution);
      const interest = row.employee.interest.plus(row.employer.interest).plus(row.voluntary.interest);
      return {
        on: row.year.end,
        opening: row.opening,
        contribution,
        interest,
        closing: row.opening.plus(contribution).plus(interest),
        note: `${row.year.label} — employee ${row.employee.contribution.toString()}, employer ${row.employer.contribution.toString()}, VPF ${row.voluntary.contribution.toString()}`,
      };
    });
    return summarise(rows, this.currency);
  }

  /** Per-year growth of each sub-balance, which everything else is derived from. */
  private yearRows(): readonly {
    year: FinancialYear;
    opening: Money;
    employee: { contribution: Money; interest: Money };
    employer: { contribution: Money; interest: Money };
    voluntary: { contribution: Money; interest: Money };
  }[] {
    const zero = Money.zero(this.currency);
    const byYear = new Map(this.terms.contributions.map((row) => [row.financialYear, row]));
    const labels = [...byYear.keys()].sort();
    if (labels.length === 0) return [];

    const out: {
      year: FinancialYear;
      opening: Money;
      employee: { contribution: Money; interest: Money };
      employer: { contribution: Money; interest: Money };
      voluntary: { contribution: Money; interest: Money };
    }[] = [];

    let employee = zero;
    let employer = zero;
    let voluntary = zero;

    let year = FinancialYear.parse(labels[0]);
    const lastYear = FinancialYear.parse(labels[labels.length - 1]);

    while (year.startYear <= lastYear.startYear) {
      const contribution = byYear.get(year.label);
      const rate = this.terms.ratesByFinancialYear.get(year.label);
      const opening = employee.plus(employer).plus(voluntary);

      /*
       * EPF interest is credited monthly on the running balance and paid annually,
       * so a year's twelve equal contributions earn, on average, 6.5 months of
       * interest: (12+11+…+1)/12 = 6.5. The interest base is therefore
       * `opening + contribution × 13/24`, not `opening + contribution`.
       *
       * The difference is not academic. On ₹1.8 lakh of contributions at 8.25% the
       * naive version credits ₹14,850 where EPFO credits ₹8,044 — ₹6,800 of
       * invented money in year one, compounding for a working life.
       */
      const grow = (balance: Money, added: Money) => {
        const interestBase = balance.plus(added.timesRatio(13n, 24n, "HALF_EVEN"));
        const interest = rate
          ? interestBase.timesRatio(rate.scaled, RATE_DENOMINATOR, "HALF_UP")
          : zero;
        return { contribution: added, interest };
      };

      const employeeRow = grow(employee, contribution?.employee ?? zero);
      const employerRow = grow(employer, contribution?.employer ?? zero);
      const voluntaryRow = grow(voluntary, contribution?.voluntary ?? zero);

      employee = employee.plus(employeeRow.contribution).plus(employeeRow.interest);
      employer = employer.plus(employerRow.contribution).plus(employerRow.interest);
      voluntary = voluntary.plus(voluntaryRow.contribution).plus(voluntaryRow.interest);

      out.push({
        year,
        opening,
        employee: employeeRow,
        employer: employerRow,
        voluntary: voluntaryRow,
      });
      year = year.next();
    }

    return out;
  }
}

/* ═══ NationalPensionSystem ═══════════════════════════════════════════ */

export type NpsScheme = "E" | "C" | "G" | "A";
export type NpsTier = "TIER_I" | "TIER_II";

export interface NpsHolding {
  readonly scheme: NpsScheme;
  readonly units: Quantity;
}

export interface NpsTerms {
  readonly tier: NpsTier;
  readonly openedOn: CalendarDate;
  readonly holdings: readonly NpsHolding[];
}

/**
 * An NPS account.
 *
 * **NPS is priced, not accrued**, and that is the whole reason it is a separate
 * class rather than another interest-bearing deposit. The balance is units of four
 * scheme funds, each with its own NAV published daily; there is no rate to compound
 * and no schedule to generate. Modelling it as a deposit with an assumed return —
 * which is what every spreadsheet does — produces a number that is wrong by
 * whatever the market did.
 *
 * `valueOn` therefore takes the prices as an argument: a value with no NAV is not
 * a value, and returning `null` for a missing NAV is more honest than substituting
 * yesterday's.
 */
export class NationalPensionSystem extends DepositProduct {
  readonly kind = "NPS" as const;

  constructor(
    account: Account,
    readonly terms: NpsTerms,
  ) {
    super(account);
  }

  get liquidity(): "LOCKED" | "FREE" {
    // Tier II is withdrawable at will; Tier I is locked until 60 bar exceptions.
    return this.terms.tier === "TIER_II" ? "FREE" : "LOCKED";
  }

  unitsIn(scheme: NpsScheme): Quantity {
    return Quantity.sum(
      this.terms.holdings.filter((holding) => holding.scheme === scheme).map((holding) => holding.units),
    );
  }

  /**
   * Value from NAVs — `null` when any held scheme has no NAV.
   *
   * All-or-nothing rather than partial, because a partial total looks like a
   * complete one on a screen: a portfolio worth ₹8 lakh reported as ₹5 lakh because
   * one scheme's NAV was missing is worse than reporting nothing.
   */
  valueFrom(navs: ReadonlyMap<NpsScheme, UnitPrice>): Money | null {
    let total = Money.zero(this.currency);
    for (const holding of this.terms.holdings) {
      const nav = navs.get(holding.scheme);
      if (!nav) return null;
      total = total.plus(nav.times(holding.units));
    }
    return total;
  }

  /**
   * The `DepositProduct` contract, which cannot ask for a NAV.
   *
   * Deliberately returns zero rather than guessing: the caller that has prices
   * uses {@link valueFrom}, and a caller that does not must not be handed an
   * invented figure. This is the one place the shared abstraction does not fit, and
   * pretending otherwise would be the bug.
   */
  override valueOn(_asOf: CalendarDate): Money {
    return Money.zero(this.currency);
  }

  /** Allocation across the four schemes, by units — the E/C/G/A split. */
  allocation(navs: ReadonlyMap<NpsScheme, UnitPrice>): readonly { scheme: NpsScheme; value: Money; share: Percentage }[] {
    const total = this.valueFrom(navs);
    if (!total || total.isZero) return [];
    const schemes: NpsScheme[] = ["E", "C", "G", "A"];
    return schemes.flatMap((scheme) => {
      const units = this.unitsIn(scheme);
      if (units.isZero) return [];
      const nav = navs.get(scheme);
      if (!nav) return [];
      const value = nav.times(units);
      return [{ scheme, value, share: Percentage.ratio(value, total) }];
    });
  }

  override schedule(): AccrualSchedule {
    // There is no accrual schedule for a priced product, and inventing one would
    // imply a return nobody promised.
    return summarise([], this.currency);
  }
}

/* ═══ Ports ═══════════════════════════════════════════════════════════ */

/** What a caller supplies to store a deposit's terms. */
export interface DepositTermsInput {
  readonly accountId: AccountId;
  readonly kind: DepositKind;
  readonly currency: Currency;
  readonly openedOn: CalendarDate;
  readonly accrualBasis: InterestType;
  readonly compounding: CompoundingFrequency;
  readonly payout: "CUMULATIVE" | "PERIODIC_PAYOUT";
  readonly rate?: Rate;
  readonly principal?: Money;
  readonly instalment?: Money;
  readonly months?: number;
  readonly maturesOn?: CalendarDate;
  readonly prematurePenalty?: Percentage;
  readonly npsTier?: NpsTier;
  readonly extensionBlocks?: number;
}

/** A year's money into a scheme. PPF uses `amount`; EPF uses the three parts. */
export interface DepositContributionInput {
  readonly accountId: AccountId;
  readonly financialYear: string;
  readonly amount?: Money;
  readonly employee?: Money;
  readonly employer?: Money;
  readonly voluntary?: Money;
}

/**
 * Persistence for deposits, retirement schemes and loans.
 *
 * One port across all of them because they share a shape: terms in, product out.
 * `load*` returns constructed domain objects rather than rows, so the mapping from
 * five stored kinds to five classes lives in exactly one place — two screens that
 * each did their own mapping is how two screens end up disagreeing about what an
 * EPF balance is.
 */
export interface DepositStore {
  saveTerms(userId: UserId, input: DepositTermsInput): Promise<void>;
  saveContribution(userId: UserId, input: DepositContributionInput): Promise<void>;
  saveSchemeRate(userId: UserId, schemeKey: string, financialYear: string, rate: Rate): Promise<void>;
  saveNpsHolding(
    userId: UserId,
    accountId: AccountId,
    scheme: NpsScheme,
    units: Quantity,
    schemeCode?: string | null,
  ): Promise<void>;
  loadDeposits(userId: UserId, accounts: readonly Account[]): Promise<readonly DepositProduct[]>;
  loadDeposit(userId: UserId, account: Account): Promise<DepositProduct | null>;
}

/**
 * A deposit's value against the ledger's own record of it.
 *
 * The reconciliation that matters for a deposit: the computed value and the
 * postings should agree, and where they do not, the difference is interest that
 * has accrued but has not been booked. Naming that difference is what turns "the
 * numbers disagree" into "₹4,231 of interest is not yet in the journal".
 */
export async function accruedButUnbooked(
  deposit: DepositProduct,
  asOf: CalendarDate,
  balances: BalanceSource,
): Promise<{ computed: Money; booked: Money; unbooked: Money }> {
  const computed = deposit.valueOn(asOf);
  const booked = await balances.balanceOf(deposit.account.userId, deposit.id, asOf);
  return { computed, booked, unbooked: computed.minus(booked) };
}

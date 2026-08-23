/**
 * Loan mathematics: EMI, amortisation, prepayment, flat versus reducing, payoff
 * strategies.
 *
 * `30-CALCULATIONS.md` §5 opens with "absent from all four repos", and that is the
 * reason this file is long: Firefly stores a rate and a period and computes
 * nothing, so there is no prior art to port and every formula here is written
 * against the arithmetic rather than against another implementation.
 *
 * Two properties are load-bearing and both are asserted as invariants rather than
 * hoped for:
 *
 *   - **N01/N02: `Σ principal` equals the loan principal exactly, and the final
 *     closing balance is exactly zero.** This is what the mandatory final-period
 *     adjustment exists for. Without it, accumulated rounding leaves a few paise
 *     outstanding forever, and a loan that never closes is a loan whose payoff date
 *     is wrong.
 *   - **The effective annual rate is always available beside a flat rate.** Flat
 *     quoting is normal in Indian consumer lending and roughly doubles the true
 *     cost; showing only the quoted number is not neutral, it repeats the lender's
 *     framing.
 *
 * Everything is exact integer arithmetic. `(1+r)^n` is a bigint rational, never a
 * float — an EMI that is a paisa out compounds into a schedule that does not close.
 */

import { UserId } from "@/core/kernel";
import { Currency, Money } from "@/core/money";
import { Percentage, Rate } from "@/core/numeric";
import { CalendarDate } from "@/core/time";
import { Account, AccountId, AccountType } from "@/domain/accounts";

/* ═══ Rate arithmetic ═════════════════════════════════════════════════ */

/** `Rate` is scaled 1e10 and quoted as a percentage, so a fraction divides by both. */
const RATE_DENOMINATOR = 10n ** 10n * 100n;

/** The exact per-period rate as a rational: `annual / periodsPerYear`. */
function periodRate(annual: Rate, periodsPerYear: number): { numerator: bigint; denominator: bigint } {
  return { numerator: annual.scaled, denominator: RATE_DENOMINATOR * BigInt(periodsPerYear) };
}

/* ═══ EMI ═════════════════════════════════════════════════════════════ */

export type PaymentFrequency = "MONTHLY" | "QUARTERLY" | "ANNUALLY";

export function paymentsPerYear(frequency: PaymentFrequency): number {
  switch (frequency) {
    case "MONTHLY":
      return 12;
    case "QUARTERLY":
      return 4;
    case "ANNUALLY":
      return 1;
  }
}

/**
 * The equated instalment: `P · r · (1+r)ⁿ / ((1+r)ⁿ − 1)`.
 *
 * Rearranged so nothing leaves the integers. With `r = s/(D·m)` and `B = D·m`,
 * `(1+r)ⁿ = (B+s)ⁿ / Bⁿ`, so the whole expression collapses to
 *
 *     EMI = P · s · (B+s)ⁿ / ( B · ((B+s)ⁿ − Bⁿ) )
 *
 * which is one `Money.timesRatio` and one rounding. A 30-year monthly loan raises
 * a 21-digit base to the 360th power — about 7,500 digits — and `bigint` is exact
 * at that size while a `double` has been wrong since the 15th digit.
 *
 * A zero-rate loan divides by zero in that formula, so it is handled directly: the
 * instalment is the principal spread evenly, which is what a 0% EMI scheme is.
 */
export function equatedInstalment(
  principal: Money,
  annualRate: Rate,
  periods: number,
  frequency: PaymentFrequency = "MONTHLY",
): Money {
  if (!Number.isInteger(periods) || periods < 1) {
    throw new RangeError(`A loan runs for a whole number of periods, got ${periods}.`);
  }
  if (!principal.isPositive) throw new TypeError("A loan needs a positive principal.");
  if (annualRate.isNegative) throw new TypeError("A loan rate cannot be negative.");

  const { numerator: s, denominator: perPeriodDenominator } = periodRate(
    annualRate,
    paymentsPerYear(frequency),
  );
  if (s === 0n) {
    // Rounded up, so the schedule never leaves a balance the final adjustment has
    // to absorb upward — an instalment a paisa short is a 361st payment.
    return principal.dividedBy(BigInt(periods), "UP");
  }

  const base = perPeriodDenominator;
  const n = BigInt(periods);
  const grown = (base + s) ** n;
  const numerator = s * grown;
  const denominator = base * (grown - base ** n);
  return principal.timesRatio(numerator, denominator, "HALF_UP");
}

/* ═══ Amortisation ════════════════════════════════════════════════════ */

export interface AmortisationRow {
  readonly period: number;
  readonly on: CalendarDate;
  readonly opening: Money;
  readonly instalment: Money;
  readonly interest: Money;
  readonly principal: Money;
  readonly closing: Money;
  /** Set when this row is not a plain instalment. */
  readonly note?: string;
}

export interface AmortisationSchedule {
  readonly rows: readonly AmortisationRow[];
  readonly totalInterest: Money;
  readonly totalPaid: Money;
  readonly closedOn: CalendarDate | null;
  /** Sum of the principal column — must equal the loan principal exactly (N01). */
  readonly principalRepaid: Money;
}

/** A lump-sum payment made outside the schedule. */
export interface Prepayment {
  readonly on: CalendarDate;
  readonly amount: Money;
  /**
   * What the borrower chose to shorten.
   *
   * `TERM` keeps the instalment and closes the loan earlier; `INSTALMENT` keeps the
   * end date and lowers each payment. The two are genuinely different products of
   * the same rupee and lenders make the borrower choose, so the model does too —
   * defaulting it would silently pick the option that saves less interest.
   */
  readonly reduces: "TERM" | "INSTALMENT";
}

/* ═══ Loan ════════════════════════════════════════════════════════════ */

export interface LoanTerms {
  readonly principal: Money;
  readonly annualRate: Rate;
  /** Total scheduled payments. */
  readonly periods: number;
  readonly frequency: PaymentFrequency;
  readonly disbursedOn: CalendarDate;
  /** The date of the first instalment; defaults to one period after disbursement. */
  readonly firstPaymentOn?: CalendarDate;
  readonly interestType: "REDUCING_BALANCE" | "FLAT";
  readonly prepayments?: readonly Prepayment[];
  /** Charged on a prepayment by some lenders — floating-rate home loans may not. */
  readonly prepaymentPenalty?: Percentage;
}

export type LoanKind = "HOME" | "VEHICLE" | "PERSONAL" | "EDUCATION" | "GOLD" | "OTHER";

/**
 * A loan.
 *
 * A liability that amortises. Everything about it is computed from the terms —
 * there is no stored schedule, for the same reason there is no stored balance: a
 * rate change or a prepayment would leave a saved schedule describing a loan that
 * no longer exists, and nothing would say which of the two was right.
 */
export abstract class Loan {
  protected constructor(
    readonly account: Account,
    readonly terms: LoanTerms,
  ) {
    if (account.type !== AccountType.LIABILITY) {
      throw new TypeError(
        `${account.displayName} is ${account.type.label.toLowerCase()}, not a liability — ` +
          `a loan wraps a liability account.`,
      );
    }
    if (!terms.principal.isPositive) throw new TypeError("A loan needs a positive principal.");
    if (!Number.isInteger(terms.periods) || terms.periods < 1) {
      throw new RangeError(`A loan runs for a whole number of periods, got ${terms.periods}.`);
    }
    if (terms.annualRate.isNegative) throw new TypeError("A loan rate cannot be negative.");
  }

  abstract readonly kind: LoanKind;

  /** Whether the lender holds security — it changes nothing arithmetically. */
  abstract readonly secured: boolean;

  get id(): AccountId {
    return this.account.id;
  }

  get currency(): Currency {
    return this.account.currency;
  }

  get displayName(): string {
    return this.account.displayName;
  }

  get firstPaymentOn(): CalendarDate {
    return this.terms.firstPaymentOn ?? this.paymentDate(1);
  }

  /** The date of instalment `period`, counting from disbursement. */
  paymentDate(period: number): CalendarDate {
    const monthsPerPeriod = 12 / paymentsPerYear(this.terms.frequency);
    const anchor = this.terms.firstPaymentOn ?? this.terms.disbursedOn.plusMonths(monthsPerPeriod);
    return anchor.plusMonths((period - 1) * monthsPerPeriod);
  }

  /**
   * The scheduled instalment.
   *
   * A flat-rate loan's instalment is `(P + P·r·years) / n` — interest on the whole
   * principal for the whole term, regardless of what has been repaid. That is what
   * makes it expensive, and it is why {@link effectiveAnnualRate} exists.
   */
  instalment(): Money {
    if (this.terms.interestType === "FLAT") {
      const years = this.terms.periods / paymentsPerYear(this.terms.frequency);
      const totalInterest = this.terms.principal.timesRatio(
        this.terms.annualRate.scaled * BigInt(Math.round(years * 1000)),
        RATE_DENOMINATOR * 1000n,
        "HALF_UP",
      );
      return this.terms.principal.plus(totalInterest).dividedBy(BigInt(this.terms.periods), "UP");
    }
    return equatedInstalment(
      this.terms.principal,
      this.terms.annualRate,
      this.terms.periods,
      this.terms.frequency,
    );
  }

  /**
   * The reducing-balance rate a flat-rate loan really costs.
   *
   * Solved by bisection on the exact EMI function rather than by the textbook
   * approximation `2·n·r/(n+1)`: the approximation is off by a percentage point at
   * long tenors, and the whole purpose of showing this figure is that it is the
   * honest one. Bisection converges on the rate whose EMI matches the flat
   * instalment to within a paisa.
   */
  effectiveAnnualRate(): Rate {
    if (this.terms.interestType === "REDUCING_BALANCE") return this.terms.annualRate;

    const target = this.instalment();
    let low = 0n;
    let high = this.terms.annualRate.scaled * 4n + RATE_DENOMINATOR;

    for (let step = 0; step < 200 && low < high; step += 1) {
      const middle = (low + high) / 2n;
      const candidate = equatedInstalment(
        this.terms.principal,
        Rate.fromScaled(middle, this.terms.annualRate.dayCount),
        this.terms.periods,
        this.terms.frequency,
      );
      if (candidate.isLessThan(target)) low = middle + 1n;
      else high = middle;
    }

    return Rate.fromScaled(low, this.terms.annualRate.dayCount);
  }

  /**
   * The amortisation schedule.
   *
   * The final period is adjusted by construction: its principal is whatever is
   * still outstanding and its instalment is that plus its interest. `30-CALCULATIONS`
   * calls this mandatory, and it is — the per-period interest rounding accumulates,
   * so an unadjusted schedule ends a few paise short and the loan never closes.
   *
   * Interest rounds `HALF_EVEN`, as the document specifies: over 360 periods,
   * `HALF_UP` biases the total upward by a systematic half-paisa per period.
   */
  schedule(): AmortisationSchedule {
    const zero = Money.zero(this.currency);
    const rows: AmortisationRow[] = [];
    const { numerator: rateNumerator, denominator: rateDenominator } = periodRate(
      this.terms.annualRate,
      paymentsPerYear(this.terms.frequency),
    );

    const flat = this.terms.interestType === "FLAT";
    const flatInterestPerPeriod = flat
      ? this.terms.principal
          .timesRatio(rateNumerator, rateDenominator, "HALF_EVEN")
      : zero;

    let instalment = this.instalment();
    let outstanding = this.terms.principal;
    const prepayments = [...(this.terms.prepayments ?? [])].sort((a, b) => a.on.compareTo(b.on));
    let prepaymentIndex = 0;
    let closedOn: CalendarDate | null = null;

    for (let period = 1; period <= this.terms.periods; period += 1) {
      if (outstanding.isZero) break;
      const on = this.paymentDate(period);

      // Prepayments land before the instalment they precede, which is what a
      // lender does: the lump sum reduces the balance interest is charged on.
      while (prepaymentIndex < prepayments.length && prepayments[prepaymentIndex].on.isOnOrBefore(on)) {
        const prepayment = prepayments[prepaymentIndex];
        prepaymentIndex += 1;
        const applied = prepayment.amount.isGreaterThan(outstanding) ? outstanding : prepayment.amount;
        const penalty = this.terms.prepaymentPenalty?.applyTo(applied) ?? zero;
        const opening = outstanding;
        outstanding = outstanding.minus(applied);
        rows.push({
          period,
          on: prepayment.on,
          opening,
          instalment: applied.plus(penalty),
          interest: penalty,
          principal: applied,
          closing: outstanding,
          note:
            prepayment.reduces === "TERM"
              ? "Prepayment — term reduced"
              : "Prepayment — instalment reduced",
        });

        if (prepayment.reduces === "INSTALMENT" && !outstanding.isZero) {
          // Re-solve the instalment over the periods that remain.
          const remaining = this.terms.periods - period + 1;
          instalment = flat
            ? instalment
            : equatedInstalment(outstanding, this.terms.annualRate, remaining, this.terms.frequency);
        }
        if (outstanding.isZero) closedOn = prepayment.on;
      }

      if (outstanding.isZero) break;

      const interest = flat
        ? flatInterestPerPeriod
        : outstanding.timesRatio(rateNumerator, rateDenominator, "HALF_EVEN");

      const isFinal = period === this.terms.periods;
      const scheduledPrincipal = instalment.minus(interest);
      const principal =
        isFinal || scheduledPrincipal.isGreaterThan(outstanding) ? outstanding : scheduledPrincipal;
      const paid = principal.plus(interest);
      const opening = outstanding;
      outstanding = outstanding.minus(principal);

      rows.push({
        period,
        on,
        opening,
        instalment: paid,
        interest,
        principal,
        closing: outstanding,
        note: isFinal ? "Final instalment — adjusted to close the loan exactly" : undefined,
      });

      if (outstanding.isZero) closedOn = on;
    }

    return {
      rows,
      totalInterest: Money.total(rows.map((row) => row.interest), this.currency),
      totalPaid: Money.total(rows.map((row) => row.instalment), this.currency),
      principalRepaid: Money.total(rows.map((row) => row.principal), this.currency),
      closedOn,
    };
  }

  /** What is still owed on a date, from the schedule. */
  outstandingOn(asOf: CalendarDate): Money {
    if (asOf.isBefore(this.terms.disbursedOn)) return Money.zero(this.currency);
    const rows = this.schedule().rows.filter((row) => row.on.isOnOrBefore(asOf));
    return rows.length === 0 ? this.terms.principal : rows[rows.length - 1].closing;
  }

  /** Interest falling in a period — what a home-loan tax deduction needs. */
  interestWithin(from: CalendarDate, to: CalendarDate): Money {
    return Money.total(
      this.schedule()
        .rows.filter((row) => row.on.isOnOrAfter(from) && row.on.isOnOrBefore(to))
        .map((row) => row.interest),
      this.currency,
    );
  }

  /** Both figures, always together — the plan's done-when for flat-rate loans. */
  quotedVersusEffective(): { quoted: Rate; effective: Rate; overstatedBy: Percentage } {
    const quoted = this.terms.annualRate;
    const effective = this.effectiveAnnualRate();
    const difference = effective.minus(quoted);
    return { quoted, effective, overstatedBy: difference.percent };
  }
}

/* ═══ Loan subclasses ═════════════════════════════════════════════════ */

/**
 * A home loan.
 *
 * Distinguished for two reasons that matter: it is the one loan whose interest is
 * deductible under §24(b) (and principal under §80C), and floating-rate home loans
 * in India carry no prepayment penalty by regulation.
 */
export class HomeLoan extends Loan {
  readonly kind = "HOME" as const;
  readonly secured = true;

  constructor(account: Account, terms: LoanTerms) {
    super(account, terms);
  }

  /** §24(b) caps the deduction on a self-occupied property at ₹2 lakh a year. */
  deductibleInterest(from: CalendarDate, to: CalendarDate, selfOccupied = true): Money {
    const paid = this.interestWithin(from, to);
    if (!selfOccupied) return paid;
    const cap = Money.fromRupees("200000", this.currency);
    return paid.isGreaterThan(cap) ? cap : paid;
  }
}

export class VehicleLoan extends Loan {
  readonly kind = "VEHICLE" as const;
  readonly secured = true;

  constructor(account: Account, terms: LoanTerms) {
    super(account, terms);
  }
}

/** The one most often quoted flat, which is why the effective rate matters here. */
export class PersonalLoan extends Loan {
  readonly kind = "PERSONAL" as const;
  readonly secured = false;

  constructor(account: Account, terms: LoanTerms) {
    super(account, terms);
  }
}

/** §80E allows the whole interest, with no cap, for eight years. */
export class EducationLoan extends Loan {
  readonly kind = "EDUCATION" as const;
  readonly secured = false;

  constructor(account: Account, terms: LoanTerms) {
    super(account, terms);
  }

  deductibleInterest(from: CalendarDate, to: CalendarDate): Money {
    return this.interestWithin(from, to);
  }
}

export class GoldLoan extends Loan {
  readonly kind = "GOLD" as const;
  readonly secured = true;

  constructor(account: Account, terms: LoanTerms) {
    super(account, terms);
  }
}

/* ═══ Payoff strategies ═══════════════════════════════════════════════ */

export interface PayoffDebt {
  readonly id: string;
  readonly label: string;
  readonly balance: Money;
  readonly annualRate: Rate;
  /** The contractual minimum that must be paid each month regardless. */
  readonly minimumPayment: Money;
}

export interface PayoffMonth {
  readonly month: number;
  readonly payments: readonly { readonly id: string; readonly amount: Money; readonly interest: Money }[];
  readonly totalPaid: Money;
  readonly remaining: Money;
}

export interface PayoffPlan {
  readonly strategy: "AVALANCHE" | "SNOWBALL";
  readonly months: readonly PayoffMonth[];
  readonly totalInterest: Money;
  readonly monthsToClear: number;
  /** The order debts were cleared in — the visible difference between strategies. */
  readonly order: readonly string[];
}

const MAX_PAYOFF_MONTHS = 600;

/**
 * Avalanche and snowball, month by month.
 *
 * Both pay every minimum and then throw everything left at one debt; they differ
 * only in which. Avalanche picks the highest rate and always pays less interest;
 * snowball picks the smallest balance and clears a debt sooner, which is a
 * behavioural argument rather than an arithmetic one. Returning both — with the
 * interest total and the order of clearing — is what lets the user weigh a real
 * cost against a real motivation instead of being told which is "correct".
 */
export function payoffPlan(
  debts: readonly PayoffDebt[],
  monthlyBudget: Money,
  strategy: "AVALANCHE" | "SNOWBALL",
): PayoffPlan {
  const currency = monthlyBudget.currency;
  const zero = Money.zero(currency);
  const totalMinimum = Money.total(debts.map((debt) => debt.minimumPayment), currency);
  if (monthlyBudget.isLessThan(totalMinimum)) {
    throw new TypeError(
      `A budget of ${monthlyBudget.toString()} cannot cover the minimum payments of ` +
        `${totalMinimum.toString()} — the plan would never close and reporting one would be a lie.`,
    );
  }

  const balances = new Map(debts.map((debt) => [debt.id, debt.balance]));
  const byId = new Map(debts.map((debt) => [debt.id, debt]));
  const months: PayoffMonth[] = [];
  const order: string[] = [];
  let totalInterest = zero;

  for (let month = 1; month <= MAX_PAYOFF_MONTHS; month += 1) {
    const live = debts.filter((debt) => !(balances.get(debt.id) ?? zero).isZero);
    if (live.length === 0) break;

    const payments: { id: string; amount: Money; interest: Money }[] = [];
    let budgetLeft = monthlyBudget;

    // Interest first, on every live debt: it is charged whether or not this is the
    // debt being attacked, which is the whole reason a high-rate debt costs more.
    const interestById = new Map<string, Money>();
    for (const debt of live) {
      const balance = balances.get(debt.id) ?? zero;
      const rate = periodRate(debt.annualRate, 12);
      const interest = balance.timesRatio(rate.numerator, rate.denominator, "HALF_EVEN");
      interestById.set(debt.id, interest);
      balances.set(debt.id, balance.plus(interest));
      totalInterest = totalInterest.plus(interest);
    }

    // Minimums.
    for (const debt of live) {
      const balance = balances.get(debt.id) ?? zero;
      const due = debt.minimumPayment.isGreaterThan(balance) ? balance : debt.minimumPayment;
      const paid = due.isGreaterThan(budgetLeft) ? budgetLeft : due;
      balances.set(debt.id, balance.minus(paid));
      budgetLeft = budgetLeft.minus(paid);
      payments.push({ id: debt.id, amount: paid, interest: interestById.get(debt.id) ?? zero });
    }

    // Everything left goes at the chosen target, then the next one if it clears.
    const ranked = [...live].sort((a, b) =>
      strategy === "AVALANCHE"
        ? b.annualRate.scaled > a.annualRate.scaled
          ? 1
          : b.annualRate.scaled < a.annualRate.scaled
            ? -1
            : 0
        : (balances.get(a.id) ?? zero).compareTo(balances.get(b.id) ?? zero),
    );

    for (const debt of ranked) {
      if (budgetLeft.isZero) break;
      const balance = balances.get(debt.id) ?? zero;
      if (balance.isZero) continue;
      const extra = balance.isGreaterThan(budgetLeft) ? budgetLeft : balance;
      balances.set(debt.id, balance.minus(extra));
      budgetLeft = budgetLeft.minus(extra);
      const existing = payments.find((payment) => payment.id === debt.id);
      if (existing) {
        payments[payments.indexOf(existing)] = { ...existing, amount: existing.amount.plus(extra) };
      } else {
        payments.push({ id: debt.id, amount: extra, interest: interestById.get(debt.id) ?? zero });
      }
    }

    for (const debt of live) {
      if ((balances.get(debt.id) ?? zero).isZero && !order.includes(debt.id)) order.push(debt.id);
    }

    const remaining = Money.total([...balances.values()], currency);
    months.push({
      month,
      payments,
      totalPaid: Money.total(payments.map((payment) => payment.amount), currency),
      remaining,
    });
    if (remaining.isZero) break;
  }

  return {
    strategy,
    months,
    totalInterest,
    monthsToClear: months.length,
    order: order.map((id) => byId.get(id)?.label ?? id),
  };
}

/** Runs both strategies and states the difference, which is the point of asking. */
export function comparePayoffStrategies(
  debts: readonly PayoffDebt[],
  monthlyBudget: Money,
): {
  avalanche: PayoffPlan;
  snowball: PayoffPlan;
  interestSavedByAvalanche: Money;
  monthsSavedByAvalanche: number;
} {
  const avalanche = payoffPlan(debts, monthlyBudget, "AVALANCHE");
  const snowball = payoffPlan(debts, monthlyBudget, "SNOWBALL");
  return {
    avalanche,
    snowball,
    interestSavedByAvalanche: snowball.totalInterest.minus(avalanche.totalInterest),
    monthsSavedByAvalanche: snowball.monthsToClear - avalanche.monthsToClear,
  };
}

/* ═══ Ports ═══════════════════════════════════════════════════════════ */

export interface StoredLoanTerms {
  readonly accountId: AccountId;
  readonly kind: LoanKind;
  readonly principal: Money;
  readonly annualRate: Rate;
  readonly periods: number;
  readonly frequency: PaymentFrequency;
  readonly disbursedOn: CalendarDate;
  readonly firstPaymentOn: CalendarDate | null;
  readonly interestType: "REDUCING_BALANCE" | "FLAT";
  readonly prepaymentPenalty: Percentage | null;
}

export interface LoanRepository {
  findFor(userId: UserId, accountId: AccountId): Promise<StoredLoanTerms | null>;
  findManyFor(
    userId: UserId,
    accountIds: readonly AccountId[],
  ): Promise<ReadonlyMap<string, StoredLoanTerms>>;
  save(userId: UserId, terms: StoredLoanTerms): Promise<void>;
}

/** Builds the right subclass for stored terms. */
export function loanFor(account: Account, terms: StoredLoanTerms): Loan {
  const shape: LoanTerms = {
    principal: terms.principal,
    annualRate: terms.annualRate,
    periods: terms.periods,
    frequency: terms.frequency,
    disbursedOn: terms.disbursedOn,
    firstPaymentOn: terms.firstPaymentOn ?? undefined,
    interestType: terms.interestType,
    prepaymentPenalty: terms.prepaymentPenalty ?? undefined,
  };
  switch (terms.kind) {
    case "HOME":
      return new HomeLoan(account, shape);
    case "VEHICLE":
      return new VehicleLoan(account, shape);
    case "EDUCATION":
      return new EducationLoan(account, shape);
    case "GOLD":
      return new GoldLoan(account, shape);
    case "PERSONAL":
    case "OTHER":
      return new PersonalLoan(account, shape);
  }
}

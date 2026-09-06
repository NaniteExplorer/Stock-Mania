/**
 * Gold leasing: a yield paid in the commodity, not in money.
 *
 * A digital-gold platform leases the user's gold to a jeweller and pays interest
 * **in grams** — 4% a year on 4.3989g is 0.1759g a year, not ₹2,900 — withholding
 * any TDS, if it withholds any at all, in grams too. That one fact is why this
 * is a new file rather than a sixth `DepositProduct`: every deposit in
 * `domain/deposits.ts` grows in `Money`,
 * and a `Money` return type cannot express a return denominated in gold. Forcing
 * it through a rupee figure would have to pick a price, and there is no honest
 * price to pick — the interest is grams until the day it is sold.
 *
 * Everything here is therefore `Quantity` (eight decimals, exact integers), and
 * `Money` appears only at the boundary where a valuation asks "what is this worth
 * today", takes a price as an argument, and says `null` when there is no price.
 *
 * Three decisions worth reading before the code:
 *
 *   1. **Accrual is by completed months, and nothing is stored.** The source
 *      spreadsheet keeps a `months_completed` column; a stored count is a figure
 *      that is wrong every day until someone edits it. `CalendarDate.monthsUntil`
 *      derives it, and it counts *completed* months: a lease that started on the
 *      15th has earned nothing on the 1st.
 *   2. **The accrual stops at the closing date.** A matured lease that nobody has
 *      closed in the UI must not keep earning — that is the difference between a
 *      tracker and a fantasy.
 *   3. **TDS is withheld from the gross grams, and the net is exactly the
 *      difference.** Rounding happens twice, on the gross and on the tax, and never
 *      a third time: `net = gross − tds` is subtraction, so the three figures
 *      always reconcile. Reported separately because the TDS is a tax credit the
 *      return can reclaim, not a cost — and reported even when it is zero, which
 *      is now the default: no CBDT guidance covers gold-lease income and the
 *      platforms surveyed withhold nothing, so a rate is something the user tells
 *      us rather than something we presume. See {@link DEFAULT_TDS_RATE}.
 */

import { DomainError, UserId, ValueObject } from "@/core/kernel";
import { Currency, Money } from "@/core/money";
import { Percentage, Quantity, UnitPrice } from "@/core/numeric";
import { CalendarDate } from "@/core/time";
import { AccountId } from "@/domain/accounts";
import { InstrumentId } from "@/domain/instruments";

/* ═══ Vocabulary ══════════════════════════════════════════════════════ */

export type LeaseStatus =
  /** Running, and accruing until its closing date. */
  | "ACTIVE"
  /** Reached its closing date and settled: the gold and its interest came back. */
  | "MATURED"
  /** Ended early. Interest stops on the cancellation date, not on the closing date. */
  | "CANCELLED";

/**
 * How often the platform actually pays the interest out.
 *
 * Not decoration, and not a display preference: it decides **when a gram is
 * earned**. A lease paying annually at 4% has earned nothing after seven months
 * — the platform owes it, but it has not been credited and cannot be sold — and
 * a tracker that accrued it monthly anyway would show grams the user cannot
 * touch, in a holding they might then try to lease again.
 *
 * `ON_MATURITY` is its own case rather than "annual with a long term": it pays
 * once at the end whatever the tenure, so an eighteen-month lease pays at
 * eighteen months and not at twelve.
 */
export const PAYOUT_FREQUENCIES = [
  "MONTHLY",
  "QUARTERLY",
  "HALF_YEARLY",
  "ANNUAL",
  "ON_MATURITY",
] as const;
export type PayoutFrequency = (typeof PAYOUT_FREQUENCIES)[number];

/** Months in one payout period. `null` means the whole term, paid once. */
export function periodMonths(frequency: PayoutFrequency): number | null {
  switch (frequency) {
    case "MONTHLY":
      return 1;
    case "QUARTERLY":
      return 3;
    case "HALF_YEARLY":
      return 6;
    case "ANNUAL":
      return 12;
    case "ON_MATURITY":
      return null;
  }
}

export function payoutFrequencyLabel(frequency: PayoutFrequency): string {
  return {
    MONTHLY: "Monthly",
    QUARTERLY: "Quarterly",
    HALF_YEARLY: "Every six months",
    ANNUAL: "Yearly",
    ON_MATURITY: "Once, at maturity",
  }[frequency];
}

/**
 * What the interest is paid in.
 *
 * `GRAMS` is the classic gold-lease product: the rent is more gold, so the
 * holding itself grows and the user is long more metal each period. `CASH` pays
 * rupees into a bank account and leaves the leased grams exactly as they were —
 * the same rate, an entirely different exposure, and a different tax posting.
 * Both are sold in India, sometimes by the same platform on the same metal,
 * which is why it is a per-lease fact rather than a global setting.
 */
export const PAYOUT_MODES = ["GRAMS", "CASH"] as const;
export type PayoutMode = (typeof PAYOUT_MODES)[number];

/**
 * The withholding assumed when a lease does not state one. **Zero.**
 *
 * This was 10% under §194A, and that was an assumption rather than a finding.
 * §194A withholds on *interest*, which §2(28A) defines as payable on money
 * borrowed or a debt incurred; a fee denominated in grams, on a bailment of
 * metal that comes back as metal, is arguably neither. No CBDT circular, ruling
 * or FAQ covers gold-lease income either way, and every platform surveyed
 * withholds nothing — including the user's own, confirmed 2026-09-05.
 *
 * So the default is zero and a lease left alone accrues gross. The mechanism is
 * untouched: a user whose platform *does* withhold sets {@link
 * GoldLeaseProps.tdsRate} explicitly and gets exactly the arithmetic that was
 * here before. Zero is a modelled rate, not an absent one — every accrual still
 * reports gross, TDS and net separately, so a statement can say "no TDS was
 * withheld" rather than leave the reader wondering whether anyone looked.
 */
export const DEFAULT_TDS_RATE = Percentage.ZERO;

export class LeaseId extends ValueObject {
  private constructor(readonly value: string) {
    super();
  }

  static from(value: string): LeaseId {
    if (value.trim() === "") throw new TypeError("A lease id cannot be blank.");
    return new LeaseId(value);
  }

  protected components(): readonly unknown[] {
    return [this.value];
  }

  toString(): string {
    return this.value;
  }
}

export interface GoldLeaseProps {
  readonly id: LeaseId;
  readonly userId: UserId;
  /** The user-facing reference, e.g. `LEASE-0001`. */
  readonly reference: string;
  /** Which digital-gold holding the leased grams came out of. */
  readonly instrumentId: InstrumentId;
  /** The asset account that holds the gold, so an accrual knows where to post. */
  readonly holdingAccountId: AccountId;
  readonly platform: string;
  /** Grams leased out. */
  readonly quantity: Quantity;
  readonly startOn: CalendarDate;
  /** When the lease ends. Accrual stops here even if nobody closes it. */
  readonly closesOn: CalendarDate;
  readonly annualRate: Percentage;
  /** How often interest is actually paid out. Defaults to monthly. */
  readonly payoutFrequency?: PayoutFrequency;
  /** Grams into the holding, or rupees into an account. Defaults to grams. */
  readonly payoutMode?: PayoutMode;
  /** Where a cash payout lands. Required when `payoutMode` is `CASH`. */
  readonly payoutAccountId?: AccountId | null;
  /**
   * Withholding on the interest, in the same grams. Zero unless the platform
   * says otherwise — see {@link DEFAULT_TDS_RATE} for why nothing is assumed.
   */
  readonly tdsRate?: Percentage;
  readonly status?: LeaseStatus;
  /** Set when the lease ended early; accrual stops here instead. */
  readonly endedOn?: CalendarDate | null;
  /** The platform's own transaction reference, for reconciliation. */
  readonly sourceReference?: string | null;
  /** Grams already credited to the holding by an accrual posting, net of TDS. */
  readonly creditedQuantity?: Quantity;
  readonly notes?: string | null;
}

/** What a lease has earned by a date, in grams. */
export interface LeaseAccrual {
  readonly asOf: CalendarDate;
  /**
   * Months the accrual is actually paid on — completed **periods**, not
   * completed months. Seven months into an annually-paying lease this is 0.
   */
  readonly monthsCompleted: number;
  /** Months that have elapsed but not yet reached a payout date. */
  readonly monthsPending: number;
  /** When the next payout falls due, or `null` once the term is over. */
  readonly nextPayoutOn: CalendarDate | null;
  /** Interest before withholding. */
  readonly gross: Quantity;
  /** Withheld at source, in grams. A tax credit, not a cost. */
  readonly tds: Quantity;
  /** What the holding actually gains. Exactly `gross − tds`. */
  readonly net: Quantity;
  /** How the figure was produced, for the "why this number" panel. */
  readonly because: string;
}

/** One month of a lease's life. */
export interface LeaseAccrualRow {
  readonly month: number;
  readonly on: CalendarDate;
  readonly grossToDate: Quantity;
  readonly tdsToDate: Quantity;
  readonly netToDate: Quantity;
  /** Net interest earned in this month alone. */
  readonly netInMonth: Quantity;
}

/* ═══ GoldLease ═══════════════════════════════════════════════════════ */

export class GoldLease {
  constructor(readonly props: GoldLeaseProps) {
    if (!props.quantity.isPositive) {
      throw new DomainError(
        "LEASE_QUANTITY_NOT_POSITIVE",
        `${props.reference}: a lease must put a positive quantity of gold to work, got ` +
          `${props.quantity.toDecimalString()}g.`,
      );
    }
    if (props.closesOn.isOnOrBefore(props.startOn)) {
      throw new DomainError(
        "LEASE_CLOSES_BEFORE_IT_STARTS",
        `${props.reference}: the closing date (${props.closesOn.toISO()}) is not after the start ` +
          `date (${props.startOn.toISO()}). A lease with no term earns nothing and is a data entry error.`,
      );
    }
    if (props.annualRate.isNegative) {
      throw new DomainError(
        "LEASE_RATE_NEGATIVE",
        `${props.reference}: a lease rate cannot be negative. Paying to lend gold is not a lease.`,
      );
    }
    const tds = props.tdsRate ?? DEFAULT_TDS_RATE;
    if (tds.isNegative || tds.compareTo(Percentage.of("100")) > 0) {
      throw new DomainError(
        "LEASE_TDS_RATE_OUT_OF_RANGE",
        `${props.reference}: a withholding rate of ${tds.toFixed(2)}% is not a rate between 0 and 100.`,
      );
    }
    if (props.endedOn && props.endedOn.isBefore(props.startOn)) {
      throw new DomainError(
        "LEASE_ENDED_BEFORE_IT_STARTED",
        `${props.reference}: it cannot have ended on ${props.endedOn.toISO()}, before it started.`,
      );
    }
    if (props.creditedQuantity && props.creditedQuantity.isNegative) {
      throw new DomainError(
        "LEASE_CREDITED_NEGATIVE",
        `${props.reference}: credited interest cannot be negative — an over-credit is corrected by a reversal.`,
      );
    }
  }

  get id(): LeaseId {
    return this.props.id;
  }

  get reference(): string {
    return this.props.reference;
  }

  get quantity(): Quantity {
    return this.props.quantity;
  }

  get status(): LeaseStatus {
    return this.props.status ?? "ACTIVE";
  }

  get tdsRate(): Percentage {
    return this.props.tdsRate ?? DEFAULT_TDS_RATE;
  }

  /** Grams already posted to the ledger, net of TDS. */
  get credited(): Quantity {
    return this.props.creditedQuantity ?? Quantity.ZERO;
  }

  /** The lease's whole term in months, for a screen and for the schedule. */
  get termMonths(): number {
    return this.props.startOn.monthsUntil(this.props.closesOn);
  }

  /**
   * The last date interest accrues.
   *
   * The closing date normally; the cancellation date when the lease ended early.
   * Whichever comes first — a lease cancelled after its closing date did not earn
   * extra for being closed late.
   */
  get accruesUntil(): CalendarDate {
    const ended = this.props.endedOn;
    if (!ended) return this.props.closesOn;
    return ended.isBefore(this.props.closesOn) ? ended : this.props.closesOn;
  }

  get payoutFrequency(): PayoutFrequency {
    return this.props.payoutFrequency ?? "MONTHLY";
  }

  get payoutMode(): PayoutMode {
    return this.props.payoutMode ?? "GRAMS";
  }

  /**
   * Months elapsed on a date, before the payout schedule is applied.
   *
   * Clamped at both ends: never negative before the lease starts, never beyond
   * the term after it ends.
   */
  monthsElapsedOn(asOf: CalendarDate): number {
    const boundary = asOf.isBefore(this.accruesUntil) ? asOf : this.accruesUntil;
    const months = this.props.startOn.monthsUntil(boundary);
    return months > 0 ? months : 0;
  }

  /**
   * Months that have actually been **paid out** by a date.
   *
   * The elapsed months rounded down to a whole number of payout periods. A
   * quarterly lease five months in has been paid for three; the other two are
   * earned in the ordinary-language sense and not yet credited, which is exactly
   * the distinction {@link LeaseAccrual.monthsPending} carries to the screen.
   *
   * `ON_MATURITY` pays nothing until the term is over and then pays all of it —
   * which is why it is not modelled as "annual with a long period".
   */
  monthsCompletedOn(asOf: CalendarDate): number {
    const elapsed = this.monthsElapsedOn(asOf);
    const period = periodMonths(this.payoutFrequency);
    if (period === null) {
      return asOf.isOnOrAfter(this.accruesUntil) ? elapsed : 0;
    }
    return Math.floor(elapsed / period) * period;
  }

  /** When the next payout falls due, or `null` if the term is over. */
  nextPayoutOn(asOf: CalendarDate): CalendarDate | null {
    if (asOf.isOnOrAfter(this.accruesUntil)) return null;
    const period = periodMonths(this.payoutFrequency);
    if (period === null) return this.accruesUntil;
    const next = (Math.floor(this.monthsElapsedOn(asOf) / period) + 1) * period;
    const due = this.props.startOn.plusMonths(next);
    return due.isBefore(this.accruesUntil) ? due : this.accruesUntil;
  }

  /**
   * Interest earned to a date, in grams.
   *
   * `qty × rate × months / 12`, as one exact integer expression. Both roundings
   * are `DOWN`, and that is a deliberate choice rather than a convention: the
   * platform credits whole units of its own precision, and rounding an accrual
   * *up* would show gold the user has not been paid. A tracker that flatters
   * itself by a fraction of a gram a month is the reason people stop trusting
   * trackers.
   */
  accrualOn(asOf: CalendarDate): LeaseAccrual {
    const months = this.monthsCompletedOn(asOf);
    const elapsed = this.monthsElapsedOn(asOf);
    const nextPayoutOn = this.nextPayoutOn(asOf);
    if (months === 0) {
      return {
        asOf,
        monthsCompleted: 0,
        monthsPending: elapsed,
        nextPayoutOn,
        gross: Quantity.ZERO,
        tds: Quantity.ZERO,
        net: Quantity.ZERO,
        because:
          elapsed === 0
            ? `No completed month yet: the lease began on ${this.props.startOn.toISO()} and ` +
              `interest is paid on completed months, so a part month has earned nothing.`
            : `${elapsed} month${elapsed === 1 ? " has" : "s have"} elapsed, but this lease pays ` +
              `${payoutFrequencyLabel(this.payoutFrequency).toLowerCase()} — nothing is credited ` +
              `until ${nextPayoutOn?.toISO() ?? this.accruesUntil.toISO()}.`,
      };
    }

    // qty × (rate% / 100) × (months / 12), with the percent scale folded into the
    // denominator so there is one division and one rounding.
    const gross = this.props.quantity.timesRatio(
      this.props.annualRate.scaled * BigInt(months),
      PERCENT_DENOMINATOR * 12n,
      "DOWN",
    );
    const tds = gross.timesRatio(this.tdsRate.scaled, PERCENT_DENOMINATOR, "DOWN");

    const pending = elapsed - months;
    return {
      asOf,
      monthsCompleted: months,
      monthsPending: pending,
      nextPayoutOn,
      gross,
      tds,
      // Subtraction, not a third rounding: gross, tds and net always reconcile.
      net: gross.minus(tds),
      because:
        `${this.props.quantity.toDecimalString()}g at ${this.props.annualRate.toFixed(2)}% for ` +
        `${months} paid month${months === 1 ? "" : "s"} is ${gross.toDecimalString()}g, less ` +
        `${this.tdsRate.toFixed(2)}% TDS of ${tds.toDecimalString()}g` +
        (pending > 0
          ? `. A further ${pending} month${pending === 1 ? "" : "s"} has elapsed and is not yet ` +
            `payable — this lease pays ` +
            `${payoutFrequencyLabel(this.payoutFrequency).toLowerCase()}.`
          : "."),
    };
  }

  /** Grams earned but not yet posted to the ledger. What an accrual run books. */
  unpostedOn(asOf: CalendarDate): Quantity {
    const earned = this.accrualOn(asOf).net;
    const outstanding = earned.minus(this.credited);
    return outstanding.isPositive ? outstanding : Quantity.ZERO;
  }

  /**
   * Principal plus net interest, in grams — what the platform owes the user.
   *
   * Still grams. It becomes money only in {@link valueOn}, and only with a price.
   */
  totalGramsOn(asOf: CalendarDate): Quantity {
    return this.props.quantity.plus(this.accrualOn(asOf).net);
  }

  /**
   * What the lease is worth on a date.
   *
   * `null` when there is no price — the rule that holds everywhere else in this
   * codebase, and it matters most here: a lease valued at ₹0 because IBJA did not
   * publish would read as a total loss of the user's gold.
   */
  valueOn(asOf: CalendarDate, pricePerGram: UnitPrice | null): Money | null {
    if (!pricePerGram) return null;
    return pricePerGram.times(this.totalGramsOn(asOf));
  }

  /** The interest alone, in money, for the income line of a tax return. */
  interestValueOn(asOf: CalendarDate, pricePerGram: UnitPrice | null): Money | null {
    if (!pricePerGram) return null;
    return pricePerGram.times(this.accrualOn(asOf).net);
  }

  /** Whether the lease has reached its closing date on this date. */
  isMaturedOn(asOf: CalendarDate): boolean {
    return asOf.isOnOrAfter(this.props.closesOn);
  }

  /** Month by month, for the detail screen and for a hand-check. */
  schedule(): readonly LeaseAccrualRow[] {
    const rows: LeaseAccrualRow[] = [];
    let previousNet = Quantity.ZERO;
    for (let month = 1; month <= this.termMonths; month += 1) {
      const on = this.props.startOn.plusMonths(month);
      const accrual = this.accrualOn(on);
      rows.push({
        month,
        on,
        grossToDate: accrual.gross,
        tdsToDate: accrual.tds,
        netToDate: accrual.net,
        netInMonth: accrual.net.minus(previousNet),
      });
      previousNet = accrual.net;
    }
    return rows;
  }

  /** With a field changed — leases are value objects, so nothing mutates. */
  with(changes: Partial<GoldLeaseProps>): GoldLease {
    return new GoldLease({ ...this.props, ...changes });
  }

  toString(): string {
    return `${this.props.reference} (${this.props.quantity.toDecimalString()}g at ${this.props.annualRate.toFixed(2)}%)`;
  }
}

/** 100 × 10^6 — the percent scale, as `Percentage.scaled` carries it. */
const PERCENT_DENOMINATOR = 100_000_000n;

/* ═══ The book — portfolio-level answers ══════════════════════════════ */

export interface LeasePortfolio {
  readonly asOf: CalendarDate;
  /** Grams out on lease right now. */
  readonly leasedGrams: Quantity;
  /** Gross interest earned to date across every lease. */
  readonly grossInterestGrams: Quantity;
  readonly tdsGrams: Quantity;
  /** What the holdings have actually gained. */
  readonly netInterestGrams: Quantity;
  /** Earned but not yet booked into the ledger. */
  readonly unpostedGrams: Quantity;
  /** Principal plus net interest, valued — `null` when no price is available. */
  readonly value: Money | null;
  /** Leases past their closing date that nobody has settled. */
  readonly matured: readonly string[];
}

/**
 * Portfolio arithmetic over a set of leases.
 *
 * A function rather than a class because it holds no state and answers one
 * question. `leasedGrams` counts **active leases only**: a matured lease's gold
 * has come back and counting it as still out on lease would double it against the
 * wallet balance.
 */
export function leasePortfolio(
  leases: readonly GoldLease[],
  asOf: CalendarDate,
  pricePerGram: UnitPrice | null,
): LeasePortfolio {
  const active = leases.filter((lease) => lease.status === "ACTIVE");
  const leasedGrams = Quantity.sum(active.map((lease) => lease.quantity));

  const accruals = leases.map((lease) => lease.accrualOn(asOf));
  const grossInterestGrams = Quantity.sum(accruals.map((accrual) => accrual.gross));
  const tdsGrams = Quantity.sum(accruals.map((accrual) => accrual.tds));
  const netInterestGrams = Quantity.sum(accruals.map((accrual) => accrual.net));
  const unpostedGrams = Quantity.sum(leases.map((lease) => lease.unpostedOn(asOf)));

  const totalGrams = leasedGrams.plus(netInterestGrams);

  return {
    asOf,
    leasedGrams,
    grossInterestGrams,
    tdsGrams,
    netInterestGrams,
    unpostedGrams,
    value: pricePerGram ? pricePerGram.times(totalGrams) : null,
    matured: leases
      .filter((lease) => lease.status === "ACTIVE" && lease.isMaturedOn(asOf))
      .map((lease) => lease.reference),
  };
}

/**
 * Gold the user holds but has *not* leased out — the wallet balance.
 *
 * `bought − sold − leased`, and it is a separate function because the leases do
 * not know the holding: the same instrument can be part leased and part idle, and
 * only the caller has both numbers.
 */
export function unleasedGrams(
  heldGrams: Quantity,
  leases: readonly GoldLease[],
): { grams: Quantity; overLeased: boolean } {
  const leased = Quantity.sum(
    leases.filter((lease) => lease.status === "ACTIVE").map((lease) => lease.quantity),
  );
  const remaining = heldGrams.minus(leased);
  return {
    grams: remaining.isNegative ? Quantity.ZERO : remaining,
    /*
     * More gold on lease than in the holding. Reported rather than clamped
     * silently: it means a lease was entered against gold that was never bought,
     * or gold was sold while still on lease, and both are real problems.
     */
    overLeased: remaining.isNegative,
  };
}

/** Profit and loss over what the leased gold cost. */
export function leaseReturn(
  portfolio: LeasePortfolio,
  moneyVested: Money,
): { profit: Money; percent: Percentage } | null {
  if (!portfolio.value || moneyVested.isZero) return null;
  const profit = portfolio.value.minus(moneyVested);
  return { profit, percent: Percentage.ratio(profit, moneyVested) };
}

/* ═══ Repository port ═════════════════════════════════════════════════ */

export interface GoldLeaseRepository {
  findById(userId: UserId, id: LeaseId): Promise<GoldLease | null>;
  findByReference(userId: UserId, reference: string): Promise<GoldLease | null>;
  list(
    userId: UserId,
    options?: { instrumentId?: InstrumentId; status?: LeaseStatus },
  ): Promise<readonly GoldLease[]>;
  save(lease: GoldLease): Promise<void>;

  /**
   * Every reference this user has ever used, **soft-deleted leases included**.
   *
   * Separate from `list` because the two questions differ on exactly the rows
   * that matter here. `list` hides tombstones, which is right for every screen —
   * but `gold_leases_user_reference_uq` does not, so a reference freed by a
   * delete is still taken as far as the database is concerned. Generating the
   * next reference from `list` handed out `LEASE-0001` a second time and the
   * insert died on the unique index with no path back for the user.
   *
   * References are audit identifiers besides: reusing the one a deleted lease
   * carried would make two different leases share a name in any statement that
   * outlived the delete.
   */
  takenReferences(userId: UserId): Promise<readonly string[]>;

  /** Tombstones a lease. Soft, per A03 — nothing here is ever hard-deleted. */
  softDelete(userId: UserId, id: LeaseId, at: Date): Promise<void>;
  /**
   * Records grams credited to the holding by an accrual posting.
   *
   * Separate from `save` because it is the one field a background job touches, and
   * a full save from a stale read would silently revert a rate the user had just
   * corrected.
   */
  recordCredit(
    userId: UserId,
    id: LeaseId,
    creditedTotal: Quantity,
    transactionId: string,
  ): Promise<void>;
}

/** The currency leases report in. Gold is priced per gram in one currency at a time. */
export const LEASE_CURRENCY: Currency = Currency.INR;

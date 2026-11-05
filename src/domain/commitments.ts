/**
 * Recurring commitments — OTT, mobile, broadband, courses, fees, memberships.
 *
 * `PRODUCT-REQUIREMENT.md` §4.2: a first-class domain, not an expense category,
 * because a category loses cadence, next renewal, price-change-at-renewal and the
 * cancel-by date — and the one number the owner wants: **total committed outgo
 * per month and per year, and what is quietly auto-renewing.**
 *
 * **A cancelled commitment leaves the total on its end date, not on the day the
 * owner cancelled it.** Cancelling Netflix on the 3rd does not refund the month
 * already paid; the outgo was committed until the period ends.
 */

import { Money, type Currency } from "@/core/money";
import type { UserId } from "@/core/kernel";
import type { PriceSteps, Recurrence } from "@/core/recurrence";
import type { CalendarDate, DateRange } from "@/core/time";
import { Count } from "@/core/units";

export type CommitmentKind = "STREAMING" | "MOBILE" | "BROADBAND" | "EDUCATION" | "MEMBERSHIP" | "SOFTWARE" | "OTHER";

export interface CommitmentRepository {
  find(userId: UserId, id: string): Promise<Commitment | null>;
  list(userId: UserId): Promise<readonly Commitment[]>;
}

/** Creates the commitment and its complete price history in one audited atomic operation. */
export interface CommitmentWriter {
  create(userId: UserId, commitment: Commitment): Promise<void>;
}

export interface CommitmentFields {
  readonly id: string;
  readonly name: string;
  readonly kind: CommitmentKind;
  readonly currency: Currency;
  readonly schedule: Recurrence;
  readonly price: PriceSteps;
  /** Renews without the owner doing anything. The reason this domain exists. */
  readonly autoRenews: boolean;
  /**
   * The last day the commitment runs, once the owner has cancelled it or it has
   * a fixed term. Null while it runs on. Distinct from the day they cancelled.
   */
  readonly endsOn: CalendarDate | null;
}

export class Commitment implements CommitmentFields {
  readonly id: string;
  readonly name: string;
  readonly kind: CommitmentKind;
  readonly currency: Currency;
  readonly schedule: Recurrence;
  readonly price: PriceSteps;
  readonly autoRenews: boolean;
  readonly endsOn: CalendarDate | null;

  constructor(fields: CommitmentFields) {
    if (!fields.name.trim()) throw new RangeError("A commitment needs a name.");
    if (fields.endsOn !== null && fields.endsOn.isBefore(fields.schedule.anchor)) {
      throw new RangeError(`${fields.name} cannot end before it starts.`);
    }
    if (fields.price.entries().some((step) => step.amount !== null && !step.amount.currency.equals(fields.currency))) {
      throw new RangeError(`${fields.name} is in ${fields.currency.code}; every price must be in that currency too.`);
    }
    this.id = fields.id;
    this.name = fields.name;
    this.kind = fields.kind;
    this.currency = fields.currency;
    this.schedule = fields.schedule;
    this.price = fields.price;
    this.autoRenews = fields.autoRenews;
    this.endsOn = fields.endsOn;
  }

  /** Running on `date`: started, and not past its end. Cancelled-but-paid-up counts. */
  activeOn(date: CalendarDate): boolean {
    return date.isOnOrAfter(this.schedule.anchor) && (this.endsOn === null || date.isOnOrBefore(this.endsOn));
  }

  /**
   * The outgo this commitment represents per year on `date`, at the price then in
   * force: each charge × charges per year. Exact — monthly figures are derived
   * from this, never the other way, so an annual ₹1,499 plan stays ₹1,499 and does
   * not become 12 × ₹124.92. Zero once ended; null when the price is unknown.
   */
  annualOn(date: CalendarDate): Money | null {
    if (!this.activeOn(date)) return Money.zero(this.currency);
    const each = this.price.on(date);
    return each === null ? null : each.times(this.schedule.perYear);
  }

  /** Charges actually falling due inside `range`, each at its own price. Null if any is unknown. */
  chargedIn(range: DateRange): Money | null {
    let total = Money.zero(this.currency);
    for (const dueOn of this.schedule.occurrencesIn(range)) {
      if (this.endsOn !== null && dueOn.isAfter(this.endsOn)) break;
      const amount = this.price.on(dueOn);
      if (amount === null) return null;
      total = total.plus(amount);
    }
    return total;
  }

  /** The next charge on or after `date`, with its price and last day to cancel; null once ended. */
  nextCharge(date: CalendarDate): UpcomingCharge | null {
    const dueOn = this.schedule.nextOnOrAfter(date);
    if (dueOn === null || (this.endsOn !== null && dueOn.isAfter(this.endsOn))) return null;
    const amount = this.price.on(dueOn);
    const before = this.price.on(dueOn.plusDays(-1));
    return {
      commitmentId: this.id,
      dueOn,
      amount,
      // A price that rises at this renewal is the thing the owner most wants warned of.
      priceChange: amount !== null && before !== null && !amount.equals(before) ? { from: before, to: amount } : null,
      cancelBy: this.schedule.cancelBy(dueOn),
      autoRenews: this.autoRenews,
    };
  }
}

export interface UpcomingCharge {
  readonly commitmentId: string;
  readonly dueOn: CalendarDate;
  readonly amount: Money | null;
  readonly priceChange: { readonly from: Money; readonly to: Money } | null;
  readonly cancelBy: CalendarDate | null;
  readonly autoRenews: boolean;
}

export interface CommittedOutgo {
  /** Null when any active commitment's price is unknown: a partial total understates. */
  readonly perMonth: Money | null;
  readonly perYear: Money | null;
  /** The part of `perMonth` that renews unattended. Same null rule. */
  readonly autoRenewingPerMonth: Money | null;
  readonly active: Count;
}

/** Total committed outgo on `date`, and how much of it is quietly auto-renewing. */
export function committedOutgo(commitments: readonly Commitment[], date: CalendarDate, currency: Currency): CommittedOutgo {
  let perYear: Money | null = Money.zero(currency);
  let autoRenewing: Money | null = Money.zero(currency);
  let active = 0;
  for (const commitment of commitments) {
    if (!commitment.activeOn(date)) continue;
    active += 1;
    const annual = commitment.annualOn(date);
    perYear = annual === null || perYear === null ? null : perYear.plus(annual);
    if (commitment.autoRenews) autoRenewing = annual === null || autoRenewing === null ? null : autoRenewing.plus(annual);
  }
  const monthly = (annual: Money | null) => annual?.dividedBy(12, "HALF_EVEN") ?? null;
  return { perMonth: monthly(perYear), perYear, autoRenewingPerMonth: monthly(autoRenewing), active: Count(active) };
}

/** Charges due within `[from, until]`, soonest first — the renewal calendar. */
export function upcomingCharges(commitments: readonly Commitment[], from: CalendarDate, until: CalendarDate): UpcomingCharge[] {
  return commitments
    .map((commitment) => commitment.nextCharge(from))
    .filter((charge): charge is UpcomingCharge => charge !== null && charge.dueOn.isOnOrBefore(until))
    .sort((a, b) => a.dueOn.compareTo(b.dueOn));
}


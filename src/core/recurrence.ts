/**
 * When something happens again: a premium, a subscription, a salary.
 *
 * Shared by the four manual domains (`ARCHITECTURE.md` §11). Cadence used to live
 * only inside credit products; this is the general form, and it carries **dates
 * only**. What each occurrence costs is a separate question, answered by
 * `PriceSteps` below, because a renewal can change the price without changing
 * the calendar.
 *
 * **Every occurrence is counted from the anchor, never from the one before it.**
 * `plusMonths` clamps to the last day of a short month, so chaining would drift:
 * 31 Jan, 28 Feb, 28 Mar. Counting from the anchor gives 31 Jan, 28 Feb, 31 Mar.
 */

import { ValueObject } from "./kernel";
import type { Money } from "./money";
import { CalendarDate, type DateRange } from "./time";
import { Count, Days, Ordinal } from "./units";

export type Cadence = "MONTHLY" | "QUARTERLY" | "HALF_YEARLY" | "ANNUAL";

const MONTHS_BETWEEN: Record<Cadence, number> = {
  MONTHLY: 1,
  QUARTERLY: 3,
  HALF_YEARLY: 6,
  ANNUAL: 12,
};

export interface RecurrenceFields {
  readonly cadence: Cadence;
  /** The first occurrence. Every later one is counted from here. */
  readonly anchor: CalendarDate;
  /** The last day an occurrence may fall on, or null for open-ended. */
  readonly endsOn: CalendarDate | null;
  /** Notice the counterparty needs before a renewal, or null if none is known. */
  readonly cancelNotice: Days | null;
}

export class Recurrence extends ValueObject implements RecurrenceFields {
  readonly cadence: Cadence;
  readonly anchor: CalendarDate;
  readonly endsOn: CalendarDate | null;
  readonly cancelNotice: Days | null;

  constructor(fields: RecurrenceFields) {
    super();
    if (fields.endsOn !== null && fields.endsOn.isBefore(fields.anchor)) {
      throw new RangeError(`A recurrence cannot end (${fields.endsOn}) before it starts (${fields.anchor}).`);
    }
    this.cadence = fields.cadence;
    this.anchor = fields.anchor;
    this.endsOn = fields.endsOn;
    this.cancelNotice = fields.cancelNotice;
  }

  /** How many times a year this happens. */
  get perYear(): Count {
    return Count(12 / MONTHS_BETWEEN[this.cadence]);
  }

  /** The nth occurrence, zero-based, or null once the recurrence has ended. */
  occurrence(n: Ordinal): CalendarDate | null {
    const date = this.anchor.plusMonths(n * MONTHS_BETWEEN[this.cadence]);
    return this.endsOn !== null && date.isAfter(this.endsOn) ? null : date;
  }

  /** The first occurrence on or after `date`, or null if none remains. */
  nextOnOrAfter(date: CalendarDate): CalendarDate | null {
    if (date.isOnOrBefore(this.anchor)) return this.occurrence(Ordinal(0));
    // Start from the month estimate, then step: clamping can put the estimate one short.
    let n = Math.floor(this.anchor.monthsUntil(date) / MONTHS_BETWEEN[this.cadence]);
    for (;;) {
      const candidate = this.occurrence(Ordinal(n));
      if (candidate === null || candidate.isOnOrAfter(date)) return candidate;
      n += 1;
    }
  }

  /** Every occurrence inside `range`, in order. */
  occurrencesIn(range: DateRange): CalendarDate[] {
    const dates: CalendarDate[] = [];
    let next = this.nextOnOrAfter(range.start);
    while (next !== null && next.isOnOrBefore(range.end)) {
      dates.push(next);
      next = this.nextOnOrAfter(next.plusDays(1));
    }
    return dates;
  }

  /**
   * The last day to cancel before the renewal falling on `renewal`, or null when
   * no notice period is known. Null, not the renewal date itself: an unknown
   * notice period is not a notice period of zero days.
   */
  cancelBy(renewal: CalendarDate): CalendarDate | null {
    return this.cancelNotice === null ? null : renewal.plusDays(-this.cancelNotice);
  }

  protected components(): readonly unknown[] {
    return [this.cadence, this.anchor, this.endsOn, this.cancelNotice];
  }
}

/** One price, in force from `from` until the next step. Null means not known. */
export interface PriceStep {
  readonly from: CalendarDate;
  readonly amount: Money | null;
}

/**
 * What each occurrence costs over time. A renewal that changes the price is a
 * new step, so the history survives instead of being overwritten.
 */
export class PriceSteps {
  private readonly steps: readonly PriceStep[];

  constructor(steps: readonly PriceStep[]) {
    if (steps.length === 0) throw new RangeError("A price history needs at least one step.");
    // Copied and frozen: a caller mutating its own step objects afterwards must not
    // rewrite a history this constructor has already validated.
    const ordered = steps
      .map((step) => Object.freeze({ from: step.from, amount: step.amount }))
      .sort((a, b) => a.from.compareTo(b.from));
    for (let i = 1; i < ordered.length; i += 1) {
      if (ordered[i]!.from.equals(ordered[i - 1]!.from)) {
        throw new RangeError(`Two prices cannot both start on ${ordered[i]!.from}.`);
      }
    }
    // A price is what something costs or pays: zero is real (a free tier), negative is not.
    if (ordered.some((step) => step.amount !== null && step.amount.isNegative)) {
      throw new RangeError("A price step cannot be negative.");
    }
    const currencies = new Set(ordered.flatMap((step) => (step.amount === null ? [] : [step.amount.currency])));
    if (currencies.size > 1) throw new RangeError("A price history cannot change currency.");
    this.steps = Object.freeze(ordered);
  }

  /** Complete chronological history for persistence; unknown and zero steps remain explicit. */
  entries(): readonly PriceStep[] {
    return this.steps;
  }

  /**
   * The price in force on `date`. Null both before the first step and when the
   * step itself is unknown: either way there is no figure, and a caller must
   * never read that as zero.
   */
  on(date: CalendarDate): Money | null {
    let current: Money | null = null;
    for (const step of this.steps) {
      if (step.from.isAfter(date)) break;
      current = step.amount;
    }
    return current;
  }

  /** Steps that take effect strictly after `date`: the renewals that will change the price. */
  changesAfter(date: CalendarDate): readonly PriceStep[] {
    return this.steps.filter((step) => step.from.isAfter(date));
  }
}

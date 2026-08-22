import { ValueObject } from "@/shared/kernel/ValueObject";

const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const MILLISECONDS_PER_DAY = 86_400_000;

/**
 * A calendar date with no time and no timezone — what a bank statement or a
 * contract note actually gives you.
 *
 * A `Date` is an instant, and using one for "the day I bought this" is a bug
 * waiting to happen: serialize it, read it back in another offset, and a trade on
 * 1 April lands on 31 March, moving it into the previous financial year and
 * changing its tax treatment. Stored as `YYYY-MM-DD` text, which also sorts
 * correctly as a string in SQL.
 */
export class CalendarDate extends ValueObject {
  private constructor(
    readonly year: number,
    /** 1–12, not the 0–11 that `Date` uses. */
    readonly month: number,
    readonly day: number,
  ) {
    super();
  }

  static parse(value: string): CalendarDate {
    const match = ISO_DATE_PATTERN.exec(value.trim());
    if (!match) {
      throw new TypeError(`Expected a YYYY-MM-DD date, got ${JSON.stringify(value)}`);
    }
    const [, year, month, day] = match;
    return CalendarDate.of(Number(year), Number(month), Number(day));
  }

  static of(year: number, month: number, day: number): CalendarDate {
    if (month < 1 || month > 12) {
      throw new RangeError(`Month out of range: ${month}`);
    }
    if (day < 1 || day > CalendarDate.daysInMonth(year, month)) {
      throw new RangeError(`Day out of range for ${year}-${month}: ${day}`);
    }
    return new CalendarDate(year, month, day);
  }

  /** The date part of an instant, in UTC. Prefer `Clock.today()` for "now". */
  static fromUtcInstant(instant: Date): CalendarDate {
    return new CalendarDate(
      instant.getUTCFullYear(),
      instant.getUTCMonth() + 1,
      instant.getUTCDate(),
    );
  }

  static daysInMonth(year: number, month: number): number {
    return new Date(Date.UTC(year, month, 0)).getUTCDate();
  }

  /** Midnight UTC on this date — for arithmetic and for `Date`-typed APIs. */
  toUtcInstant(): Date {
    return new Date(Date.UTC(this.year, this.month - 1, this.day));
  }

  /** `"2026-08-05"` — the stored form. */
  toISO(): string {
    return `${this.year.toString().padStart(4, "0")}-${this.month
      .toString()
      .padStart(2, "0")}-${this.day.toString().padStart(2, "0")}`;
  }

  /** `"2026-08"` — groups rows into months for monthly reports. */
  toMonthKey(): string {
    return `${this.year.toString().padStart(4, "0")}-${this.month.toString().padStart(2, "0")}`;
  }

  plusDays(days: number): CalendarDate {
    const shifted = new Date(this.toUtcInstant().getTime() + days * MILLISECONDS_PER_DAY);
    return CalendarDate.fromUtcInstant(shifted);
  }

  /** Clamps to the last valid day, so 31 Jan + 1 month is 28/29 Feb. */
  plusMonths(months: number): CalendarDate {
    const zeroBased = this.year * 12 + (this.month - 1) + months;
    const year = Math.floor(zeroBased / 12);
    const month = (zeroBased % 12) + 1;
    return new CalendarDate(year, month, Math.min(this.day, CalendarDate.daysInMonth(year, month)));
  }

  plusYears(years: number): CalendarDate {
    return this.plusMonths(years * 12);
  }

  /** Whole days from this date to `other`; negative if `other` is earlier. */
  daysUntil(other: CalendarDate): number {
    return Math.round(
      (other.toUtcInstant().getTime() - this.toUtcInstant().getTime()) / MILLISECONDS_PER_DAY,
    );
  }

  /** First day of this date's month. */
  startOfMonth(): CalendarDate {
    return new CalendarDate(this.year, this.month, 1);
  }

  /** Last day of this date's month. */
  endOfMonth(): CalendarDate {
    return new CalendarDate(this.year, this.month, CalendarDate.daysInMonth(this.year, this.month));
  }

  compareTo(other: CalendarDate): -1 | 0 | 1 {
    const mine = this.toISO();
    const theirs = other.toISO();
    if (mine < theirs) return -1;
    if (mine > theirs) return 1;
    return 0;
  }

  isBefore(other: CalendarDate): boolean {
    return this.compareTo(other) < 0;
  }

  isAfter(other: CalendarDate): boolean {
    return this.compareTo(other) > 0;
  }

  isOnOrBefore(other: CalendarDate): boolean {
    return this.compareTo(other) <= 0;
  }

  isOnOrAfter(other: CalendarDate): boolean {
    return this.compareTo(other) >= 0;
  }

  static min(a: CalendarDate, b: CalendarDate): CalendarDate {
    return a.isBefore(b) ? a : b;
  }

  static max(a: CalendarDate, b: CalendarDate): CalendarDate {
    return a.isAfter(b) ? a : b;
  }

  protected components(): readonly unknown[] {
    return [this.year, this.month, this.day];
  }

  toString(): string {
    return this.toISO();
  }

  toJSON(): string {
    return this.toISO();
  }
}

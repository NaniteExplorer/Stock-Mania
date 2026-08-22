/**
 * Accounting time: dates without instants.
 *
 * A posting happens on a day, not at a moment — conflating the two is what forces
 * a timezone retrofit later. `CalendarDate` is date-only; event timestamps stay
 * separate and are stored UTC.
 *
 * `MarketCalendar` (NSE/BSE trading days) joins this file in Phase 1a.
 */

import { ValueObject } from "./kernel";

/* ─── CalendarDate ─────────────────────────────────────────────── */

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

/* ─── DateRange ─────────────────────────────────────────────── */

/**
 * A closed date range — both ends included.
 *
 * Inclusive on purpose: every reporting period a user names ("this month", "FY
 * 2025-26") is inclusive of its last day, and half-open ranges invite the
 * off-by-one where 31 March's transactions vanish from the year's totals.
 */
export class DateRange extends ValueObject {
  private constructor(
    readonly start: CalendarDate,
    readonly end: CalendarDate,
  ) {
    super();
  }

  static of(start: CalendarDate, end: CalendarDate): DateRange {
    if (start.isAfter(end)) {
      throw new RangeError(`Range start ${start.toISO()} is after its end ${end.toISO()}`);
    }
    return new DateRange(start, end);
  }

  /** The calendar month containing `date`. */
  static monthOf(date: CalendarDate): DateRange {
    return new DateRange(date.startOfMonth(), date.endOfMonth());
  }

  /** The `count` months ending with `date`'s month, oldest first. */
  static trailingMonths(date: CalendarDate, count: number): DateRange[] {
    if (count < 1) throw new RangeError(`trailingMonths needs count >= 1, got ${count}`);
    return Array.from({ length: count }, (_, index) =>
      DateRange.monthOf(date.plusMonths(index - (count - 1))),
    );
  }

  contains(date: CalendarDate): boolean {
    return date.isOnOrAfter(this.start) && date.isOnOrBefore(this.end);
  }

  overlaps(other: DateRange): boolean {
    return this.start.isOnOrBefore(other.end) && other.start.isOnOrBefore(this.end);
  }

  get days(): number {
    return this.start.daysUntil(this.end) + 1;
  }

  /** Each calendar month the range touches, oldest first. */
  months(): DateRange[] {
    const result: DateRange[] = [];
    let cursor = this.start.startOfMonth();
    while (cursor.isOnOrBefore(this.end)) {
      result.push(DateRange.monthOf(cursor));
      cursor = cursor.plusMonths(1);
    }
    return result;
  }

  protected components(): readonly unknown[] {
    return [this.start, this.end];
  }

  toString(): string {
    return `${this.start.toISO()}..${this.end.toISO()}`;
  }
}

/* ─── FinancialYear ─────────────────────────────────────────────── */

/** India's financial year opens on 1 April. */
const FY_START_MONTH = 4;

/**
 * An Indian financial year: 1 April to 31 March.
 *
 * Identified by its *starting* calendar year — FY 2025-26 is
 * `FinancialYear.startingIn(2025)` and runs 2025-04-01 to 2026-03-31.
 *
 * This is a first-class type rather than a pair of dates because so much hangs
 * off the boundary: which tax regime's rules apply, when the ₹1.25 lakh LTCG
 * exemption resets, and which year a realized gain is reported in. Getting 31
 * March vs 1 April wrong moves money between years.
 */
export class FinancialYear extends ValueObject {
  private constructor(readonly startYear: number) {
    super();
  }

  static startingIn(year: number): FinancialYear {
    if (!Number.isInteger(year) || year < 1900 || year > 2200) {
      throw new RangeError(`Implausible financial year: ${year}`);
    }
    return new FinancialYear(year);
  }

  /** The financial year that `date` falls in. */
  static containing(date: CalendarDate): FinancialYear {
    return new FinancialYear(date.month >= FY_START_MONTH ? date.year : date.year - 1);
  }

  /** Parses `"2025-26"` — the label users recognise. */
  static parse(label: string): FinancialYear {
    const match = /^(\d{4})-(\d{2})$/.exec(label.trim());
    if (!match) {
      throw new TypeError(`Expected a financial year like "2025-26", got "${label}"`);
    }
    return new FinancialYear(Number(match[1]));
  }

  get endYear(): number {
    return this.startYear + 1;
  }

  get start(): CalendarDate {
    return CalendarDate.of(this.startYear, FY_START_MONTH, 1);
  }

  get end(): CalendarDate {
    return CalendarDate.of(this.endYear, FY_START_MONTH - 1, 31);
  }

  get range(): DateRange {
    return DateRange.of(this.start, this.end);
  }

  contains(date: CalendarDate): boolean {
    return this.range.contains(date);
  }

  previous(): FinancialYear {
    return new FinancialYear(this.startYear - 1);
  }

  next(): FinancialYear {
    return new FinancialYear(this.startYear + 1);
  }

  /** The `count` financial years ending with this one, oldest first. */
  trailing(count: number): FinancialYear[] {
    if (count < 1) throw new RangeError(`trailing needs count >= 1, got ${count}`);
    return Array.from({ length: count }, (_, index) =>
      FinancialYear.startingIn(this.startYear - (count - 1) + index),
    );
  }

  /** `"2025-26"` — for labels and for storage. */
  get label(): string {
    return `${this.startYear}-${(this.endYear % 100).toString().padStart(2, "0")}`;
  }

  protected components(): readonly unknown[] {
    return [this.startYear];
  }

  toString(): string {
    return this.label;
  }

  toJSON(): string {
    return this.label;
  }
}

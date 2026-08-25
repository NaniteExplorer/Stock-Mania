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

  /**
   * Whole months from this date to `other` — 15 Jan to 14 Feb is **0**, and to
   * 15 Feb is 1.
   *
   * Completed months, not month boundaries crossed, because that is what an
   * accrual is paid on: a lease that started on the 15th has earned nothing on the
   * 1st of the next month, however many calendar pages have turned. Negative when
   * `other` is earlier.
   */
  monthsUntil(other: CalendarDate): number {
    const gross = (other.year - this.year) * 12 + (other.month - this.month);
    if (gross >= 0) return other.day >= Math.min(this.day, CalendarDate.daysInMonth(other.year, other.month)) ? gross : gross - 1;
    return other.day <= this.day ? gross : gross + 1;
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

/* ═══ MarketCalendar ═════════════════════════════════════════════════════ */

export type ExchangeMic = "XNSE" | "XBOM";

/**
 * NSE trading holidays, transcribed from the exchange's published annual
 * circulars (nseindia.com/resources/exchange-communication-holidays).
 *
 * Shipped as data rather than fetched, for the same reason the Cost Inflation
 * Index table is: it changes once a year by published notice, and a network
 * dependency would mean a day-change calculation can fail because a website is
 * down.
 *
 * BSE's *trading* holidays are identical to NSE's — only clearing holidays
 * differ, and settlement calendars are not modelled — so one table serves both.
 * Muhurat sessions are deliberately excluded: they are ceremonial sessions held
 * on days that are otherwise holidays, and treating one as a normal trading day
 * would make it a valid previous-trading-day for a day-change comparison.
 */
const NSE_TRADING_HOLIDAYS: Readonly<Record<number, readonly string[]>> = {
  2015: ["01-26", "02-17", "03-06", "04-02", "04-03", "04-14", "05-01", "09-17", "09-25", "10-02", "10-22", "11-25", "12-25"],
  2016: ["01-26", "03-07", "03-24", "03-25", "04-14", "04-15", "04-19", "07-06", "08-15", "09-05", "09-13", "10-11", "10-12", "10-31", "11-14"],
  2017: ["01-26", "02-24", "03-13", "04-04", "04-14", "05-01", "06-26", "08-15", "08-25", "10-02", "10-19", "10-20", "12-25"],
  2018: ["01-26", "02-13", "03-02", "03-29", "03-30", "05-01", "08-15", "08-22", "09-13", "09-20", "10-02", "10-18", "11-07", "11-08", "11-23", "12-25"],
  2019: ["03-04", "03-21", "04-17", "04-19", "04-29", "05-01", "06-05", "08-12", "08-15", "09-02", "09-10", "10-02", "10-08", "10-28", "11-12", "12-25"],
  2020: ["02-21", "03-10", "04-02", "04-06", "04-10", "04-14", "05-01", "05-25", "10-02", "11-16", "11-30", "12-25"],
  2021: ["01-26", "03-11", "03-29", "04-02", "04-14", "04-21", "05-13", "07-21", "08-19", "09-10", "10-15", "11-04", "11-05", "11-19"],
  2022: ["01-26", "03-01", "03-18", "04-14", "04-15", "05-03", "08-09", "08-15", "08-31", "10-05", "10-24", "10-26", "11-08"],
  2023: ["01-26", "03-07", "03-30", "04-04", "04-07", "04-14", "05-01", "06-28", "08-15", "09-19", "10-02", "10-24", "11-14", "11-27", "12-25"],
  2024: ["01-22", "01-26", "03-08", "03-25", "03-29", "04-11", "04-17", "05-01", "05-20", "06-17", "07-17", "08-15", "10-02", "11-01", "11-15", "12-25"],
  2025: ["02-26", "03-14", "03-31", "04-10", "04-14", "04-18", "05-01", "08-15", "08-27", "10-02", "10-21", "10-22", "11-05", "12-25"],
  2026: ["01-26", "02-15", "03-04", "03-21", "03-31", "04-01", "04-03", "04-14", "05-01", "08-15", "08-26", "09-14", "10-02", "10-20", "11-09", "12-25"],
  2027: ["01-26", "03-08", "03-24", "04-02", "04-14", "05-01", "08-15", "09-03", "10-02", "10-29", "11-19", "12-25"],
};

const COVERAGE_FROM = "2015-01-01";
const COVERAGE_THROUGH = "2027-12-31";

/**
 * Raised rather than guessed.
 *
 * Past the transcribed years the only honest answers are "throw" or "flag the
 * guess". Silently falling back to weekend-skipping would return a plausible
 * wrong date — a Monday day-change comparing against a public holiday — and
 * nothing downstream could detect it.
 */
export class CalendarCoverageError extends Error {
  constructor(date: CalendarDate, through: CalendarDate) {
    super(
      `No market-calendar data for ${date.toISO()} — coverage ends ${through.toISO()}. ` +
        "Add the exchange's published holiday list for that year to core/time.ts.",
    );
    this.name = "CalendarCoverageError";
  }
}

/**
 * Trading days for an Indian exchange.
 *
 * Why this exists rather than "skip weekends": a day-change figure on a Monday
 * must compare against Friday, and volatility annualises over trading days, not
 * calendar days. Both are wrong without a holiday table, and wrong by an amount
 * small enough to look right.
 */
export class MarketCalendar {
  private static readonly cache = new Map<ExchangeMic, MarketCalendar>();

  private constructor(
    readonly mic: ExchangeMic,
    private readonly holidays: ReadonlySet<string>,
    readonly coverageFrom: CalendarDate,
    readonly coverageThrough: CalendarDate,
  ) {}

  static of(mic: ExchangeMic): MarketCalendar {
    const cached = MarketCalendar.cache.get(mic);
    if (cached) return cached;

    const dates = new Set<string>();
    for (const [year, days] of Object.entries(NSE_TRADING_HOLIDAYS)) {
      for (const monthDay of days) dates.add(`${year}-${monthDay}`);
    }
    const calendar = new MarketCalendar(
      mic,
      dates,
      CalendarDate.parse(COVERAGE_FROM),
      CalendarDate.parse(COVERAGE_THROUGH),
    );
    MarketCalendar.cache.set(mic, calendar);
    return calendar;
  }

  static nse(): MarketCalendar {
    return MarketCalendar.of("XNSE");
  }

  static bse(): MarketCalendar {
    return MarketCalendar.of("XBOM");
  }

  isWithinCoverage(date: CalendarDate): boolean {
    return date.isOnOrAfter(this.coverageFrom) && date.isOnOrBefore(this.coverageThrough);
  }

  /**
   * Every holiday date, sorted.
   *
   * Exposed so `infra/db/seeds.ts` can mirror the list into `market_holidays`
   * for SQL reporting. The mirror is a copy; this class stays the source, so
   * there is only ever one transcription of the exchange circulars.
   */
  holidayDates(): readonly string[] {
    return [...this.holidays].sort();
  }

  private assertCovered(date: CalendarDate): void {
    if (!this.isWithinCoverage(date)) {
      throw new CalendarCoverageError(date, this.coverageThrough);
    }
  }

  private isTradingDayUnchecked(date: CalendarDate): boolean {
    const weekday = date.toUtcInstant().getUTCDay();
    if (weekday === 0 || weekday === 6) return false;
    return !this.holidays.has(date.toISO());
  }

  /** Weekends and published holidays are not trading days. */
  isTradingDay(date: CalendarDate): boolean {
    this.assertCovered(date);
    return this.isTradingDayUnchecked(date);
  }

  /** The most recent trading day strictly before `date`. */
  previousTradingDay(date: CalendarDate): CalendarDate {
    this.assertCovered(date);
    let cursor = date.plusDays(-1);
    // A holiday run plus a weekend spans a few days at most; the bound stops a
    // mistranscribed table turning into an infinite loop.
    for (let step = 0; step < 30; step++) {
      if (!this.isWithinCoverage(cursor)) {
        throw new CalendarCoverageError(cursor, this.coverageThrough);
      }
      if (this.isTradingDayUnchecked(cursor)) return cursor;
      cursor = cursor.plusDays(-1);
    }
    throw new Error(
      `No trading day within 30 days before ${date.toISO()} — the holiday table is wrong.`,
    );
  }

  /** The next trading day strictly after `date`. */
  nextTradingDay(date: CalendarDate): CalendarDate {
    this.assertCovered(date);
    let cursor = date.plusDays(1);
    for (let step = 0; step < 30; step++) {
      if (!this.isWithinCoverage(cursor)) {
        throw new CalendarCoverageError(cursor, this.coverageThrough);
      }
      if (this.isTradingDayUnchecked(cursor)) return cursor;
      cursor = cursor.plusDays(1);
    }
    throw new Error(
      `No trading day within 30 days after ${date.toISO()} — the holiday table is wrong.`,
    );
  }

  /**
   * A previous trading day that never throws, flagged when the answer is
   * weekend-only because the date falls outside coverage.
   *
   * UI paths use this: a staleness badge must still render for a date whose
   * holiday list we do not have, and it must not claim more precision than it has.
   */
  previousTradingDayApprox(date: CalendarDate): { date: CalendarDate; approximate: boolean } {
    if (this.isWithinCoverage(date) && this.isWithinCoverage(date.plusDays(-10))) {
      return { date: this.previousTradingDay(date), approximate: false };
    }
    let cursor = date.plusDays(-1);
    for (;;) {
      const weekday = cursor.toUtcInstant().getUTCDay();
      if (weekday !== 0 && weekday !== 6) return { date: cursor, approximate: true };
      cursor = cursor.plusDays(-1);
    }
  }

  /**
   * Trading days in the half-open range `(from, to]` — the count a volatility
   * annualisation needs. Half-open because a return series has one observation
   * per *transition*, not per date.
   */
  tradingDaysBetween(from: CalendarDate, to: CalendarDate): number {
    this.assertCovered(from);
    this.assertCovered(to);
    if (from.isOnOrAfter(to)) return 0;
    let count = 0;
    let cursor = from.plusDays(1);
    while (cursor.isOnOrBefore(to)) {
      if (this.isTradingDayUnchecked(cursor)) count++;
      cursor = cursor.plusDays(1);
    }
    return count;
  }

  /** Every trading day in an inclusive range. */
  tradingDays(range: DateRange): readonly CalendarDate[] {
    this.assertCovered(range.start);
    this.assertCovered(range.end);
    const days: CalendarDate[] = [];
    let cursor = range.start;
    while (cursor.isOnOrBefore(range.end)) {
      if (this.isTradingDayUnchecked(cursor)) days.push(cursor);
      cursor = cursor.plusDays(1);
    }
    return days;
  }
}

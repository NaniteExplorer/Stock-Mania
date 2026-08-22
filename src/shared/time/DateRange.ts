import { ValueObject } from "@/shared/kernel/ValueObject";
import { CalendarDate } from "./CalendarDate";

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

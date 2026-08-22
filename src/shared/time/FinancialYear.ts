import { ValueObject } from "@/shared/kernel/ValueObject";
import { CalendarDate } from "./CalendarDate";
import { DateRange } from "./DateRange";

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

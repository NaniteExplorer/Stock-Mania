/**
 * Time as an injected dependency.
 *
 * Financial-year boundaries, holding-period cutoffs (short- vs long-term capital
 * gains) and the terminal cash flow in an XIRR calculation all depend on "now".
 * A bare `new Date()` buried in a domain service makes every one of those
 * untestable, and makes a report's output depend on when it was run.
 */
export interface Clock {
  now(): Date;
  /** Today in the app's reporting timezone, as `YYYY-MM-DD`. */
  today(): string;
}

/** The timezone all reporting boundaries are computed in. */
export const REPORTING_TIME_ZONE = "Asia/Kolkata";

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }

  today(): string {
    return SystemClock.toReportingDate(this.now());
  }

  /**
   * Formats an instant as a calendar date in {@link REPORTING_TIME_ZONE}.
   *
   * Using the timezone explicitly matters: a purchase made at 02:00 IST is
   * 20:30 the previous day in UTC, and booking it to the wrong date can move a
   * trade across a financial-year boundary.
   */
  static toReportingDate(instant: Date): string {
    // en-CA renders as YYYY-MM-DD, which is the format we store.
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: REPORTING_TIME_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(instant);
  }
}

/** Test double: a clock frozen at a chosen instant. */
export class FixedClock implements Clock {
  constructor(private instant: Date) {}

  now(): Date {
    return new Date(this.instant);
  }

  today(): string {
    return SystemClock.toReportingDate(this.instant);
  }

  advanceTo(instant: Date): void {
    this.instant = instant;
  }
}

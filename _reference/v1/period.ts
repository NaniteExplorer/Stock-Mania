/**
 * Month-bucket helpers. A snapshot is keyed by "YYYY-MM" so at most one exists
 * per user per calendar month regardless of when in the month it was captured.
 * Pure — no I/O — so it stays unit-testable.
 */

/** "YYYY-MM" for a date (UTC month). */
export function periodKeyOf(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

/** Last instant of a period's month (UTC) — the canonical capturedAt for a bucket. */
export function periodEnd(periodKey: string): Date {
  const [year, month] = periodKey.split("-").map(Number);
  // Day 0 of the next month = last day of this month.
  return new Date(Date.UTC(year, month, 0, 23, 59, 59, 0));
}

/** The period immediately before the given key (e.g. "2026-01" → "2025-12"). */
export function previousPeriodKey(periodKey: string): string {
  const [year, month] = periodKey.split("-").map(Number);
  const prev = new Date(Date.UTC(year, month - 2, 1));
  return periodKeyOf(prev);
}

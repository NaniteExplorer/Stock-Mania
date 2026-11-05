/**
 * Pure model for the owner CPI entry screen (net-worth-age-chart.md § "CPI series").
 * No container, no React: the page and the spec both use it.
 */
import { expectedBase, formatCpiIndex, isCpiMonth, type CpiBase, type CpiPoint } from "@/domain/cpi-series";

export interface CpiRow {
  readonly month: string;
  readonly monthLabel: string;
  readonly base: CpiBase;
  readonly index: string;
  readonly source: string;
}

export interface CpiEditValues {
  readonly month: string;
  readonly index: string;
  readonly source: string;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** `"2026-09"` -> `"Sep 2026"`; anything else is returned unchanged. */
export function cpiMonthLabel(month: string): string {
  if (!isCpiMonth(month)) return month;
  return `${MONTHS[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;
}

/** The base shown beside the month input; `null` until the month is a valid yyyy-mm. */
export function baseFor(month: string): CpiBase | null {
  const m = month.trim();
  return isCpiMonth(m) ? expectedBase(m) : null;
}

/** Newest month first. */
export function buildCpiRows(points: readonly CpiPoint[]): CpiRow[] {
  return [...points]
    .sort((a, b) => (a.month < b.month ? 1 : a.month > b.month ? -1 : 0))
    .map((p) => ({ month: p.month, monthLabel: cpiMonthLabel(p.month), base: p.base, index: formatCpiIndex(p.indexScaled), source: p.source }));
}

/** Prefill for `?edit=yyyy-mm`; `null` when the month is not recorded. */
export function editValues(points: readonly CpiPoint[], month: string | undefined): CpiEditValues | null {
  if (!month) return null;
  const point = points.find((p) => p.month === month);
  return point ? { month: point.month, index: formatCpiIndex(point.indexScaled), source: point.source } : null;
}

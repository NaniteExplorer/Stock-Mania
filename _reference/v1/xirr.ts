/**
 * Pure XIRR (money-weighted annualized return) over irregular cash flows.
 * No I/O, no dependencies — hand-written so it stays unit-testable.
 *
 * Sign convention: money LEAVING you is negative (a buy / contribution), money
 * COMING to you is positive (a sell / dividend / the current market value as a
 * final synthetic inflow). XIRR is the annual rate r solving NPV(r) = 0.
 *
 * Newton–Raphson is used first (fast when it converges); a bisection fallback
 * brackets the root when Newton diverges or the derivative vanishes.
 */

export interface Cashflow {
  date: Date;
  amount: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const YEAR_DAYS = 365.25;

/** NPV of flows at annual rate r, with t0 as the reference date. */
function npv(rate: number, flows: Cashflow[], t0: number): number {
  let sum = 0;
  for (const f of flows) {
    const years = (f.date.getTime() - t0) / (DAY_MS * YEAR_DAYS);
    sum += f.amount / (1 + rate) ** years;
  }
  return sum;
}

/** d(NPV)/d(rate). */
function dNpv(rate: number, flows: Cashflow[], t0: number): number {
  let sum = 0;
  for (const f of flows) {
    const years = (f.date.getTime() - t0) / (DAY_MS * YEAR_DAYS);
    sum += (-years * f.amount) / (1 + rate) ** (years + 1);
  }
  return sum;
}

/**
 * Compute XIRR as a decimal (0.12 = 12%/yr), or null when it can't be defined:
 * fewer than two flows, no sign change (can't break even), or no convergence.
 */
export function xirr(flows: Cashflow[], guess = 0.1): number | null {
  if (flows.length < 2) return null;

  const hasPositive = flows.some((f) => f.amount > 0);
  const hasNegative = flows.some((f) => f.amount < 0);
  if (!hasPositive || !hasNegative) return null; // no sign change → no IRR

  const ordered = [...flows].sort((a, b) => a.date.getTime() - b.date.getTime());
  const t0 = ordered[0].date.getTime();

  // Newton–Raphson.
  let rate = guess;
  for (let i = 0; i < 60; i += 1) {
    const value = npv(rate, ordered, t0);
    if (Math.abs(value) < 1e-7) return clampRate(rate);
    const derivative = dNpv(rate, ordered, t0);
    if (!Number.isFinite(derivative) || Math.abs(derivative) < 1e-12) break;
    const next = rate - value / derivative;
    if (!Number.isFinite(next) || next <= -0.9999) break;
    if (Math.abs(next - rate) < 1e-9) return clampRate(next);
    rate = next;
  }

  // Bisection fallback over a wide bracket (-99.99% to +100000%/yr).
  let lo = -0.9999;
  let hi = 1000;
  let fLo = npv(lo, ordered, t0);
  let fHi = npv(hi, ordered, t0);
  if (!Number.isFinite(fLo) || !Number.isFinite(fHi) || fLo * fHi > 0) return null;
  for (let i = 0; i < 200; i += 1) {
    const mid = (lo + hi) / 2;
    const fMid = npv(mid, ordered, t0);
    if (Math.abs(fMid) < 1e-7 || (hi - lo) / 2 < 1e-9) return clampRate(mid);
    if (fLo * fMid < 0) {
      hi = mid;
      fHi = fMid;
    } else {
      lo = mid;
      fLo = fMid;
    }
  }
  return clampRate((lo + hi) / 2);
}

/** Guard against absurd numeric blow-ups from degenerate flow sets. */
function clampRate(rate: number): number | null {
  if (!Number.isFinite(rate)) return null;
  if (rate > 1000 || rate < -0.9999) return null;
  return rate;
}

/**
 * Simple annualized return (CAGR) — a fallback when there are no dated flows,
 * only a start value/date and an end value. Returns null if inputs are invalid.
 */
export function annualizedReturn(invested: number, currentValue: number, since: Date, until: Date): number | null {
  if (invested <= 0 || currentValue <= 0) return null;
  const years = (until.getTime() - since.getTime()) / (DAY_MS * YEAR_DAYS);
  if (years <= 0) return null;
  return (currentValue / invested) ** (1 / years) - 1;
}

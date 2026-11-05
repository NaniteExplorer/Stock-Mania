/**
 * CPI Urban series, entered by the owner (net-worth-age-chart.md § "CPI series").
 *
 * The app never fetches CPI and never assumes an inflation rate: the owner types
 * the published monthly index. Each point is exact — the index is held as a
 * BigInt scaled by 10 000 (at most four decimal places; MoSPI publishes one) —
 * and money is deflated with `Money.timesRatio` on those integers, rounded once
 * (HALF_UP). Nothing here is a float.
 *
 * Refusals are explicit:
 * - a month with no recorded index is refused, never interpolated;
 * - two months on different bases (MoSPI rebased 2012=100 → 2024=100 in
 *   January 2026, and says they are not comparable) are refused, since no
 *   linking factor is stored.
 */
import type { Money } from "@/core/money";

export const CPI_INDEX_SCALE = 10_000n;
const CPI_INDEX_DECIMALS = 4;
/** First month published on the 2024 base. */
export const CPI_BASE_BREAK_MONTH = "2026-01";

export type CpiBase = "2012" | "2024";

export interface CpiPoint {
  /** `yyyy-mm`. */
  readonly month: string;
  readonly base: CpiBase;
  /** Index × 10 000, exact. */
  readonly indexScaled: bigint;
  /** Where the owner read the figure, e.g. "MoSPI press release". */
  readonly source: string;
}

export type Deflated = { readonly ok: true; readonly value: Money } | { readonly ok: false; readonly reason: string };

export interface CpiSeriesReader {
  list(userId: { readonly value: string }): Promise<readonly CpiPoint[]>;
}

export interface CpiSeriesWriter {
  record(userId: { readonly value: string }, point: CpiPoint): Promise<void>;
  remove(userId: { readonly value: string }, month: string): Promise<void>;
}

const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;
const INDEX = /^(\d+)(?:\.(\d{1,4}))?$/;

export function isCpiMonth(value: string): boolean {
  return MONTH.test(value);
}

/** The base a month must be published on. */
export function expectedBase(month: string): CpiBase {
  return month < CPI_BASE_BREAK_MONTH ? "2012" : "2024";
}

/** `"193.4"` → 1 934 000n. Refuses more than four decimals, signs, exponents and zero. */
export function parseCpiIndex(text: string): bigint {
  const match = INDEX.exec(text.trim());
  if (!match) throw new RangeError(`A CPI index is a positive decimal with at most ${CPI_INDEX_DECIMALS} places, got "${text}".`);
  const scaled = BigInt(match[1]!) * CPI_INDEX_SCALE + BigInt((match[2] ?? "").padEnd(CPI_INDEX_DECIMALS, "0"));
  if (scaled <= 0n) throw new RangeError("A CPI index must be greater than zero.");
  return scaled;
}

/** 1 934 000n → `"193.4"` (trailing zeros dropped). */
export function formatCpiIndex(scaled: bigint): string {
  const whole = scaled / CPI_INDEX_SCALE;
  const fraction = (scaled % CPI_INDEX_SCALE).toString().padStart(CPI_INDEX_DECIMALS, "0").replace(/0+$/, "");
  return fraction === "" ? whole.toString() : `${whole}.${fraction}`;
}

/** Builds a validated point; throws RangeError on any invalid field. */
export function cpiPoint(input: { month: string; base: string; index: string | bigint; source: string }): CpiPoint {
  if (!isCpiMonth(input.month)) throw new RangeError(`A CPI month is yyyy-mm, got "${input.month}".`);
  if (input.base !== "2012" && input.base !== "2024") throw new RangeError(`A CPI base is 2012 or 2024, got "${input.base}".`);
  const want = expectedBase(input.month);
  if (input.base !== want) throw new RangeError(`CPI for ${input.month} is published on the ${want} base, not ${input.base}.`);
  const indexScaled = typeof input.index === "bigint" ? input.index : parseCpiIndex(input.index);
  if (indexScaled <= 0n) throw new RangeError("A CPI index must be greater than zero.");
  const source = input.source.trim();
  if (source === "") throw new RangeError("A CPI point needs a source label.");
  if (source.length > 200) throw new RangeError("A CPI source label is at most 200 characters.");
  return Object.freeze({ month: input.month, base: input.base, indexScaled, source });
}

/** Problems with a series as a whole (duplicates, invalid points). Empty means valid. */
export function validateCpiSeries(points: readonly CpiPoint[]): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const point of points) {
    if (seen.has(point.month)) problems.push(`${point.month} is recorded twice.`);
    seen.add(point.month);
    try {
      cpiPoint({ month: point.month, base: point.base, index: point.indexScaled, source: point.source });
    } catch (error) {
      problems.push((error as Error).message);
    }
  }
  return problems;
}

/**
 * `money`, stated in `fromMonth` rupees, re-expressed in `toMonth` rupees:
 * `money × CPI(to) ÷ CPI(from)`, exact until the one HALF_UP rounding.
 */
export function deflate(money: Money, fromMonth: string, toMonth: string, points: readonly CpiPoint[]): Deflated {
  const problems = validateCpiSeries(points);
  if (problems.length > 0) return { ok: false, reason: `The CPI series is invalid: ${problems[0]}` };
  const byMonth = new Map(points.map((p) => [p.month, p]));
  for (const month of [fromMonth, toMonth]) {
    if (!isCpiMonth(month)) return { ok: false, reason: `"${month}" is not a yyyy-mm month.` };
  }
  const from = byMonth.get(fromMonth);
  if (!from) return { ok: false, reason: `No CPI figure is recorded for ${fromMonth}; months are never interpolated.` };
  const to = byMonth.get(toMonth);
  if (!to) return { ok: false, reason: `No CPI figure is recorded for ${toMonth}; months are never interpolated.` };
  if (from.base !== to.base) {
    return { ok: false, reason: `${fromMonth} (${from.base} base) and ${toMonth} (${to.base} base) are not comparable without a recorded linking factor.` };
  }
  return { ok: true, value: money.timesRatio(to.indexScaled, from.indexScaled, "HALF_UP") };
}

/**
 * Percentile placement on two scales (TASKS 3.8) and log-ratio-to-median
 * progression with a decomposition of every move (TASKS 3.9). Pure; no I/O.
 *
 * - A placement is always a band between two published cut points, never a
 *   single percentile. Above the 90th it widens to the top; on the India scale
 *   it stops at "top 10%", where Indian data no longer resolves
 *   (PRODUCT-REQUIREMENT §5.1).
 * - Inputs that cannot be compared are refused: a different measure, a pending
 *   table, or a currency basis that needs a conversion that was not supplied.
 *   A population-unit mismatch (household against adult) is stated and widens
 *   the band rather than being hidden.
 * - Amounts stay exact (bigint minor units); the only float is a log of an
 *   exact ratio (`exactRatio`).
 */
import type { Money } from "@/core/money";
import { exactRatio } from "@/core/ratio";
import { Ordinal, Ratio } from "@/core/units";
import type { CurrencyBasis, PlacementMeasure, PopulationUnit, ReferenceDistribution, ThresholdPoint } from "./percentile-references";

/** INR per international dollar as an exact fraction, with where it came from. */
export interface PppFactor {
  readonly inrPerUnitNumerator: bigint;
  readonly inrPerUnitDenominator: bigint;
  /** ISO year of the factor, e.g. "2021". */
  readonly year: string;
  readonly source: string;
}

export interface OwnerFigure {
  readonly measure: PlacementMeasure;
  readonly unit: PopulationUnit;
  /** In INR; the owner's own figure. */
  readonly amount: Money;
}

export type Placement =
  | {
    readonly state: "placed";
    readonly distributionId: string;
    /** Band in whole percentiles, lower < upper; upper 100 means "top". */
    readonly lower: Ordinal;
    readonly upper: Ordinal;
    readonly label: string;
    readonly notes: readonly string[];
  }
  | { readonly state: "refused"; readonly distributionId: string; readonly reason: string };

const INDIA_CEILING = 90;

/** Converts INR minor units onto the distribution's basis, or names why it cannot. */
function onBasis(minor: bigint, basis: CurrencyBasis, ppp: PppFactor | null): bigint | string {
  if (basis === "INR_NOMINAL") return minor;
  if (basis === "USD_NOMINAL") {
    return "This scale is in nominal US dollars; converting at the market rate misstates purchasing power, so it is not placed.";
  }
  if (ppp === null) return "This scale is in PPP international dollars and no PPP factor is stored, so it is not placed.";
  if (ppp.inrPerUnitNumerator <= 0n || ppp.inrPerUnitDenominator <= 0n) return "The stored PPP factor is not positive, so it is not placed.";
  // INR minor / (INR per $) = $ minor (both two minor digits); floor loses under a cent.
  return (minor * ppp.inrPerUnitDenominator) / ppp.inrPerUnitNumerator;
}

function bandLabel(lower: Ordinal, upper: Ordinal): string {
  if (upper >= 100) return `Top ${100 - lower}%`;
  return `Between the ${lower}th and ${upper}th percentile`;
}

/** Index of the last cut point at or below `value`, or -1 below the first. */
function bracket(points: readonly ThresholdPoint[], value: bigint): number {
  let at = -1;
  for (let i = 0; i < points.length; i += 1) if (points[i].minor <= value) at = i;
  return at;
}

export function place(owner: OwnerFigure, reference: ReferenceDistribution, ppp: PppFactor | null = null): Placement {
  const refuse = (reason: string): Placement => ({ state: "refused", distributionId: reference.id, reason });
  if (owner.amount.currency.code !== "INR") return refuse("The owner figure must be in rupees.");
  if (owner.measure !== reference.measure) return refuse(`This scale measures ${reference.measure}, not ${owner.measure}; they are not comparable.`);
  if (reference.thresholds === null) return refuse(reference.pendingReason ?? "This scale has no thresholds.");
  const points = reference.thresholds;
  if (points.length < 2) return refuse("This scale has too few cut points to place anyone.");
  for (let i = 1; i < points.length; i += 1) {
    if (points[i].percentile <= points[i - 1].percentile || points[i].minor < points[i - 1].minor) return refuse("This scale's cut points are not ascending.");
  }
  const value = onBasis(owner.amount.minor, reference.basis, ppp);
  if (typeof value === "string") return refuse(value);

  const notes: string[] = [];
  const at = bracket(points, value);
  let lowerIdx = at;
  let upperIdx = at + 1;
  if (owner.unit !== reference.unit) {
    notes.push(`Unit mismatch: your figure is per ${owner.unit}, this scale is per ${reference.unit}. The band is widened one step each side.`);
    lowerIdx -= 1;
    upperIdx += 1;
  }
  let lower: number = lowerIdx < 0 ? 0 : points[Math.min(lowerIdx, points.length - 1)].percentile;
  let upper: number = upperIdx >= points.length ? 100 : points[upperIdx].percentile;
  if (lower >= 90 && upper < 100) {
    notes.push("Above the 90th percentile the band runs to the top: data there is modelled, not observed.");
    upper = 100;
  }
  if (reference.scale === "INDIA" && lower >= INDIA_CEILING) {
    lower = INDIA_CEILING;
    upper = 100;
    notes.push("Indian data does not resolve above the 90th percentile, so placement stops at top 10%.");
  }
  if (reference.basis === "INTL_PPP" && ppp !== null) notes.push(`Converted at PPP (${ppp.year}, ${ppp.source}), not the nominal exchange rate.`);
  return { state: "placed", distributionId: reference.id, lower: Ordinal(lower), upper: Ordinal(upper), label: bandLabel(Ordinal(lower), Ordinal(upper)), notes };
}

// ── 3.9 progression ──────────────────────────────────────────────────────────

/** ln(amount / median): 0 at the median, about +0.69 at twice it. Null for non-positive or mixed inputs. */
export function logRatioToMedian(amount: Money, median: Money): Ratio | null {
  if (amount.currency.code !== median.currency.code || amount.minor <= 0n || median.minor <= 0n) return null;
  return Ratio(Math.log(exactRatio(amount.minor, median.minor)));
}

export interface Snapshot {
  readonly amount: Money;
  /** Reference median on the same basis and date. */
  readonly median: Money;
}

export type MoveDecomposition =
  | {
    readonly state: "decomposed";
    /** Change in log-ratio-to-median; total = contributions + market - reference. */
    readonly total: Ratio;
    /** ln((before + net contributions) / before). */
    readonly contributions: Ratio;
    /** ln(after / (before + net contributions)): change not from new money. */
    readonly market: Ratio;
    /** ln(median after / median before): how far the distribution itself moved. */
    readonly reference: Ratio;
    readonly sentence: string;
  }
  | { readonly state: "refused"; readonly reason: string };

const pct = (log: number): string => `${(Math.expm1(log) * 100).toFixed(1)}%`;

/**
 * Decomposes a move in log-ratio-to-median. For income pass zero contributions;
 * the own change then reads as the owner's real change against the
 * distribution's. All figures must already share one price basis (real terms).
 */
export function decomposeMove(before: Snapshot, after: Snapshot, netContributions: Money): MoveDecomposition {
  const codes = new Set([before.amount, before.median, after.amount, after.median, netContributions].map((m) => m.currency.code));
  if (codes.size !== 1) return { state: "refused", reason: "The figures are in different currencies; not decomposed." };
  const funded = before.amount.minor + netContributions.minor;
  if (before.amount.minor <= 0n || after.amount.minor <= 0n || funded <= 0n || before.median.minor <= 0n || after.median.minor <= 0n) {
    return { state: "refused", reason: "A log ratio needs positive amounts and medians; not decomposed." };
  }
  const ln = (a: bigint, b: bigint): number => Math.log(exactRatio(a, b));
  const contributions = ln(funded, before.amount.minor);
  const market = ln(after.amount.minor, funded);
  const reference = ln(after.median.minor, before.median.minor);
  const total = contributions + market - reference;
  const own = contributions + market;
  const direction = total > 0 ? "rose" : total < 0 ? "fell" : "did not change";
  const sentence = `Your position against the median ${direction}: your figure changed ${pct(own)} (new money ${pct(contributions)}, the rest ${pct(market)}), the median changed ${pct(reference)}.`;
  return { state: "decomposed", total: Ratio(total), contributions: Ratio(contributions), market: Ratio(market), reference: Ratio(reference), sentence };
}

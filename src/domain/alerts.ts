/**
 * Tier 1 alerts — factual, rare, and about the owner's own state (task 6.1).
 *
 * `PRODUCT-REQUIREMENT.md` §7: an alert states what is true and suggests nothing.
 * It never forecasts a price, never recommends a trade, and never fires on market
 * movement — the channel itself raises trading, whatever it says.
 *
 * Every rule is a pure function returning an `Alert` or null. **An unknown input
 * produces no alert**, never a guessed one: an unknown runway is not a shortfall,
 * an unknown gain is not a gain. Rates and the exemption amount are inputs from
 * the tax rules; this file holds no statutory figure of its own.
 */

import { rupee, percentage } from "@/core/format";
import type { Money } from "@/core/money";
import { Percentage } from "@/core/numeric";
import type { CalendarDate, FinancialYear } from "@/core/time";
import { Days, type Months } from "@/core/units";

export type AlertKind = "TERM_BOUNDARY" | "EXEMPTION_UNUSED" | "CONCENTRATION" | "RUNWAY_BELOW_TARGET" | "SOURCE_FAILURE";

export interface Alert {
  readonly kind: AlertKind;
  /** Stable per subject: the same condition on a later day is the same alert, not a new one. */
  readonly key: string;
  readonly asOf: CalendarDate;
  readonly text: string;
}

const alert = (kind: AlertKind, key: string, asOf: CalendarDate, text: string): Alert =>
  Object.freeze({ kind, key, asOf, text });

const days = (n: number): string => (n === 1 ? "1 day" : `${n} days`);

/** A lot about to turn long-term, with an unrealised gain the boundary would re-rate. */
export interface LotNearBoundary {
  readonly lotId: string;
  readonly instrument: string;
  readonly acquiredOn: CalendarDate;
  /** First day on which a sale is long-term, from the tax rule for this category. */
  readonly longTermFrom: CalendarDate;
  /** Null when no current price is known. */
  readonly unrealisedGain: Money | null;
  readonly shortTermRate: Percentage;
  readonly longTermRate: Percentage;
}

export function termBoundaryAlert(lot: LotNearBoundary, asOf: CalendarDate, window: Days): Alert | null {
  if (lot.unrealisedGain === null || !lot.unrealisedGain.isPositive) return null;
  const left = asOf.daysUntil(lot.longTermFrom);
  if (left <= 0 || left > window) return null;
  return alert(
    "TERM_BOUNDARY",
    `term:${lot.lotId}`,
    asOf,
    `${lot.instrument} bought ${lot.acquiredOn.toISO()} becomes long-term on ${lot.longTermFrom.toISO()}, in ${days(left)}. ` +
      `Its unrealised gain of ${rupee(lot.unrealisedGain)} is taxed at ${percentage(lot.shortTermRate)} short-term ` +
      `and ${percentage(lot.longTermRate)} long-term.`,
  );
}

/** Unused long-term exemption, near the end of the financial year that holds it. */
export function exemptionUnusedAlert(
  year: FinancialYear,
  exemption: Money,
  used: Money,
  asOf: CalendarDate,
  window: Days,
): Alert | null {
  if (!year.contains(asOf)) return null;
  const unused = exemption.minus(used);
  if (!unused.isPositive) return null;
  const left = asOf.daysUntil(year.end);
  if (left > window) return null;
  return alert(
    "EXEMPTION_UNUSED",
    `exemption:${year.label}`,
    asOf,
    `${rupee(unused, 0)} of the ${rupee(exemption, 0)} long-term equity exemption for ${year.label} is unused. ` +
      `The financial year ends ${year.end.toISO()}, in ${days(left)}.`,
  );
}

/** One holding's share of the portfolio above the owner's own threshold. */
export function concentrationAlert(
  holding: { readonly id: string; readonly name: string; readonly value: Money },
  total: Money | null,
  threshold: Percentage,
  asOf: CalendarDate,
): Alert | null {
  if (total === null || !total.isPositive || !holding.value.isPositive) return null;
  if (!holding.value.currency.equals(total.currency)) throw new RangeError("A share needs the holding and the total in one currency.");
  // Exact: value / total > threshold  ⇔  value × 100 × scale > threshold.scaled × total.
  if (holding.value.minor * 100_000_000n <= threshold.scaled * total.minor) return null;
  return alert(
    "CONCENTRATION",
    `concentration:${holding.id}`,
    asOf,
    `${holding.name} is ${percentage(Percentage.ratio(holding.value, total), 2)} of the portfolio ` +
      `(${rupee(holding.value, 0)} of ${rupee(total, 0)}). Your threshold is ${percentage(threshold, 2)}.`,
  );
}

/** Truncated toward zero, never rounded: 1.96 months below a 2-month target must not read "2.0". */
const tenths = (months: Months): string => (Math.trunc(months * 10) / 10).toFixed(1);

/** Emergency runway below the owner's target. Unknown runway is not a shortfall. */
export function runwayAlert(runway: Months | null, target: Months, asOf: CalendarDate): Alert | null {
  if (runway === null || runway >= target) return null;
  return alert(
    "RUNWAY_BELOW_TARGET",
    "runway",
    asOf,
    `Emergency runway is ${tenths(runway)} months of expenses. Your target is ${tenths(target)} months.`,
  );
}

/**
 * A price or rate source with no successful fetch inside its allowed age. Silent
 * staleness is the product's biggest correctness risk, so a source that has never
 * succeeded alerts too.
 */
export function sourceFailureAlert(
  source: { readonly id: string; readonly name: string; readonly lastSuccessOn: CalendarDate | null },
  maxAge: Days,
  asOf: CalendarDate,
): Alert | null {
  // The caller passes the last success *as of* `asOf`. A later date means it passed
  // today's state into a historical evaluation; refuse rather than guess either way.
  if (source.lastSuccessOn !== null && source.lastSuccessOn.isAfter(asOf)) {
    throw new RangeError(`${source.name}'s last success (${source.lastSuccessOn.toISO()}) is after the evaluation date ${asOf.toISO()}; pass the last success on or before it.`);
  }
  if (source.lastSuccessOn === null) {
    return alert("SOURCE_FAILURE", `source:${source.id}`, asOf, `${source.name} has never returned data. Figures that depend on it are shown as unknown.`);
  }
  const age = Days(source.lastSuccessOn.daysUntil(asOf));
  if (age <= maxAge) return null;
  return alert(
    "SOURCE_FAILURE",
    `source:${source.id}`,
    asOf,
    `${source.name} last returned data on ${source.lastSuccessOn.toISO()}, ${days(age)} ago. Figures that depend on it are stale.`,
  );
}

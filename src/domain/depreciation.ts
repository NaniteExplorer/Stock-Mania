/**
 * Depreciation — a **model**, labelled as one, never an observation.
 *
 * `PRODUCT-REQUIREMENT.md` §4.3: an asset bought with a major spend carries "a
 * depreciation model — labelled a model, with its rate shown, never presented as
 * an observation". So a modelled value never travels alone: it carries the
 * model's name, its rate or schedule, and the basis for choosing it, and nothing
 * here is ever stored as the asset's value (task 1.4). A valuation someone made
 * is an `AssertedValuation`; this is what arithmetic says in its absence.
 *
 * Each model owns its own arithmetic, so a new one is a new class.
 */

import type { Money } from "@/core/money";
import { Percentage } from "@/core/numeric";
import type { CalendarDate } from "@/core/time";
import { Months } from "@/core/units";

export interface Purchase {
  readonly on: CalendarDate;
  readonly price: Money;
}

/** A value produced by a model, with everything a screen needs to say so. */
export interface ModelledValue {
  readonly value: Money;
  readonly model: string;
  /** The rate or schedule, in words: "15% of the remaining value a year". */
  readonly terms: string;
  /** Where the model comes from, or that it is the owner's own assumption. */
  readonly basis: string;
}

export abstract class DepreciationModel {
  abstract readonly name: string;
  abstract readonly terms: string;
  abstract readonly basis: string;

  /** The value on `asOf`. Before the purchase date it is the purchase price. */
  protected abstract valueAfter(purchase: Purchase, asOf: CalendarDate): Money;

  valueOn(purchase: Purchase, asOf: CalendarDate): ModelledValue {
    const value = asOf.isOnOrBefore(purchase.on) ? purchase.price : this.valueAfter(purchase, asOf);
    return { value, model: this.name, terms: this.terms, basis: this.basis };
  }
}

/** Whole years elapsed: a year counts only once it has passed. */
function wholeYears(purchase: Purchase, asOf: CalendarDate): number {
  let years = 0;
  while (purchase.on.plusYears(years + 1).isOnOrBefore(asOf)) years += 1;
  return years;
}

/** A fixed share of the *remaining* value each full year. Never reaches zero. */
export class DecliningBalance extends DepreciationModel {
  readonly name = "Declining balance";
  readonly terms: string;

  constructor(
    readonly rate: Percentage,
    readonly basis: string,
  ) {
    super();
    if (rate.isNegative || rate.compareTo(Percentage.of(100)) >= 0) {
      throw new RangeError("A declining-balance rate must be from 0% up to, not including, 100%.");
    }
    this.terms = `${rate.toFixed(2)}% of the remaining value each full year`;
  }

  protected valueAfter(purchase: Purchase, asOf: CalendarDate): Money {
    let value = purchase.price;
    for (let year = 0; year < wholeYears(purchase, asOf); year += 1) value = value.minus(this.rate.applyTo(value));
    return value;
  }
}

/** A fixed share of the *purchase price* each full year, down to a floor. */
export class StraightLine extends DepreciationModel {
  readonly name = "Straight line";
  readonly terms: string;

  constructor(
    readonly rate: Percentage,
    /** The share of the price it never falls below — a residual value. */
    readonly floor: Percentage,
    readonly basis: string,
  ) {
    super();
    if (rate.isNegative || rate.isZero) throw new RangeError("A straight-line rate must be above zero.");
    if (floor.isNegative || floor.compareTo(Percentage.of(100)) > 0) throw new RangeError("A floor is a share of the price, 0% to 100%.");
    this.terms = `${rate.toFixed(2)}% of the price each full year, never below ${floor.toFixed(2)}%`;
  }

  protected valueAfter(purchase: Purchase, asOf: CalendarDate): Money {
    const lost = this.rate.applyTo(purchase.price).times(wholeYears(purchase, asOf));
    const floor = this.floor.applyTo(purchase.price);
    const value = purchase.price.minus(lost);
    return value.compareTo(floor) < 0 ? floor : value;
  }
}

/** One band of an age schedule: up to (not including) `underMonths`, depreciation `off`. */
export interface AgeBand {
  readonly underMonths: Months;
  readonly off: Percentage;
}

/**
 * A schedule of depreciation by age, as a share of the purchase price. The last
 * band applies to every older age, so a schedule stops being informative past it
 * and says so in its terms.
 */
export class AgeSchedule extends DepreciationModel {
  readonly terms: string;
  readonly bands: readonly AgeBand[];

  constructor(
    readonly name: string,
    bands: readonly AgeBand[],
    readonly basis: string,
  ) {
    super();
    if (bands.length === 0) throw new RangeError("An age schedule needs at least one band.");
    for (const band of bands) {
      if (band.off.isNegative || band.off.compareTo(Percentage.of(100)) > 0) {
        throw new RangeError("An age-band discount must be from 0% to 100%.");
      }
    }
    for (let i = 1; i < bands.length; i += 1) {
      if (bands[i]!.underMonths <= bands[i - 1]!.underMonths) throw new RangeError("Age bands must rise.");
    }
    this.bands = Object.freeze(bands.map((band) => Object.freeze({ ...band })));
    const last = this.bands[this.bands.length - 1]!;
    this.terms = `${this.bands.map((band) => `${band.off.toFixed(0)}% under ${band.underMonths} months`).join(", ")}; ${last.off.toFixed(0)}% beyond`;
  }

  protected valueAfter(purchase: Purchase, asOf: CalendarDate): Money {
    const months = purchase.on.monthsUntil(asOf);
    const band = this.bands.find((candidate) => months < candidate.underMonths) ?? this.bands[this.bands.length - 1]!;
    return purchase.price.minus(band.off.applyTo(purchase.price));
  }
}

/**
 * The motor-insurance IDV depreciation schedule for vehicles up to five years old
 * (India Motor Tariff, General Regulation 8). It is what an insurer pays on a
 * total loss, which is **not** what the car would sell for — the basis says so.
 * Past five years the tariff has no schedule and IDV is agreed case by case, so
 * this model's last band is a placeholder the terms make visible.
 */
export const MOTOR_IDV_SCHEDULE = new AgeSchedule(
  "Motor insurance IDV schedule",
  [
    { underMonths: Months(6), off: Percentage.of(5) },
    { underMonths: Months(12), off: Percentage.of(15) },
    { underMonths: Months(24), off: Percentage.of(20) },
    { underMonths: Months(36), off: Percentage.of(30) },
    { underMonths: Months(48), off: Percentage.of(40) },
    { underMonths: Months(60), off: Percentage.of(50) },
  ],
  "India Motor Tariff GR 8: insured declared value by vehicle age. An insurance figure, not a resale price; beyond 5 years IDV is agreed with the insurer.",
);

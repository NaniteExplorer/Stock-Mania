/**
 * Units for the numbers that are not money.
 *
 * `RULES.md` §8.6 forbids a raw `number` at a domain boundary because a number
 * does not say what it counts. `Money`, `Percentage` and `Quantity` answer that
 * for the figures that need exact arithmetic. Everything else — a row count, a
 * grace period, a Sharpe ratio — is an ordinary JavaScript number with nothing
 * to round, and needs only its unit stated where a caller can see it.
 *
 * So these are **brands**: compile-time units over `number`, with no runtime
 * cost and no wrapper. A `Days` cannot be passed where `Months` is expected, a
 * `Count` cannot be passed where a `Ratio` is, and none of them can be passed
 * where `Money` is. Arithmetic on a brand yields a plain `number`; re-brand it
 * through the constructor below, which is where the invariant is checked.
 *
 * **Choosing one is a claim about the number, made where it is declared.** That
 * is the point: the architecture check (F.8) passes a `number` only when it
 * carries one of these, so the unit is stated once, at the boundary, and review
 * can see it. A rupee figure typed `Count` would pass the check and fail review.
 */

declare const unit: unique symbol;

/** A number that carries its unit in the type. */
export type Unit<Name extends string> = number & { readonly [unit]: Name };

/** How many of something. A non-negative integer: rows, lots, attempts. */
export type Count = Unit<"count">;
/** A position in an order: a priority, a sequence number, a day of the month. */
export type Ordinal = Unit<"ordinal">;

/** A span of calendar days. Whole days; a duration, not a date. */
export type Days = Unit<"days">;
/**
 * A signed span of calendar days, measured from one date to another: negative
 * when the second date is earlier. Whole days. Used where "before" is a real
 * answer — an option already past expiry, a sale dated before its lot.
 */
export type DaySpan = Unit<"day-span">;
/** A span of calendar months. May be fractional: a savings runway of 4.5 months is real. */
export type Months = Unit<"months">;
/** A span of years. */
export type Years = Unit<"years">;
/** A span of minutes — operational timing, never a financial period. */
export type Minutes = Unit<"minutes">;
/** A span of milliseconds — operational timing, never a financial period. */
export type Millis = Unit<"millis">;

/**
 * A dimensionless real number: a return as a fraction (`0.05` is 5%), a
 * correlation, a beta, a Sharpe ratio, a z-score. Statistics are computed in
 * floating point and that is fine — they are never money and never posted.
 *
 * **A fraction, not a percent.** `0.05`, never `5`. The fraction/percent
 * confusion is the classic failure here, and a threshold a person sets in
 * percent is a `Percentage`, not a `Ratio`.
 */
export type Ratio = Unit<"ratio">;

/**
 * A price level for analysis — a moving average, a Bollinger band, an ATR, a MACD
 * line. Currency per unit, in floating point, **because it is never money**: it
 * is drawn on a chart and compared with other levels, and never posted, summed
 * into a balance or shown as an amount someone holds. The moment a figure is
 * any of those it is `Money` or `UnitPrice`, never this.
 *
 * The difference of two levels is still a level, so MACD is one.
 */
export type PriceLevel = Unit<"price-level">;

/**
 * A point on a bounded index scale: RSI on 0–100, the cost inflation index.
 * Not a fraction and not a percent — RSI 70 is not 70% of anything — so it is
 * neither `Ratio` nor `Percentage`.
 */
export type IndexPoints = Unit<"index-points">;

/**
 * A position someone chose for display: an account's sort order. A whole number
 * that **may be negative**, because a negative key is how an owner lifts one item
 * above the defaults at zero. That is the difference from `Ordinal`.
 */
export type SortKey = Unit<"sort-key">;

/** The direction a balance moves: `1` or `-1`. A literal union, not a brand. */
export type Sign = 1 | -1;

/**
 * A `Sign` that may also be zero, for a quantity with no direction at all: the
 * net-worth side of an income, expense or equity account, which is neither an
 * asset nor a liability. Zero is a real answer here, not a missing one.
 */
export type Polarity = Sign | 0;

function whole(value: number, what: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${what} must be a whole number of zero or more, got ${value}.`);
  }
}

export const Count = (value: number): Count => (whole(value, "A count"), value as Count);
export const Ordinal = (value: number): Ordinal => (whole(value, "An ordinal"), value as Ordinal);
export const Days = (value: number): Days => (whole(value, "Days"), value as Days);
export const DaySpan = (value: number): DaySpan => {
  if (!Number.isSafeInteger(value)) throw new RangeError(`A day span must be a whole number of days, got ${value}.`);
  return value as DaySpan;
};
export const SortKey = (value: number): SortKey => {
  if (!Number.isSafeInteger(value)) throw new RangeError(`A sort key must be a whole number, got ${value}.`);
  return value as SortKey;
};
function span(value: number, what: string): void {
  // Months and years may be fractional — a runway of 4.5 months, a tenor of 2.5
  // years. Days may not: a calendar day is the smallest span the ledger knows.
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${what} must be finite and non-negative, got ${value}.`);
  }
}

export const Months = (value: number): Months => (span(value, "Months"), value as Months);
export const Years = (value: number): Years => (span(value, "Years"), value as Years);
export const Minutes = (value: number): Minutes => (whole(value, "Minutes"), value as Minutes);
export const Millis = (value: number): Millis => (whole(value, "Milliseconds"), value as Millis);
export const Ratio = (value: number): Ratio => {
  // NaN and infinity are not ratios; they are a division that should have been
  // guarded. A statistic that cannot be computed is null upstream (§3.2), never NaN.
  if (!Number.isFinite(value)) throw new RangeError(`A ratio must be finite, got ${value}.`);
  return value as Ratio;
};
export const PriceLevel = (value: number): PriceLevel => {
  if (!Number.isFinite(value)) throw new RangeError(`A price level must be finite, got ${value}.`);
  return value as PriceLevel;
};
export const IndexPoints = (value: number): IndexPoints => {
  if (!Number.isFinite(value)) throw new RangeError(`An index value must be finite, got ${value}.`);
  return value as IndexPoints;
};

/**
 * The constructor of a continuous unit — `Ratio`, `PriceLevel` and friends. It is
 * the one sanctioned place a raw number becomes a brand, so domain helpers that are
 * generic over the unit take the constructor by this type rather than spelling out
 * a raw-number callback at their own boundary.
 */
export type UnitFactory<U> = (value: number) => U;

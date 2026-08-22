/**
 * The two non-money numeric kinds.
 *
 * `Quantity` (scale 1e8) counts units — shares, grams, coins — and is never
 * rounded implicitly. `Percentage` (scale 1e6) carries rates and ratios. Keeping
 * these distinct from Money is the single most important numeric decision in the
 * system: one type cannot serve money, quantity and rate well.
 *
 * `Rate`, with an explicit day count, joins this file in Phase 1a.
 */

import { ValueObject } from "./kernel";
import { Money, divideRounded, pow10, type RoundingMode } from "./money";

/* ─── Quantity ─────────────────────────────────────────────── */

/** Decimal places retained for unit counts. */
const QUANTITY_SCALE = 8;
const QUANTITY_FACTOR = pow10(QUANTITY_SCALE);
const DECIMAL_PATTERN = /^-?(\d+)(?:\.(\d+))?$/;

/**
 * A count of units held, exact to eight decimal places.
 *
 * Whole shares would fit in an integer, but mutual fund units, digital gold
 * (grams) and fractional SIP allotments do not — a ₹5,000 SIP buys something
 * like 123.45678901 units. Storing that as a float and then multiplying by a
 * price is exactly how a portfolio value drifts from the sum of its lots, so
 * unit counts get the same exact-integer treatment as {@link Money}.
 */
export class Quantity extends ValueObject {
  private constructor(readonly scaled: bigint) {
    super();
  }

  static readonly ZERO = new Quantity(0n);

  static fromString(value: string): Quantity {
    const text = value.trim();
    const match = DECIMAL_PATTERN.exec(text);
    if (!match) {
      throw new TypeError(`Not a valid quantity: ${JSON.stringify(value)}`);
    }

    const [, whole, fraction = ""] = match;
    const scaled = BigInt(whole + fraction.padEnd(QUANTITY_SCALE, "0"));
    const excessDigits = Math.max(0, fraction.length - QUANTITY_SCALE);
    const magnitude =
      excessDigits === 0 ? scaled : divideRounded(scaled, pow10(excessDigits), "HALF_UP");

    return new Quantity(text.startsWith("-") ? -magnitude : magnitude);
  }

  static fromNumber(value: number): Quantity {
    if (!Number.isFinite(value)) {
      throw new TypeError(`Not a finite quantity: ${value}`);
    }
    return Quantity.fromString(value.toFixed(QUANTITY_SCALE));
  }

  /** From the raw scaled integer stored in the database. */
  static fromScaled(scaled: bigint | number): Quantity {
    return new Quantity(BigInt(scaled));
  }

  plus(other: Quantity): Quantity {
    return new Quantity(this.scaled + other.scaled);
  }

  minus(other: Quantity): Quantity {
    return new Quantity(this.scaled - other.scaled);
  }

  negated(): Quantity {
    return new Quantity(-this.scaled);
  }

  get isZero(): boolean {
    return this.scaled === 0n;
  }

  get isPositive(): boolean {
    return this.scaled > 0n;
  }

  get isNegative(): boolean {
    return this.scaled < 0n;
  }

  compareTo(other: Quantity): -1 | 0 | 1 {
    if (this.scaled < other.scaled) return -1;
    if (this.scaled > other.scaled) return 1;
    return 0;
  }

  isGreaterThan(other: Quantity): boolean {
    return this.scaled > other.scaled;
  }

  static min(a: Quantity, b: Quantity): Quantity {
    return a.scaled <= b.scaled ? a : b;
  }

  static sum(quantities: readonly Quantity[]): Quantity {
    return quantities.reduce((total, quantity) => total.plus(quantity), Quantity.ZERO);
  }

  /**
   * Multiplies a per-unit price by this quantity.
   *
   * Lives here rather than on `Money` so that `Money` never needs to know about
   * unit scaling, and so every `units × price` in the app rounds identically.
   */
  valueAt(pricePerUnit: Money, mode: RoundingMode = "HALF_UP"): Money {
    return pricePerUnit.timesRatio(this.scaled, QUANTITY_FACTOR, mode);
  }

  /** This quantity's share of `amount`, given a total quantity. */
  shareOf(amount: Money, total: Quantity, mode: RoundingMode = "HALF_UP"): Money {
    if (total.isZero) return Money.zero(amount.currency);
    return amount.timesRatio(this.scaled, total.scaled, mode);
  }

  /** For the `INTEGER` database column. */
  toScaledNumber(): number {
    return Number(this.scaled);
  }

  /** Trimmed decimal text: `"123.45678901"`, `"10"`. */
  toDecimalString(): string {
    const sign = this.scaled < 0n ? "-" : "";
    const absolute = this.scaled < 0n ? -this.scaled : this.scaled;
    const whole = absolute / QUANTITY_FACTOR;
    const fraction = (absolute % QUANTITY_FACTOR).toString().padStart(QUANTITY_SCALE, "0").replace(/0+$/, "");
    return fraction ? `${sign}${whole}.${fraction}` : `${sign}${whole}`;
  }

  /** Approximate float, for charts and display only. */
  toApproximateNumber(): number {
    return Number(this.scaled) / Number(QUANTITY_FACTOR);
  }

  protected components(): readonly unknown[] {
    return [this.scaled];
  }

  toString(): string {
    return this.toDecimalString();
  }

  toJSON(): string {
    return this.toDecimalString();
  }
}

/* ─── Percentage ─────────────────────────────────────────────── */

/** Decimal places retained on a percentage. */
const PERCENT_SCALE = 6;
const PERCENT_FACTOR = pow10(PERCENT_SCALE);
/** Denominator for `percent → fraction`: 100 × 10^PERCENT_SCALE. */
const PERCENT_DENOMINATOR = 100n * PERCENT_FACTOR;

/**
 * A percentage, exact to six decimal places.
 *
 * Indian statutory charges are quoted at awkward precisions — SEBI's turnover fee
 * is 0.0001%, the exchange transaction charge is 0.00297% — so a two-decimal rate
 * type would silently zero them out. Rates are stored as percentages rather than
 * fractions because that is how the source documents quote them, which makes the
 * regime definitions checkable against the originals by eye.
 */
export class Percentage extends ValueObject {
  private constructor(readonly scaled: bigint) {
    super();
  }

  static readonly ZERO = new Percentage(0n);

  /** `Percentage.of("12.5")` is 12.5%, not 1250%. */
  static of(percent: string | number): Percentage {
    const text = typeof percent === "number" ? percent.toFixed(PERCENT_SCALE) : percent.trim();
    const match = /^-?(\d+)(?:\.(\d+))?$/.exec(text);
    if (!match) {
      throw new TypeError(`Not a valid percentage: ${JSON.stringify(percent)}`);
    }
    const [, whole, fraction = ""] = match;
    if (fraction.length > PERCENT_SCALE) {
      throw new RangeError(
        `Percentage supports at most ${PERCENT_SCALE} decimal places, got "${text}"`,
      );
    }
    const scaled = BigInt(whole + fraction.padEnd(PERCENT_SCALE, "0"));
    return new Percentage(text.startsWith("-") ? -scaled : scaled);
  }

  /** From basis points: 25 bps → 0.25%. */
  static fromBasisPoints(basisPoints: number): Percentage {
    return new Percentage((BigInt(basisPoints) * PERCENT_FACTOR) / 100n);
  }

  static fromScaled(scaled: bigint | number): Percentage {
    return new Percentage(BigInt(scaled));
  }

  /**
   * Applies this rate to an amount, e.g. `Percentage.of("18").applyTo(brokerage)`
   * for GST. Statutory charges conventionally round up, hence the mode argument.
   */
  applyTo(amount: Money, mode: RoundingMode = "HALF_UP"): Money {
    return amount.timesRatio(this.scaled, PERCENT_DENOMINATOR, mode);
  }

  /** The proportion `part / whole`, as a percentage. Zero whole → 0%. */
  static ratio(part: Money, whole: Money): Percentage {
    if (whole.isZero) return Percentage.ZERO;
    return new Percentage((part.minor * PERCENT_DENOMINATOR) / whole.minor);
  }

  plus(other: Percentage): Percentage {
    return new Percentage(this.scaled + other.scaled);
  }

  get isZero(): boolean {
    return this.scaled === 0n;
  }

  get isNegative(): boolean {
    return this.scaled < 0n;
  }

  compareTo(other: Percentage): -1 | 0 | 1 {
    if (this.scaled < other.scaled) return -1;
    if (this.scaled > other.scaled) return 1;
    return 0;
  }

  toScaledNumber(): number {
    return Number(this.scaled);
  }

  /** Approximate float percent, for charts and display: `12.5`. */
  toApproximateNumber(): number {
    return Number(this.scaled) / Number(PERCENT_FACTOR);
  }

  /** `"12.50"` — rounded for display, with a fixed number of decimals. */
  toFixed(decimals = 2): string {
    return this.toApproximateNumber().toFixed(decimals);
  }

  protected components(): readonly unknown[] {
    return [this.scaled];
  }

  toString(): string {
    return `${this.toFixed()}%`;
  }
}

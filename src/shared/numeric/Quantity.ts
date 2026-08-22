import { ValueObject } from "@/shared/kernel/ValueObject";
import { Money } from "@/shared/money/Money";
import { divideRounded, pow10, type RoundingMode } from "@/shared/money/rounding";

/** Decimal places retained for unit counts. */
const SCALE = 8;
const SCALE_FACTOR = pow10(SCALE);
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
    const scaled = BigInt(whole + fraction.padEnd(SCALE, "0"));
    const excessDigits = Math.max(0, fraction.length - SCALE);
    const magnitude =
      excessDigits === 0 ? scaled : divideRounded(scaled, pow10(excessDigits), "HALF_UP");

    return new Quantity(text.startsWith("-") ? -magnitude : magnitude);
  }

  static fromNumber(value: number): Quantity {
    if (!Number.isFinite(value)) {
      throw new TypeError(`Not a finite quantity: ${value}`);
    }
    return Quantity.fromString(value.toFixed(SCALE));
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
    return pricePerUnit.timesRatio(this.scaled, SCALE_FACTOR, mode);
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
    const whole = absolute / SCALE_FACTOR;
    const fraction = (absolute % SCALE_FACTOR).toString().padStart(SCALE, "0").replace(/0+$/, "");
    return fraction ? `${sign}${whole}.${fraction}` : `${sign}${whole}`;
  }

  /** Approximate float, for charts and display only. */
  toApproximateNumber(): number {
    return Number(this.scaled) / Number(SCALE_FACTOR);
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

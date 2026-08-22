import { ValueObject } from "@/shared/kernel/ValueObject";
import { Currency } from "./Currency";
import { divideRounded, pow10, type RoundingMode } from "./rounding";

const DECIMAL_PATTERN = /^-?(\d+)(?:\.(\d+))?$/;

/**
 * An exact monetary amount, stored as an integer count of minor units (paise for
 * INR) in a `bigint`.
 *
 * This exists because v1 stored money in JS numbers, where `0.1 + 0.2` is
 * `0.30000000000000004` and a long run of postings quietly stops summing to
 * zero. A `bigint` of paise is exact for every value the app can hold, and it is
 * also what goes into the database — the column is an `INTEGER`, so no
 * conversion can lose precision on the way in or out.
 *
 * Immutable: every operation returns a new `Money`.
 *
 * @example
 * const price = Money.fromRupees("1500.00");
 * const total = price.times(10).plus(Money.fromRupees("23.60"));
 * total.toDecimalString();  // "15023.60"
 */
export class Money extends ValueObject {
  private constructor(
    readonly minor: bigint,
    readonly currency: Currency,
  ) {
    super();
  }

  // ── Construction ────────────────────────────────────────────────────────────

  static zero(currency: Currency = Currency.reporting): Money {
    return new Money(0n, currency);
  }

  /** From a raw count of minor units — the form stored in the database. */
  static fromMinor(
    minor: bigint | number,
    currency: Currency = Currency.reporting,
  ): Money {
    if (typeof minor === "number") {
      if (!Number.isSafeInteger(minor)) {
        throw new TypeError(
          `Money.fromMinor needs a safe integer, received ${minor}. ` +
            `Use a bigint, or Money.fromRupees for a decimal amount.`,
        );
      }
      return new Money(BigInt(minor), currency);
    }
    return new Money(minor, currency);
  }

  /**
   * From a major-unit amount: `"1240.50"` → 124050 paise.
   *
   * Strings are parsed exactly. Numbers are accepted for convenience but are
   * routed through their decimal representation, and anything with more decimal
   * places than the currency allows is rounded half-up rather than truncated
   * silently.
   */
  static fromRupees(
    amount: string | number,
    currency: Currency = Currency.reporting,
  ): Money {
    const text = typeof amount === "number" ? Money.numberToDecimalString(amount) : amount.trim();
    const match = DECIMAL_PATTERN.exec(text);
    if (!match) {
      throw new TypeError(`Not a decimal amount: ${JSON.stringify(amount)}`);
    }

    const isNegative = text.startsWith("-");
    const [, whole, fraction = ""] = match;

    // Scale to minor units, keeping one extra digit to decide the rounding.
    const scaled = BigInt(whole + fraction.padEnd(currency.exponent, "0"));
    const excessDigits = Math.max(0, fraction.length - currency.exponent);
    const magnitude =
      excessDigits === 0
        ? scaled
        : divideRounded(scaled, pow10(excessDigits), "HALF_UP");

    return new Money(isNegative ? -magnitude : magnitude, currency);
  }

  private static numberToDecimalString(value: number): string {
    if (!Number.isFinite(value)) {
      throw new TypeError(`Not a finite amount: ${value}`);
    }
    // toFixed(20) then trim avoids exponential notation for very small numbers.
    return value.toFixed(20).replace(/0+$/, "").replace(/\.$/, "");
  }

  /** Sums amounts, requiring at least one so the currency is unambiguous. */
  static sum(first: Money, ...rest: readonly Money[]): Money {
    return rest.reduce((total, amount) => total.plus(amount), first);
  }

  /** Sums a possibly-empty list; falls back to zero in the given currency. */
  static total(
    amounts: readonly Money[],
    currency: Currency = Currency.reporting,
  ): Money {
    return amounts.reduce((sum, amount) => sum.plus(amount), Money.zero(currency));
  }

  // ── Arithmetic ──────────────────────────────────────────────────────────────

  plus(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.minor + other.minor, this.currency);
  }

  minus(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.minor - other.minor, this.currency);
  }

  /** Scales by an exact integer — e.g. a price by a whole share count. */
  times(factor: bigint | number): Money {
    if (typeof factor === "number" && !Number.isInteger(factor)) {
      throw new TypeError(
        `Money.times needs an integer factor (got ${factor}). ` +
          `Use timesRatio for a fractional multiplier so the rounding is explicit.`,
      );
    }
    return new Money(this.minor * BigInt(factor), this.currency);
  }

  /**
   * Scales by the exact rational `numerator / denominator`.
   *
   * This is the only way to apply a fractional multiplier, and the rounding mode
   * is required — fractional unit counts (mutual fund units), percentage-based
   * statutory charges and tax rates all land here, and each wants its rounding
   * stated rather than assumed.
   */
  timesRatio(
    numerator: bigint,
    denominator: bigint,
    mode: RoundingMode = "HALF_UP",
  ): Money {
    return new Money(
      divideRounded(this.minor * numerator, denominator, mode),
      this.currency,
    );
  }

  dividedBy(divisor: bigint | number, mode: RoundingMode = "HALF_UP"): Money {
    return this.timesRatio(1n, BigInt(divisor), mode);
  }

  negated(): Money {
    return new Money(-this.minor, this.currency);
  }

  abs(): Money {
    return this.minor < 0n ? this.negated() : this;
  }

  /**
   * Splits the amount into parts proportional to `weights`, distributing the
   * leftover minor units to the largest remainders first.
   *
   * The parts always sum back to the original exactly — no paisa is created or
   * lost, which a naive per-part rounding would do.
   *
   * @example
   * Money.fromRupees("1.00").allocate([1, 1, 1])
   * // ₹0.34, ₹0.33, ₹0.33
   */
  allocate(weights: readonly number[]): Money[] {
    if (weights.length === 0) {
      throw new RangeError("allocate needs at least one weight");
    }
    if (weights.some((weight) => weight < 0)) {
      throw new RangeError("allocate weights must not be negative");
    }

    const asBigInt = weights.map((weight) => BigInt(Math.round(weight * 1e6)));
    const totalWeight = asBigInt.reduce((sum, weight) => sum + weight, 0n);
    if (totalWeight === 0n) {
      throw new RangeError("allocate weights must not all be zero");
    }

    const shares = asBigInt.map((weight) => (this.minor * weight) / totalWeight);
    const distributed = shares.reduce((sum, share) => sum + share, 0n);
    let leftover = this.minor - distributed;

    // Hand out the remaining units to the largest fractional remainders.
    const byRemainderDesc = asBigInt
      .map((weight, index) => ({
        index,
        remainder: (this.minor * weight) % totalWeight,
      }))
      .sort((a, b) => (b.remainder > a.remainder ? 1 : b.remainder < a.remainder ? -1 : 0));

    const step = leftover < 0n ? -1n : 1n;
    for (const { index } of byRemainderDesc) {
      if (leftover === 0n) break;
      shares[index] += step;
      leftover -= step;
    }

    return shares.map((share) => new Money(share, this.currency));
  }

  // ── Comparison ──────────────────────────────────────────────────────────────

  get isZero(): boolean {
    return this.minor === 0n;
  }

  get isPositive(): boolean {
    return this.minor > 0n;
  }

  get isNegative(): boolean {
    return this.minor < 0n;
  }

  /** -1, 0 or 1 — suitable for `Array.prototype.sort`. */
  compareTo(other: Money): -1 | 0 | 1 {
    this.assertSameCurrency(other);
    if (this.minor < other.minor) return -1;
    if (this.minor > other.minor) return 1;
    return 0;
  }

  isGreaterThan(other: Money): boolean {
    return this.compareTo(other) > 0;
  }

  isLessThan(other: Money): boolean {
    return this.compareTo(other) < 0;
  }

  isGreaterThanOrEqual(other: Money): boolean {
    return this.compareTo(other) >= 0;
  }

  // ── Conversion ──────────────────────────────────────────────────────────────

  /** For the `INTEGER` database column. */
  toMinorNumber(): number {
    if (this.minor > BigInt(Number.MAX_SAFE_INTEGER) || this.minor < BigInt(Number.MIN_SAFE_INTEGER)) {
      throw new RangeError(`${this.toDecimalString()} exceeds the safe integer range`);
    }
    return Number(this.minor);
  }

  /** Exact decimal text: `"15023.60"`. Round-trips through `fromRupees`. */
  toDecimalString(): string {
    const sign = this.minor < 0n ? "-" : "";
    const absolute = this.minor < 0n ? -this.minor : this.minor;
    const divisor = this.currency.minorUnitsPerMajor;
    const whole = absolute / divisor;
    const fraction = absolute % divisor;
    if (this.currency.exponent === 0) return `${sign}${whole}`;
    return `${sign}${whole}.${fraction.toString().padStart(this.currency.exponent, "0")}`;
  }

  /**
   * Approximate float, for charting libraries and `Intl` formatting only.
   * Never feed this back into a calculation.
   */
  toApproximateNumber(): number {
    return Number(this.minor) / Number(this.currency.minorUnitsPerMajor);
  }

  protected components(): readonly unknown[] {
    return [this.minor, this.currency];
  }

  toString(): string {
    return `${this.currency.code} ${this.toDecimalString()}`;
  }

  toJSON(): { minor: string; currency: string } {
    return { minor: this.minor.toString(), currency: this.currency.code };
  }

  private assertSameCurrency(other: Money): void {
    if (this.currency.code !== other.currency.code) {
      throw new TypeError(
        `Cannot combine ${this.currency.code} with ${other.currency.code}. ` +
          `Convert one of them first.`,
      );
    }
  }
}

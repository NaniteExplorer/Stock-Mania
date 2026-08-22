import { ValueObject } from "@/shared/kernel/ValueObject";
import type { Money } from "@/shared/money/Money";
import { pow10, type RoundingMode } from "@/shared/money/rounding";

/** Decimal places retained on a percentage. */
const SCALE = 6;
const SCALE_FACTOR = pow10(SCALE);
/** Denominator for `percent → fraction`: 100 × 10^SCALE. */
const PERCENT_DENOMINATOR = 100n * SCALE_FACTOR;

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
    const text = typeof percent === "number" ? percent.toFixed(SCALE) : percent.trim();
    const match = /^-?(\d+)(?:\.(\d+))?$/.exec(text);
    if (!match) {
      throw new TypeError(`Not a valid percentage: ${JSON.stringify(percent)}`);
    }
    const [, whole, fraction = ""] = match;
    if (fraction.length > SCALE) {
      throw new RangeError(
        `Percentage supports at most ${SCALE} decimal places, got "${text}"`,
      );
    }
    const scaled = BigInt(whole + fraction.padEnd(SCALE, "0"));
    return new Percentage(text.startsWith("-") ? -scaled : scaled);
  }

  /** From basis points: 25 bps → 0.25%. */
  static fromBasisPoints(basisPoints: number): Percentage {
    return new Percentage((BigInt(basisPoints) * SCALE_FACTOR) / 100n);
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
    return Number(this.scaled) / Number(SCALE_FACTOR);
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

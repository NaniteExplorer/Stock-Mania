/**
 * Money — exact integer minor units, and the rounding rules that go with it.
 *
 * Consolidated from `src/shared/money/`. Rounding comes first because both
 * Currency and Money depend on it; nothing here depends on anything outside
 * `core/kernel`.
 *
 * No `number` appears on a money path. `times()` takes an integer only, and any
 * fractional operation demands an explicit RoundingMode at the call site.
 */

import { ValueObject } from "./kernel";

/* ─── Rounding ─────────────────────────────────────────────── */

/**
 * Exact integer division with an explicit rounding rule.
 *
 * All money arithmetic that is not closed over integers — a percentage of an
 * amount, a price times a fractional unit count, splitting a bill three ways —
 * funnels through here. Making the rounding rule a required, named argument is
 * deliberate: silent rounding is how ledgers end up off by a paisa, and the
 * right rule genuinely differs by context (statutory charges round up, splits
 * round half-up, interest accrual rounds half-even).
 */
export type RoundingMode =
  /** Toward zero (truncate). */
  | "DOWN"
  /** Away from zero. */
  | "UP"
  /** Nearest; exact halves go away from zero. The usual rule for money. */
  | "HALF_UP"
  /** Nearest; exact halves go to the even neighbour. Avoids upward bias. */
  | "HALF_EVEN";

/**
 * The rounding rule for each place money gets rounded, named once.
 *
 * The required `mode` argument already makes rounding explicit at every call
 * site. This goes a step further: a caller names the *reason* rather than the
 * mode, so the decision lives in one place and the same context cannot round two
 * different ways in two different files.
 *
 * `30-CALCULATIONS.md` §1.2 proposes HALF_EVEN as the house standard with HALF_UP
 * where a tax authority mandates it. For Indian practice that inverts for most of
 * these — statutory charges and tax computation are HALF_UP — so the split is
 * recorded per context rather than as a default plus a list of exceptions.
 */
export const ROUNDING = {
  /** Tax computation. HALF_UP, per Indian practice. */
  tax: "HALF_UP",
  /** Brokerage, STT, exchange fees, stamp duty. HALF_UP. */
  charge: "HALF_UP",
  /** Splitting a total across lots or categories — see `Money.allocate`. */
  allocation: "HALF_UP",
  /** Interest accrual, where HALF_EVEN avoids a systematic upward drift. */
  interest: "HALF_EVEN",
  /** Marking a position to market, for the same reason. */
  valuation: "HALF_EVEN",
  /** Converting between currencies at a recorded rate. */
  fx: "HALF_EVEN",
} as const satisfies Record<string, RoundingMode>;

export type RoundingContext = keyof typeof ROUNDING;

/**
 * Divides `numerator` by `denominator`, returning an integer rounded per `mode`.
 * Sign is handled symmetrically: the magnitude is rounded, then the sign
 * reapplied, so `-5/2` and `5/2` round to the same magnitude.
 */
export function divideRounded(
  numerator: bigint,
  denominator: bigint,
  mode: RoundingMode,
): bigint {
  if (denominator === 0n) {
    throw new RangeError("Division by zero");
  }

  const isNegative = numerator < 0n !== denominator < 0n;
  const absNumerator = numerator < 0n ? -numerator : numerator;
  const absDenominator = denominator < 0n ? -denominator : denominator;

  const quotient = absNumerator / absDenominator;
  const remainder = absNumerator % absDenominator;

  if (remainder === 0n) return isNegative ? -quotient : quotient;

  const magnitude = roundMagnitude(quotient, remainder, absDenominator, mode);
  return isNegative ? -magnitude : magnitude;
}

function roundMagnitude(
  quotient: bigint,
  remainder: bigint,
  denominator: bigint,
  mode: RoundingMode,
): bigint {
  switch (mode) {
    case "DOWN":
      return quotient;
    case "UP":
      return quotient + 1n;
    case "HALF_UP":
      return remainder * 2n >= denominator ? quotient + 1n : quotient;
    case "HALF_EVEN": {
      const doubled = remainder * 2n;
      if (doubled > denominator) return quotient + 1n;
      if (doubled < denominator) return quotient;
      // Exactly half — pick the even neighbour.
      return quotient % 2n === 0n ? quotient : quotient + 1n;
    }
  }
}

/** 10 raised to a non-negative integer power, as a bigint. */
export function pow10(exponent: number): bigint {
  if (!Number.isInteger(exponent) || exponent < 0) {
    throw new RangeError(`pow10 needs a non-negative integer, got ${exponent}`);
  }
  return 10n ** BigInt(exponent);
}

/* ─── Currency ─────────────────────────────────────────────── */

/**
 * A currency, defined by its ISO 4217 code and how many decimal places it has.
 *
 * The `exponent` is what lets {@link Money} store an exact integer: INR has
 * exponent 2, so ₹12.40 is 1240 paise. Currencies genuinely differ here (JPY is
 * 0, KWD is 3), so it cannot be hardcoded to 2.
 */
export class Currency extends ValueObject {
  private constructor(
    readonly code: string,
    readonly exponent: number,
    readonly symbol: string,
    /** BCP 47 locale used to format amounts in this currency. */
    readonly locale: string,
  ) {
    super();
  }

  /** Number of minor units in one major unit — 100 for INR. */
  get minorUnitsPerMajor(): bigint {
    return pow10(this.exponent);
  }

  protected components(): readonly unknown[] {
    return [this.code];
  }

  toString(): string {
    return this.code;
  }

  static readonly INR = new Currency("INR", 2, "₹", "en-IN");
  static readonly USD = new Currency("USD", 2, "$", "en-US");

  private static readonly REGISTRY: ReadonlyMap<string, Currency> = new Map([
    [Currency.INR.code, Currency.INR],
    [Currency.USD.code, Currency.USD],
  ]);

  /** The app's reporting currency — every total is expressed in this. */
  static get reporting(): Currency {
    return Currency.INR;
  }

  /** Resolves a stored currency code. Throws on an unknown code rather than guessing. */
  static of(code: string): Currency {
    const currency = Currency.REGISTRY.get(code.toUpperCase());
    if (!currency) {
      throw new RangeError(
        `Unsupported currency "${code}". Add it to Currency.REGISTRY to use it.`,
      );
    }
    return currency;
  }

  static all(): readonly Currency[] {
    return [...Currency.REGISTRY.values()];
  }
}

/* ─── Money ─────────────────────────────────────────────── */

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
  allocate(weights: readonly (number | bigint)[]): Money[] {
    if (weights.length === 0) {
      throw new RangeError("allocate needs at least one weight");
    }
    if (weights.some((weight) => weight < 0)) {
      throw new RangeError("allocate weights must not be negative");
    }

    /*
     * `bigint` weights pass through untouched; numbers are scaled by 1e6 to keep
     * six decimal places of a fractional weight.
     *
     * Accepting bigint was added in Phase 5: a lot allocation weights by scaled
     * unit counts, and `Number(quantity.scaled)` on a large holding is exactly the
     * silent precision loss the float rules exist to prevent. A weight only has to
     * be proportionally right, so an exact integer is strictly better than a
     * rounded double.
     */
    const asBigInt = weights.map((weight) =>
      typeof weight === "bigint" ? weight : BigInt(Math.round(weight * 1e6)),
    );
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

  /**
   * Present because its absence forces `!a.isGreaterThan(b)` at call sites, and
   * inverted comparisons on a boundary are where off-by-one lot-consumption bugs
   * live — "consume while remaining <= available" is the shape the lot book wants.
   */
  isLessThanOrEqual(other: Money): boolean {
    return this.compareTo(other) <= 0;
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

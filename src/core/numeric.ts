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
import { Currency, Money, divideRounded, pow10, type RoundingMode } from "./money";

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

  /**
   * The inverse of {@link valueAt}: the per-unit price implied by spreading
   * `amount` over this quantity.
   *
   * Here rather than at the call site for the same reason `valueAt` is: dividing a
   * cost basis by a unit count needs the scale factor, and a caller that reaches
   * for the scale factor eventually reaches for it with the wrong number of zeros.
   */
  perUnit(amount: Money, mode: RoundingMode = "HALF_UP"): Money {
    if (this.isZero) {
      throw new RangeError("Cannot spread an amount over zero units");
    }
    return amount.timesRatio(QUANTITY_FACTOR, this.scaled, mode);
  }

  /**
   * An exact ratio as a quantity — how many of `this` there are per one of
   * `other`.
   *
   * The rescaling factor of a share split (5-for-1 is `5`) and the implied rate of
   * an FX conversion are both this, and both must stay exact: a float here is how
   * a split turns 100 units into 499.99999.
   */
  ratioTo(other: Quantity): Quantity {
    return Quantity.fromRatio(this.scaled, other.scaled);
  }

  /** A ratio of two integers, held to `Quantity`'s scale. */
  static fromRatio(numerator: bigint, denominator: bigint): Quantity {
    if (denominator === 0n) {
      throw new RangeError("Cannot form a ratio with a zero denominator");
    }
    return new Quantity((numerator * QUANTITY_FACTOR) / denominator);
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

/* ─── UnitPrice ──────────────────────────────────────────────── */

/**
 * A price per unit: an exact decimal to eight places, in a currency.
 *
 * **Not `Money`, and the distinction is not pedantry.** `Money` is an amount, held
 * in the currency's own minor units — two decimals for the rupee — because an
 * amount of money that is not a whole number of paise cannot exist. A *price* has
 * no such limit: AMFI publishes NAV to four decimals, a fund unit costs
 * ₹84.5612, and `Money.fromRupees("84.5612")` rounds that to ₹84.56 without
 * complaint. On a 10,000-unit holding that is ₹12 of invented value, and the
 * rounding happens at ingestion where nothing can see it.
 *
 * So a price is a rate, like {@link Rate} and unlike {@link Money}, and rounding
 * belongs at the multiplication — {@link times} — where the result really is an
 * amount of money and there is one place to state the mode.
 *
 * This is the `NUMERIC(38,18)` of `20-DOMAIN-MODEL.md` §3.8, at `Quantity`'s scale:
 * eight decimals covers every published price (four for NAV, two for equities,
 * eight for crypto) and shares `Quantity`'s factor, so `units × price` is one exact
 * integer multiplication.
 */
export class UnitPrice extends ValueObject {
  private constructor(
    readonly scaled: bigint,
    readonly currency: Currency,
  ) {
    super();
  }

  static of(value: string | number, currency: Currency = Currency.reporting): UnitPrice {
    return new UnitPrice(Quantity.fromString(typeof value === "number" ? value.toFixed(QUANTITY_SCALE) : value).scaled, currency);
  }

  /** From the stored scaled integer. Only mappers should call this. */
  static fromScaled(scaled: bigint | number, currency: Currency = Currency.reporting): UnitPrice {
    return new UnitPrice(BigInt(scaled), currency);
  }

  /** A price that happens to be a whole number of minor units. */
  static fromMoney(amount: Money): UnitPrice {
    return new UnitPrice(
      (BigInt(amount.toMinorNumber()) * QUANTITY_FACTOR) / amount.currency.minorUnitsPerMajor,
      amount.currency,
    );
  }

  get isPositive(): boolean {
    return this.scaled > 0n;
  }

  get isZero(): boolean {
    return this.scaled === 0n;
  }

  /**
   * What `quantity` units cost at this price.
   *
   * The single rounding point: `HALF_EVEN` by default because a valuation is an
   * accrual rather than a statutory charge, and repeated half-up rounding across a
   * portfolio biases the total upward.
   */
  times(quantity: Quantity, mode: RoundingMode = "HALF_EVEN"): Money {
    return Money.fromMinor(
      divideRounded(
        this.scaled * quantity.scaled * this.currency.minorUnitsPerMajor,
        QUANTITY_FACTOR * QUANTITY_FACTOR,
        mode,
      ),
      this.currency,
    );
  }

  /** The price of one unit, as money. For display, and it rounds. */
  toMoney(mode: RoundingMode = "HALF_EVEN"): Money {
    return this.times(Quantity.fromString("1"), mode);
  }

  compareTo(other: UnitPrice): -1 | 0 | 1 {
    this.assertSameCurrency(other);
    if (this.scaled < other.scaled) return -1;
    if (this.scaled > other.scaled) return 1;
    return 0;
  }

  /**
   * How far this price is from `other`, as a percentage of `other`.
   *
   * Here rather than at the call site because both the >1% vendor-divergence rule
   * and the >50% suspicious-move rule ask exactly this question, and asking it two
   * ways is how two thresholds end up meaning different things.
   */
  percentDifferenceFrom(other: UnitPrice): Percentage {
    this.assertSameCurrency(other);
    if (other.scaled === 0n) {
      throw new RangeError("Cannot express a difference as a percentage of zero");
    }
    const difference = this.scaled > other.scaled ? this.scaled - other.scaled : other.scaled - this.scaled;
    const denominator = other.scaled < 0n ? -other.scaled : other.scaled;
    return Percentage.fromScaled((difference * 100n * PERCENT_FACTOR) / denominator);
  }

  private assertSameCurrency(other: UnitPrice): void {
    if (this.currency.code !== other.currency.code) {
      throw new TypeError(
        `Cannot compare a ${this.currency.code} price with a ${other.currency.code} one`,
      );
    }
  }

  /** Trimmed decimal text: `"84.5612"`, `"1543.25"`. */
  toDecimalString(): string {
    return Quantity.fromScaled(this.scaled).toDecimalString();
  }

  /** For the `INTEGER` database column. */
  toScaledNumber(): number {
    return Number(this.scaled);
  }

  protected components(): readonly unknown[] {
    return [this.scaled, this.currency.code];
  }

  toString(): string {
    return `${this.toDecimalString()} ${this.currency.code}`;
  }

  toJSON(): { price: string; currency: string } {
    return { price: this.toDecimalString(), currency: this.currency.code };
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

/* ═══ Rate ═══════════════════════════════════════════════════════════════ */

/**
 * How a year is measured when turning an annual rate into a period accrual.
 *
 * Naming it is the point. `30-CALCULATIONS.md` §4.1 requires ACT/365F for retail
 * return reporting, and a formula that silently picks its own year length is the
 * difference between a correct XIRR and a plausible one. Indian lending quotes
 * both conventions, so both exist here and neither is a default.
 */
export type DayCount =
  /** Actual days elapsed over a fixed 365-day year. The retail convention. */
  | "ACT_365F"
  /** Actual days over 360. Money-market convention. */
  | "ACT_360"
  /** 30-day months over a 360-day year. Some loan schedules. */
  | "THIRTY_360";

const RATE_SCALE = 10;
const RATE_FACTOR = pow10(RATE_SCALE);
/** A percentage is per hundred, so a rate as a fraction divides by 100 more. */
const RATE_PERCENT_DENOMINATOR = 100n * RATE_FACTOR;

const RATE_PATTERN = /^-?(\d+)(?:\.(\d+))?$/;

/**
 * An annualised rate, exact to ten decimal places, carrying its day count.
 *
 * Separate from `Percentage` because the two answer different questions. A
 * percentage is a ratio — 18% GST applies to an amount and is done. A rate is a
 * ratio *per unit of time*, so it cannot be applied to money without also saying
 * over what period and against what year length. Conflating them is how an
 * interest figure ends up 5/365ths wrong and nobody notices.
 *
 * `accrualFactor` returns an exact bigint ratio rather than a number, so it feeds
 * `Money.timesRatio` without ever passing through a float.
 */
export class Rate extends ValueObject {
  private constructor(
    readonly scaled: bigint,
    readonly dayCount: DayCount,
  ) {
    super();
  }

  static readonly SCALE = RATE_SCALE;

  /** From a percent-per-annum figure: `Rate.annual("7.1")` is 7.1% p.a. */
  static annual(percent: string | number, dayCount: DayCount = "ACT_365F"): Rate {
    return new Rate(Rate.parseScaled(String(percent)), dayCount);
  }

  /** From a decimal fraction: `Rate.fromFraction("0.071")` is also 7.1% p.a. */
  static fromFraction(fraction: string | number, dayCount: DayCount = "ACT_365F"): Rate {
    const asPercent = Rate.parseScaled(String(fraction)) * 100n;
    return new Rate(asPercent, dayCount);
  }

  static fromBasisPoints(basisPoints: number, dayCount: DayCount = "ACT_365F"): Rate {
    if (!Number.isInteger(basisPoints)) {
      throw new TypeError(`Basis points must be a whole number, got ${basisPoints}`);
    }
    // 1bp = 0.01%
    return new Rate((BigInt(basisPoints) * RATE_FACTOR) / 100n, dayCount);
  }

  static zero(dayCount: DayCount = "ACT_365F"): Rate {
    return new Rate(0n, dayCount);
  }

  private static parseScaled(value: string): bigint {
    const trimmed = value.trim();
    const negative = trimmed.startsWith("-");
    const match = RATE_PATTERN.exec(trimmed);
    if (!match) {
      throw new TypeError(`Expected a decimal rate, got ${JSON.stringify(value)}`);
    }
    const [, whole, fraction = ""] = match;
    const padded = fraction.padEnd(RATE_SCALE, "0").slice(0, RATE_SCALE);
    const magnitude = BigInt(whole) * RATE_FACTOR + BigInt(padded || "0");
    return negative ? -magnitude : magnitude;
  }

  protected components(): readonly unknown[] {
    return [this.scaled, this.dayCount];
  }

  get isZero(): boolean {
    return this.scaled === 0n;
  }

  get isNegative(): boolean {
    return this.scaled < 0n;
  }

  /** The same rate as a percentage, for display. Truncated to Percentage's scale. */
  get percent(): Percentage {
    return Percentage.fromScaled(this.scaled / pow10(RATE_SCALE - 6));
  }

  daysInYear(): 360 | 365 {
    return this.dayCount === "ACT_365F" ? 365 : 360;
  }

  private assertSameDayCount(other: Rate): void {
    if (this.dayCount !== other.dayCount) {
      throw new TypeError(
        `Cannot combine a ${this.dayCount} rate with a ${other.dayCount} one — ` +
          "convert one explicitly, because the year lengths differ.",
      );
    }
  }

  plus(other: Rate): Rate {
    this.assertSameDayCount(other);
    return new Rate(this.scaled + other.scaled, this.dayCount);
  }

  minus(other: Rate): Rate {
    this.assertSameDayCount(other);
    return new Rate(this.scaled - other.scaled, this.dayCount);
  }

  times(factor: number): Rate {
    if (!Number.isInteger(factor)) {
      throw new TypeError(`Rate.times takes a whole factor; got ${factor}.`);
    }
    return new Rate(this.scaled * BigInt(factor), this.dayCount);
  }

  /** The per-period rate for `n` compounding periods a year — the `r` in an EMI. */
  perPeriod(periodsPerYear: number): Rate {
    if (!Number.isInteger(periodsPerYear) || periodsPerYear <= 0) {
      throw new RangeError(`periodsPerYear must be a positive whole number, got ${periodsPerYear}`);
    }
    return new Rate(this.scaled / BigInt(periodsPerYear), this.dayCount);
  }

  /**
   * The exact accrual ratio for a period, as `{ numerator, denominator }`.
   *
   * Returned as a bigint pair rather than a number so it can be handed straight
   * to `Money.timesRatio` — no float appears anywhere on the path from an annual
   * rate to an accrued amount.
   */
  accrualFactor(days: number): { numerator: bigint; denominator: bigint } {
    if (!Number.isInteger(days) || days < 0) {
      throw new RangeError(`Accrual days must be a non-negative whole number, got ${days}`);
    }
    return {
      numerator: this.scaled * BigInt(days),
      denominator: RATE_PERCENT_DENOMINATOR * BigInt(this.daysInYear()),
    };
  }

  /**
   * Days between two dates *under this rate's convention*.
   *
   * ACT/365F and ACT/360 both count actual elapsed days and differ only in the
   * denominator, which `accrualFactor` already handles. 30/360 differs in the
   * numerator too — every month counts as 30 days — so the count has to live with
   * the convention rather than being left to the caller to remember.
   */
  daysBetween(from: { year: number; month: number; day: number }, to: { year: number; month: number; day: number }): number {
    if (this.dayCount !== "THIRTY_360") {
      const asUtc = (d: { year: number; month: number; day: number }) =>
        Date.UTC(d.year, d.month - 1, d.day);
      return Math.round((asUtc(to) - asUtc(from)) / 86_400_000);
    }
    // US 30/360: both day-of-month values are capped at 30.
    const d1 = Math.min(from.day, 30);
    const d2 = from.day >= 30 ? Math.min(to.day, 30) : to.day;
    return 360 * (to.year - from.year) + 30 * (to.month - from.month) + (d2 - d1);
  }

  toString(): string {
    const label = this.dayCount === "ACT_365F" ? "ACT/365F" : this.dayCount === "ACT_360" ? "ACT/360" : "30/360";
    return `${this.percent.toFixed(4)}% p.a. ${label}`;
  }

  toJSON(): { scaled: string; dayCount: DayCount } {
    return { scaled: this.scaled.toString(), dayCount: this.dayCount };
  }
}

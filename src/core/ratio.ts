/**
 * The exact boundary between money and a dimensionless ratio.
 *
 * A ratio of two amounts — debt service over income, net worth over a year's
 * expenses — is a statistic, and statistics are floating point (`units.ts`,
 * `Ratio`). The amounts are not: `RULES.md` §1.2 keeps money in exact integer
 * minor units, and `Money.toMinorNumber()` refuses anything past 2^53 minor
 * units, which a valid ledger can hold (₹90 lakh crore is 9×10^16 paise).
 *
 * So the division happens **in BigInt**, on the minor units, and only the
 * quotient — never an amount — becomes a `number`, rounded once. No amount is
 * converted to a float, nothing is clamped, and a division by zero is refused
 * rather than turned into infinity or NaN: the caller decides what an
 * undefined ratio means (usually "unknown, with the reason").
 */

import type { Money } from "./money";
import { Ratio } from "./units";

const abs = (value: bigint): bigint => (value < 0n ? -value : value);
const bitLength = (value: bigint): number => (value === 0n ? 0 : value.toString(2).length);

/** Bits a double keeps (53) plus guard bits taken before the one rounding. */
const TARGET_BITS = 55;
/** Exponent of the smallest normal double; below it the significand narrows. */
const MIN_NORMAL_EXPONENT = -1022;

/**
 * `numerator ÷ denominator` as a `Ratio`, from exact integers.
 *
 * The quotient is taken in binary: the operands are shifted so the integer
 * quotient carries at least 55 significant bits, the bits below the double's
 * significand (53 bits, fewer for a subnormal) plus the division remainder
 * decide the rounding — half-to-even, with the remainder as the sticky bit. So
 * the result is the correctly rounded nearest double for any operand size,
 * with no intermediate decimal rounding. Throws on a zero denominator, and
 * (through `Ratio`) on a quotient too large for a double.
 */
export function exactRatio(numerator: bigint, denominator: bigint): Ratio {
  if (denominator === 0n) throw new RangeError("A ratio needs a non-zero denominator.");
  if (numerator === 0n) return Ratio(0);
  const negative = (numerator < 0n) !== (denominator < 0n);
  const top = abs(numerator);
  const bottom = abs(denominator);
  // shift > 0 scales the numerator up; shift < 0 scales the denominator up.
  const shift = TARGET_BITS - (bitLength(top) - bitLength(bottom));
  const n = shift >= 0 ? top << BigInt(shift) : top;
  const d = shift >= 0 ? bottom : bottom << BigInt(-shift);
  const quotient = n / d;
  const inexact = n % d !== 0n;
  const qBits = bitLength(quotient); // 55 or 56
  const exponent = qBits - 1 - shift; // floor(log2 of the true quotient)
  let dropped = qBits - 53;
  if (exponent < MIN_NORMAL_EXPONENT) dropped += MIN_NORMAL_EXPONENT - exponent;
  const drop = BigInt(dropped);
  let significand = quotient >> drop;
  const rest = quotient - (significand << drop);
  const half = 1n << (drop - 1n);
  if (rest > half || (rest === half && (inexact || (significand & 1n) === 1n))) significand += 1n;
  // significand ≤ 2^53 is exact as a number; the power of two is exact unless it overflows.
  const magnitude = Number(significand) * 2 ** (dropped - shift);
  return Ratio(negative ? -magnitude : magnitude);
}

/**
 * `part ÷ whole` for two amounts in one currency, exactly (see `exactRatio`).
 * Refuses mixed currencies and a zero whole; it never converts either amount to
 * a float.
 */
export function moneyRatio(part: Money, whole: Money): Ratio {
  if (part.currency.code !== whole.currency.code) {
    throw new RangeError(`A ratio of amounts needs one currency, got ${part.currency.code} and ${whole.currency.code}.`);
  }
  if (whole.isZero) throw new RangeError("A ratio of amounts needs a non-zero whole.");
  return exactRatio(part.minor, whole.minor);
}

/**
 * Compares two fractions `a/b` and `c/d` exactly. Denominators must be
 * positive. For ordering ratios of amounts without rounding either.
 */
export function compareFractions(a: bigint, b: bigint, c: bigint, d: bigint): -1 | 0 | 1 {
  if (b <= 0n || d <= 0n) throw new RangeError("compareFractions needs positive denominators.");
  const left = a * d;
  const right = c * b;
  return left < right ? -1 : left > right ? 1 : 0;
}

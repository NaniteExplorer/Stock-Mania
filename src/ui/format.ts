import { Money } from "@/shared/money/Money";
import { Percentage } from "@/shared/numeric/Percentage";

/**
 * Money and percentage formatting for the UI.
 *
 * Every function here takes a `Money` or a `Percentage` — never a `number`. v1's
 * equivalents in `lib/utils.ts` took floats, which is how an inexact figure
 * reached the screen in the first place. `Money.toDecimalString()` is exact, so
 * formatting starts from an exact decimal string and only ever groups digits.
 *
 * The Indian digit grouping (lakh/crore) is what `en-IN` gives us for free.
 */

const INR_COMPACT_UNITS = [
  { limit: 10_000_000n, suffix: "Cr", divisor: 10_000_000n },
  { limit: 100_000n, suffix: "L", divisor: 100_000n },
  { limit: 1_000n, suffix: "K", divisor: 1_000n },
] as const;

const grouped = (digits: string): string =>
  new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(BigInt(digits));

/** `₹15,023.60` — full precision, grouped Indian-style. */
export function formatMoney(value: Money, fractionDigits = 2): string {
  const decimal = value.toDecimalString();
  const negative = decimal.startsWith("-");
  const [whole, fraction = ""] = decimal.replace("-", "").split(".");
  const body =
    fractionDigits > 0
      ? `${grouped(whole)}.${fraction.padEnd(fractionDigits, "0").slice(0, fractionDigits)}`
      : grouped(whole);
  return `${negative ? "-" : ""}${value.currency.symbol}${body}`;
}

/**
 * `₹2.48Cr` — for headline figures where the exact paise would be noise.
 *
 * Rounds toward zero on the major unit, so a compact figure never reads as more
 * money than there is.
 */
export function formatMoneyCompact(value: Money): string {
  const symbol = value.currency.symbol;
  const negative = value.isNegative;
  const major = BigInt(value.abs().toDecimalString().split(".")[0]);

  for (const { limit, suffix, divisor } of INR_COMPACT_UNITS) {
    if (major >= limit) {
      // One decimal place, truncated rather than rounded.
      const tenths = (major * 10n) / divisor;
      const text = `${tenths / 10n}.${tenths % 10n}${suffix}`;
      return `${negative ? "-" : ""}${symbol}${text.replace(".0", "")}`;
    }
  }
  return `${negative ? "-" : ""}${symbol}${grouped(major.toString())}`;
}

/** `+₹3.42L` / `-₹1.2K` — always carries an explicit sign. */
export function formatMoneySignedCompact(value: Money): string {
  const body = formatMoneyCompact(value.abs());
  if (value.isZero) return body;
  return `${value.isNegative ? "-" : "+"}${body}`;
}

/** `+12.50%` — always carries an explicit sign. */
export function formatPercentSigned(value: Percentage, decimals = 2): string {
  const text = value.toFixed(decimals);
  return text.startsWith("-") ? `${text}%` : `+${text}%`;
}

/** `12.50%` */
export function formatPercent(value: Percentage, decimals = 2): string {
  return `${value.toFixed(decimals)}%`;
}

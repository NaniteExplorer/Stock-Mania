import { type Money, divideRounded, pow10 } from "./money";
import type { Percentage } from "./numeric";

declare const figure: unique symbol;

/** A display figure produced by this module, rather than arbitrary page text. */
export type Figure = string & { readonly [figure]: true };
export type Unknown = { readonly kind: "unknown"; readonly reason: string };
export type FigureValue = Figure | Unknown;

export interface FigureParts {
  readonly sign: string;
  readonly currency: string;
  readonly amount: string;
  readonly unit: string;
}

/** Split display text without parsing its magnitude or changing a single character. */
export function figureParts(value: Figure): FigureParts {
  const sign = value.startsWith("+") || value.startsWith("−") ? value.slice(0, 1) : "";
  const body = value.slice(sign.length);
  const parts = /^([^0-9]*)([0-9][0-9,.]*)(.*)$/u.exec(body);
  if (!parts) throw new Error("A formatted figure must contain display digits");
  return { sign, currency: parts[1], amount: parts[2], unit: parts[3] };
}

const formatted = (value: string): Figure => value as Figure;

/** Unavailable is a value with an explanation, never a formatted zero. */
export function unknown(reason: string): Unknown {
  if (!reason.trim()) throw new Error("An unknown figure requires a specific reason");
  return Object.freeze({ kind: "unknown", reason });
}

const MINUS = "−";
const GROUPS = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });
const COMPACT_UNITS = [
  { major: 10_000_000n, suffix: "Cr" },
  { major: 100_000n, suffix: "L" },
  { major: 1_000n, suffix: "K" },
] as const;

function checkDecimals(decimals: number): void {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 20) {
    throw new RangeError("Display decimal places must be an integer from 0 to 20");
  }
}

/** Format an unsigned integer already scaled to the requested display precision. */
function fixed(magnitude: bigint, decimals: number): string {
  const factor = pow10(decimals);
  const whole = GROUPS.format(magnitude / factor);
  return decimals === 0
    ? whole
    : `${whole}.${(magnitude % factor).toString().padStart(decimals, "0")}`;
}

function moneyDisplay(value: Money, decimals: number): { body: string; nonzero: boolean } {
  checkDecimals(decimals);
  const magnitude = value.minor < 0n ? -value.minor : value.minor;
  // Display precision truncates toward zero, including when paise are hidden.
  const shown = magnitude * pow10(decimals) / value.currency.minorUnitsPerMajor;
  return { body: `${value.currency.symbol}${fixed(shown, decimals)}`, nonzero: shown !== 0n };
}

/** Indian grouping and exact decimal digits; retains the Money currency's symbol. */
export function rupee(value: Money, fractionDigits = 2): Figure {
  const display = moneyDisplay(value, fractionDigits);
  return formatted(`${value.minor < 0n && display.nonzero ? MINUS : ""}${display.body}`);
}

/** Two decimal places by default, truncated toward zero; K/L/Cr use Indian magnitude units. */
export function compact(value: Money, decimals = 2): Figure {
  checkDecimals(decimals);
  const magnitude = value.minor < 0n ? -value.minor : value.minor;
  for (const unit of COMPACT_UNITS) {
    const divisor = unit.major * value.currency.minorUnitsPerMajor;
    if (magnitude >= divisor) {
      const scaled = magnitude * pow10(decimals) / divisor;
      return formatted(`${value.minor < 0n ? MINUS : ""}${value.currency.symbol}${fixed(scaled, decimals)}${unit.suffix}`);
    }
  }
  return rupee(value);
}

/**
 * A whole count (holdings, accounts, days, bars) with Indian grouping. A unit is
 * appended after a space ("1,20,000 units"). Fractions are refused: a count that
 * is not whole is a quantity and belongs to a Decimal-aware formatter.
 */
export function count(value: number | bigint, unit?: string): Figure {
  if (typeof value === "number" && !Number.isSafeInteger(value)) {
    throw new RangeError("A count must be a safe integer");
  }
  const whole = BigInt(value);
  const magnitude = whole < 0n ? -whole : whole;
  return formatted(`${whole < 0n ? MINUS : ""}${GROUPS.format(magnitude)}${unit ? ` ${unit}` : ""}`);
}

/** Percentage points, rounded HALF_UP in bigint; Percentage retains six decimal places. */
export function percentage(value: Percentage, decimals = 2): Figure {
  checkDecimals(decimals);
  const magnitude = value.scaled < 0n ? -value.scaled : value.scaled;
  const shown = divideRounded(magnitude * pow10(decimals), 1_000_000n, "HALF_UP");
  return formatted(`${value.scaled < 0n && shown !== 0n ? MINUS : ""}${fixed(shown, decimals)}%`);
}

export interface SignedOptions {
  /** Compact output always has two decimal places; fractionDigits applies to full output. */
  readonly compact?: boolean;
  readonly fractionDigits?: number;
}

/** An explicit plus/minus for displayed nonzero money; zero never receives a sign. */
export function signed(value: Money, options: SignedOptions = {}): Figure {
  if (options.compact) {
    const body = compact(value);
    const nonzero = moneyDisplay(value, 2).nonzero;
    return value.minor > 0n && nonzero ? formatted(`+${body}`) : body;
  }
  const display = moneyDisplay(value, options.fractionDigits ?? 2);
  const sign = !display.nonzero ? "" : value.minor < 0n ? MINUS : "+";
  return formatted(`${sign}${display.body}`);
}

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

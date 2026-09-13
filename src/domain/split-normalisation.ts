/**
 * Split normalisation: the one conversion that keeps a ledger and an adjusted
 * price series from multiplying each other.
 *
 * **The trap this file exists to close (C3).** Yahoo and Nasdaq do not serve the
 * prices that traded; they serve history *restated into today's share terms*. A
 * 2021 NVDA close of $500 is served as $12.50, because 4:1 in July 2021 and 10:1
 * in June 2024 have both been applied to it retroactively. The owner, separately
 * and correctly, logs those two splits himself, so his ledger has already been
 * rescaled too. Plot one against the other without thinking and the factor lands
 * **twice**: measured 40x wrong for NVDA, 4x for AAPL, 2x for RELIANCE, 5x for
 * IRCTC.
 *
 * The rule, and there is only one:
 *
 *  - **Cost basis comes from the ledger, untouched.** Price x quantity *as
 *    traded*. Nothing here is allowed to change it, and {@link normaliseTrade}
 *    proves that by construction — the quantity is multiplied by exactly the
 *    factor the price is divided by, so their product is preserved.
 *  - **To draw a ledger number on an adjusted chart, normalise the ledger number
 *    first** — never de-adjust the chart. The series is the thing with thousands
 *    of points; the trade is the thing with one.
 *
 * **Integer only (C8).** A factor is a `bigint` numerator over a `bigint`
 * denominator, reduced by GCD and never evaluated as a decimal. A third of a
 * share is not representable at 1e8, so the rounding is stated rather than
 * implied: quantities round half-even at the 1e8 scale, and the price is then
 * *derived* from the preserved cost rather than rounded independently, because
 * two independent roundings of a product do not reconstruct the product.
 */

import { Quantity, UnitPrice } from "@/core/numeric";
import { CalendarDate } from "@/core/time";

/* ═══ The factor ══════════════════════════════════════════════════════ */

/**
 * One split the **owner logged**, as an exact ratio.
 *
 * `numerator:denominator` is *new shares : old shares*, so a 10-for-1 forward
 * split is `10n/1n` and a 1-for-5 consolidation is `1n/5n`. Both directions are
 * one type on purpose: a reverse split is not a special case of this arithmetic,
 * it is a factor below one, and giving it its own code path would be two chances
 * to get the same multiplication wrong.
 *
 * A provider-observed split is **not** one of these. C2: market data is prices
 * and FX only, and an action the owner has not logged is a warning
 * (`src/app/pricing.usecases.ts`), never an input here.
 */
export interface LoggedSplit {
  /** The ex-date. A trade **on** the ex-date is already in post-split terms. */
  readonly exDate: CalendarDate;
  readonly numerator: bigint;
  readonly denominator: bigint;
}

/** An exact ratio, reduced. Never a decimal, never a float. */
export interface SplitFactor {
  readonly numerator: bigint;
  readonly denominator: bigint;
}

/** The factor that changes nothing. */
export const IDENTITY_SPLIT_FACTOR: SplitFactor = { numerator: 1n, denominator: 1n };

export class ImpossibleSplitError extends TypeError {
  constructor(message: string) {
    super(message);
    this.name = "ImpossibleSplitError";
  }
}

function gcd(a: bigint, b: bigint): bigint {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y !== 0n) {
    const next = x % y;
    x = y;
    y = next;
  }
  return x === 0n ? 1n : x;
}

function reduce(numerator: bigint, denominator: bigint): SplitFactor {
  if (numerator <= 0n || denominator <= 0n) {
    throw new ImpossibleSplitError(
      `A split ratio is two positive integers; got ${numerator}:${denominator}.`,
    );
  }
  const divisor = gcd(numerator, denominator);
  return { numerator: numerator / divisor, denominator: denominator / divisor };
}

export function splitFactor(split: LoggedSplit): SplitFactor {
  return reduce(split.numerator, split.denominator);
}

export function isIdentity(factor: SplitFactor): boolean {
  return factor.numerator === factor.denominator;
}

/** Composition, reduced at every step so a long history stays small. */
export function composeSplitFactors(a: SplitFactor, b: SplitFactor): SplitFactor {
  return reduce(a.numerator * b.numerator, a.denominator * b.denominator);
}

/** The reciprocal. */
export function invertSplitFactor(factor: SplitFactor): SplitFactor {
  return reduce(factor.denominator, factor.numerator);
}

/**
 * The cumulative factor of every logged split **strictly after** `tradeDate`.
 *
 * Strictly after, and that boundary is the whole correctness of the function: a
 * split's ex-date is the first day the stock trades in the new terms, so a trade
 * *on* the ex-date already happened at the new price and must not be rescaled
 * again. Off by one day here is off by the entire factor.
 *
 * Order does not matter — multiplication commutes — so the caller may hand over
 * splits in any order, which matters because a repository returns what the index
 * returns.
 */
export function cumulativeSplitFactorAfter(
  splits: readonly LoggedSplit[],
  tradeDate: CalendarDate,
): SplitFactor {
  let factor = IDENTITY_SPLIT_FACTOR;
  for (const split of splits) {
    if (!split.exDate.isAfter(tradeDate)) continue;
    factor = composeSplitFactors(factor, splitFactor(split));
  }
  return factor;
}

/* ═══ Applying it ═════════════════════════════════════════════════════ */

/** Half-even `value x numerator / denominator` on scaled integers. No floats. */
function scaleExact(value: bigint, numerator: bigint, denominator: bigint): bigint {
  const negative = value < 0n;
  const magnitude = negative ? -value : value;
  const product = magnitude * numerator;
  const whole = product / denominator;
  const remainder = product % denominator;
  let rounded = whole;
  if (remainder !== 0n) {
    const twice = remainder * 2n;
    if (twice > denominator || (twice === denominator && whole % 2n !== 0n)) rounded = whole + 1n;
  }
  return negative ? -rounded : rounded;
}

/**
 * A ledger quantity, as traded, expressed in today's shares.
 *
 * 10 NVDA bought in January 2021 is 400 of the shares that exist now. This is the
 * number to plot beside an adjusted series, and it is **not** the number to report
 * as "what I bought" — that stays 10.
 */
export function normaliseQuantity(quantity: Quantity, factor: SplitFactor): Quantity {
  return Quantity.fromScaled(scaleExact(quantity.scaled, factor.numerator, factor.denominator));
}

/** The inverse: today's shares back to the shares that were actually bought. */
export function denormaliseQuantity(quantity: Quantity, factor: SplitFactor): Quantity {
  return normaliseQuantity(quantity, invertSplitFactor(factor));
}

/**
 * A ledger price, as traded, expressed per today's share.
 *
 * The *inverse* factor, because more shares for the same total money is less
 * money per share — that inversion is the single most common way this is written
 * wrong.
 */
export function normalisePrice(price: UnitPrice, factor: SplitFactor): UnitPrice {
  return UnitPrice.fromScaled(
    scaleExact(price.scaled, factor.denominator, factor.numerator),
    price.currency,
  );
}

/** The inverse: a per-current-share price back to what was paid per share. */
export function denormalisePrice(price: UnitPrice, factor: SplitFactor): UnitPrice {
  return normalisePrice(price, invertSplitFactor(factor));
}

export interface NormalisedTrade {
  /** Units in today's share terms. */
  readonly quantity: Quantity;
  /** Price per today's share. */
  readonly price: UnitPrice;
  readonly factor: SplitFactor;
}

/**
 * A whole trade, normalised together so the cost it represents cannot drift.
 *
 * Rounding the quantity and the price *independently* would leave
 * quantity x price a few units away from what was actually paid, and a cost basis
 * that moves when you draw a chart is the bug this file is about. So the quantity
 * is rounded once and the price is then derived from the preserved total: the
 * product is exact by construction, not by luck.
 *
 * `tradeDate` is the date the trade happened. Splits on or before it are already
 * reflected in what was traded and are ignored.
 */
export function normaliseTrade(
  trade: { quantity: Quantity; price: UnitPrice; tradeDate: CalendarDate },
  splits: readonly LoggedSplit[],
): NormalisedTrade {
  const factor = cumulativeSplitFactorAfter(splits, trade.tradeDate);
  const quantity = normaliseQuantity(trade.quantity, factor);

  if (quantity.isZero) {
    // Nothing to spread the cost over; the price is meaningless rather than
    // infinite, so the honest answer is the untouched price.
    return { quantity, price: trade.price, factor };
  }

  /*
   * The new price is the preserved total divided by the new quantity, on scaled
   * integers throughout: `quantity x price` is a 1e16-scaled total, and dividing
   * it by the 1e8-scaled new quantity lands back on 1e8 without rounding the
   * factor a second time.
   */
  const total = trade.quantity.scaled * trade.price.scaled;
  const priceScaled = scaleExact(total, 1n, quantity.scaled);
  return { quantity, price: UnitPrice.fromScaled(priceScaled, trade.price.currency), factor };
}

/**
 * Whether an adjusted series may be compared with this trade at face value.
 *
 * `true` means no split was logged after the trade, so the ledger and the series
 * already speak the same units and normalisation is a no-op. Callers use it to
 * decide whether to *say* so in the UI — a silently-correct number and a silently
 * wrong one look identical.
 */
export function tradeIsInCurrentShareTerms(
  splits: readonly LoggedSplit[],
  tradeDate: CalendarDate,
): boolean {
  return isIdentity(cumulativeSplitFactorAfter(splits, tradeDate));
}

/**
 * A logged split from `(exDate, from, to)` — the `from:to` vocabulary
 * `src/domain/corporate.ts` already uses, so a caller holding a `Split` does not
 * have to remember which way round this file wants it.
 */
export function loggedSplit(exDate: string, from: bigint, to: bigint): LoggedSplit {
  return { exDate: CalendarDate.parse(exDate), numerator: to, denominator: from };
}

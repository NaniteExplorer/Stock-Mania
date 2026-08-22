import { ValueObject } from "@/shared/kernel/ValueObject";
import { pow10 } from "./rounding";

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

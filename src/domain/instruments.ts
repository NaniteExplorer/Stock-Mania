/**
 * The `MarketInstrument` hierarchy: thirteen leaf classes, one file.
 *
 * The plan's done-when is that **adding a fourteenth instrument type touches
 * exactly one file**, and that is the entire design constraint. It holds because
 * every downstream engine consumes only three answers — `taxProfile()`,
 * `quoteKey()` and `valueOn()` — and never asks what kind of thing it is holding.
 * The tax engine sees a `TaxCategory`; the price book sees an identifier and an
 * asset class; a valuation sees units times a price. None of them switches on a
 * type.
 *
 * The differences between the leaves are the point of the hierarchy, and they are
 * real money:
 *
 *   - `LiquidFund` and `DebtFund` are **slab-taxed always** after the April 2023
 *     change, with no long-term rate at any holding period. A debt fund treated as
 *     an equity fund reports 12.5% on a gain that is taxed at 30%.
 *   - `ElssFund` carries a **three-year lock-in** that no other fund has, and a
 *     redemption inside it is not a tax question but an impossible instruction.
 *   - `SovereignGoldBond` is **exempt at maturity** and taxed as debt if sold
 *     early — the same instrument, two entirely different answers.
 *   - `DigitalGold` and `DigitalSilver` are quantified in **grams**, so a "unit"
 *     is not a share and a per-unit price is a per-gram rate.
 *   - `Crypto` is a VDA: flat 30%, no long-term relief, and losses that cannot be
 *     set off against anything.
 */

import { UserId, ValueObject } from "@/core/kernel";
import { Currency, Money } from "@/core/money";
import { Percentage, Quantity, UnitPrice } from "@/core/numeric";
import { CalendarDate } from "@/core/time";
import { AccountId } from "@/domain/accounts";
import type { PricedAssetClass, QuoteType } from "@/domain/pricing";
import type { TaxCategory } from "@/domain/tax";

/* ═══ Identity ════════════════════════════════════════════════════════ */

export class InstrumentId extends ValueObject {
  private constructor(readonly value: string) {
    super();
  }

  static from(value: string): InstrumentId {
    if (value.trim() === "") throw new TypeError("An instrument id cannot be blank.");
    return new InstrumentId(value);
  }

  protected components(): readonly unknown[] {
    return [this.value];
  }

  toString(): string {
    return this.value;
  }
}

/** The thirteen leaves, as the discriminator a stored row carries. */
export type InstrumentKind =
  | "LISTED_EQUITY"
  | "ETF"
  | "INDEX_FUND"
  | "MUTUAL_FUND"
  | "LIQUID_FUND"
  | "DEBT_FUND"
  | "ELSS_FUND"
  | "BOND"
  | "GOVT_SECURITY"
  | "SOVEREIGN_GOLD_BOND"
  | "DIGITAL_GOLD"
  | "DIGITAL_SILVER"
  | "CRYPTO";

/** What a unit of the instrument is. Not decoration — it changes the label and the maths. */
export type UnitOfMeasure = "SHARE" | "UNIT" | "GRAM" | "COIN" | "BOND";

/* ═══ What the engines consume ════════════════════════════════════════ */

/**
 * Everything the tax engine needs that the *regime* cannot know.
 *
 * The split matters: holding-period thresholds and rates belong to the regime
 * (they change with a budget), while the category, a lock-in and a
 * maturity exemption belong to the instrument (they do not). Putting the rate here
 * would freeze last year's rate into this year's instrument.
 */
export interface InstrumentTaxProfile {
  readonly category: TaxCategory;
  /**
   * True when there is no long-term treatment at any holding period.
   *
   * Post-April-2023 debt and liquid funds. A `longTermDays` of `null` in the
   * regime says the same thing; carrying it here too is what lets a screen explain
   * *why* a two-year holding is still slab-taxed.
   */
  readonly slabTaxedAlways: boolean;
  /** Sovereign gold bonds: the capital gain on redemption at maturity is exempt. */
  readonly exemptOnMaturity: boolean;
  /**
   * Months during which redemption is not permitted at all. ELSS is 36.
   *
   * **Months, not days**, and that is a correction rather than a preference: the
   * statutory ELSS lock-in is three *years*, and 1,095 days is only three years in
   * a window with no leap day. Units bought on 1 April 2026 unlock on 1 April 2029,
   * which is 1,096 days later — a day-count check would have released them a day
   * early, and a registrar would have refused the redemption.
   */
  readonly lockInMonths: number | null;
  /** Whether STT applies — it is a cost that is never deductible against gains. */
  readonly securitiesTransactionTax: boolean;
  /** VDA: losses cannot be set off, and there is no indexation or exemption. */
  readonly lossesSetOffAllowed: boolean;
}

/**
 * How a price for this instrument is found.
 *
 * `ref` is the identifier *that source* needs, and the comment is load-bearing: an
 * AMFI scheme code is not an NSE symbol, and the two are not interchangeable. This
 * is the shape `PriceBook.priceOn` takes.
 */
export interface QuoteKey {
  readonly assetClass: PricedAssetClass;
  readonly quoteType: QuoteType;
  /** `AMFI:120503`, `NSE:INFY`, `IBJA:GOLD999` — the source's own code. */
  readonly ref: string | null;
  readonly identifierType: "SYMBOL" | "ISIN" | "SCHEME_CODE" | "SLUG";
}

/** A valuation, with the honesty about price age that `40-MARKET-DATA.md` requires. */
export interface InstrumentValuation {
  readonly instrumentId: InstrumentId;
  readonly asOf: CalendarDate;
  readonly quantity: Quantity;
  /** `null` when no price could be resolved — never zero. */
  readonly price: UnitPrice | null;
  readonly value: Money | null;
  readonly pricedOn: CalendarDate | null;
  readonly isStale: boolean;
  /** Why there is no value, when there is none. */
  readonly unpricedReason: string | null;
}

/**
 * The minimum a price source has to provide. `PriceBook` satisfies it.
 *
 * A one-method port again, so an instrument cannot reach the provider registry,
 * the divergence log or the backfill machinery.
 */
export interface PriceLookup {
  priceOn(
    ref: { instrumentId: string; assetClass: PricedAssetClass; currency: Currency; identifierType: string },
    asOf: CalendarDate,
    quoteType?: QuoteType,
  ): Promise<{
    price: UnitPrice | null;
    pricedOn: CalendarDate | null;
    isStale: boolean;
    rung: string;
  }>;
}

/* ═══ MarketInstrument ════════════════════════════════════════════════ */

export interface InstrumentProps {
  readonly id: InstrumentId;
  readonly userId: UserId;
  /** What the user recognises it by: a ticker, a scheme code, a slug. */
  readonly symbol: string;
  readonly name: string;
  readonly currency: Currency;
  readonly isin?: string | null;
  readonly exchange?: string | null;
  /** The source's own code for this instrument, when it differs from the symbol. */
  readonly quoteRef?: string | null;
  /** The asset account this holding's value lives in. */
  readonly assetAccountId: AccountId;
  readonly isClosed?: boolean;
}

/**
 * Anything priced from a quote and held in lots.
 *
 * `valueOn` is `async` and takes the price source as an argument for the same
 * reason a deposit's `valueOn` takes a date: the value is a computation, not a
 * field, and the price is an input the instrument does not own. An instrument with
 * a cached `currentPrice` would be a v1 instrument.
 */
export abstract class MarketInstrument {
  protected constructor(readonly props: InstrumentProps) {
    if (props.symbol.trim() === "") throw new TypeError("An instrument needs a symbol.");
    if (props.name.trim() === "") throw new TypeError("An instrument needs a name.");
  }

  abstract readonly kind: InstrumentKind;

  abstract readonly unit: UnitOfMeasure;

  /** The tax facts that belong to the instrument rather than to the regime. */
  abstract taxProfile(): InstrumentTaxProfile;

  /** How to ask for a price. */
  abstract quoteKey(): QuoteKey;

  get id(): InstrumentId {
    return this.props.id;
  }

  get symbol(): string {
    return this.props.symbol;
  }

  get name(): string {
    return this.props.name;
  }

  get currency(): Currency {
    return this.props.currency;
  }

  get assetAccountId(): AccountId {
    return this.props.assetAccountId;
  }

  get isClosed(): boolean {
    return this.props.isClosed ?? false;
  }

  /** `1,250.4321 units` / `12.5000 g` — the unit is part of the number's meaning. */
  formatQuantity(quantity: Quantity): string {
    const suffix = { SHARE: "shares", UNIT: "units", GRAM: "g", COIN: "coins", BOND: "bonds" }[this.unit];
    return `${quantity.toDecimalString()} ${suffix}`;
  }

  /**
   * Value on a date: units times the resolved price.
   *
   * A missing price produces `value: null` with a reason, never ₹0. That is
   * `40-MARKET-DATA.md` §1.4 and it is the difference between "we do not know what
   * this is worth" and "this is worth nothing" — which are opposite claims about
   * someone's net worth.
   */
  async valueOn(
    quantity: Quantity,
    asOf: CalendarDate,
    prices: PriceLookup,
  ): Promise<InstrumentValuation> {
    if (quantity.isZero) {
      return {
        instrumentId: this.id,
        asOf,
        quantity,
        price: null,
        value: Money.zero(this.currency),
        pricedOn: null,
        isStale: false,
        unpricedReason: null,
      };
    }

    const key = this.quoteKey();
    const resolved = await prices.priceOn(
      {
        instrumentId: this.id.value,
        assetClass: key.assetClass,
        currency: this.currency,
        identifierType: key.identifierType,
      },
      asOf,
      key.quoteType,
    );

    if (!resolved.price) {
      return {
        instrumentId: this.id,
        asOf,
        quantity,
        price: null,
        value: null,
        pricedOn: null,
        isStale: true,
        unpricedReason: `No ${key.quoteType.toLowerCase()} could be resolved for ${this.symbol}.`,
      };
    }

    return {
      instrumentId: this.id,
      asOf,
      quantity,
      price: resolved.price,
      // Rounding happens exactly once, here: the price keeps eight decimals until
      // it meets a quantity.
      value: resolved.price.times(quantity),
      pricedOn: resolved.pricedOn,
      isStale: resolved.isStale,
      unpricedReason: null,
    };
  }

  /**
   * Whether a disposal on this date is permitted at all.
   *
   * Distinct from a tax question: an ELSS redemption inside the lock-in is not
   * taxed differently, it is refused by the registrar. Returning a reason rather
   * than a boolean means the UI can say which.
   */
  disposalBlockedOn(acquiredOn: CalendarDate, disposedOn: CalendarDate): string | null {
    const months = this.taxProfile().lockInMonths;
    if (months === null) return null;
    const unlocksOn = acquiredOn.plusMonths(months);
    if (disposedOn.isOnOrAfter(unlocksOn)) return null;
    const daysToGo = disposedOn.daysUntil(unlocksOn);
    return (
      `${this.symbol} units bought on ${acquiredOn.toISO()} are locked until ` +
      `${unlocksOn.toISO()} (${daysToGo} day${daysToGo === 1 ? "" : "s"} to go). A redemption ` +
      `before then is refused by the registrar, not merely taxed.`
    );
  }

  toString(): string {
    return `${this.kind} ${this.symbol}`;
  }

  /* ─── Construction ───────────────────────────────────────────────── */

  /**
   * Builds the right leaf for a stored kind.
   *
   * The one place that knows all thirteen. A fourteenth instrument adds a class
   * and a case here, and nothing else in the codebase changes — which is the
   * plan's done-when, and is only true because no engine switches on the kind.
   */
  static of(kind: InstrumentKind, props: InstrumentProps): MarketInstrument {
    switch (kind) {
      case "LISTED_EQUITY":
        return new ListedEquity(props);
      case "ETF":
        return new Etf(props);
      case "INDEX_FUND":
        return new IndexFund(props);
      case "MUTUAL_FUND":
        return new MutualFund(props);
      case "LIQUID_FUND":
        return new LiquidFund(props);
      case "DEBT_FUND":
        return new DebtFund(props);
      case "ELSS_FUND":
        return new ElssFund(props);
      case "BOND":
        return new Bond(props);
      case "GOVT_SECURITY":
        return new GovtSecurity(props);
      case "SOVEREIGN_GOLD_BOND":
        return new SovereignGoldBond(props);
      case "DIGITAL_GOLD":
        return new DigitalGold(props);
      case "DIGITAL_SILVER":
        return new DigitalSilver(props);
      case "CRYPTO":
        return new Crypto(props);
    }
  }

  /** Every kind, for a picker and for the conformance test. */
  static kinds(): readonly InstrumentKind[] {
    return [
      "LISTED_EQUITY",
      "ETF",
      "INDEX_FUND",
      "MUTUAL_FUND",
      "LIQUID_FUND",
      "DEBT_FUND",
      "ELSS_FUND",
      "BOND",
      "GOVT_SECURITY",
      "SOVEREIGN_GOLD_BOND",
      "DIGITAL_GOLD",
      "DIGITAL_SILVER",
      "CRYPTO",
    ];
  }
}

/* ═══ Equity-taxed instruments ════════════════════════════════════════ */

const EQUITY_PROFILE: InstrumentTaxProfile = {
  category: "LISTED_EQUITY",
  slabTaxedAlways: false,
  exemptOnMaturity: false,
  lockInMonths: null,
  securitiesTransactionTax: true,
  lossesSetOffAllowed: true,
};

/** A share listed on a recognised exchange. STT applies; 12-month long-term line. */
export class ListedEquity extends MarketInstrument {
  readonly kind = "LISTED_EQUITY" as const;
  readonly unit = "SHARE" as const;

  constructor(props: InstrumentProps) {
    super(props);
  }

  taxProfile(): InstrumentTaxProfile {
    return EQUITY_PROFILE;
  }

  quoteKey(): QuoteKey {
    return {
      assetClass: "EQUITY",
      quoteType: "CLOSE",
      ref: this.props.quoteRef ?? this.symbol,
      identifierType: "SYMBOL",
    };
  }
}

/**
 * An exchange-traded fund.
 *
 * Priced from an exchange close like a share, taxed like an equity fund when it
 * holds equity — and that is exactly why `taxAssetClass` is stored per instrument
 * rather than derived from the kind: a gold ETF and a Nifty ETF are the same kind
 * of thing to a price feed and different things to the tax engine.
 */
export class Etf extends MarketInstrument {
  readonly kind = "ETF" as const;
  readonly unit = "UNIT" as const;

  constructor(
    props: InstrumentProps,
    /** What the fund holds. Gold ETFs changed class in the 2023 budget. */
    private readonly underlying: "EQUITY" | "DEBT" | "GOLD" = "EQUITY",
  ) {
    super(props);
  }

  taxProfile(): InstrumentTaxProfile {
    if (this.underlying === "EQUITY") {
      return { ...EQUITY_PROFILE, category: "EQUITY_MUTUAL_FUND" };
    }
    return {
      category: this.underlying === "GOLD" ? "GOLD" : "DEBT",
      slabTaxedAlways: this.underlying === "DEBT",
      exemptOnMaturity: false,
      lockInMonths: null,
      securitiesTransactionTax: false,
      lossesSetOffAllowed: true,
    };
  }

  quoteKey(): QuoteKey {
    return {
      assetClass: "ETF",
      quoteType: "CLOSE",
      ref: this.props.quoteRef ?? this.symbol,
      identifierType: "SYMBOL",
    };
  }
}

/** A NAV-priced index fund holding equity. */
export class IndexFund extends MarketInstrument {
  readonly kind = "INDEX_FUND" as const;
  readonly unit = "UNIT" as const;

  constructor(props: InstrumentProps) {
    super(props);
  }

  taxProfile(): InstrumentTaxProfile {
    return { ...EQUITY_PROFILE, category: "EQUITY_MUTUAL_FUND", securitiesTransactionTax: false };
  }

  quoteKey(): QuoteKey {
    return {
      assetClass: "MUTUAL_FUND",
      quoteType: "NAV",
      ref: this.props.quoteRef ?? this.symbol,
      identifierType: "SCHEME_CODE",
    };
  }
}

/** An actively managed equity fund. */
export class MutualFund extends MarketInstrument {
  readonly kind = "MUTUAL_FUND" as const;
  readonly unit = "UNIT" as const;

  constructor(props: InstrumentProps) {
    super(props);
  }

  taxProfile(): InstrumentTaxProfile {
    return { ...EQUITY_PROFILE, category: "EQUITY_MUTUAL_FUND", securitiesTransactionTax: false };
  }

  quoteKey(): QuoteKey {
    return {
      assetClass: "MUTUAL_FUND",
      quoteType: "NAV",
      ref: this.props.quoteRef ?? this.symbol,
      identifierType: "SCHEME_CODE",
    };
  }
}

/* ═══ Slab-taxed funds ════════════════════════════════════════════════ */

const SLAB_FUND_PROFILE: InstrumentTaxProfile = {
  category: "DEBT",
  /*
   * The April 2023 change: a debt or liquid fund has no long-term treatment at any
   * holding period. Two years of holding does not help, and a screen that showed
   * "long term" for one would understate the tax by up to 17.5 points.
   */
  slabTaxedAlways: true,
  exemptOnMaturity: false,
  lockInMonths: null,
  securitiesTransactionTax: false,
  lossesSetOffAllowed: true,
};

/** An overnight or liquid fund — a parking place, taxed at slab always. */
export class LiquidFund extends MarketInstrument {
  readonly kind = "LIQUID_FUND" as const;
  readonly unit = "UNIT" as const;

  constructor(props: InstrumentProps) {
    super(props);
  }

  taxProfile(): InstrumentTaxProfile {
    return SLAB_FUND_PROFILE;
  }

  quoteKey(): QuoteKey {
    return {
      assetClass: "MUTUAL_FUND",
      quoteType: "NAV",
      ref: this.props.quoteRef ?? this.symbol,
      identifierType: "SCHEME_CODE",
    };
  }
}

/** Any other debt fund. Same treatment, different mandate. */
export class DebtFund extends MarketInstrument {
  readonly kind = "DEBT_FUND" as const;
  readonly unit = "UNIT" as const;

  constructor(
    props: InstrumentProps,
    /**
     * Units bought before 1 April 2023 keep indexation and the 20% long-term rate.
     *
     * A property of the *holding*, not of the fund, which is why it is a
     * constructor argument: the same fund can hold pre- and post-change units, and
     * the lot's acquisition date is what decides. `DEBT_LEGACY` is the category the
     * regime prices differently.
     */
    private readonly legacyUnits = false,
  ) {
    super(props);
  }

  taxProfile(): InstrumentTaxProfile {
    return this.legacyUnits
      ? { ...SLAB_FUND_PROFILE, category: "DEBT_LEGACY", slabTaxedAlways: false }
      : SLAB_FUND_PROFILE;
  }

  quoteKey(): QuoteKey {
    return {
      assetClass: "MUTUAL_FUND",
      quoteType: "NAV",
      ref: this.props.quoteRef ?? this.symbol,
      identifierType: "SCHEME_CODE",
    };
  }
}

/* ═══ ELSS ════════════════════════════════════════════════════════════ */

/** The statutory ELSS lock-in: three years, counted as calendar months. */
export const ELSS_LOCK_IN_MONTHS = 36;

/**
 * An equity-linked savings scheme.
 *
 * Taxed as an equity fund, with an §80C deduction on the way in and a **hard
 * three-year lock** on each individual purchase. Per purchase, not per account: a
 * SIP creates a new lock every month, which is the part people are surprised by
 * and the reason `disposalBlockedOn` takes an acquisition date.
 */
export class ElssFund extends MarketInstrument {
  readonly kind = "ELSS_FUND" as const;
  readonly unit = "UNIT" as const;

  constructor(props: InstrumentProps) {
    super(props);
  }

  taxProfile(): InstrumentTaxProfile {
    return {
      ...EQUITY_PROFILE,
      category: "EQUITY_MUTUAL_FUND",
      securitiesTransactionTax: false,
      lockInMonths: ELSS_LOCK_IN_MONTHS,
    };
  }

  quoteKey(): QuoteKey {
    return {
      assetClass: "MUTUAL_FUND",
      quoteType: "NAV",
      ref: this.props.quoteRef ?? this.symbol,
      identifierType: "SCHEME_CODE",
    };
  }

  /** §80C: the deduction is on the amount invested, capped at ₹1.5 lakh a year. */
  deductibleInvestment(invested: Money, alreadyClaimed: Money): Money {
    const cap = Money.fromRupees("150000", this.currency);
    const room = cap.minus(alreadyClaimed);
    if (!room.isPositive) return Money.zero(this.currency);
    return invested.isGreaterThan(room) ? room : invested;
  }
}

/* ═══ Debt securities ═════════════════════════════════════════════════ */

/** A corporate bond or debenture. Interest is slab income; the gain is a gain. */
export class Bond extends MarketInstrument {
  readonly kind = "BOND" as const;
  readonly unit = "BOND" as const;

  constructor(
    props: InstrumentProps,
    readonly terms: {
      readonly faceValue: Money;
      readonly couponRate: Percentage;
      readonly maturesOn: CalendarDate;
    } | null = null,
  ) {
    super(props);
  }

  taxProfile(): InstrumentTaxProfile {
    return {
      category: "DEBT",
      slabTaxedAlways: false,
      exemptOnMaturity: false,
      lockInMonths: null,
      securitiesTransactionTax: false,
      lossesSetOffAllowed: true,
    };
  }

  quoteKey(): QuoteKey {
    return {
      assetClass: "BOND",
      quoteType: "CLOSE",
      ref: this.props.quoteRef ?? this.props.isin ?? this.symbol,
      identifierType: this.props.isin ? "ISIN" : "SYMBOL",
    };
  }

  /**
   * A coupon payment, which is income and not a change in value.
   *
   * `Quantity.valueAt` rather than `Money.times`, because a holding of 12.5 bonds
   * is expressible and `times` takes only whole factors — the rounding of the
   * fractional part has to be stated, and `valueAt` states it.
   */
  couponFor(held: Quantity, periodsPerYear = 2): Money | null {
    if (!this.terms) return null;
    const perBondPerPeriod = this.terms.couponRate
      .applyTo(this.terms.faceValue)
      .dividedBy(BigInt(periodsPerYear), "HALF_UP");
    return held.valueAt(perBondPerPeriod);
  }
}

/** A government security. Same shape as a bond; sovereign credit. */
export class GovtSecurity extends MarketInstrument {
  readonly kind = "GOVT_SECURITY" as const;
  readonly unit = "BOND" as const;

  constructor(props: InstrumentProps) {
    super(props);
  }

  taxProfile(): InstrumentTaxProfile {
    return {
      category: "DEBT",
      slabTaxedAlways: false,
      exemptOnMaturity: false,
      lockInMonths: null,
      securitiesTransactionTax: false,
      lossesSetOffAllowed: true,
    };
  }

  quoteKey(): QuoteKey {
    return {
      assetClass: "BOND",
      quoteType: "CLOSE",
      ref: this.props.quoteRef ?? this.props.isin ?? this.symbol,
      identifierType: this.props.isin ? "ISIN" : "SYMBOL",
    };
  }
}

/**
 * A sovereign gold bond.
 *
 * Two tax answers for one instrument, which is why it is its own class: held to
 * the eight-year maturity, the capital gain is **exempt entirely**; sold on the
 * exchange before then, it is a gold gain. `exemptOnMaturity` is what a disposal
 * has to consult, and getting it wrong means taxing a gain the statute exempts.
 *
 * The 2.5% annual interest is taxable as slab income throughout, in both cases.
 */
export class SovereignGoldBond extends MarketInstrument {
  readonly kind = "SOVEREIGN_GOLD_BOND" as const;
  readonly unit = "GRAM" as const;

  constructor(
    props: InstrumentProps,
    readonly terms: { readonly issuedOn: CalendarDate; readonly maturesOn: CalendarDate } | null = null,
  ) {
    super(props);
  }

  taxProfile(): InstrumentTaxProfile {
    return {
      category: "GOLD",
      slabTaxedAlways: false,
      exemptOnMaturity: true,
      lockInMonths: null,
      securitiesTransactionTax: false,
      lossesSetOffAllowed: true,
    };
  }

  quoteKey(): QuoteKey {
    return {
      assetClass: "BOND",
      quoteType: "CLOSE",
      ref: this.props.quoteRef ?? this.props.isin ?? this.symbol,
      identifierType: this.props.isin ? "ISIN" : "SYMBOL",
    };
  }

  /** Whether a disposal on this date is a redemption at maturity — hence exempt. */
  isMaturityRedemption(disposedOn: CalendarDate): boolean {
    if (!this.terms) return false;
    return disposedOn.isOnOrAfter(this.terms.maturesOn);
  }

  /** The 2.5% coupon, paid half-yearly on the issue price. */
  interestFor(grams: Quantity, issuePricePerGram: UnitPrice): Money {
    const annual = issuePricePerGram.times(grams);
    return Percentage.of("2.5").applyTo(annual).dividedBy(2n, "HALF_UP");
  }
}

/* ═══ Metals, in grams ════════════════════════════════════════════════ */

const METAL_PROFILE: InstrumentTaxProfile = {
  category: "GOLD",
  slabTaxedAlways: false,
  exemptOnMaturity: false,
  lockInMonths: null,
  securitiesTransactionTax: false,
  lossesSetOffAllowed: true,
};

/**
 * Digital gold — grams held with a vaulting provider.
 *
 * The unit is a **gram**, not a share, and that is more than a label: a price is a
 * rate per gram, holdings are fractional to four decimals, and a "quantity" that
 * the UI rendered as "1250 shares of gold" would be nonsense. It is also why
 * `Quantity` carries eight decimals rather than being an integer count.
 */
export class DigitalGold extends MarketInstrument {
  readonly kind = "DIGITAL_GOLD" as const;
  readonly unit = "GRAM" as const;

  constructor(props: InstrumentProps) {
    super(props);
  }

  taxProfile(): InstrumentTaxProfile {
    return METAL_PROFILE;
  }

  quoteKey(): QuoteKey {
    return {
      assetClass: "COMMODITY",
      quoteType: "MID",
      // IBJA publishes a buy and a sell rate; the mid is the fair one to value at.
      ref: this.props.quoteRef ?? "GOLD999",
      identifierType: "SLUG",
    };
  }
}

export class DigitalSilver extends MarketInstrument {
  readonly kind = "DIGITAL_SILVER" as const;
  readonly unit = "GRAM" as const;

  constructor(props: InstrumentProps) {
    super(props);
  }

  taxProfile(): InstrumentTaxProfile {
    return METAL_PROFILE;
  }

  quoteKey(): QuoteKey {
    return {
      assetClass: "COMMODITY",
      quoteType: "MID",
      ref: this.props.quoteRef ?? "SILVER999",
      identifierType: "SLUG",
    };
  }
}

/* ═══ Crypto ══════════════════════════════════════════════════════════ */

/**
 * A virtual digital asset.
 *
 * The harshest treatment in the book, and all of it is instrument-level fact: a
 * flat 30% with no long-term relief at any holding period, no indexation, no
 * exemption, and **losses that cannot be set off against anything** — not against
 * other crypto gains, not carried forward. `lossesSetOffAllowed: false` is the flag
 * that stops a loss ledger from quietly netting them.
 */
export class Crypto extends MarketInstrument {
  readonly kind = "CRYPTO" as const;
  readonly unit = "COIN" as const;

  constructor(props: InstrumentProps) {
    super(props);
  }

  taxProfile(): InstrumentTaxProfile {
    return {
      category: "VDA",
      slabTaxedAlways: false,
      exemptOnMaturity: false,
      lockInMonths: null,
      securitiesTransactionTax: false,
      lossesSetOffAllowed: false,
    };
  }

  quoteKey(): QuoteKey {
    return {
      assetClass: "CRYPTO",
      quoteType: "LAST",
      ref: this.props.quoteRef ?? this.symbol.toLowerCase(),
      identifierType: "SLUG",
    };
  }
}

/* ═══ Repository port ═════════════════════════════════════════════════ */

export interface StoredInstrument {
  readonly id: InstrumentId;
  readonly kind: InstrumentKind;
  readonly props: InstrumentProps;
}

export interface InstrumentRepository {
  findById(userId: UserId, id: InstrumentId): Promise<MarketInstrument | null>;
  findBySymbol(userId: UserId, symbol: string): Promise<MarketInstrument | null>;
  list(userId: UserId, options?: { includeClosed?: boolean }): Promise<readonly MarketInstrument[]>;
  save(userId: UserId, kind: InstrumentKind, props: InstrumentProps): Promise<void>;
}

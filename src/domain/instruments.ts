/**
 * The `MarketInstrument` hierarchy: seventeen leaf classes, one file.
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

import { z } from "zod";
import { UserId, ValueObject } from "@/core/kernel";
import { Currency, Money } from "@/core/money";
import { Percentage, Quantity, UnitPrice } from "@/core/numeric";
import { CalendarDate } from "@/core/time";
import { AccountId } from "@/domain/accounts";
import { InstitutionId } from "@/domain/institutions";
import { analyseSeries, type Bar, type InstrumentAnalysis } from "@/domain/analysis";
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

/** The seventeen leaves, as the discriminator a stored row carries. */
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
  | "DIGITAL_PLATINUM"
  | "REIT"
  | "CRYPTO"
  | "OPTION"
  | "FUTURE";

/** What a unit of the instrument is. Not decoration — it changes the label and the maths. */
export type UnitOfMeasure = "SHARE" | "UNIT" | "GRAM" | "COIN" | "BOND" | "CONTRACT";

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
    ref: {
      instrumentId: string;
      /** The provider-facing name — a ticker, a scheme code, a metal slug. */
      symbol: string;
      assetClass: PricedAssetClass;
      currency: Currency;
      identifierType: string;
    },
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
  /**
   * The platform it is held on — Zerodha, Groww, Tanishq, SafeGold.
   *
   * Optional because it is a property of *where* the holding sits, not of what
   * it is: the tax treatment, the price key and the unit are all the same
   * whether the gold is at Tanishq or SafeGold, which is why no leaf reads this
   * and it stays on the base props. Null means unassigned, and every rollup
   * reports that as its own group rather than hiding the holding.
   */
  readonly institutionId?: InstitutionId | null;
  readonly isClosed?: boolean;
  /**
   * The facts that belong to *this kind* of instrument and to no other.
   *
   * Stored as one JSON column and parsed by the leaf's own Zod schema in the
   * leaf's own constructor, which is the whole point: a strike price is
   * meaningless on an index fund, and fifteen nullable columns — one per leaf
   * fact — would be a schema that documents the union of every instrument type
   * rather than any one of them. It also means adding `Option` needs no
   * migration, which is the plan's Phase 8 done-when.
   *
   * `unknown`, not a union: the base class must not know the shape of any leaf's
   * metadata, or every new leaf would edit the base type. Money is carried as a
   * decimal *string* and a date as an ISO string, so the JSON never holds a
   * float and a round-trip through the database is lossless.
   */
  readonly metadata?: unknown;
}

/* ═══ Metadata, one Zod schema per asset class ════════════════════════ */

/**
 * Money and dates inside metadata are strings.
 *
 * `z.number()` would be the obvious choice and it is the wrong one: a strike of
 * ₹22,500.55 is exactly representable as a string and not as a double, and the
 * float prohibition exists precisely so that this decision is not made casually
 * at the edge of the system. `moneyString` refuses anything a `Money` cannot be
 * built from, at parse time, in the constructor.
 */
const moneyString = z
  .string()
  .regex(/^-?\d+(\.\d+)?$/, "A money amount in metadata is a decimal string, e.g. \"22500.55\".");

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "A date in metadata is an ISO calendar date.");

/** What an ETF holds. Gold ETFs changed tax class in the 2023 budget. */
export const ETF_METADATA = z.object({
  underlying: z.enum(["EQUITY", "DEBT", "GOLD"]).default("EQUITY"),
});

/** Whether these are pre-April-2023 debt-fund units, which keep indexation. */
export const DEBT_FUND_METADATA = z.object({
  legacyUnits: z.boolean().default(false),
});

export const BOND_METADATA = z.object({
  faceValue: moneyString,
  couponRatePercent: z.string(),
  maturesOn: isoDate,
});

export const SGB_METADATA = z.object({
  issuedOn: isoDate,
  maturesOn: isoDate,
});

export const OPTION_METADATA = z.object({
  underlyingSymbol: z.string().min(1),
  right: z.enum(["CALL", "PUT"]),
  strike: moneyString,
  expiry: isoDate,
  /** Contracts trade in lots; a "quantity" of 1 is one lot, not one share. */
  lotSize: z.number().int().positive(),
  /** Index options settle in cash; stock options are deliverable. */
  settlement: z.enum(["CASH", "PHYSICAL"]).default("CASH"),
});

export const FUTURE_METADATA = z.object({
  underlyingSymbol: z.string().min(1),
  expiry: isoDate,
  /** `2026-09` — which monthly series this is, for rolling. */
  contractMonth: z.string().regex(/^\d{4}-\d{2}$/),
  lotSize: z.number().int().positive(),
  settlement: z.enum(["CASH", "PHYSICAL"]).default("CASH"),
});

/** Leaves with no facts of their own accept metadata and ignore it. */
const NO_METADATA = z.object({}).loose();

const METADATA_SCHEMAS: Readonly<Record<InstrumentKind, z.ZodType>> = {
  LISTED_EQUITY: NO_METADATA,
  ETF: ETF_METADATA,
  INDEX_FUND: NO_METADATA,
  MUTUAL_FUND: NO_METADATA,
  LIQUID_FUND: NO_METADATA,
  DEBT_FUND: DEBT_FUND_METADATA,
  ELSS_FUND: NO_METADATA,
  BOND: BOND_METADATA,
  GOVT_SECURITY: NO_METADATA,
  SOVEREIGN_GOLD_BOND: SGB_METADATA,
  DIGITAL_GOLD: NO_METADATA,
  DIGITAL_SILVER: NO_METADATA,
  DIGITAL_PLATINUM: NO_METADATA,
  REIT: NO_METADATA,
  CRYPTO: NO_METADATA,
  OPTION: OPTION_METADATA,
  FUTURE: FUTURE_METADATA,
};

/**
 * Parses metadata, or throws.
 *
 * A leaf whose metadata is required and absent is *not* silently degraded to a
 * default: an `Option` with no strike is not an option, and constructing one
 * would push the failure to whatever screen first divided by it. Invariant: an
 * instrument that exists is fully specified.
 */
function parseMetadata<T extends z.ZodType>(schema: T, kind: InstrumentKind, metadata: unknown): z.output<T> {
  const result = schema.safeParse(metadata ?? {});
  if (!result.success) {
    const detail = result.error.issues
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("; ");
    throw new TypeError(
      `A ${kind} instrument's metadata is not usable (${detail}). It is refused here rather ` +
        `than defaulted, because a half-specified derivative is not a derivative.`,
    );
  }
  return result.data as z.output<T>;
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

  get institutionId(): InstitutionId | null {
    return this.props.institutionId ?? null;
  }

  get isClosed(): boolean {
    return this.props.isClosed ?? false;
  }

  /** `1,250.4321 units` / `12.5000 g` — the unit is part of the number's meaning. */
  formatQuantity(quantity: Quantity): string {
    const suffix = {
      SHARE: "shares",
      UNIT: "units",
      GRAM: "g",
      COIN: "coins",
      BOND: "bonds",
      CONTRACT: "lots",
    }[this.unit];
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
        // The source's own code when there is one, the symbol otherwise: an AMFI
        // scheme code is not an NSE ticker, and asking with the wrong one gets a
        // confident answer about a different instrument.
        symbol: key.ref ?? this.symbol,
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
        unpricedReason: `No ${key.quoteType.toLowerCase()} could be resolved for price reference ${key.ref ?? this.symbol}.`,
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

  /**
   * Per-instrument analysis over a bar series — the extension point.
   *
   * On the base class it is the standard technical set, so thirteen of the
   * fifteen leaves need nothing. A leaf overrides it to *add* what only it can
   * say: an option's days to expiry and moneyness, a bond's yield to maturity
   * when that arrives. It returns no `Money`, which is what keeps indicators
   * (floats, correctly) on one side of the line and valuation (exact) on the
   * other.
   */
  analyse(series: readonly Bar[]): InstrumentAnalysis {
    return analyseSeries(this.id.value, series);
  }

  /**
   * Whether the instrument can be traded at all on this date.
   *
   * A different question from `disposalBlockedOn`, which is about a *lock* on
   * units already held. This one is about the contract: an expired option is not
   * locked, it has ceased to exist. Everything with no expiry answers `null`.
   */
  tradableOn(_date: CalendarDate): string | null {
    return null;
  }

  toString(): string {
    return `${this.kind} ${this.symbol}`;
  }

  /* ─── Construction ───────────────────────────────────────────────── */

  /**
   * The metadata schema for a kind, so a form can be generated from it rather
   * than hand-written per instrument type and drifting from the parser.
   */
  static metadataSchemaFor(kind: InstrumentKind): z.ZodType {
    return METADATA_SCHEMAS[kind];
  }

  /**
   * Builds the right leaf for a stored kind.
   *
   * The one place that knows all seventeen. An eighteenth instrument adds a class
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
      case "DIGITAL_PLATINUM":
        return new DigitalPlatinum(props);
      case "REIT":
        return new Reit(props);
      case "CRYPTO":
        return new Crypto(props);
      case "OPTION":
        return new Option(props);
      case "FUTURE":
        return new Future(props);
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
      "DIGITAL_PLATINUM",
      "REIT",
      "CRYPTO",
      "OPTION",
      "FUTURE",
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

  private readonly underlying: "EQUITY" | "DEBT" | "GOLD";

  constructor(
    props: InstrumentProps,
    /**
     * What the fund holds. Gold ETFs changed class in the 2023 budget.
     *
     * Optional, and the metadata is the fallback rather than the other way
     * round: a caller that knows says so, and a row read back from the database
     * carries the answer in its metadata. Before Phase 8 the argument was the
     * *only* source, so a gold ETF loaded from storage silently claimed to be an
     * equity ETF and was taxed 12.5% on a gain the statute charges at 20%.
     */
    underlying?: "EQUITY" | "DEBT" | "GOLD",
  ) {
    super(props);
    this.underlying = underlying ?? parseMetadata(ETF_METADATA, "ETF", props.metadata).underlying;
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

  private readonly legacyUnits: boolean;

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
    legacyUnits?: boolean,
  ) {
    super(props);
    this.legacyUnits =
      legacyUnits ?? parseMetadata(DEBT_FUND_METADATA, "DEBT_FUND", props.metadata).legacyUnits;
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

  readonly terms: {
    readonly faceValue: Money;
    readonly couponRate: Percentage;
    readonly maturesOn: CalendarDate;
  } | null;

  constructor(
    props: InstrumentProps,
    terms: {
      readonly faceValue: Money;
      readonly couponRate: Percentage;
      readonly maturesOn: CalendarDate;
    } | null = null,
  ) {
    super(props);
    this.terms = terms ?? Bond.termsFromMetadata(props);
  }

  /**
   * Terms out of the stored JSON, or `null` when there are none.
   *
   * `null` is a real answer here rather than a failure — a bond entered with no
   * terms is a priced holding whose coupon nobody has told us about, and
   * `couponFor` already answers `null` for it. What is *not* allowed is partial
   * terms, which the schema refuses.
   */
  private static termsFromMetadata(props: InstrumentProps): {
    faceValue: Money;
    couponRate: Percentage;
    maturesOn: CalendarDate;
  } | null {
    if (props.metadata === undefined || props.metadata === null) return null;
    const parsed = parseMetadata(BOND_METADATA, "BOND", props.metadata);
    return {
      faceValue: Money.fromRupees(parsed.faceValue, props.currency),
      couponRate: Percentage.of(parsed.couponRatePercent),
      maturesOn: CalendarDate.parse(parsed.maturesOn),
    };
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

  readonly terms: { readonly issuedOn: CalendarDate; readonly maturesOn: CalendarDate } | null;

  constructor(
    props: InstrumentProps,
    terms: { readonly issuedOn: CalendarDate; readonly maturesOn: CalendarDate } | null = null,
  ) {
    super(props);
    if (terms) {
      this.terms = terms;
    } else if (props.metadata === undefined || props.metadata === null) {
      this.terms = null;
    } else {
      const parsed = parseMetadata(SGB_METADATA, "SOVEREIGN_GOLD_BOND", props.metadata);
      this.terms = {
        issuedOn: CalendarDate.parse(parsed.issuedOn),
        maturesOn: CalendarDate.parse(parsed.maturesOn),
      };
    }
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
      // The shipped bullion feeds publish a daily benchmark close. Asking for
      // MID made every gold holding permanently unpriced.
      quoteType: "CLOSE",
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
      quoteType: "CLOSE",
      ref: this.props.quoteRef ?? "SILVER999",
      identifierType: "SLUG",
    };
  }
}

/**
 * Digital platinum.
 *
 * The same shape as gold and silver — grams with a vaulting provider — and the
 * same `GOLD` tax category, which is not a naming slip: the category is the
 * *treatment*, and bullion of any metal is taxed alike as a non-STT capital
 * asset. Renaming the category to `BULLION` would be truer and would rewrite
 * every stored `tax_asset_class`, so the name stays and this comment carries the
 * caveat.
 *
 * IBJA publishes platinum irregularly, so a platinum holding may sit unpriced.
 * That is the honest outcome and the screen already says so; it is not valued at
 * the gold rate as an approximation.
 */
export class DigitalPlatinum extends MarketInstrument {
  readonly kind = "DIGITAL_PLATINUM" as const;
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
      quoteType: "CLOSE",
      ref: this.props.quoteRef ?? "PLATINUM999",
      identifierType: "SLUG",
    };
  }
}

/* ═══ Real estate ═════════════════════════════════════════════════════ */

/**
 * A listed real-estate investment trust.
 *
 * Priced from an exchange close like a share, and since the 2024 change taxed on
 * the same twelve-month line as listed equity with STT applying — so the equity
 * profile is not an approximation here, it is the treatment.
 *
 * What a REIT does *not* get modelled as is a property. The unit is a unit, the
 * price is a close, and the distributions (part interest, part dividend, part
 * return of capital) are income events rather than instrument facts — they book
 * through the ledger like any other payout.
 */
export class Reit extends MarketInstrument {
  readonly kind = "REIT" as const;
  readonly unit = "UNIT" as const;

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

/* ═══ Derivatives ═════════════════════════════════════════════════════ */

/**
 * Everything a contract shares: an underlying, an expiry and a lot size.
 *
 * The tax answer is the same for both leaves and is the reason they are classes
 * rather than a `DERIVATIVE` flag on `ListedEquity`: F&O is **business income**,
 * so nothing about a holding period, an exemption or indexation applies to
 * either of them, and a screen that grouped them with equity would offer reliefs
 * that do not exist.
 */
const FNO_PROFILE: InstrumentTaxProfile = {
  category: "FNO_BUSINESS",
  /*
   * True in the sense the flag means — there is no long-term treatment at any
   * holding period. The rate is the slab rate rather than a capital-gains rate,
   * which the regime's `FNO_BUSINESS` rule states as three nulls.
   */
  slabTaxedAlways: true,
  exemptOnMaturity: false,
  /* No lock-in: an expiry is not a lock, and `tradableOn` answers that question. */
  lockInMonths: null,
  /* STT applies to F&O, at its own rates, and is a business expense here rather
   * than a non-deductible charge — which is the one place F&O is *better* off
   * than equity. */
  securitiesTransactionTax: true,
  /*
   * Set-off is allowed — against business income only. The wall between business
   * and capital buckets lives in `LossLedger`, because it is a property of the
   * two heads meeting, not of the instrument.
   */
  lossesSetOffAllowed: true,
};

/** One unit, for a per-unit figure that has to come back as `Money`. */
const ONE_UNIT = Quantity.fromString("1");

abstract class DerivativeContract extends MarketInstrument {
  readonly unit = "CONTRACT" as const;

  taxProfile(): InstrumentTaxProfile {
    return FNO_PROFILE;
  }

  quoteKey(): QuoteKey {
    return {
      assetClass: "DERIVATIVE",
      quoteType: "CLOSE",
      ref: this.props.quoteRef ?? this.symbol,
      identifierType: "SYMBOL",
    };
  }

  abstract readonly expiry: CalendarDate;
  abstract readonly underlyingSymbol: string;
  abstract readonly lotSize: number;

  /** Whole units of the underlying behind a position. Lots times lot size. */
  underlyingUnits(lots: Quantity): Quantity {
    // Exact integer scaling on the raw scaled value: 25 lots of a 50-lot contract
    // is 1,250 units, not 1,249.99999.
    return Quantity.fromScaled(lots.scaled * BigInt(this.lotSize));
  }

  /**
   * Why this contract cannot be traded on a date, or `null`.
   *
   * Expiry is checked here rather than in the constructor: a contract that
   * expired last month is a perfectly valid thing to *hold in history* — its
   * trades are in the ledger and its business income is in last year's return.
   * Refusing to construct it would make the past unreadable.
   */
  tradableOn(date: CalendarDate): string | null {
    if (date.isOnOrBefore(this.expiry)) return null;
    return (
      `${this.symbol} expired on ${this.expiry.toISO()}. An expired contract cannot be traded ` +
      `and has no price — a position in it was settled at expiry, not carried forward.`
    );
  }

  daysToExpiry(asOf: CalendarDate): number {
    return asOf.daysUntil(this.expiry);
  }

  /**
   * The standard indicators, plus what only a contract has.
   *
   * `extras` rather than new fields on `InstrumentAnalysis`, so adding a leaf
   * never edits the shared return type — the same reason metadata is one JSON
   * column rather than fifteen nullable ones.
   */
  analyse(series: readonly Bar[]): InstrumentAnalysis {
    const base = analyseSeries(this.id.value, series);
    const days = this.daysToExpiry(base.asOf);
    return {
      ...base,
      warnings:
        days < 0
          ? [
              ...base.warnings,
              `${this.symbol} expired on ${this.expiry.toISO()}, ${-days} day(s) before the last ` +
                `bar. Indicators past an expiry describe a contract that no longer trades.`,
            ]
          : base.warnings,
      extras: {
        ...base.extras,
        underlying: this.underlyingSymbol,
        expiry: this.expiry.toISO(),
        daysToExpiry: String(days),
        lotSize: String(this.lotSize),
      },
    };
  }
}

/**
 * An exchange-traded option.
 *
 * The fourteenth leaf, and the proof of the Phase 8 gate: it is one class in this
 * one file, plus one line in {@link MarketInstrument.of} and one entry in the
 * metadata schema map. No engine changed to admit it — the tax engine met a new
 * `TaxCategory`, and the price book met a new `PricedAssetClass`, both of which
 * are data.
 */
export class Option extends DerivativeContract {
  readonly kind = "OPTION" as const;

  readonly underlyingSymbol: string;
  readonly right: "CALL" | "PUT";
  readonly strike: Money;
  readonly expiry: CalendarDate;
  readonly lotSize: number;
  readonly settlement: "CASH" | "PHYSICAL";

  constructor(props: InstrumentProps) {
    super(props);
    const meta = parseMetadata(OPTION_METADATA, "OPTION", props.metadata);
    this.underlyingSymbol = meta.underlyingSymbol;
    this.right = meta.right;
    this.strike = Money.fromRupees(meta.strike, props.currency);
    this.expiry = CalendarDate.parse(meta.expiry);
    this.lotSize = meta.lotSize;
    this.settlement = meta.settlement;
    if (!this.strike.isPositive) {
      throw new TypeError(`${props.symbol}: an option strike is a positive amount.`);
    }
  }

  /**
   * Whether the option is worth exercising at this spot, and by how much.
   *
   * Intrinsic value only — no premium, no time value, no model. A Black-Scholes
   * price needs a volatility input this app does not have and would be a
   * *guess presented as a valuation*, which is exactly what the pricing rules
   * forbid. The market price comes from the market, through `PriceBook`.
   */
  intrinsicValue(spot: Money): Money {
    const difference = this.right === "CALL" ? spot.minus(this.strike) : this.strike.minus(spot);
    return difference.isPositive ? difference : Money.zero(this.currency);
  }

  /**
   * The contract analysis, plus strike, right and moneyness at the last close.
   *
   * Moneyness is measured against the *underlying's* series, so the caller
   * passes the underlying's bars — an option's own premium series says nothing
   * about whether it is in the money.
   */
  analyse(series: readonly Bar[]): InstrumentAnalysis {
    const base = super.analyse(series);
    const lastClose = series.filter((bar) => !bar.supersededBy).at(-1)?.close ?? null;
    return {
      ...base,
      extras: {
        ...base.extras,
        right: this.right,
        strike: this.strike.toDecimalString(),
        ...(lastClose
          ? {
              underlyingClose: lastClose.toDecimalString(),
              moneyness: this.moneyness(lastClose.toMoney()),
              intrinsicValue: this.intrinsicValue(lastClose.toMoney()).toDecimalString(),
            }
          : { moneyness: "unknown — no underlying close in the series" }),
      },
    };
  }

  /** `ITM` / `ATM` / `OTM` at a spot price. */
  moneyness(spot: Money): "ITM" | "ATM" | "OTM" {
    if (spot.equals(this.strike)) return "ATM";
    const inTheMoney = this.right === "CALL" ? spot.isGreaterThan(this.strike) : spot.isLessThan(this.strike);
    return inTheMoney ? "ITM" : "OTM";
  }
}

/** An exchange-traded futures contract. The fifteenth leaf. */
export class Future extends DerivativeContract {
  readonly kind = "FUTURE" as const;

  readonly underlyingSymbol: string;
  readonly expiry: CalendarDate;
  /** `2026-09` — the monthly series, for rolling a position forward. */
  readonly contractMonth: string;
  readonly lotSize: number;
  readonly settlement: "CASH" | "PHYSICAL";

  constructor(props: InstrumentProps) {
    super(props);
    const meta = parseMetadata(FUTURE_METADATA, "FUTURE", props.metadata);
    this.underlyingSymbol = meta.underlyingSymbol;
    this.expiry = CalendarDate.parse(meta.expiry);
    this.contractMonth = meta.contractMonth;
    this.lotSize = meta.lotSize;
    this.settlement = meta.settlement;
  }

  /**
   * Mark-to-market on a position, which is where a future differs from
   * everything else in this file: the gain is realised daily by the exchange,
   * not on disposal, so it is a *movement* and can be negative.
   */
  markToMarket(lots: Quantity, entryPrice: UnitPrice, settlementPrice: UnitPrice): Money {
    const units = this.underlyingUnits(lots);
    return settlementPrice.times(units).minus(entryPrice.times(units));
  }

  /** The basis per unit: futures over spot. Positive is a premium, negative a discount. */
  basis(futuresPrice: UnitPrice, spot: UnitPrice): Money {
    return futuresPrice.times(ONE_UNIT).minus(spot.times(ONE_UNIT));
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
  /** Includes closed and soft-deleted rows because the database unique key does. */
  isSymbolReserved(userId: UserId, symbol: string): Promise<boolean>;
  list(userId: UserId, options?: { includeClosed?: boolean }): Promise<readonly MarketInstrument[]>;
  save(userId: UserId, kind: InstrumentKind, props: InstrumentProps): Promise<void>;

  /**
   * Tombstones an instrument. Soft, per A03 — the row keeps its `deleted_at` and
   * drops out of every read, so a trade that still references it can be
   * reconstructed rather than pointing at nothing.
   */
  softDelete(userId: UserId, id: InstrumentId, at: Date): Promise<void>;

  /** How many live trades reference it — a delete is refused if any do. */
  countTrades(userId: UserId, id: InstrumentId): Promise<number>;
}

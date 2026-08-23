import { ValueObject } from "@/core/kernel";
import { Money, ROUNDING, type RoundingMode } from "@/core/money";
import { Percentage, Quantity } from "@/core/numeric";
import type { CalendarDate } from "@/core/time";

/**
 * The charge engine.
 *
 * An Indian equity trade carries seven statutory and broker charges, and the tax
 * treatment of each differs. v1 lumped them into one "fees" number, which makes
 * two things impossible: reproducing a contract note, and computing a defensible
 * taxable gain — STT is not deductible, brokerage is, and stamp duty is
 * capitalised into cost basis.
 *
 * The split of responsibility here is deliberate. These classes hold the
 * *structure*: which charges apply, in what order, on what basis. The `charge_rates`
 * table holds the *numbers*. A broker changing its brokerage is a new row with a
 * later `effectiveFrom`, and a contract note from last year still reproduces
 * exactly — which it would not if the rate were a constant in a class body.
 */

/* ═══ Types ══════════════════════════════════════════════════════════════ */

export type ChargeType =
  | "BROKERAGE"
  | "STT"
  | "EXCHANGE_TXN"
  | "SEBI_TURNOVER"
  | "STAMP_DUTY"
  | "GST"
  | "DP_CHARGES"
  | "OTHER";

export type Segment = "EQ_DELIVERY" | "EQ_INTRADAY";

export type TradeSide = "BUY" | "SELL";

export type ChargeSide = TradeSide | "BOTH";

/**
 * What a charge does to a taxable gain.
 *
 * A property of the charge, not a comment somewhere else. The tax engine reads
 * `ChargeBreakdown.deductible` and there is no `total` on the path it can reach,
 * so deducting STT is not a mistake anyone can make by accident.
 */
export type Deductibility =
  /** Reduces the gain: brokerage, exchange fees, SEBI turnover, GST, DP. */
  | "DEDUCTIBLE"
  /** Explicitly not allowed against capital gains: securities transaction tax. */
  | "NON_DEDUCTIBLE"
  /** Added to cost basis instead of expensed: stamp duty. */
  | "CAPITALISED";

/** Whether a rate applies to turnover, to other charges, or per scrip-day. */
export type ChargeBasis = "TURNOVER" | "BROKERAGE_PLUS_FEES" | "PER_SCRIP_DAY";

/** Rounding granularity. STT and stamp duty round to the whole rupee. */
export type RoundingUnit = "PAISE" | "RUPEE";

/** One row of `charge_rates`, as the domain sees it. */
export interface ChargeRate {
  readonly brokerId: string;
  readonly segment: Segment;
  readonly chargeType: ChargeType;
  readonly side: ChargeSide;
  readonly basis: ChargeBasis;
  readonly rate: Percentage | null;
  readonly flat: Money | null;
  readonly cap: Money | null;
  readonly floor: Money | null;
  readonly deductibility: Deductibility;
  readonly rounding: RoundingMode;
  readonly roundingUnit: RoundingUnit;
  readonly effectiveFrom: CalendarDate;
  readonly effectiveTo: CalendarDate | null;
}

/** What a trade needs to state for its charges to be computable. */
export interface TradeFacts {
  readonly brokerId: string;
  readonly segment: Segment;
  readonly side: TradeSide;
  readonly tradedOn: CalendarDate;
  readonly exchange: "NSE" | "BSE";
  readonly quantity: Quantity;
  readonly pricePerUnit: Money;
  /**
   * Distinct scrips sold on this day, for the DP charge.
   *
   * Zerodha's DP fee is per scrip per day, not per trade: two sells of the same
   * scrip on one day are charged once, and two different scrips twice. Passing
   * the count rather than deriving it from one trade is what makes that
   * expressible — a single trade cannot know what else happened that day.
   */
  readonly scripDayCount?: number;
}

/* ═══ ChargeItem and ChargeBreakdown ════════════════════════════════════ */

/**
 * One computed charge, carrying how it was computed.
 *
 * `rule` is what makes a contract note reproducible in the other direction: given
 * a figure that disagrees with the broker, the rule id says which rate row
 * produced it.
 */
export class ChargeItem extends ValueObject {
  constructor(
    readonly type: ChargeType,
    readonly amount: Money,
    readonly deductibility: Deductibility,
    readonly basisAmount: Money,
    readonly rate: Percentage | null,
    readonly rule: string,
    readonly rounding: RoundingMode,
    readonly roundingUnit: RoundingUnit,
  ) {
    super();
  }

  protected components(): readonly unknown[] {
    return [this.type, this.amount.minor, this.rule];
  }
}

/**
 * The charges on one trade.
 *
 * Note what this class does *not* expose to the tax engine: there is no way to
 * ask it for a total and deduct that. `deductible`, `nonDeductible` and
 * `capitalised` are the three answers, and they partition `total` exactly.
 */
export class ChargeBreakdown extends ValueObject {
  private constructor(
    readonly items: readonly ChargeItem[],
    readonly currency: Money,
  ) {
    super();
  }

  static of(items: readonly ChargeItem[], zero: Money): ChargeBreakdown {
    return new ChargeBreakdown(items, zero);
  }

  static empty(zero: Money): ChargeBreakdown {
    return new ChargeBreakdown([], zero);
  }

  protected components(): readonly unknown[] {
    return this.items.map((i) => `${i.type}:${i.amount.minor}`);
  }

  private sumWhere(predicate: (item: ChargeItem) => boolean): Money {
    return this.items
      .filter(predicate)
      .reduce((acc, item) => acc.plus(item.amount), this.currency);
  }

  get total(): Money {
    return this.sumWhere(() => true);
  }

  /** The only figure the tax engine may reduce a gain by. */
  get deductible(): Money {
    return this.sumWhere((i) => i.deductibility === "DEDUCTIBLE");
  }

  /** STT. Recorded, reported, and never deducted. */
  get nonDeductible(): Money {
    return this.sumWhere((i) => i.deductibility === "NON_DEDUCTIBLE");
  }

  /** Stamp duty. Added to cost basis rather than expensed. */
  get capitalised(): Money {
    return this.sumWhere((i) => i.deductibility === "CAPITALISED");
  }

  by(type: ChargeType): Money {
    return this.sumWhere((i) => i.type === type);
  }

  find(type: ChargeType): ChargeItem | undefined {
    return this.items.find((i) => i.type === type);
  }
}

/* ═══ The rate table ════════════════════════════════════════════════════ */

/**
 * The effective-dated rate lookup.
 *
 * `for(...)` returns the row in force on a date, so a contract note from a
 * previous financial year reproduces under the rates that applied then. A broker
 * id of `*` holds the statutory charges, which are the same everywhere.
 */
export class ChargeRateTable {
  constructor(private readonly rows: readonly ChargeRate[]) {}

  find(
    brokerId: string,
    segment: Segment,
    chargeType: ChargeType,
    on: CalendarDate,
  ): ChargeRate | null {
    const candidates = this.rows.filter(
      (r) =>
        (r.brokerId === brokerId || r.brokerId === "*") &&
        r.segment === segment &&
        r.chargeType === chargeType &&
        r.effectiveFrom.isOnOrBefore(on) &&
        (r.effectiveTo === null || r.effectiveTo.isOnOrAfter(on)),
    );
    if (candidates.length === 0) return null;
    // Prefer a broker-specific row over the statutory wildcard, then the latest
    // effective date — so a broker override does not lose to a generic default.
    return candidates.sort((a, b) => {
      if (a.brokerId !== b.brokerId) return a.brokerId === "*" ? 1 : -1;
      return a.effectiveFrom.isBefore(b.effectiveFrom) ? 1 : -1;
    })[0];
  }

  /** True when this charge does not apply to this side of the trade. */
  static appliesToSide(rate: ChargeRate, side: TradeSide): boolean {
    return rate.side === "BOTH" || rate.side === side;
  }
}

/** Rounds to the rate's granularity — the detail a paisa-exact note turns on. */
function applyRounding(amount: Money, unit: RoundingUnit, mode: RoundingMode): Money {
  if (unit === "PAISE") return amount;
  // To the whole rupee: divide by the minor-unit factor and back.
  const factor = BigInt(amount.currency.minorUnitsPerMajor);
  return Money.fromMinor(amount.dividedBy(factor, mode).minor * factor, amount.currency);
}

/* ═══ BrokerChargeModel ═════════════════════════════════════════════════ */

/**
 * Template method: `compute` is final, subclasses supply only what differs.
 *
 * The statutory charges — STT, exchange transaction, SEBI turnover, stamp duty,
 * GST — are identical for every broker, so they live here once. A subclass
 * supplies brokerage and DP charges, which is the entire difference between
 * Zerodha and Groww.
 *
 * The order is fixed and load-bearing: GST is levied on brokerage plus the
 * exchange, SEBI and DP fees, so it must be computed after them. That is why
 * `compute` is not overridable.
 */
export abstract class BrokerChargeModel {
  constructor(
    readonly brokerId: string,
    protected readonly rates: ChargeRateTable,
  ) {}

  /** Turnover: quantity times price. The basis for every ad-valorem charge. */
  protected turnover(trade: TradeFacts): Money {
    return trade.quantity.valueAt(trade.pricePerUnit, ROUNDING.charge);
  }

  /** final — the ordering matters, so it is not open for a subclass to change. */
  compute(trade: TradeFacts): ChargeBreakdown {
    const zero = Money.zero(trade.pricePerUnit.currency);
    const items: ChargeItem[] = [];

    const push = (item: ChargeItem | null) => {
      if (item && !item.amount.isZero) items.push(item);
    };

    push(this.brokerage(trade));
    push(this.statutory(trade, "STT"));
    push(this.statutory(trade, "EXCHANGE_TXN"));
    push(this.statutory(trade, "SEBI_TURNOVER"));
    push(this.statutory(trade, "STAMP_DUTY"));
    push(this.dpCharges(trade));

    // GST last, and on the sum of the fee-bearing charges rather than turnover.
    const gstBase = items
      .filter((i) => i.type !== "STT" && i.type !== "STAMP_DUTY")
      .reduce((acc, i) => acc.plus(i.amount), zero);
    push(this.gst(trade, gstBase));

    return ChargeBreakdown.of(items, zero);
  }

  /** Brokerage — the one figure that genuinely differs between brokers. */
  protected abstract brokerage(trade: TradeFacts): ChargeItem | null;

  /** Depository charges, if the broker levies them. */
  protected abstract dpCharges(trade: TradeFacts): ChargeItem | null;

  /**
   * An ad-valorem charge on turnover, from the rate table.
   *
   * Returns `null` — not zero — when the charge does not apply to this side, so a
   * buy-side stamp duty and a sell-side-only intraday STT fall out of the
   * breakdown entirely rather than appearing as ₹0 lines.
   */
  protected statutory(trade: TradeFacts, type: ChargeType): ChargeItem | null {
    const rate = this.rates.find(this.brokerId, trade.segment, type, trade.tradedOn);
    if (!rate || !rate.rate) return null;
    if (!ChargeRateTable.appliesToSide(rate, trade.side)) return null;

    const basis = this.turnover(trade);
    const raw = rate.rate.applyTo(basis, rate.rounding);
    const amount = applyRounding(raw, rate.roundingUnit, rate.rounding);

    return new ChargeItem(
      type,
      amount,
      rate.deductibility,
      basis,
      rate.rate,
      this.ruleId(type, trade),
      rate.rounding,
      rate.roundingUnit,
    );
  }

  protected gst(trade: TradeFacts, base: Money): ChargeItem | null {
    const rate = this.rates.find(this.brokerId, trade.segment, "GST", trade.tradedOn);
    if (!rate || !rate.rate || base.isZero) return null;
    return new ChargeItem(
      "GST",
      rate.rate.applyTo(base, rate.rounding),
      rate.deductibility,
      base,
      rate.rate,
      this.ruleId("GST", trade),
      rate.rounding,
      rate.roundingUnit,
    );
  }

  /**
   * A rate capped and floored, which is how "0.03% or ₹20, whichever is lower"
   * is expressed without a special case per broker.
   */
  protected capped(amount: Money, rate: ChargeRate): Money {
    let result = amount;
    if (rate.cap && result.isGreaterThan(rate.cap)) result = rate.cap;
    if (rate.floor && result.isLessThan(rate.floor)) result = rate.floor;
    return result;
  }

  /** Names the rate row that produced a figure, for provenance. */
  protected ruleId(type: ChargeType, trade: TradeFacts): string {
    return `${this.brokerId.toUpperCase()}.${trade.segment}.${type}.${trade.tradedOn.toISO()}`;
  }
}

/* ═══ Concrete brokers ══════════════════════════════════════════════════ */

/**
 * Zerodha.
 *
 * Delivery brokerage is zero and intraday is min(0.03%, ₹20) per order. DP is
 * ₹15.34 per scrip per day on the sell side — per scrip-day, so two sells of the
 * same scrip in a day are charged once.
 */
export class ZerodhaChargeModel extends BrokerChargeModel {
  constructor(rates: ChargeRateTable) {
    super("zerodha", rates);
  }

  protected brokerage(trade: TradeFacts): ChargeItem | null {
    const rate = this.rates.find("zerodha", trade.segment, "BROKERAGE", trade.tradedOn);
    if (!rate) return null;
    const basis = this.turnover(trade);
    const raw = rate.rate ? rate.rate.applyTo(basis, rate.rounding) : (rate.flat ?? Money.zero(basis.currency));
    return new ChargeItem(
      "BROKERAGE",
      this.capped(raw, rate),
      rate.deductibility,
      basis,
      rate.rate,
      this.ruleId("BROKERAGE", trade),
      rate.rounding,
      rate.roundingUnit,
    );
  }

  protected dpCharges(trade: TradeFacts): ChargeItem | null {
    if (trade.side !== "SELL") return null;
    const rate = this.rates.find("zerodha", trade.segment, "DP_CHARGES", trade.tradedOn);
    if (!rate?.flat) return null;
    const scripDays = trade.scripDayCount ?? 1;
    return new ChargeItem(
      "DP_CHARGES",
      rate.flat.times(scripDays),
      rate.deductibility,
      rate.flat,
      null,
      this.ruleId("DP_CHARGES", trade),
      rate.rounding,
      rate.roundingUnit,
    );
  }
}

/** Groww. Flat 0.1% capped at ₹20 on both segments; a higher DP fee. */
export class GrowwChargeModel extends BrokerChargeModel {
  constructor(rates: ChargeRateTable) {
    super("groww", rates);
  }

  protected brokerage(trade: TradeFacts): ChargeItem | null {
    const rate = this.rates.find("groww", trade.segment, "BROKERAGE", trade.tradedOn);
    if (!rate?.rate) return null;
    const basis = this.turnover(trade);
    return new ChargeItem(
      "BROKERAGE",
      this.capped(rate.rate.applyTo(basis, rate.rounding), rate),
      rate.deductibility,
      basis,
      rate.rate,
      this.ruleId("BROKERAGE", trade),
      rate.rounding,
      rate.roundingUnit,
    );
  }

  protected dpCharges(trade: TradeFacts): ChargeItem | null {
    if (trade.side !== "SELL") return null;
    const rate = this.rates.find("groww", trade.segment, "DP_CHARGES", trade.tradedOn);
    if (!rate?.flat) return null;
    return new ChargeItem(
      "DP_CHARGES",
      rate.flat.times(trade.scripDayCount ?? 1),
      rate.deductibility,
      rate.flat,
      null,
      this.ruleId("DP_CHARGES", trade),
      rate.rounding,
      rate.roundingUnit,
    );
  }
}

/**
 * For a broker with no built-in model: the user supplies the rates.
 *
 * Statutory charges still come from the table, so only brokerage and DP need
 * asserting. That is the difference between "we support your broker" and "you can
 * still record your trade exactly".
 */
export class GenericChargeModel extends BrokerChargeModel {
  protected brokerage(trade: TradeFacts): ChargeItem | null {
    const rate = this.rates.find(this.brokerId, trade.segment, "BROKERAGE", trade.tradedOn);
    if (!rate) return null;
    const basis = this.turnover(trade);
    const raw = rate.rate ? rate.rate.applyTo(basis, rate.rounding) : (rate.flat ?? Money.zero(basis.currency));
    return new ChargeItem(
      "BROKERAGE",
      this.capped(raw, rate),
      rate.deductibility,
      basis,
      rate.rate,
      this.ruleId("BROKERAGE", trade),
      rate.rounding,
      rate.roundingUnit,
    );
  }

  protected dpCharges(trade: TradeFacts): ChargeItem | null {
    if (trade.side !== "SELL") return null;
    const rate = this.rates.find(this.brokerId, trade.segment, "DP_CHARGES", trade.tradedOn);
    if (!rate?.flat) return null;
    return new ChargeItem(
      "DP_CHARGES",
      rate.flat.times(trade.scripDayCount ?? 1),
      rate.deductibility,
      rate.flat,
      null,
      this.ruleId("DP_CHARGES", trade),
      rate.rounding,
      rate.roundingUnit,
    );
  }
}

/** Picks a model by broker id, falling back to the generic one. */
export function chargeModelFor(brokerId: string, rates: ChargeRateTable): BrokerChargeModel {
  switch (brokerId) {
    case "zerodha":
      return new ZerodhaChargeModel(rates);
    case "groww":
      return new GrowwChargeModel(rates);
    default:
      return new GenericChargeModel(brokerId, rates);
  }
}

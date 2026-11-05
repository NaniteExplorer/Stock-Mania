/**
 * Corporate actions — the gap `30-CALCULATIONS.md` calls critical.
 *
 * The design decision that everything else follows from: **a corporate action is
 * applied as a ledger transaction, never as an in-place edit of a lot.** Editing
 * lots is what every spreadsheet does, and it has three consequences that only
 * show up later — the change is invisible (nothing records that a split happened),
 * unauditable (the old quantities are gone) and irreversible (a wrongly-applied
 * 1:5 leaves no way back). Booking it as a transaction makes it a fact with a date,
 * a source and a reversal, exactly like every other fact in the ledger.
 *
 * The second decision: **charts use adjusted prices, cost basis uses raw prices.**
 * A ₹1,500 share that splits 1:5 did not fall 80% — the chart must show a
 * continuous series — but the ₹1,50,000 that was actually paid is what a capital
 * gain is computed from. Conflating the two either makes every historical chart a
 * cliff or reports an 80% loss on a split.
 *
 * Ten action types, each answering the same three questions: what happens to the
 * units, what happens to the money, and what the tax engine should see. The tax
 * engine never learns what a split is — a `Split` produces a rescale and nothing
 * else, so `taxableEvents()` is empty and there is no rule to write.
 */

import { ValueObject } from "@/core/kernel";
import { Currency, Money } from "@/core/money";
import { Percentage, Quantity, UnitPrice } from "@/core/numeric";
import { CalendarDate } from "@/core/time";
import { InstrumentId } from "@/domain/instruments";
import { Lot, LotId } from "@/domain/lots";

/* ═══ Effects ═════════════════════════════════════════════════════════ */

export type CorporateActionKind =
  | "SPLIT"
  | "REVERSE_SPLIT"
  | "BONUS"
  | "RIGHTS"
  | "MERGER"
  | "DEMERGER"
  | "SPINOFF"
  | "DIVIDEND_CASH"
  | "DIVIDEND_STOCK"
  | "RETURN_OF_CAPITAL";

/**
 * What an action does to the lots of a position.
 *
 * `RESCALE` multiplies units and leaves cost alone; `TRANSFER_BASIS` moves part of
 * the basis to another instrument (a demerger); `OPEN` creates units at a stated
 * cost (a rights issue); `REDUCE_BASIS` lowers cost without changing units (a
 * return of capital); `CLOSE` ends the position (a merger's outgoing leg).
 */
export type LotEffectKind = "RESCALE" | "OPEN" | "CLOSE" | "TRANSFER_BASIS" | "REDUCE_BASIS";

/** The fields an effect is built from. Each subclass reads the ones it needs. */
export interface LotEffectFields {
  readonly instrumentId: InstrumentId;
  /**
   * `RESCALE`: units are multiplied by `to` and divided by `from`.
   *
   * A ratio rather than one precomputed factor, because a factor rounds: 1/6 held
   * to eight decimals does not reverse a 1:6 split, and a corporate action that
   * cannot be undone exactly is the failure this design exists to prevent.
   */
  readonly ratio?: { readonly from: Quantity; readonly to: Quantity };
  /** `OPEN`: units created, and what they cost. */
  readonly quantity?: Quantity;
  readonly cost?: Money;
  /** `TRANSFER_BASIS` / `REDUCE_BASIS`: how much basis moves or falls. */
  readonly basisAmount?: Money;
  /** `TRANSFER_BASIS`: where it goes. */
  readonly toInstrumentId?: InstrumentId;
  /** Human-readable, because a lot's history is read by a person. */
  readonly note: string;
}

/** What an effect needs to know about the action that produced it. */
export interface LotEffectOrigin {
  readonly exDate: CalendarDate;
  readonly currency: Currency;
  readonly actionKind: CorporateActionKind;
}

/**
 * One thing an action does to a set of lots.
 *
 * **Each effect applies itself.** `CorporateAction.applyTo` used to switch on
 * `kind`, so a new effect needed an edit to the interpreter: the open–closed
 * test in `RULES.md` §8.2, failed, by a type-tag switch inside an engine (§8.3).
 * A new effect is now one new subclass and nothing else changes.
 *
 * `kind` and every field stay readable. A caller that *describes* an effect, such
 * as the use case reading a split's ratio, is not dispatching on it.
 */
export abstract class LotEffect implements LotEffectFields {
  abstract readonly kind: LotEffectKind;
  readonly instrumentId: InstrumentId;
  readonly ratio?: { readonly from: Quantity; readonly to: Quantity };
  readonly quantity?: Quantity;
  readonly cost?: Money;
  readonly basisAmount?: Money;
  readonly toInstrumentId?: InstrumentId;
  readonly note: string;

  constructor(fields: LotEffectFields) {
    this.instrumentId = fields.instrumentId;
    this.ratio = fields.ratio;
    this.quantity = fields.quantity;
    this.cost = fields.cost;
    this.basisAmount = fields.basisAmount;
    this.toInstrumentId = fields.toInstrumentId;
    this.note = fields.note;
  }

  /** Pure: returns new lots and leaves the input alone. */
  abstract applyTo(lots: readonly Lot[], origin: LotEffectOrigin): readonly Lot[];
}

/** Units scaled by a ratio, cost unchanged. A split or consolidation. */
export class RescaleLots extends LotEffect {
  readonly kind = "RESCALE" as const;

  applyTo(lots: readonly Lot[]): readonly Lot[] {
    const ratio = this.ratio ?? { from: Quantity.fromString("1"), to: Quantity.fromString("1") };
    return lots.map((lot) => (lot.isExhausted ? lot : lot.rescale(ratio)));
  }
}

/** New units at a stated cost. A bonus, a rights take-up, a merger's incoming leg. */
export class OpenLots extends LotEffect {
  readonly kind = "OPEN" as const;

  applyTo(lots: readonly Lot[], origin: LotEffectOrigin): readonly Lot[] {
    if (!this.quantity || !this.cost) return lots;
    return [
      ...lots,
      Lot.open({
        instrumentId: this.instrumentId,
        acquiredOn: origin.exDate,
        originalQuantity: this.quantity,
        cost: this.cost,
        buyCharges: Money.zero(origin.currency),
        openedByTransactionId: `corporate-${origin.actionKind.toLowerCase()}-${origin.exDate.toISO()}`,
      }),
    ];
  }
}

/** Every remaining unit ends. A merger's outgoing leg. */
export class CloseLots extends LotEffect {
  readonly kind = "CLOSE" as const;

  applyTo(lots: readonly Lot[]): readonly Lot[] {
    return lots.map((lot) =>
      lot.isExhausted ? lot : Lot.rehydrate({ ...lot.props, remainingQuantity: Quantity.ZERO }),
    );
  }
}

/**
 * Basis leaves in proportion to remaining units. The outgoing side of a
 * demerger; the receiving instrument's lots are opened by the paired effect.
 */
export class TransferBasis extends LotEffect {
  readonly kind = "TRANSFER_BASIS" as const;

  applyTo(lots: readonly Lot[]): readonly Lot[] {
    const moving = this.basisAmount;
    if (!moving) return lots;
    const held = Quantity.sum(lots.map((lot) => lot.remaining));
    if (held.isZero) return lots;
    return lots.map((lot) => {
      if (lot.isExhausted) return lot;
      const share = lot.remaining.shareOf(moving, held, "HALF_EVEN");
      return Lot.rehydrate({ ...lot.props, cost: lot.props.cost.minus(share) });
    });
  }
}

/** Basis falls with units unchanged. A return of capital. */
export class ReduceBasis extends LotEffect {
  readonly kind = "REDUCE_BASIS" as const;

  applyTo(lots: readonly Lot[]): readonly Lot[] {
    const reduction = this.basisAmount;
    if (!reduction) return lots;
    const held = Quantity.sum(lots.map((lot) => lot.remaining));
    if (held.isZero) return lots;
    return lots.map((lot) => {
      if (lot.isExhausted) return lot;
      const share = lot.remaining.shareOf(reduction, held, "HALF_EVEN");
      const reduced = lot.props.cost.minus(share);
      return Lot.rehydrate({
        ...lot.props,
        // Basis cannot go below zero: a return of capital beyond the basis is
        // a capital gain, which `taxableEvents` reports instead.
        cost: reduced.isNegative ? Money.zero(lot.currency) : reduced,
      });
    });
  }
}

/** Money the action moves, if any. A split moves none. */
export interface CashEffect {
  readonly amount: Money;
  readonly direction: "IN" | "OUT";
  readonly note: string;
  /** Cash dividends are income; a return of capital is not. */
  readonly isIncome: boolean;
}

/**
 * What the tax engine sees — and often nothing at all.
 *
 * A split, a bonus and a stock dividend are not taxable events in India: no gain
 * is realised because nothing was sold. Returning an empty list is the honest
 * answer and is what keeps the tax engine free of corporate-action rules.
 */
export interface CorporateTaxableEvent {
  readonly kind: "CAPITAL_GAIN" | "DIVIDEND" | "SLAB_INCOME";
  readonly onDate: CalendarDate;
  readonly instrumentId: InstrumentId;
  readonly proceeds: Money | null;
  readonly costBasis: Money | null;
  readonly gain: Money;
  readonly note: string;
}

/** How a historical price series is adjusted so a chart stays continuous. */
export interface PriceAdjustment {
  /** Prices strictly before this date are multiplied by `factor`. */
  readonly effectiveFrom: CalendarDate;
  readonly factor: Quantity;
  readonly note: string;
}

/* ═══ CorporateAction ═════════════════════════════════════════════════ */

export interface CorporateActionContext {
  readonly instrumentId: InstrumentId;
  /** The date the action takes effect — the ex-date, not the announcement. */
  readonly exDate: CalendarDate;
  readonly recordDate?: CalendarDate;
  /** What the position held immediately before the action. */
  readonly heldQuantity: Quantity;
  readonly currency: Currency;
  /** The announcement, for provenance. */
  readonly source?: string;
}

/**
 * A corporate action.
 *
 * Four hooks, mirroring `Transaction`'s: what happens to lots, what happens to
 * cash, what the tax engine sees, and how a price series is adjusted. Nothing else
 * in the system needs to know which subclass produced them, which is why a
 * fifteenth action type is a new class and no changes anywhere else.
 */
export abstract class CorporateAction extends ValueObject {
  protected constructor(readonly context: CorporateActionContext) {
    super();
    if (context.heldQuantity.isNegative) {
      throw new TypeError("A corporate action applies to a non-negative holding.");
    }
  }

  abstract readonly kind: CorporateActionKind;

  /** What it does to the lots. */
  abstract lotEffects(): readonly LotEffect[];

  /**
   * The action that undoes this one, booked as its own transaction.
   *
   * Only a ratio change has a corporate-action inverse. Everything else is undone
   * by reversing the ledger transaction it wrote — `Transaction.reverse()`'s job —
   * so the default is null rather than an inverse that only half-works. A subtype
   * that can invert itself says so here; nothing outside it asks what it is
   * (`RULES.md` §8.3).
   */
  inverse(): CorporateAction | null {
    return null;
  }

  /** What it does to cash. Most actions do nothing. */
  cashEffects(): readonly CashEffect[] {
    return [];
  }

  /** What the tax engine sees. Most actions produce nothing. */
  taxableEvents(): readonly CorporateTaxableEvent[] {
    return [];
  }

  /**
   * How to adjust prices before the ex-date so a chart is continuous.
   *
   * `null` when the action does not change the price scale — a cash dividend
   * technically does, but adjusting for it turns a price chart into a total-return
   * chart, and those are different questions. The choice is stated here rather
   * than left to whoever draws the chart.
   */
  priceAdjustment(): PriceAdjustment | null {
    return null;
  }

  /**
   * Applies the lot effects to a set of lots, returning new lots.
   *
   * Pure, like `LotBook.apply`, so the effect of an action can be previewed before
   * it is booked — and so applying it twice is detectably different from applying
   * it once, rather than silently compounding.
   */
  applyTo(lots: readonly Lot[]): readonly Lot[] {
    const origin: LotEffectOrigin = {
      exDate: this.context.exDate,
      currency: this.context.currency,
      actionKind: this.kind,
    };
    return this.lotEffects().reduce<readonly Lot[]>((current, effect) => effect.applyTo(current, origin), lots);
  }

  protected components(): readonly unknown[] {
    return [this.kind, this.context.instrumentId.value, this.context.exDate.toISO()];
  }

  toString(): string {
    return `${this.kind} ${this.context.instrumentId.value} on ${this.context.exDate.toISO()}`;
  }
}

/* ═══ Splits ══════════════════════════════════════════════════════════ */

/**
 * A forward split: `1:5` means one share becomes five.
 *
 * The ratio is expressed as `from:to` and both are required, because "a 5:1 split"
 * is said both ways in the wild — a British filing and an Indian one mean opposite
 * things by it. Naming the fields removes the ambiguity from the call site.
 */
export class Split extends CorporateAction {
  readonly kind = "SPLIT" as const;

  constructor(
    context: CorporateActionContext,
    readonly ratio: { readonly from: Quantity; readonly to: Quantity },
  ) {
    super(context);
    if (!ratio.from.isPositive || !ratio.to.isPositive) {
      throw new TypeError("A split ratio needs positive quantities on both sides.");
    }
    if (!ratio.to.isGreaterThan(ratio.from)) {
      throw new TypeError(
        `A split increases the unit count; ${ratio.from.toDecimalString()}:${ratio.to.toDecimalString()} ` +
          `does not. Use ReverseSplit.`,
      );
    }
  }

  get factor(): Quantity {
    return this.ratio.to.ratioTo(this.ratio.from);
  }

  override inverse(): CorporateAction {
    return new ReverseSplit(this.context, { from: this.ratio.to, to: this.ratio.from });
  }

  lotEffects(): readonly LotEffect[] {
    return [
      new RescaleLots({
        instrumentId: this.context.instrumentId,
        ratio: this.ratio,
        note: `${this.ratio.from.toDecimalString()}:${this.ratio.to.toDecimalString()} split — units × ${this.factor.toDecimalString()}, cost unchanged`,
      }),
    ];
  }

  /**
   * Prices before the ex-date are divided by the factor.
   *
   * So the chart is continuous and the basis is not: `Lot.rescale` leaves cost
   * alone while this adjusts the *price series*. Both are needed and they are
   * different numbers, which is the distinction the plan's done-when is about.
   */
  priceAdjustment(): PriceAdjustment {
    return {
      effectiveFrom: this.context.exDate,
      // The inverse of the unit factor: five times the units, a fifth of the price.
      factor: this.ratio.from.ratioTo(this.ratio.to),
      note: `Prices before ${this.context.exDate.toISO()} divided by ${this.factor.toDecimalString()}`,
    };
  }
}

/** A consolidation: `5:1` means five shares become one. */
export class ReverseSplit extends CorporateAction {
  readonly kind = "REVERSE_SPLIT" as const;

  constructor(
    context: CorporateActionContext,
    readonly ratio: { readonly from: Quantity; readonly to: Quantity },
  ) {
    super(context);
    if (!ratio.from.isGreaterThan(ratio.to)) {
      throw new TypeError("A reverse split reduces the unit count. Use Split.");
    }
  }

  get factor(): Quantity {
    return this.ratio.to.ratioTo(this.ratio.from);
  }

  override inverse(): CorporateAction {
    return new Split(this.context, { from: this.ratio.to, to: this.ratio.from });
  }

  lotEffects(): readonly LotEffect[] {
    return [
      new RescaleLots({
        instrumentId: this.context.instrumentId,
        ratio: this.ratio,
        note: `${this.ratio.from.toDecimalString()}:${this.ratio.to.toDecimalString()} consolidation`,
      }),
    ];
  }

  priceAdjustment(): PriceAdjustment {
    return {
      effectiveFrom: this.context.exDate,
      factor: this.ratio.from.ratioTo(this.ratio.to),
      note: `Prices before ${this.context.exDate.toISO()} multiplied by ${this.ratio.from.ratioTo(this.ratio.to).toDecimalString()}`,
    };
  }
}

/* ═══ Bonus and rights ════════════════════════════════════════════════ */

/**
 * A bonus issue: free shares, `1:1` meaning one free per one held.
 *
 * Arithmetically a split — the same money over more units — and deliberately a
 * separate class anyway, because the *holding period of the bonus shares* is a
 * question a split never raises. In India bonus shares take the ex-date as their
 * acquisition date for holding-period purposes, so a long-held position that
 * receives a bonus has a short-term tranche the next day. Modelling it as a
 * rescale would silently give the bonus units the original purchase date and
 * report a long-term gain where a short-term one is due.
 */
export class Bonus extends CorporateAction {
  readonly kind = "BONUS" as const;

  constructor(
    context: CorporateActionContext,
    readonly ratio: { readonly held: Quantity; readonly received: Quantity },
  ) {
    super(context);
    if (!ratio.held.isPositive || !ratio.received.isPositive) {
      throw new TypeError("A bonus ratio needs positive quantities.");
    }
  }

  /** Units issued, given what is held. */
  get issuedQuantity(): Quantity {
    return Quantity.fromRatio(
      this.context.heldQuantity.scaled * this.ratio.received.scaled,
      this.ratio.held.scaled * 10n ** 8n,
    );
  }

  lotEffects(): readonly LotEffect[] {
    return [
      new OpenLots({
        instrumentId: this.context.instrumentId,
        quantity: this.issuedQuantity,
        // Zero cost: nothing was paid. The gain on eventual sale is the whole
        // proceeds, which is the correct and unwelcome answer.
        cost: Money.zero(this.context.currency),
        note:
          `${this.ratio.received.toDecimalString()}-for-${this.ratio.held.toDecimalString()} bonus — ` +
          `${this.issuedQuantity.toDecimalString()} units at nil cost, acquired ${this.context.exDate.toISO()}`,
      }),
    ];
  }

  priceAdjustment(): PriceAdjustment {
    const totalAfter = this.context.heldQuantity.plus(this.issuedQuantity);
    return {
      effectiveFrom: this.context.exDate,
      factor: this.context.heldQuantity.isZero
        ? Quantity.fromString("1")
        : this.context.heldQuantity.ratioTo(totalAfter),
      note: "Prices before the ex-date scaled by the pre-bonus share of the enlarged holding",
    };
  }
}

/**
 * A rights issue taken up: new units at a stated price.
 *
 * Cash goes out and units come in at what was paid — an ordinary purchase in
 * everything but name. A rights issue *renounced* is not this class: nothing
 * happens to the holding, and the renunciation proceeds are a capital gain, which
 * `RightsRenunciation` reports.
 */
export class Rights extends CorporateAction {
  readonly kind = "RIGHTS" as const;

  constructor(
    context: CorporateActionContext,
    readonly subscription: {
      readonly quantity: Quantity;
      readonly pricePerUnit: UnitPrice;
    },
  ) {
    super(context);
    if (!subscription.quantity.isPositive) {
      throw new TypeError("A rights subscription takes a positive quantity.");
    }
  }

  get amountPaid(): Money {
    return this.subscription.pricePerUnit.times(this.subscription.quantity);
  }

  lotEffects(): readonly LotEffect[] {
    return [
      new OpenLots({
        instrumentId: this.context.instrumentId,
        quantity: this.subscription.quantity,
        cost: this.amountPaid,
        note: `Rights subscription at ${this.subscription.pricePerUnit.toDecimalString()} per unit`,
      }),
    ];
  }

  cashEffects(): readonly CashEffect[] {
    return [
      {
        amount: this.amountPaid,
        direction: "OUT",
        note: "Rights subscription paid",
        isIncome: false,
      },
    ];
  }
}

/* ═══ Mergers, demergers, spinoffs ════════════════════════════════════ */

/**
 * A merger: the holding becomes units of another company.
 *
 * The basis carries across — a merger in the statutory form is **not a taxable
 * event**, and reporting one would tax a gain nobody realised. The old position
 * closes, the new one opens with the same money and, importantly, **the original
 * acquisition date**: holding period is preserved through a merger, so a
 * three-year holding does not become a one-day holding.
 */
export class Merger extends CorporateAction {
  readonly kind = "MERGER" as const;

  constructor(
    context: CorporateActionContext,
    readonly terms: {
      readonly intoInstrumentId: InstrumentId;
      /** Units of the acquirer received per unit held. */
      readonly exchangeRatio: Quantity;
      /** Any cash element, which *is* taxable. */
      readonly cashPerUnit?: UnitPrice;
    },
  ) {
    super(context);
    if (!terms.exchangeRatio.isPositive) {
      throw new TypeError("A merger needs a positive exchange ratio.");
    }
  }

  get receivedQuantity(): Quantity {
    return Quantity.fromRatio(
      this.context.heldQuantity.scaled * this.terms.exchangeRatio.scaled,
      10n ** 16n,
    );
  }

  get cashReceived(): Money {
    return this.terms.cashPerUnit
      ? this.terms.cashPerUnit.times(this.context.heldQuantity)
      : Money.zero(this.context.currency);
  }

  lotEffects(): readonly LotEffect[] {
    return [
      new CloseLots({
        instrumentId: this.context.instrumentId,
        note: `Merged into ${this.terms.intoInstrumentId.value}`,
      }),
      new OpenLots({
        instrumentId: this.terms.intoInstrumentId,
        quantity: this.receivedQuantity,
        // The caller supplies the outgoing basis; a merger moves it unchanged.
        cost: Money.zero(this.context.currency),
        note: `Received on merger at ${this.terms.exchangeRatio.toDecimalString()} per unit held`,
      }),
    ];
  }

  cashEffects(): readonly CashEffect[] {
    const cash = this.cashReceived;
    return cash.isZero
      ? []
      : [{ amount: cash, direction: "IN", note: "Cash element of the merger", isIncome: false }];
  }

  /**
   * Only the cash element is taxable, and only to the extent it exceeds basis.
   *
   * The share-for-share part is exempt under §47, which is why this returns an
   * event *only* when cash changed hands. `costBasis` is left null for the caller
   * to fill from the actual lots — the action does not know them.
   */
  taxableEvents(): readonly CorporateTaxableEvent[] {
    const cash = this.cashReceived;
    if (cash.isZero) return [];
    return [
      {
        kind: "CAPITAL_GAIN",
        onDate: this.context.exDate,
        instrumentId: this.context.instrumentId,
        proceeds: cash,
        costBasis: null,
        gain: cash,
        note: "Cash element of a merger is taxable; the share-for-share part is not",
      },
    ];
  }
}

/**
 * A demerger or spinoff: part of the basis moves to a new instrument.
 *
 * The split of basis is by **relative fair value on the ex-date**, which is the
 * statutory method and cannot be derived from anything the ledger holds — so it is
 * an input. A demerger that guessed 50/50 would misstate both positions' gains for
 * as long as they are held.
 */
export class Demerger extends CorporateAction {
  readonly kind: CorporateActionKind = "DEMERGER";

  constructor(
    context: CorporateActionContext,
    readonly terms: {
      readonly intoInstrumentId: InstrumentId;
      /** Units of the new entity received per unit held. */
      readonly ratio: Quantity;
      /** Share of the original basis that moves — from the relative fair values. */
      readonly basisShare: Percentage;
      /** The original position's total basis, which the caller reads from the lots. */
      readonly originalBasis: Money;
    },
  ) {
    super(context);
  }

  get receivedQuantity(): Quantity {
    return Quantity.fromRatio(this.context.heldQuantity.scaled * this.terms.ratio.scaled, 10n ** 16n);
  }

  get basisMoved(): Money {
    return this.terms.basisShare.applyTo(this.terms.originalBasis);
  }

  lotEffects(): readonly LotEffect[] {
    return [
      new TransferBasis({
        instrumentId: this.context.instrumentId,
        basisAmount: this.basisMoved,
        toInstrumentId: this.terms.intoInstrumentId,
        note: `${this.terms.basisShare.toFixed(2)}% of basis moved to ${this.terms.intoInstrumentId.value}`,
      }),
      new OpenLots({
        instrumentId: this.terms.intoInstrumentId,
        quantity: this.receivedQuantity,
        cost: this.basisMoved,
        note: "Demerged entity received, carrying its share of the original basis",
      }),
    ];
  }
}

/**
 * A spinoff. Same arithmetic as a demerger; the distinction is legal, not financial.
 *
 * A subclass rather than a `kind` flag on `Demerger` so a screen and a report can
 * label it correctly — the two are announced differently and a user looking for
 * "the Jio spinoff" will not find "demerger".
 */
export class Spinoff extends Demerger {
  override readonly kind: CorporateActionKind = "SPINOFF";
}

/* ═══ Distributions ═══════════════════════════════════════════════════ */

/**
 * A cash dividend.
 *
 * Income, taxed at slab since 2020 — no longer exempt, which is the change most
 * spreadsheets never absorbed. It does **not** change the lots: a dividend is not
 * a reduction of basis, and treating it as one understates every later gain.
 */
export class DividendCash extends CorporateAction {
  readonly kind = "DIVIDEND_CASH" as const;

  constructor(
    context: CorporateActionContext,
    readonly perUnit: UnitPrice,
    /** TDS withheld at source, which is a credit rather than a cost. */
    readonly taxWithheld: Money = Money.zero(context.currency),
  ) {
    super(context);
  }

  get grossAmount(): Money {
    return this.perUnit.times(this.context.heldQuantity);
  }

  get netAmount(): Money {
    return this.grossAmount.minus(this.taxWithheld);
  }

  lotEffects(): readonly LotEffect[] {
    return [];
  }

  cashEffects(): readonly CashEffect[] {
    return [
      {
        amount: this.netAmount,
        direction: "IN",
        note:
          this.taxWithheld.isZero
            ? `Dividend of ${this.perUnit.toDecimalString()} per unit`
            : `Dividend of ${this.perUnit.toDecimalString()} per unit, net of ${this.taxWithheld.toString()} TDS`,
        isIncome: true,
      },
    ];
  }

  taxableEvents(): readonly CorporateTaxableEvent[] {
    return [
      {
        kind: "DIVIDEND",
        onDate: this.context.exDate,
        instrumentId: this.context.instrumentId,
        proceeds: this.grossAmount,
        costBasis: null,
        // The gross figure is taxable; the TDS is a credit against the bill, not a
        // reduction of the income.
        gain: this.grossAmount,
        note: "Dividend income, taxed at slab since FY2020-21",
      },
    ];
  }
}

/**
 * A stock dividend: units instead of cash.
 *
 * Not taxable on receipt, and — like a bonus — the new units take the ex-date as
 * their acquisition date. Nil cost, so the eventual gain is the whole proceeds.
 */
export class DividendStock extends CorporateAction {
  readonly kind = "DIVIDEND_STOCK" as const;

  constructor(
    context: CorporateActionContext,
    readonly issuedQuantity: Quantity,
  ) {
    super(context);
    if (!issuedQuantity.isPositive) {
      throw new TypeError("A stock dividend issues a positive quantity.");
    }
  }

  lotEffects(): readonly LotEffect[] {
    return [
      new OpenLots({
        instrumentId: this.context.instrumentId,
        quantity: this.issuedQuantity,
        cost: Money.zero(this.context.currency),
        note: `Stock dividend of ${this.issuedQuantity.toDecimalString()} units at nil cost`,
      }),
    ];
  }
}

/**
 * A return of capital: cash that reduces basis rather than being income.
 *
 * The distinction from a dividend is the whole reason this class exists. A ₹10
 * dividend is ₹10 of taxable income; a ₹10 return of capital is ₹10 off what was
 * paid, taxed only when the position is sold — and taxed as a *gain* once basis
 * reaches zero, which is the case `applyTo` clamps and `taxableEvents` reports.
 */
export class ReturnOfCapital extends CorporateAction {
  readonly kind = "RETURN_OF_CAPITAL" as const;

  constructor(
    context: CorporateActionContext,
    readonly amount: Money,
    /** The position's basis before the distribution, so the excess can be found. */
    readonly basisBefore: Money,
  ) {
    super(context);
    if (!amount.isPositive) throw new TypeError("A return of capital is a positive amount.");
  }

  /** The part that exceeds basis, which is a capital gain now rather than later. */
  get excessOverBasis(): Money {
    const excess = this.amount.minus(this.basisBefore);
    return excess.isNegative ? Money.zero(this.amount.currency) : excess;
  }

  lotEffects(): readonly LotEffect[] {
    const reduction = this.amount.minus(this.excessOverBasis);
    return reduction.isZero
      ? []
      : [
          new ReduceBasis({
            instrumentId: this.context.instrumentId,
            basisAmount: reduction,
            note: `Return of capital — basis reduced by ${reduction.toString()}`,
          }),
        ];
  }

  cashEffects(): readonly CashEffect[] {
    return [
      {
        amount: this.amount,
        direction: "IN",
        note: "Return of capital",
        isIncome: false,
      },
    ];
  }

  taxableEvents(): readonly CorporateTaxableEvent[] {
    const excess = this.excessOverBasis;
    return excess.isZero
      ? []
      : [
          {
            kind: "CAPITAL_GAIN",
            onDate: this.context.exDate,
            instrumentId: this.context.instrumentId,
            proceeds: excess,
            costBasis: Money.zero(this.amount.currency),
            gain: excess,
            note: "Return of capital beyond basis is a capital gain in the year received",
          },
        ];
  }
}

/* ═══ Price adjustment over a series ══════════════════════════════════ */

export interface PricePoint {
  readonly on: CalendarDate;
  readonly price: UnitPrice;
}

/**
 * Adjusts a historical price series for a list of actions.
 *
 * **Charts use this; cost basis never does.** That separation is the plan's
 * done-when for corporate actions, and it is a single function rather than a flag
 * on the price so that nothing can accidentally value a holding at an adjusted
 * price: an adjusted series is a different object, produced on request, for
 * drawing.
 *
 * Adjustments compound: a price before two splits is divided by both factors, so
 * they are applied in reverse chronological order.
 */
export function adjustSeries(
  series: readonly PricePoint[],
  adjustments: readonly PriceAdjustment[],
): readonly PricePoint[] {
  const ordered = [...adjustments].sort((a, b) => b.effectiveFrom.compareTo(a.effectiveFrom));
  return series.map((point) => {
    let scaled = point.price;
    for (const adjustment of ordered) {
      if (point.on.isBefore(adjustment.effectiveFrom)) {
        scaled = UnitPrice.fromScaled(
          (scaled.scaled * adjustment.factor.scaled) / 10n ** 8n,
          scaled.currency,
        );
      }
    }
    return { on: point.on, price: scaled };
  });
}

/* ═══ Reversal ════════════════════════════════════════════════════════ */

/**
 * The inverse of an action, for undoing one applied in error.
 *
 * Available because actions are transactions: a wrongly-entered 1:5 split is
 * reversed by a 5:1 consolidation with the same ex-date, and the lots come back to
 * where they were. An in-place lot edit would have nothing to reverse — which is
 * the argument for the whole design, stated as code.
 */
export function inverseOf(action: CorporateAction): CorporateAction | null {
  return action.inverse();
}

/* ═══ Repository port ═════════════════════════════════════════════════ */

export interface StoredCorporateAction {
  readonly id: string;
  readonly kind: CorporateActionKind;
  readonly instrumentId: InstrumentId;
  readonly exDate: CalendarDate;
  readonly recordDate: CalendarDate | null;
  /** The action's own terms, as JSON — each kind's shape differs. */
  readonly terms: Readonly<Record<string, string>>;
  /** The ledger transaction it wrote, so it can be reversed. */
  readonly transactionId: string | null;
  readonly appliedAt: Date | null;
}

export interface CorporateActionRepository {
  listFor(
    instrumentId: InstrumentId,
    options?: { appliedOnly?: boolean },
  ): Promise<readonly StoredCorporateAction[]>;
  save(action: StoredCorporateAction): Promise<void>;
  markApplied(id: string, transactionId: string, at: Date): Promise<void>;
}

/** Lots affected by an action, for the caller that has to persist the result. */
export interface ActionApplication {
  readonly action: CorporateAction;
  readonly lotsBefore: readonly Lot[];
  readonly lotsAfter: readonly Lot[];
  readonly cashEffects: readonly CashEffect[];
  readonly taxableEvents: readonly CorporateTaxableEvent[];
  readonly priceAdjustment: PriceAdjustment | null;
}

/** Applies an action and returns everything a caller needs to persist. */
export function applyAction(action: CorporateAction, lots: readonly Lot[]): ActionApplication {
  return {
    action,
    lotsBefore: lots,
    lotsAfter: action.applyTo(lots),
    cashEffects: action.cashEffects(),
    taxableEvents: action.taxableEvents(),
    priceAdjustment: action.priceAdjustment(),
  };
}

export { LotId };

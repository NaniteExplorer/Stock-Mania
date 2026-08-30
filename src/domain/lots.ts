/**
 * Lots, cost basis and disposals.
 *
 * A port of v1's FIFO engine — whose logic was correct — into `Money` and
 * `Quantity`, generalised to the five selection strategies behind one interface.
 * The strategy is set per account and overridable per disposal, because both are
 * real: a broker account has a house method, and a single sale may be specified
 * lot by lot for tax reasons.
 *
 * Two properties are the reason this file is a separate concept rather than part of
 * `transactions.ts`:
 *
 *   - **All five methods dispose the same total quantity and differ only in
 *     basis.** That is the property test, and it is the one that catches a strategy
 *     that quietly drops or duplicates units.
 *   - **A fully liquidated position's realised gain equals proceeds minus cost,
 *     exactly, with no leaked paise.** Basis is split with `Money.allocate`, which
 *     distributes the remainder rather than rounding each part independently —
 *     rounding per part is how a hundred partial sales lose a rupee.
 *
 * `AverageCost` is the one that cannot be computed incrementally. A backdated buy
 * changes the average that every later disposal used, so the whole position is
 * recomputed forward from the earliest affected transaction. Pretending otherwise
 * — adjusting only the new trade — is how an average-cost portfolio drifts away
 * from its own history.
 */

import { UniqueId, UserId, ValueObject, newUuid } from "@/core/kernel";
import { Currency, Money } from "@/core/money";
import { Quantity } from "@/core/numeric";
import { CalendarDate } from "@/core/time";
import { InstrumentId } from "@/domain/instruments";

/* ═══ Identity ════════════════════════════════════════════════════════ */

export class LotId extends UniqueId {
  static create(): LotId {
    return new LotId(newUuid());
  }

  static from(value: string): LotId {
    return new LotId(value);
  }
}

/* ═══ Lot ═════════════════════════════════════════════════════════════ */

export interface LotProps {
  readonly id: LotId;
  readonly instrumentId: InstrumentId;
  readonly acquiredOn: CalendarDate;
  readonly originalQuantity: Quantity;
  readonly remainingQuantity: Quantity;
  /** Purchase cost of the original quantity, excluding charges. */
  readonly cost: Money;
  /** Buy-side charges attributed to this lot, on the original quantity. */
  readonly buyCharges: Money;
  /** The trade that opened it, so a lot can always be traced to an event. */
  readonly openedByTransactionId: string;
}

/**
 * One purchase, and what is left of it.
 *
 * Cost and charges are separate fields rather than one "total cost", because they
 * are reported differently: charges are capitalised into "amount invested" for
 * return purposes and are deductible against a gain for tax purposes, while STT
 * inside them is not. Conflating them overstates the gain in one direction and the
 * return in the other.
 *
 * Immutable. A consumption produces a new lot, so a disposal cannot half-apply.
 */
export class Lot extends ValueObject {
  private constructor(readonly props: LotProps) {
    super();
    if (props.originalQuantity.isNegative || props.originalQuantity.isZero) {
      throw new TypeError("A lot must open with a positive quantity.");
    }
    if (props.remainingQuantity.isNegative) {
      throw new TypeError("A lot cannot have negative remaining quantity (P02).");
    }
    if (props.remainingQuantity.isGreaterThan(props.originalQuantity)) {
      throw new TypeError(
        `A lot cannot have more remaining (${props.remainingQuantity.toDecimalString()}) than it ` +
          `opened with (${props.originalQuantity.toDecimalString()}) — invariant P02.`,
      );
    }
  }

  static open(props: Omit<LotProps, "remainingQuantity" | "id"> & { id?: LotId }): Lot {
    return new Lot({
      ...props,
      id: props.id ?? LotId.create(),
      remainingQuantity: props.originalQuantity,
    });
  }

  static rehydrate(props: LotProps): Lot {
    return new Lot(props);
  }

  get id(): LotId {
    return this.props.id;
  }

  get acquiredOn(): CalendarDate {
    return this.props.acquiredOn;
  }

  get remaining(): Quantity {
    return this.props.remainingQuantity;
  }

  get isExhausted(): boolean {
    return this.props.remainingQuantity.isZero;
  }

  get currency(): Currency {
    return this.props.cost.currency;
  }

  /** Cost per unit, excluding charges — what an average-cost report shows. */
  get costPerUnit(): Money {
    return this.props.originalQuantity.perUnit(this.props.cost, "HALF_EVEN");
  }

  /** Cost plus charges: what was actually paid for the original quantity. */
  get totalInvested(): Money {
    return this.props.cost.plus(this.props.buyCharges);
  }

  /** The basis still sitting in this lot — proportional to what remains. */
  get remainingCost(): Money {
    return this.props.remainingQuantity.shareOf(
      this.props.cost,
      this.props.originalQuantity,
      "HALF_EVEN",
    );
  }

  get remainingCharges(): Money {
    return this.props.remainingQuantity.shareOf(
      this.props.buyCharges,
      this.props.originalQuantity,
      "HALF_EVEN",
    );
  }

  /**
   * Consumes `quantity`, returning the reduced lot and the basis taken.
   *
   * The basis of the consumed part is `quantity/original × cost`, computed by
   * `shareOf` in exact integer arithmetic. The *remaining* lot keeps the rest by
   * subtraction rather than by its own proportional calculation, which is what
   * makes the parts sum back to the whole exactly — two independent proportions
   * would each round and the two roundings would not cancel.
   */
  consume(quantity: Quantity): { lot: Lot; costTaken: Money; chargesTaken: Money } {
    if (quantity.isNegative || quantity.isZero) {
      throw new TypeError("A consumption takes a positive quantity.");
    }
    if (quantity.isGreaterThan(this.props.remainingQuantity)) {
      throw new TypeError(
        `Cannot take ${quantity.toDecimalString()} from a lot with ` +
          `${this.props.remainingQuantity.toDecimalString()} remaining (P03).`,
      );
    }

    const costBefore = this.remainingCost;
    const chargesBefore = this.remainingCharges;
    const reduced = new Lot({
      ...this.props,
      remainingQuantity: this.props.remainingQuantity.minus(quantity),
    });

    // Subtraction, not a second proportion: whatever the reduced lot now holds,
    // the difference is exactly what left.
    return {
      lot: reduced,
      costTaken: costBefore.minus(reduced.remainingCost),
      chargesTaken: chargesBefore.minus(reduced.remainingCharges),
    };
  }

  /**
   * Rescales a lot for a split or bonus: more units, same money.
   *
   * The cost is untouched on purpose — a 1:5 split does not change what was paid,
   * only how many things it was paid for. Cost *per unit* therefore falls by five,
   * which is the correct and often-surprising answer.
   */
  rescale(ratio: { from: Quantity; to: Quantity }): Lot {
    if (!ratio.from.isPositive || !ratio.to.isPositive) {
      throw new TypeError("A rescale ratio needs positive quantities on both sides.");
    }
    /*
     * The ratio is applied as a ratio, not as a precomputed factor, and that is a
     * correction rather than a preference.
     *
     * A single factor for a 5:1 consolidation is 0.16666667 — `Quantity` holds
     * eight decimals — so splitting 1:6 and consolidating 6:1 did **not** return
     * the original quantity, which the round-trip property test caught. Multiplying
     * by `to` and dividing by `from` in one exact bigint expression is reversible.
     */
    const scale = (quantity: Quantity) =>
      Quantity.fromScaled((quantity.scaled * ratio.to.scaled) / ratio.from.scaled);
    return new Lot({
      ...this.props,
      originalQuantity: scale(this.props.originalQuantity),
      remainingQuantity: scale(this.props.remainingQuantity),
    });
  }

  protected components(): readonly unknown[] {
    return [
      this.props.id.value,
      this.props.remainingQuantity.toString(),
      this.props.cost.toString(),
    ];
  }

  toString(): string {
    return `Lot ${this.props.acquiredOn.toISO()} ${this.props.remainingQuantity.toDecimalString()}/${this.props.originalQuantity.toDecimalString()}`;
  }
}

/* ═══ Disposal ════════════════════════════════════════════════════════ */

/** One lot consumed by one sale. Written once; never recomputed. */
export interface Disposal {
  /**
   * The lot consumed — `null` under average cost, where no particular lot was.
   *
   * Nullable rather than faked with the sale's own id: a disposal that named a lot
   * that did not exist would be traceable to nothing, and "the average of the
   * position" is the honest answer to which lot this came from.
   */
  readonly lotId: LotId | null;
  readonly instrumentId: InstrumentId;
  readonly quantity: Quantity;
  readonly acquiredOn: CalendarDate;
  readonly disposedOn: CalendarDate;
  /** Gross sale value of these units. */
  readonly proceeds: Money;
  /** Purchase price of these units, excluding charges. */
  readonly costBasis: Money;
  readonly buyCharges: Money;
  readonly sellCharges: Money;
  /** `proceeds − costBasis − deductible charges`. */
  readonly gain: Money;
  readonly holdingDays: number;
}

export interface DisposalResult {
  readonly disposals: readonly Disposal[];
  /** Lots after the sale, in their original order, exhausted ones included. */
  readonly lots: readonly Lot[];
  readonly totalProceeds: Money;
  readonly totalCostBasis: Money;
  readonly totalGain: Money;
  /** Units the sale could not source — a short position, which most accounts forbid. */
  readonly unmatchedQuantity: Quantity;
}

/* ═══ Strategies ══════════════════════════════════════════════════════ */

export type LotSelectionMethod = "FIFO" | "LIFO" | "HIFO" | "AVERAGE_COST" | "SPECIFIC_ID";

/**
 * Which lots a sale consumes, and in what order.
 *
 * One interface, five implementations, and the *only* thing that differs between
 * them is the order the open lots are offered in. That is the whole reason the
 * total disposed quantity cannot differ between methods — the consumption loop is
 * shared, so a strategy has no opportunity to lose a unit.
 */
export interface LotSelectionStrategy {
  readonly method: LotSelectionMethod;
  /** Open lots in the order this method consumes them. */
  order(lots: readonly Lot[], context: SelectionContext): readonly Lot[];
}

export interface SelectionContext {
  readonly disposedOn: CalendarDate;
  /** For `SpecificId`: which lots the user nominated, in order. */
  readonly nominatedLotIds?: readonly LotId[];
}

/** Oldest first. The Indian statutory default for equities. */
export class Fifo implements LotSelectionStrategy {
  readonly method = "FIFO" as const;

  order(lots: readonly Lot[]): readonly Lot[] {
    return [...lots].sort(
      (a, b) => a.acquiredOn.compareTo(b.acquiredOn) || compareIds(a, b),
    );
  }
}

/** Newest first. */
export class Lifo implements LotSelectionStrategy {
  readonly method = "LIFO" as const;

  order(lots: readonly Lot[]): readonly Lot[] {
    return [...lots].sort(
      (a, b) => b.acquiredOn.compareTo(a.acquiredOn) || compareIds(a, b),
    );
  }
}

/**
 * Highest cost first — the tax-minimising order for a gain.
 *
 * Compared on cost *per unit*, not on total cost: a lot of 100 units at ₹90 has a
 * higher total cost than 10 units at ₹500 and a lower basis per unit, and it is the
 * per-unit figure that decides which sale realises less gain.
 */
export class Hifo implements LotSelectionStrategy {
  readonly method = "HIFO" as const;

  order(lots: readonly Lot[]): readonly Lot[] {
    return [...lots].sort((a, b) => {
      const byCost = b.costPerUnit.compareTo(a.costPerUnit);
      return byCost !== 0 ? byCost : a.acquiredOn.compareTo(b.acquiredOn) || compareIds(a, b);
    });
  }
}

/**
 * Average cost: every unit has the same basis.
 *
 * The consumption order is still FIFO — the holding period has to come from
 * somewhere, and the oldest units are what a mutual fund registrar reports — but
 * the *basis* is the position-wide average. {@link AverageCostBook} is what
 * actually computes it, because an average is a property of the position rather
 * than of a lot, and no per-lot ordering can express it.
 */
export class AverageCost implements LotSelectionStrategy {
  readonly method = "AVERAGE_COST" as const;

  order(lots: readonly Lot[]): readonly Lot[] {
    return new Fifo().order(lots);
  }
}

/**
 * The lots the user nominated, in the order they nominated them.
 *
 * Lots not nominated are appended in FIFO order rather than being excluded: a
 * nomination that under-covers the sale would otherwise fail with "unmatched
 * quantity" when the user simply forgot one, and silently failing a sale is worse
 * than continuing predictably.
 */
export class SpecificId implements LotSelectionStrategy {
  readonly method = "SPECIFIC_ID" as const;

  order(lots: readonly Lot[], context: SelectionContext): readonly Lot[] {
    const nominated = context.nominatedLotIds ?? [];
    const byId = new Map(lots.map((lot) => [lot.id.value, lot]));
    const chosen: Lot[] = [];
    for (const id of nominated) {
      const lot = byId.get(id.value);
      if (lot) {
        chosen.push(lot);
        byId.delete(id.value);
      }
    }
    return [...chosen, ...new Fifo().order([...byId.values()])];
  }
}

function compareIds(a: Lot, b: Lot): number {
  return a.id.value < b.id.value ? -1 : a.id.value > b.id.value ? 1 : 0;
}

export function strategyFor(method: LotSelectionMethod): LotSelectionStrategy {
  switch (method) {
    case "FIFO":
      return new Fifo();
    case "LIFO":
      return new Lifo();
    case "HIFO":
      return new Hifo();
    case "AVERAGE_COST":
      return new AverageCost();
    case "SPECIFIC_ID":
      return new SpecificId();
  }
}

export const ALL_METHODS: readonly LotSelectionMethod[] = [
  "FIFO",
  "LIFO",
  "HIFO",
  "AVERAGE_COST",
  "SPECIFIC_ID",
];

/* ═══ LotBook ═════════════════════════════════════════════════════════ */

export interface SaleInput {
  readonly instrumentId: InstrumentId;
  readonly quantity: Quantity;
  readonly disposedOn: CalendarDate;
  /** Gross sale value of the whole sale, before charges. */
  readonly proceeds: Money;
  /** Sell-side charges for the whole sale. */
  readonly sellCharges: Money;
  /** Charges that may be set against the gain — STT is excluded from this. */
  readonly deductibleSellCharges?: Money;
  readonly nominatedLotIds?: readonly LotId[];
}

/**
 * The position's lots, and what a sale does to them.
 *
 * Pure: given lots in, it returns lots out. Nothing here writes, so the same sale
 * can be *previewed* under five strategies before one is chosen — which is what
 * makes "show me what HIFO would save" answerable without touching the ledger.
 */
export class LotBook {
  constructor(
    private readonly strategy: LotSelectionStrategy,
    private readonly currency: Currency = Currency.reporting,
  ) {}

  get method(): LotSelectionMethod {
    return this.strategy.method;
  }

  /** Units still held. */
  static openQuantity(lots: readonly Lot[]): Quantity {
    return Quantity.sum(lots.map((lot) => lot.remaining));
  }

  /**
   * Cost basis of what is still held, and its per-unit average.
   *
   * The invariant P01 — the sum of lot remainders equals the position — is what
   * makes this the same number as a broker's holding statement.
   */
  static openPosition(
    lots: readonly Lot[],
    currency: Currency = Currency.reporting,
  ): { quantity: Quantity; cost: Money; charges: Money; averageCostPerUnit: Money | null } {
    const quantity = LotBook.openQuantity(lots);
    const cost = Money.total(lots.map((lot) => lot.remainingCost), currency);
    const charges = Money.total(lots.map((lot) => lot.remainingCharges), currency);
    return {
      quantity,
      cost,
      charges,
      averageCostPerUnit: quantity.isZero ? null : quantity.perUnit(cost, "HALF_EVEN"),
    };
  }

  /**
   * Applies a sale.
   *
   * Proceeds and sell charges are allocated across the consumed lots **by
   * `Money.allocate`**, weighted by the units each lot gave up. That is what makes
   * the parts sum back to the whole exactly: allocating distributes the leftover
   * paise to the largest remainders instead of rounding each part on its own, and
   * per-part rounding across a hundred sales is how a portfolio loses a rupee that
   * nothing can account for.
   */
  apply(lots: readonly Lot[], sale: SaleInput): DisposalResult {
    if (!sale.quantity.isPositive) {
      throw new TypeError("A sale disposes a positive quantity.");
    }

    const open = lots.filter((lot) => !lot.isExhausted);
    const ordered = this.strategy.order(open, {
      disposedOn: sale.disposedOn,
      nominatedLotIds: sale.nominatedLotIds,
    });

    // First pass: decide how much comes from each lot.
    const takes: { lot: Lot; quantity: Quantity }[] = [];
    let outstanding = sale.quantity;
    for (const lot of ordered) {
      if (!outstanding.isPositive) break;
      const take = Quantity.min(lot.remaining, outstanding);
      if (!take.isPositive) continue;
      takes.push({ lot, quantity: take });
      outstanding = outstanding.minus(take);
    }

    const matched = Quantity.sum(takes.map((take) => take.quantity));
    // Weights are the units taken, as exact scaled integers: a large holding's
    // scaled quantity exceeds a double's safe range, and a weight that lost
    // precision would allocate proceeds slightly wrongly with nothing to notice.
    const weights = takes.map((take) => take.quantity.scaled);
    const proceedsParts = takes.length > 0 ? sale.proceeds.allocate(weights) : [];
    const sellChargeParts =
      takes.length > 0
        ? (sale.deductibleSellCharges ?? sale.sellCharges).allocate(weights)
        : [];

    const disposals: Disposal[] = [];
    const replacements = new Map<string, Lot>();

    takes.forEach((take, index) => {
      const consumed = take.lot.consume(take.quantity);
      replacements.set(take.lot.id.value, consumed.lot);

      const proceeds = proceedsParts[index];
      const sellCharges = sellChargeParts[index];
      const gain = proceeds
        .minus(consumed.costTaken)
        .minus(consumed.chargesTaken)
        .minus(sellCharges);

      disposals.push({
        lotId: take.lot.id,
        instrumentId: sale.instrumentId,
        quantity: take.quantity,
        acquiredOn: take.lot.acquiredOn,
        disposedOn: sale.disposedOn,
        proceeds,
        costBasis: consumed.costTaken,
        buyCharges: consumed.chargesTaken,
        sellCharges,
        gain,
        holdingDays: take.lot.acquiredOn.daysUntil(sale.disposedOn),
      });
    });

    return {
      disposals,
      lots: lots.map((lot) => replacements.get(lot.id.value) ?? lot),
      totalProceeds: Money.total(disposals.map((disposal) => disposal.proceeds), this.currency),
      totalCostBasis: Money.total(disposals.map((disposal) => disposal.costBasis), this.currency),
      totalGain: Money.total(disposals.map((disposal) => disposal.gain), this.currency),
      unmatchedQuantity: sale.quantity.minus(matched),
    };
  }

  /**
   * What each strategy would realise on the same sale.
   *
   * The comparison the tax-aware seller actually wants, and it is only cheap
   * because `apply` is pure. `SPECIFIC_ID` is included and behaves as FIFO unless
   * lots are nominated, which is the honest answer rather than an omission.
   */
  static compare(
    lots: readonly Lot[],
    sale: SaleInput,
    currency: Currency = Currency.reporting,
  ): readonly { method: LotSelectionMethod; gain: Money; costBasis: Money }[] {
    return ALL_METHODS.map((method) => {
      const result = new LotBook(strategyFor(method), currency).apply(lots, sale);
      return { method, gain: result.totalGain, costBasis: result.totalCostBasis };
    });
  }
}

/* ═══ Average cost ════════════════════════════════════════════════════ */

export interface PositionEvent {
  readonly kind: "BUY" | "SELL" | "RESCALE";
  readonly on: CalendarDate;
  readonly quantity: Quantity;
  /** BUY: what was paid. SELL: gross proceeds. RESCALE: unused. */
  readonly amount: Money;
  readonly charges: Money;
  /** RESCALE only: units are multiplied by `to` and divided by `from`, exactly. */
  readonly ratio?: { readonly from: Quantity; readonly to: Quantity };
  readonly transactionId: string;
}

export interface AverageCostState {
  readonly quantity: Quantity;
  readonly cost: Money;
  readonly averagePerUnit: Money | null;
  readonly realisedGain: Money;
  readonly disposals: readonly Disposal[];
}

/**
 * Average cost, recomputed forward over the whole event history.
 *
 * **This is the class the plan's done-when is about.** A backdated buy changes the
 * average that every later sale used, so there is no incremental update that is
 * correct: the only honest answer is to replay. `recompute` takes the events in
 * date order and folds, so inserting an event anywhere and replaying produces the
 * state that history implies — and the test asserts exactly that, by inserting a
 * backdated buy and comparing against a replay from scratch.
 *
 * Firefly and Actual do not have this problem because they do not do cost basis.
 * Every tool that does, and updates incrementally, drifts.
 */
export class AverageCostBook {
  constructor(
    private readonly instrumentId: InstrumentId,
    private readonly currency: Currency = Currency.reporting,
  ) {}

  recompute(events: readonly PositionEvent[]): AverageCostState {
    const ordered = [...events].sort(
      (a, b) => a.on.compareTo(b.on) || a.transactionId.localeCompare(b.transactionId),
    );

    let quantity = Quantity.ZERO;
    let cost = Money.zero(this.currency);
    let realised = Money.zero(this.currency);
    const disposals: Disposal[] = [];
    // The earliest acquisition still held, for the holding-period clock.
    let holdingSince: CalendarDate | null = null;

    for (const event of ordered) {
      if (event.kind === "BUY") {
        quantity = quantity.plus(event.quantity);
        cost = cost.plus(event.amount).plus(event.charges);
        holdingSince = holdingSince ?? event.on;
        continue;
      }

      if (event.kind === "RESCALE") {
        // Units change, money does not — the average per unit falls by the ratio.
        const ratio = event.ratio ?? { from: Quantity.fromString("1"), to: Quantity.fromString("1") };
        quantity = Quantity.fromScaled((quantity.scaled * ratio.to.scaled) / ratio.from.scaled);
        continue;
      }

      // SELL: basis is the average, so the gain is proceeds less that average.
      const soldQuantity = Quantity.min(quantity, event.quantity);
      if (!soldQuantity.isPositive) continue;
      const basis = soldQuantity.shareOf(cost, quantity, "HALF_EVEN");
      const gain = event.amount.minus(basis).minus(event.charges);

      disposals.push({
        // No lot: under average cost the basis is the position's, not a lot's.
        lotId: null,
        instrumentId: this.instrumentId,
        quantity: soldQuantity,
        acquiredOn: holdingSince ?? event.on,
        disposedOn: event.on,
        proceeds: event.amount,
        costBasis: basis,
        buyCharges: Money.zero(this.currency),
        sellCharges: event.charges,
        gain,
        holdingDays: (holdingSince ?? event.on).daysUntil(event.on),
      });

      quantity = quantity.minus(soldQuantity);
      cost = cost.minus(basis);
      realised = realised.plus(gain);
      if (quantity.isZero) holdingSince = null;
    }

    return {
      quantity,
      cost,
      averagePerUnit: quantity.isZero ? null : quantity.perUnit(cost, "HALF_EVEN"),
      realisedGain: realised,
      disposals,
    };
  }

  /**
   * The earliest date a change affects, given the event being inserted.
   *
   * What a caller needs in order to recompute *only* the affected span rather than
   * a whole portfolio — and the reason it is a method rather than a comment is that
   * "recompute from here" is easy to get wrong by one event, which reintroduces the
   * drift.
   */
  static affectedFrom(events: readonly PositionEvent[], inserted: PositionEvent): CalendarDate {
    const earlier = events
      .map((event) => event.on)
      .filter((date) => date.isOnOrBefore(inserted.on))
      .sort((a, b) => b.compareTo(a));
    return earlier[0] ?? inserted.on;
  }
}

/* ═══ Repository port ═════════════════════════════════════════════════ */

/**
 * The broker-level record of a trade, distinct from the ledger transaction it
 * wrote.
 *
 * Both exist because they answer different questions: the transaction is what the
 * money did, and the trade is what the broker did — each statutory charge in its
 * own column, because STT is not deductible while brokerage is, and a single
 * "fees" total cannot answer that later. `transactionId` ties them together and is
 * the same id, so a trade is always traceable to its postings.
 */
export interface TradeRecord {
  readonly id: string;
  readonly instrumentId: InstrumentId;
  readonly side: "BUY" | "SELL";
  readonly tradedOn: CalendarDate;
  readonly quantity: Quantity;
  readonly pricePerUnit: Money;
  readonly charges: Money;
  readonly transactionId: string;
  readonly settlementAccountId: string | null;
}

/**
 * A stored `lot_matches` row, identified.
 *
 * `Disposal` is the tax report's shape and carries no row id, because nothing
 * needed to address one match until a sale could be undone. Restoring a lot
 * means tombstoning exactly the rows that consumed it, so the id is the whole
 * point of this type existing beside `Disposal` rather than instead of it.
 */
export interface StoredLotMatch {
  readonly id: string;
  readonly sellTradeId: string;
  readonly lotId: LotId;
  readonly quantity: Quantity;
}

/**
 * What a void has to write, decided before anything is written.
 *
 * A plan rather than a sequence of repository calls, because the whole unwind
 * has to be one transaction: a restore that half-succeeds leaves a position that
 * either double-counts units or loses them, and only the first of those is
 * detectable. Building the plan is also where the `Lot` constructor's P02 check
 * runs — on objects, before a single row moves.
 */
export interface TradeVoidPlan {
  readonly tradeId: string;
  /** Lots the voided buy opened. Tombstoned. */
  readonly lotsToTombstone: readonly LotId[];
  /** Lots the voided sell consumed, with their quantity already restored. */
  readonly lotsToRestore: readonly Lot[];
  /** `lot_matches` rows the voided sell wrote. Tombstoned. */
  readonly matchesToTombstone: readonly string[];
}

export interface LotRepository {
  /** Writes the broker-level trade row a lot and a disposal both reference. */
  recordTrade(userId: UserId, trade: TradeRecord): Promise<void>;

  /** Open lots for a position, oldest first. */
  openLots(userId: UserId, instrumentId: InstrumentId): Promise<readonly Lot[]>;
  /** Every lot, including exhausted ones — a realised-gain report needs them. */
  allLots(userId: UserId, instrumentId: InstrumentId): Promise<readonly Lot[]>;
  saveLots(userId: UserId, lots: readonly Lot[]): Promise<void>;
  saveDisposals(
    userId: UserId,
    sellTransactionId: string,
    disposals: readonly Disposal[],
  ): Promise<void>;
  /** Realised disposals in a period, for the tax report. */
  disposalsWithin(
    userId: UserId,
    from: CalendarDate,
    to: CalendarDate,
  ): Promise<readonly Disposal[]>;

  /* ── Corrections ──────────────────────────────────────────────────── */

  /** One trade by id, or nothing. The id is also the transaction's. */
  findTrade(userId: UserId, tradeId: string): Promise<TradeRecord | null>;

  /** Every live trade on a position, oldest first, ties broken by id. */
  tradesFor(userId: UserId, instrumentId: InstrumentId): Promise<readonly TradeRecord[]>;

  /** The lots a buy opened — one, unless a corporate action split it. */
  lotsFromBuy(userId: UserId, buyTradeId: string): Promise<readonly Lot[]>;

  /** The matches a sale wrote, so a void knows exactly what to give back. */
  matchesForSell(userId: UserId, sellTradeId: string): Promise<readonly StoredLotMatch[]>;

  /** The matches that consumed a lot, so a buy void knows whether it may. */
  matchesAgainstLot(userId: UserId, lotId: LotId): Promise<readonly StoredLotMatch[]>;

  /**
   * Applies a whole void in one transaction: restores, tombstones, done.
   *
   * One call rather than four so a correction — void then re-record — can wrap
   * the pair, and so a partial unwind is not a state the database can be left in.
   */
  voidTrade(userId: UserId, plan: TradeVoidPlan, at: Date): Promise<void>;
}

/**
 * Undoing and restating a trade.
 *
 * Until now the investments module could only add. You could register an
 * instrument, buy, sell and split, and there was no way to correct a fat-fingered
 * price or remove a purchase entered twice — which meant the only fix was a
 * compensating trade that never happened, and a lot book that described a
 * portfolio nobody owned.
 *
 * The difficulty is that this feature straddles two storage models with opposite
 * rules. The **ledger** is append-only (A03): a posted transaction is corrected
 * by posting its mirror image, never by editing it, so both the mistake and the
 * fix stay on the statement. The **lot book** is not: `remainingQuantity` is
 * mutable by design, because a sale consumes lots in place. So a void has to
 * reverse on one side and unwind on the other, and get the second one exactly
 * right — a lot restored by the wrong amount is a wrong capital gain, filed.
 *
 * ## What is refused, and why refusal is the feature
 *
 * A void is allowed only when nothing later on that position depends on the
 * trade. Four refusals, each of which would otherwise produce a *confidently
 * wrong* number rather than an error:
 *
 *   1. **A buy whose lot has been sold.** The units are gone into a disposal
 *      with a stored gain and a stored holding period. Deleting the lot they came
 *      from would strand that gain against nothing. The message names the sales
 *      that block it, because voiding those first is the actual fix.
 *   2. **A sale with a corporate action after it.** `lot_matches.quantity` is
 *      frozen in *pre-split* units. Restoring 40 units to a lot that has since
 *      been 1:5 split under-restores by 160; after a consolidation it overshoots
 *      and trips P02. Scaling by the ratio would look like a fix and would
 *      silently disagree with the disposal that was already reported.
 *   3. **A sale whose matches do not add up to it.** `saveDisposals` skips any
 *      disposal with no lot — under a position-wide average there is no
 *      particular lot to name, so there is correctly no row. A surgical unwind
 *      then has nothing to give some of those units back to and would
 *      *succeed*, leaving the position quietly short. This is the most dangerous
 *      case in the feature because it fails silently, so the units the matches
 *      account for are compared against the units the trade sold, and anything
 *      less is refused. The check is on the arithmetic rather than on the method
 *      name, which is why it also catches a half-tombstoned history and a match
 *      lost to any other cause.
 *   4. **A buy under a basis-moving action** — a merger, demerger, spinoff or
 *      return of capital. Those pushed part of this lot's basis into another
 *      instrument's lots; removing the source strands it.
 *
 * ## Why not replay the whole position
 *
 * Rebuilding the lot book by folding the trade history would be the more elegant
 * answer and is the wrong one *today*, because the schema cannot replay
 * faithfully: `trades` stores neither the lot-selection method, nor the charge
 * treatment, nor the deductible/non-deductible split, and `ApplyCorporateAction`
 * writes its ratio as an empty string. A replay would return a number for every
 * case, and some of those numbers would be wrong in a tax return. An honest
 * refusal beats a confident answer. Closing those four gaps is the prerequisite
 * for replay, and it is worth doing.
 */

import {
  AppError,
  Err,
  NotFoundError,
  Ok,
  Result,
  UseCase,
  UserId,
  ValidationError,
} from "@/core/kernel";
import { CalendarDate } from "@/core/time";
import { AccountId } from "@/domain/accounts";
import { CorporateActionRepository } from "@/domain/corporate";
import { InstrumentId, InstrumentRepository } from "@/domain/instruments";
import { Lot, LotRepository, LotSelectionMethod, TradeRecord, TradeVoidPlan } from "@/domain/lots";
import { Money } from "@/core/money";
import { Quantity } from "@/core/numeric";
import { TransactionId, TransactionRepository } from "@/domain/transactions";
import { ReverseTransaction } from "@/app/ledger.usecases";
import {
  RecordBuy,
  RecordBuyOutput,
  RecordSell,
  RecordSellOutput,
} from "@/app/investing.usecases";

/* ═══ Void ════════════════════════════════════════════════════════════ */

/**
 * Which of the two honest stories a void tells.
 *
 * The same distinction `accounts/actions.ts` draws for a bank transaction, and
 * for the same reason: a reversal says "this happened and was recorded wrongly",
 * a delete says "this never happened". Collapsing them into one button would mean
 * every correction either invented a phantom pair of postings or destroyed the
 * evidence of the original.
 */
export type TradeVoidMode = "REVERSE" | "DELETE";

export interface VoidTradeInput {
  userId: UserId;
  /** The trade id — which is also the id of the transaction it posted. */
  tradeId: string;
  mode: TradeVoidMode;
  /** Dates the reversal. Defaults to the original's own date, so it lands in period. */
  reversedOn?: CalendarDate;
  reason?: string;
}

export interface VoidTradeOutput {
  readonly tradeId: string;
  readonly side: "BUY" | "SELL";
  readonly instrumentId: InstrumentId;
  /** Present only for `REVERSE`. */
  readonly reversalTransactionId: string | null;
  readonly lotsTombstoned: number;
  readonly lotsRestored: number;
  readonly matchesTombstoned: number;
  /** Units the position gained back (sell) or lost (buy). */
  readonly quantityUndone: Quantity;
}

export class VoidTrade implements UseCase<VoidTradeInput, VoidTradeOutput> {
  constructor(
    private readonly journal: TransactionRepository,
    private readonly lots: LotRepository,
    private readonly actionsFor: (userId: UserId) => CorporateActionRepository,
    private readonly reverse: ReverseTransaction,
  ) {}

  async execute(input: VoidTradeInput): Promise<Result<VoidTradeOutput, AppError>> {
    const trade = await this.lots.findTrade(input.userId, input.tradeId);
    if (!trade) return Err(new NotFoundError("Trade", input.tradeId));

    const plan =
      trade.side === "BUY"
        ? await this.planBuyVoid(input.userId, trade)
        : await this.planSellVoid(input.userId, trade);
    if (!plan.ok) return plan;

    /*
     * The ledger leg first, and only then the lot leg. A reversal that fails
     * (already reversed, for instance) must not leave the lots unwound against a
     * journal that still shows the trade — that is a portfolio and a net worth
     * disagreeing, which is the one failure this whole architecture exists to
     * prevent.
     */
    let reversalTransactionId: string | null = null;
    if (input.mode === "REVERSE") {
      const reversed = await this.reverse.execute({
        userId: input.userId,
        transactionId: TransactionId.from(trade.transactionId),
        reversedOn: input.reversedOn,
        narration: input.reason,
      });
      if (!reversed.ok) return reversed;
      reversalTransactionId = reversed.value.reversalTransactionId.value;
    } else {
      await this.journal.softDelete(
        input.userId,
        TransactionId.from(trade.transactionId),
        new Date(),
      );
    }

    await this.lots.voidTrade(input.userId, plan.value, new Date());

    return Ok({
      tradeId: trade.id,
      side: trade.side,
      instrumentId: trade.instrumentId,
      reversalTransactionId,
      lotsTombstoned: plan.value.lotsToTombstone.length,
      lotsRestored: plan.value.lotsToRestore.length,
      matchesTombstoned: plan.value.matchesToTombstone.length,
      quantityUndone: trade.quantity,
    });
  }

  /* ── Buy ─────────────────────────────────────────────────────────── */

  private async planBuyVoid(
    userId: UserId,
    trade: TradeRecord,
  ): Promise<Result<TradeVoidPlan, AppError>> {
    const opened = await this.lots.lotsFromBuy(userId, trade.id);
    if (opened.length === 0) {
      return Err(
        new ValidationError(
          `The purchase of ${trade.tradedOn.toISO()} has no open lot to remove — it may already ` +
            `have been voided.`,
          { tradeId: ["Nothing to undo"] },
        ),
      );
    }

    /*
     * Consumption is tested by asking for the matches, not by comparing
     * `remaining` against `original`. A split rescales both, and a return of
     * capital reduces basis without touching either, so the quantity comparison
     * is both false-positive and — after a reverse split — false-negative. The
     * matches are the record of what was actually sold.
     */
    const blocking: string[] = [];
    for (const lot of opened) {
      const consumed = await this.lots.matchesAgainstLot(userId, lot.id);
      for (const match of consumed) blocking.push(match.sellTradeId);
    }
    if (blocking.length > 0) {
      const sales = await this.describeSales(userId, [...new Set(blocking)]);
      return Err(
        new ValidationError(
          `Some of what this purchase bought has already been sold (${sales}). Void those sales ` +
            `first — removing the lot underneath a disposal would leave a realised gain with no ` +
            `cost basis behind it.`,
          { tradeId: ["Already sold"] },
        ),
      );
    }

    const blockedBy = await this.basisMovingActionAfter(userId, trade);
    if (blockedBy) {
      return Err(
        new ValidationError(
          `A ${blockedBy.toLowerCase().replace(/_/g, " ")} on this holding after ` +
            `${trade.tradedOn.toISO()} moved part of this lot's cost into another instrument. ` +
            `Removing the lot would strand that basis, so this purchase cannot be voided.`,
          { tradeId: ["Corporate action applied"] },
        ),
      );
    }

    return Ok({
      tradeId: trade.id,
      lotsToTombstone: opened.map((lot) => lot.id),
      lotsToRestore: [],
      matchesToTombstone: [],
    });
  }

  /* ── Sell ────────────────────────────────────────────────────────── */

  private async planSellVoid(
    userId: UserId,
    trade: TradeRecord,
  ): Promise<Result<TradeVoidPlan, AppError>> {
    const matches = await this.lots.matchesForSell(userId, trade.id);

    /*
     * The matches must account for every unit the sale disposed of. A disposal
     * with no lot — a position-wide average has none to name — is skipped by
     * `saveDisposals`, correctly, and leaves this sum short. Restoring only what
     * is recorded would put back fewer units than were taken and report success,
     * which is the one failure mode here that a user would never notice.
     */
    const accountedFor = matches.reduce(
      (total, match) => total.plus(match.quantity),
      Quantity.ZERO,
    );
    if (!accountedFor.equals(trade.quantity)) {
      return Err(
        new ValidationError(
          `The sale of ${trade.tradedOn.toISO()} disposed of ${trade.quantity.toDecimalString()} ` +
            `units, but only ${accountedFor.toDecimalString()} of them can be traced to a lot. ` +
            `Restoring the difference would be a guess, so this sale cannot be voided — reverse ` +
            `its ledger entry from the transaction list if it is the money that is wrong.`,
          { tradeId: ["Units not fully traceable"] },
        ),
      );
    }

    const action = await this.anyActionOnOrAfter(userId, trade);
    if (action) {
      return Err(
        new ValidationError(
          `A ${action.kind.toLowerCase().replace(/_/g, " ")} dated ${action.exDate.toISO()} has ` +
            `been applied since this sale. The disposal recorded its units in pre-action terms, ` +
            `so putting them back would restore the wrong quantity. Voiding this sale is not safe.`,
          { tradeId: ["Corporate action applied"] },
        ),
      );
    }

    /*
     * Every restored lot is constructed *before* anything is written, so the
     * `Lot` constructor's P02 check — remaining may not exceed original — aborts
     * the whole void rather than leaving half a position restored. A refusal that
     * half-wrote is worse than no refusal at all.
     */
    const byLot = new Map<string, Quantity>();
    for (const match of matches) {
      const running = byLot.get(match.lotId.value);
      byLot.set(match.lotId.value, running ? running.plus(match.quantity) : match.quantity);
    }

    const current = await this.lots.allLots(userId, trade.instrumentId);
    const restored: Lot[] = [];
    for (const [lotId, quantity] of byLot) {
      const lot = current.find((candidate) => candidate.id.value === lotId);
      if (!lot) {
        return Err(
          new ValidationError(
            `The sale of ${trade.tradedOn.toISO()} consumed a lot that no longer exists. ` +
              `Restoring it would invent units, so this sale cannot be voided.`,
            { tradeId: ["Lot missing"] },
          ),
        );
      }
      try {
        restored.push(
          Lot.rehydrate({ ...lot.props, remainingQuantity: lot.remaining.plus(quantity) }),
        );
      } catch (error) {
        return Err(
          new ValidationError(
            `Restoring ${quantity.toDecimalString()} units to the lot of ` +
              `${lot.acquiredOn.toISO()} would put more back than it ever held ` +
              `(${(error as Error).message}). Nothing has been changed.`,
            { tradeId: ["Would break invariant P02"] },
          ),
        );
      }
    }

    return Ok({
      tradeId: trade.id,
      lotsToTombstone: [],
      lotsToRestore: restored,
      matchesToTombstone: matches.map((match) => match.id),
    });
  }

  /* ── Shared checks ───────────────────────────────────────────────── */

  /** Actions that move basis out of a lot rather than merely rescaling it. */
  private async basisMovingActionAfter(
    userId: UserId,
    trade: TradeRecord,
  ): Promise<string | null> {
    const actions = await this.actionsFor(userId).listFor(trade.instrumentId);
    const moving = actions.find(
      (action) =>
        BASIS_MOVING.has(action.kind) &&
        action.appliedAt !== null &&
        !action.exDate.isBefore(trade.tradedOn),
    );
    return moving?.kind ?? null;
  }

  private async anyActionOnOrAfter(userId: UserId, trade: TradeRecord) {
    const actions = await this.actionsFor(userId).listFor(trade.instrumentId);
    return (
      actions.find(
        (action) => action.appliedAt !== null && !action.exDate.isBefore(trade.tradedOn),
      ) ?? null
    );
  }

  private async describeSales(userId: UserId, tradeIds: readonly string[]): Promise<string> {
    const described: string[] = [];
    for (const id of tradeIds.slice(0, 3)) {
      const sale = await this.lots.findTrade(userId, id);
      described.push(
        sale
          ? `${sale.quantity.toDecimalString()} units on ${sale.tradedOn.toISO()}`
          : "a sale since removed",
      );
    }
    return described.join(", ") + (tradeIds.length > 3 ? `, and ${tradeIds.length - 3} more` : "");
  }
}

const BASIS_MOVING = new Set(["MERGER", "DEMERGER", "SPINOFF", "RETURN_OF_CAPITAL"]);

/* ═══ Correct ═════════════════════════════════════════════════════════ */

export interface CorrectTradeChanges {
  quantity?: Quantity;
  pricePerUnit?: Money;
  tradedOn?: CalendarDate;
  charges?: Money;
  /** Sells only — the part deductible against the gain. STT never is. */
  deductibleCharges?: Money;
  settlementAccountId?: AccountId;
  /** Sells only. */
  method?: LotSelectionMethod;
  narration?: string;
}

export interface CorrectTradeInput {
  userId: UserId;
  tradeId: string;
  /** Only what changed; everything else is carried from the original. */
  changes: CorrectTradeChanges;
  reason?: string;
}

export interface CorrectTradeOutput {
  readonly voided: VoidTradeOutput;
  readonly replacement:
    | { side: "BUY"; result: RecordBuyOutput }
    | { side: "SELL"; result: RecordSellOutput };
  /**
   * Facts the correction could not carry across, because the trade row does not
   * store them. Empty today for a buy; a sell loses its charge split.
   */
  readonly caveats: readonly string[];
}

/**
 * Restates a trade: void it, record the corrected one.
 *
 * Composition rather than a second implementation. Every rule about which lots a
 * sale consumes, how charges are capitalised and what a `Buy` posts already lives
 * in `RecordBuy` and `RecordSell`, and a `CorrectTrade` that reimplemented any of
 * it would be a second answer to the same question — which is how the two drift.
 *
 * Always `REVERSE`, never `DELETE`: a restatement is by definition a thing that
 * happened and was recorded wrongly, so both halves belong on the statement. The
 * delete mode exists for {@link VoidTrade} on its own, where the user is saying
 * the trade never happened at all.
 */
export class CorrectTrade implements UseCase<CorrectTradeInput, CorrectTradeOutput> {
  constructor(
    private readonly lots: LotRepository,
    private readonly instruments: InstrumentRepository,
    private readonly voidTrade: VoidTrade,
    private readonly recordBuy: RecordBuy,
    private readonly recordSell: RecordSell,
  ) {}

  async execute(input: CorrectTradeInput): Promise<Result<CorrectTradeOutput, AppError>> {
    const original = await this.lots.findTrade(input.userId, input.tradeId);
    if (!original) return Err(new NotFoundError("Trade", input.tradeId));

    const settlementAccountId =
      input.changes.settlementAccountId ??
      (original.settlementAccountId ? AccountId.from(original.settlementAccountId) : null);
    if (!settlementAccountId) {
      return Err(
        new ValidationError(
          "This trade has no settlement account recorded, so a corrected one has nowhere to " +
            "settle. Choose the account the money moved through.",
          { settlementAccountId: ["Required"] },
        ),
      );
    }

    const instrument = await this.instruments.findById(input.userId, original.instrumentId);
    if (!instrument) return Err(new NotFoundError("Instrument", original.instrumentId.value));

    /*
     * The void runs first and is the gate. Everything that could refuse — a lot
     * already sold, a split since applied, an average-cost sale — refuses here,
     * before the replacement is booked, so the failure mode is "nothing changed"
     * rather than "the old trade is gone and the new one would not go in".
     */
    const voided = await this.voidTrade.execute({
      userId: input.userId,
      tradeId: input.tradeId,
      mode: "REVERSE",
      reason: input.reason ?? "Trade corrected",
    });
    if (!voided.ok) return voided;

    const quantity = input.changes.quantity ?? original.quantity;
    const pricePerUnit = input.changes.pricePerUnit ?? original.pricePerUnit;
    const tradedOn = input.changes.tradedOn ?? original.tradedOn;
    const charges = input.changes.charges ?? original.charges;

    if (original.side === "BUY") {
      const result = await this.recordBuy.execute({
        userId: input.userId,
        instrumentId: original.instrumentId,
        fromAccountId: settlementAccountId,
        quantity,
        pricePerUnit,
        tradedOn,
        charges,
        narration: input.changes.narration ?? input.reason,
      });
      if (!result.ok) return result;
      return Ok({ voided: voided.value, replacement: { side: "BUY", result: result.value }, caveats: [] });
    }

    const result = await this.recordSell.execute({
      userId: input.userId,
      instrumentId: original.instrumentId,
      toAccountId: settlementAccountId,
      quantity,
      pricePerUnit,
      tradedOn,
      charges,
      deductibleCharges: input.changes.deductibleCharges,
      method: input.changes.method,
      narration: input.changes.narration ?? input.reason,
    });
    if (!result.ok) return result;

    /*
     * Named rather than silently reapplied. The trade row stores one lumped
     * charge figure and no lot-selection method, so a correction that did not ask
     * for them cannot restore what the original sale used — and a re-matched sale
     * with a different method is a different capital gain. Saying so is the
     * honest version; re-deriving it would be a guess wearing a number's clothes.
     */
    const caveats: string[] = [];
    if (input.changes.deductibleCharges === undefined && !original.charges.isZero) {
      caveats.push(
        "The deductible share of the charges was not carried over — the trade row stores one " +
          "total, not the STT/brokerage split. Re-enter it if the gain matters.",
      );
    }
    if (input.changes.method === undefined) {
      caveats.push(
        "Lots were re-matched using the default method, because the original sale did not record " +
          "which one it used.",
      );
    }

    return Ok({
      voided: voided.value,
      replacement: { side: "SELL", result: result.value },
      caveats,
    });
  }
}

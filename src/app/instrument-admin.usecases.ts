/**
 * Editing, closing and removing an instrument.
 *
 * Separated from `investing.usecases.ts` because the concerns are genuinely
 * different: that file is about *trades* and the money they move, this one is
 * about the registration record — the name, the ISIN, the quote reference, which
 * platform it sits on. None of it posts anything.
 *
 * Two fields are deliberately immutable once anything has been traded:
 *
 *   - **Kind.** It decides the tax treatment, the unit and the price key, and
 *     every disposal already stored was computed under the old answer. Changing
 *     a debt fund to an equity fund after the fact would silently restate a
 *     filed capital gain from 30% to 12.5%. If the kind was wrong, the honest
 *     fix is a new instrument and voided trades.
 *   - **Currency.** Every lot, posting and disposal is denominated in it. A
 *     change here is not an edit, it is a revaluation of the whole position.
 *
 * Everything else is safe to correct, because nothing downstream is derived from
 * it. `quoteRef` in particular is the field a user most needs to fix — a holding
 * that will not price is almost always a wrong scheme code — and refusing to let
 * them change it was the single most common reason to delete and re-add.
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
import { InstitutionId } from "@/domain/institutions";
import { InstrumentId, InstrumentRepository } from "@/domain/instruments";
import { LotRepository } from "@/domain/lots";

/* ═══ Update ══════════════════════════════════════════════════════════ */

export interface UpdateInstrumentInput {
  userId: UserId;
  instrumentId: InstrumentId;
  name?: string;
  isin?: string | null;
  exchange?: string | null;
  /** The source's own code — an AMFI scheme number, an IBJA slug, an NSE symbol. */
  quoteRef?: string | null;
  institutionId?: InstitutionId | null;
  metadata?: unknown;
}

export class UpdateInstrument implements UseCase<UpdateInstrumentInput, { ok: true }> {
  constructor(private readonly instruments: InstrumentRepository) {}

  async execute(input: UpdateInstrumentInput): Promise<Result<{ ok: true }, AppError>> {
    const existing = await this.instruments.findById(input.userId, input.instrumentId);
    if (!existing) return Err(new NotFoundError("Instrument", input.instrumentId.value));

    const props = existing.props;
    try {
      /*
       * Saved through `MarketInstrument.of` by way of the repository, so the
       * leaf's own Zod schema still validates the metadata. An edit cannot
       * produce an instrument the constructor would have refused.
       */
      await this.instruments.save(input.userId, existing.kind, {
        ...props,
        name: input.name?.trim() || props.name,
        isin: input.isin === undefined ? props.isin : input.isin || null,
        exchange: input.exchange === undefined ? props.exchange : input.exchange || null,
        quoteRef: input.quoteRef === undefined ? props.quoteRef : input.quoteRef || null,
        institutionId:
          input.institutionId === undefined ? props.institutionId : input.institutionId,
        metadata: input.metadata === undefined ? props.metadata : input.metadata,
      });
    } catch (error) {
      return Err(new ValidationError((error as Error).message, { metadata: ["Invalid"] }));
    }
    return Ok({ ok: true });
  }
}

/* ═══ Close and reopen ════════════════════════════════════════════════ */

export interface CloseInstrumentInput {
  userId: UserId;
  instrumentId: InstrumentId;
  reopen?: boolean;
}

/**
 * Hides a holding from the pickers without touching what it holds.
 *
 * The right control for a position you have exited: the lots are exhausted, the
 * realised gain is filed, and you do not want it in the add-a-trade dropdown any
 * more. Nothing is removed, so last year's tax report still reconstructs.
 */
export class CloseInstrument implements UseCase<CloseInstrumentInput, { ok: true }> {
  constructor(
    private readonly instruments: InstrumentRepository,
    private readonly lots: LotRepository,
  ) {}

  async execute(input: CloseInstrumentInput): Promise<Result<{ ok: true }, AppError>> {
    const existing = await this.instruments.findById(input.userId, input.instrumentId);
    if (!existing) return Err(new NotFoundError("Instrument", input.instrumentId.value));

    if (!input.reopen) {
      const open = await this.lots.openLots(input.userId, input.instrumentId);
      const held = open.filter((lot) => !lot.remaining.isZero);
      if (held.length > 0) {
        return Err(
          new ValidationError(
            `${existing.symbol} still holds units. Closing it would hide a live position from ` +
              `every screen while it kept counting towards net worth — sell what is left first.`,
            { instrumentId: ["Still held"] },
          ),
        );
      }
    }

    await this.instruments.save(input.userId, existing.kind, {
      ...existing.props,
      isClosed: !input.reopen,
    });
    return Ok({ ok: true });
  }
}

/* ═══ Delete ══════════════════════════════════════════════════════════ */

export interface DeleteInstrumentInput {
  userId: UserId;
  instrumentId: InstrumentId;
}

/**
 * Removes an instrument that was never traded.
 *
 * Refused the moment a trade references it, and the message says what to do
 * instead — void the trades, or close it. That is the same distinction the
 * ledger draws everywhere else: *close* says "this is over", *delete* says "this
 * never was", and only the second is true of a registration typo.
 *
 * Soft, so the holding account it opened still resolves for anything historic
 * that names it.
 */
export class DeleteInstrument implements UseCase<DeleteInstrumentInput, { ok: true }> {
  constructor(
    private readonly instruments: InstrumentRepository,
    private readonly lots: LotRepository,
  ) {}

  async execute(input: DeleteInstrumentInput): Promise<Result<{ ok: true }, AppError>> {
    const existing = await this.instruments.findById(input.userId, input.instrumentId);
    if (!existing) return Err(new NotFoundError("Instrument", input.instrumentId.value));

    const traded = await this.instruments.countTrades(input.userId, input.instrumentId);
    if (traded > 0) {
      return Err(
        new ValidationError(
          `${existing.symbol} has ${traded} trade(s) recorded against it. Void those first if they ` +
            `never happened, or close the holding — that keeps the history and hides it from the ` +
            `pickers.`,
          { instrumentId: ["Has trades"] },
        ),
      );
    }

    await this.instruments.softDelete(input.userId, input.instrumentId, new Date());
    return Ok({ ok: true });
  }
}

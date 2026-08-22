import { Err, Ok, type Result } from "@/shared/kernel/Result";
import type { UseCase } from "@/shared/kernel/UseCase";
import type { UserId } from "@/shared/kernel/UserId";
import type { Clock } from "@/shared/kernel/Clock";
import { CalendarDate } from "@/shared/time/CalendarDate";
import { NotFoundError, type AppError } from "@/shared/errors/AppError";
import { EntryAlreadyReversedError } from "../../domain/errors";
import type { JournalEntryId } from "../../domain/ids";
import type { JournalRepository } from "../../domain/ports/JournalRepository";

export interface ReverseTransactionInput {
  userId: UserId;
  entryId: JournalEntryId;
  /** Defaults to the original entry's date, so the fix lands in the right period. */
  reversedOn?: CalendarDate;
  narration?: string;
}

export interface ReverseTransactionOutput {
  reversalEntryId: JournalEntryId;
}

/**
 * Undoes a transaction by posting its mirror image.
 *
 * This is the *only* way to correct the ledger, and there is deliberately no
 * `EditTransaction` or `DeleteTransaction` beside it. Editing a posted entry would
 * silently change every report that had already been produced from it; reversing
 * leaves both the mistake and the correction visible, and the pair nets to zero
 * everywhere. It is also how real accounting systems behave, which matters when
 * the numbers feed a tax return.
 *
 * To restate a transaction, reverse it and record the correct one.
 */
export class ReverseTransaction
  implements UseCase<ReverseTransactionInput, ReverseTransactionOutput>
{
  constructor(
    private readonly journal: JournalRepository,
    private readonly clock: Clock,
  ) {}

  async execute(input: ReverseTransactionInput): Promise<Result<ReverseTransactionOutput, AppError>> {
    const original = await this.journal.findById(input.userId, input.entryId);
    if (!original) return Err(new NotFoundError("Transaction", input.entryId.value));

    // Reversing a reversal would leave the user unable to tell what the current
    // state is; they should reverse the original instead.
    if (original.isReversal) {
      return Err(new EntryAlreadyReversedError());
    }
    if (await this.journal.hasReversal(input.userId, original.id)) {
      return Err(new EntryAlreadyReversedError());
    }

    const reversedOn = input.reversedOn ?? original.postedOn;
    // A reversal dated in the future would sit outside every report until that
    // date arrives, leaving the original apparently un-corrected.
    const today = CalendarDate.parse(this.clock.today());
    const effectiveDate = reversedOn.isAfter(today) ? today : reversedOn;

    const reversal = original.reverse({
      reversedOn: effectiveDate,
      narration: input.narration,
    });

    await this.journal.save(reversal);

    return Ok({ reversalEntryId: reversal.id });
  }
}

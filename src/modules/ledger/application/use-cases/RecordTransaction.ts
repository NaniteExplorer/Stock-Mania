import { Err, Ok, type Result, type UseCase, type UserId, NotFoundError, ValidationError, type AppError } from "@/core/kernel";
import { type Money } from "@/core/money";
import { type CalendarDate } from "@/core/time";
import { AccountClosedError } from "../../domain/errors";
import { JournalEntry, type EntryKind, type EntrySource } from "../../domain/entities/JournalEntry";
import type { Account } from "../../domain/entities/Account";
import type { AccountId, JournalEntryId } from "../../domain/ids";
import type { AccountRepository } from "../../domain/ports/AccountRepository";
import type { JournalRepository } from "../../domain/ports/JournalRepository";
import { AccountType } from "../../domain/value-objects/AccountType";

export interface RecordTransactionInput {
  userId: UserId;
  /** Where the money comes FROM — credited. */
  fromAccountId: AccountId;
  /** Where the money goes TO — debited. */
  toAccountId: AccountId;
  amount: Money;
  postedOn: CalendarDate;
  narration: string;
  reference?: string | null;
  source?: EntrySource;
  importBatchId?: string | null;
  fingerprint?: string | null;
}

export interface RecordTransactionOutput {
  entryId: JournalEntryId;
  kind: EntryKind;
}

/**
 * Records any single movement of money between two accounts.
 *
 * **One use case covers expenses, income, transfers and card spending**, because
 * in double-entry they are the same operation: debit the destination, credit the
 * source. Working through the four cases with that one rule:
 *
 * | From → To | Debit / Credit | Result |
 * | --- | --- | --- |
 * | HDFC → Groceries | Dr Groceries, Cr HDFC | expense up, bank down |
 * | Salary → HDFC | Dr HDFC, Cr Salary | bank up, income up |
 * | HDFC → Credit Card | Dr Card, Cr HDFC | debt down, bank down |
 * | Credit Card → Groceries | Dr Groceries, Cr Card | expense up, debt up |
 *
 * All four fall out of the account types' normal balances, so there is no
 * per-case sign logic to get wrong — which is what v1's separate transaction,
 * transfer and credit-card paths each got wrong differently. `kind` is *derived*
 * from the two account types for display only; it never affects the arithmetic.
 */
export class RecordTransaction
  implements UseCase<RecordTransactionInput, RecordTransactionOutput>
{
  constructor(
    private readonly accounts: AccountRepository,
    private readonly journal: JournalRepository,
  ) {}

  async execute(input: RecordTransactionInput): Promise<Result<RecordTransactionOutput, AppError>> {
    if (!input.amount.isPositive) {
      return Err(
        new ValidationError("Enter an amount greater than zero.", {
          amount: ["Must be greater than zero"],
        }),
      );
    }
    if (input.fromAccountId.equals(input.toAccountId)) {
      return Err(
        new ValidationError("Pick two different accounts — money cannot move to itself.", {
          toAccountId: ["Must differ from the source account"],
        }),
      );
    }
    if (input.narration.trim().length === 0) {
      return Err(
        new ValidationError("Add a description so you can recognise this later.", {
          narration: ["Required"],
        }),
      );
    }

    const [from, to] = await Promise.all([
      this.accounts.findById(input.userId, input.fromAccountId),
      this.accounts.findById(input.userId, input.toAccountId),
    ]);
    if (!from) return Err(new NotFoundError("Source account", input.fromAccountId.value));
    if (!to) return Err(new NotFoundError("Destination account", input.toAccountId.value));

    for (const account of [from, to]) {
      if (!account.acceptsPostings) return Err(new AccountClosedError(account.displayName));
    }

    // Both legs must share the entry's currency; the aggregate would reject a
    // mismatch, but catching it here gives the user a usable message.
    if (from.currency.code !== input.amount.currency.code || to.currency.code !== input.amount.currency.code) {
      return Err(
        new ValidationError(
          `${from.displayName} and ${to.displayName} must both be in ${input.amount.currency.code} ` +
            `to record this in ${input.amount.currency.code}.`,
        ),
      );
    }

    // An imported row we already have is a friendly no-op, not an error — the
    // unique index would otherwise surface as a driver exception.
    if (input.fingerprint) {
      const seen = await this.journal.existsWithFingerprint(input.userId, input.fingerprint);
      if (seen) {
        return Err(
          new ValidationError("This transaction is already recorded.", {
            fingerprint: ["Duplicate"],
          }),
        );
      }
    }

    const entry = JournalEntry.twoLegged({
      userId: input.userId,
      postedOn: input.postedOn,
      narration: input.narration,
      kind: RecordTransaction.deriveKind(from, to),
      debitAccountId: to.id,
      creditAccountId: from.id,
      amount: input.amount,
      source: input.source ?? "MANUAL",
      reference: input.reference ?? null,
      importBatchId: input.importBatchId ?? null,
      fingerprint: input.fingerprint ?? null,
    });

    await this.journal.save(entry);

    return Ok({ entryId: entry.id, kind: entry.kind });
  }

  /**
   * Labels the entry from the shape of the movement. Presentation only — two
   * balance-sheet accounts is a transfer (and so must not change net worth),
   * money arriving from an income account is income, and so on.
   */
  private static deriveKind(from: Account, to: Account): EntryKind {
    if (from.type === AccountType.INCOME) return "INCOME";
    if (to.type === AccountType.EXPENSE) return "EXPENSE";
    if (from.type === AccountType.EQUITY || to.type === AccountType.EQUITY) return "OPENING";
    if (from.type.isBalanceSheet && to.type.isBalanceSheet) return "TRANSFER";
    return "ADJUSTMENT";
  }
}

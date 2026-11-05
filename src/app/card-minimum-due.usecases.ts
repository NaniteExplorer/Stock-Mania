/**
 * Card minimum-due use cases (card-minimum-due.md).
 *
 * The minimum due on a closed statement is the owner's typed figure for that statement,
 * or — when none is typed — the card's rule (user-entered percentage with a user-entered
 * floor, never above the balance). Recording validates the typed amount against the
 * statement rebuilt from postings; nothing computed is ever stored.
 */
import { Err, Ok, ValidationError, type AppError, type Result, type UseCase, type UserId } from "@/core/kernel";
import { Money } from "@/core/money";
import { CalendarDate } from "@/core/time";
import type { AccountId } from "@/domain/accounts";
import type { CardStatement } from "@/domain/assets";
import {
  validateEnteredMinimumDue,
  withEnteredMinimumDue,
  type CardMinimumDueReader,
  type CardMinimumDueWriter,
  type EnteredMinimumDue,
  type ResolvedMinimumDue,
} from "@/domain/card-minimum-due";

/** The statements of one card, as `ViewCard` rebuilds them. */
export interface CardStatementsReader {
  execute(input: { userId: UserId; accountId: AccountId; asOf: CalendarDate }): Promise<Result<{ readonly statements: readonly CardStatement[] }, AppError>>;
}

export interface RecordCardMinimumDueInput {
  readonly userId: UserId;
  readonly accountId: AccountId;
  /** The statement's last day, yyyy-mm-dd. */
  readonly statementThrough: string;
  /** Rupees as decimal text, e.g. "1250.00". */
  readonly amount: string;
  readonly asOf: CalendarDate;
}

/** Finds the closed statement ending on `through`, or explains why there is none. */
async function closedStatement(
  cards: CardStatementsReader,
  input: { userId: UserId; accountId: AccountId; statementThrough: string; asOf: CalendarDate },
): Promise<Result<CardStatement, AppError>> {
  let through: CalendarDate;
  try {
    through = CalendarDate.parse(input.statementThrough);
  } catch {
    return Err(new ValidationError("The statement date is not a valid yyyy-mm-dd date."));
  }
  const detail = await cards.execute({ userId: input.userId, accountId: input.accountId, asOf: input.asOf });
  if (!detail.ok) return detail;
  const statement = detail.value.statements.find((s) => s.cycle.through.equals(through));
  if (!statement) return Err(new ValidationError(`This card has no statement ending ${through.toString()}.`));
  if (!statement.cycle.through.isOnOrBefore(input.asOf)) return Err(new ValidationError("That statement has not closed yet."));
  return Ok(statement);
}

export class RecordCardMinimumDue implements UseCase<RecordCardMinimumDueInput, Money> {
  constructor(
    private readonly cards: CardStatementsReader,
    private readonly writer: CardMinimumDueWriter,
  ) {}

  async execute(input: RecordCardMinimumDueInput): Promise<Result<Money, AppError>> {
    const found = await closedStatement(this.cards, input);
    if (!found.ok) return found;
    let amount: Money;
    try {
      amount = validateEnteredMinimumDue(found.value, Money.fromRupees(input.amount.trim(), found.value.closing.currency));
    } catch (error) {
      return Err(new ValidationError((error as Error).message));
    }
    await this.writer.record(input.userId, { accountId: input.accountId.value, statementThrough: found.value.cycle.through, amount });
    return Ok(amount);
  }
}

export class RemoveCardMinimumDue implements UseCase<{ readonly userId: UserId; readonly accountId: AccountId; readonly statementThrough: string }, void> {
  constructor(private readonly writer: CardMinimumDueWriter) {}

  async execute(input: { readonly userId: UserId; readonly accountId: AccountId; readonly statementThrough: string }): Promise<Result<void, AppError>> {
    try {
      await this.writer.remove(input.userId, input.accountId.value, CalendarDate.parse(input.statementThrough));
    } catch (error) {
      return Err(new ValidationError((error as Error).message));
    }
    return Ok();
  }
}

export class LoadCardMinimumDues implements UseCase<{ readonly userId: UserId; readonly accountIds: readonly string[] }, readonly EnteredMinimumDue[]> {
  constructor(private readonly reader: CardMinimumDueReader) {}

  async execute(input: { readonly userId: UserId; readonly accountIds: readonly string[] }): Promise<Result<readonly EnteredMinimumDue[], AppError>> {
    return Ok(await this.reader.forCards(input.userId, input.accountIds));
  }
}

export interface MinimumDueView extends ResolvedMinimumDue {
  /** Set when a typed figure exists but no longer fits the rebuilt statement (e.g. a posting changed it). */
  readonly refused: string | null;
}

/**
 * The minimum due that applies to one statement. A typed figure that no longer fits the
 * statement is not shown as if valid: the rule applies and the refusal is reported.
 */
export function resolveMinimumDue(statement: CardStatement, accountId: string, entries: readonly EnteredMinimumDue[]): MinimumDueView {
  const entry = entries.find((e) => e.accountId === accountId && e.statementThrough.equals(statement.cycle.through)) ?? null;
  try {
    return Object.freeze({ ...withEnteredMinimumDue(statement, entry?.amount ?? null), refused: null });
  } catch (error) {
    return Object.freeze({ statement, entered: false, refused: `Your typed minimum no longer fits this statement: ${(error as Error).message}` });
  }
}

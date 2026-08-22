import { Entity } from "@/shared/kernel/Entity";
import { Money } from "@/shared/money/Money";
import { DomainError } from "@/shared/errors/AppError";
import { AccountId, PostingId } from "../ids";
import type { AccountType } from "../value-objects/AccountType";
import { oppositeOf, type PostingDirection } from "../value-objects/PostingDirection";

/**
 * One leg of a journal entry: an amount, a side, and the account it lands on.
 *
 * A posting is never valid on its own — it exists only inside a
 * {@link JournalEntry}, which is what enforces that the legs balance. It is
 * therefore constructed through the entry, not saved or loaded independently.
 *
 * The amount is always positive. Direction carries the sign, and
 * {@link signedEffectOn} is the single place that turns a debit or credit into a
 * movement, given the account's type.
 */
export class Posting extends Entity<PostingId> {
  private constructor(
    id: PostingId,
    readonly accountId: AccountId,
    readonly direction: PostingDirection,
    readonly amount: Money,
    readonly seq: number,
    readonly memo: string | null,
  ) {
    super(id);
    if (!amount.isPositive) {
      throw new DomainError(
        "LEDGER_POSTING_NOT_POSITIVE",
        `A posting's amount must be positive, got ${amount.toDecimalString()}. ` +
          `Flip the direction to ${oppositeOf(direction)} instead of negating the amount.`,
      );
    }
  }

  static create(props: {
    accountId: AccountId;
    direction: PostingDirection;
    amount: Money;
    seq?: number;
    memo?: string | null;
  }): Posting {
    return new Posting(
      PostingId.create(),
      props.accountId,
      props.direction,
      props.amount,
      props.seq ?? 0,
      props.memo ?? null,
    );
  }

  static debit(accountId: AccountId, amount: Money, memo?: string | null): Posting {
    return Posting.create({ accountId, direction: "DEBIT", amount, memo });
  }

  static credit(accountId: AccountId, amount: Money, memo?: string | null): Posting {
    return Posting.create({ accountId, direction: "CREDIT", amount, memo });
  }

  /** Rehydration from a stored row. Only mappers should call this. */
  static rehydrate(props: {
    id: PostingId;
    accountId: AccountId;
    direction: PostingDirection;
    amount: Money;
    seq: number;
    memo: string | null;
  }): Posting {
    return new Posting(props.id, props.accountId, props.direction, props.amount, props.seq, props.memo);
  }

  get isDebit(): boolean {
    return this.direction === "DEBIT";
  }

  /**
   * The amount under the debit-positive convention, used to prove the entry
   * balances: debits are positive, credits negative, and a valid entry sums to
   * zero. This is independent of any account's type.
   */
  get balancingAmount(): Money {
    return this.isDebit ? this.amount : this.amount.negated();
  }

  /**
   * How much this posting moves the target account's own balance — positive when
   * it increases the account, negative when it decreases it.
   *
   * The same ₹1,240 credit lowers a bank balance and raises a credit-card debt;
   * that difference lives entirely in {@link AccountType.signedEffect}.
   */
  signedEffectOn(accountType: AccountType): Money {
    return accountType.signedEffect(this.direction) === 1 ? this.amount : this.amount.negated();
  }

  withSeq(seq: number): Posting {
    return new Posting(this.id, this.accountId, this.direction, this.amount, seq, this.memo);
  }

  toString(): string {
    return `${this.direction.padEnd(6)} ${this.accountId.value} ${this.amount.toDecimalString()}`;
  }
}

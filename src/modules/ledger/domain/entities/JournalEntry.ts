import { AggregateRoot } from "@/shared/kernel/Entity";
import type { UserId } from "@/shared/kernel/UserId";
import { Money } from "@/shared/money/Money";
import type { Currency } from "@/shared/money/Currency";
import type { CalendarDate } from "@/shared/time/CalendarDate";
import { AccountId, JournalEntryId } from "../ids";
import {
  InsufficientPostingsError,
  MixedCurrencyEntryError,
  UnbalancedEntryError,
} from "../errors";
import { Posting } from "./Posting";
import type { AccountType } from "../value-objects/AccountType";

/** What kind of event the entry records. Drives grouping and iconography only. */
export type EntryKind =
  | "OPENING"
  | "EXPENSE"
  | "INCOME"
  | "TRANSFER"
  | "TRADE"
  | "ADJUSTMENT"
  | "REVERSAL";

/** How the entry got here — hand-entered, imported, or written by a trade. */
export type EntrySource = "MANUAL" | "IMPORT" | "TRADE";

/**
 * A journal entry: the atomic financial event, and the ledger's aggregate root.
 *
 * **The invariant is enforced in the constructor**, so an entry whose legs do not
 * sum to zero cannot be brought into existence — there is no setter, no
 * `validate()` a caller might forget, and no partially-built state to persist.
 * That is the property that makes drift unrepresentable rather than merely
 * unlikely, and it is the direct fix for v1 storing a balance beside an unrelated
 * list of transactions.
 *
 * Entries are **append-only**. Correcting one produces a REVERSAL via
 * {@link reverse}; nothing rewrites history, so a report run twice gives the same
 * answer.
 *
 * @example
 * JournalEntry.twoLegged({
 *   userId, postedOn, narration: "Big Bazaar — groceries", kind: "EXPENSE",
 *   debitAccountId: groceries, creditAccountId: hdfc, amount: Money.fromRupees("1240"),
 * });
 */
export class JournalEntry extends AggregateRoot<JournalEntryId> {
  private constructor(
    id: JournalEntryId,
    readonly userId: UserId,
    readonly postedOn: CalendarDate,
    readonly narration: string,
    readonly kind: EntryKind,
    readonly source: EntrySource,
    readonly postings: readonly Posting[],
    readonly reference: string | null,
    readonly importBatchId: string | null,
    readonly reversesEntryId: JournalEntryId | null,
    readonly fingerprint: string | null,
  ) {
    super(id);
    JournalEntry.assertBalances(postings);
  }

  /**
   * The three conditions that make an entry well-formed. Checked together because
   * they are not independent: you cannot sum amounts across currencies to prove a
   * balance, so the currency check must come first.
   */
  private static assertBalances(postings: readonly Posting[]): void {
    if (postings.length < 2) {
      throw new InsufficientPostingsError(postings.length);
    }

    const currencies = [...new Set(postings.map((posting) => posting.amount.currency.code))];
    if (currencies.length > 1) {
      throw new MixedCurrencyEntryError(currencies);
    }

    const currency = postings[0].amount.currency;
    const debits = JournalEntry.sumWhere(postings, (posting) => posting.isDebit, currency);
    const credits = JournalEntry.sumWhere(postings, (posting) => !posting.isDebit, currency);

    if (!debits.equals(credits)) {
      throw new UnbalancedEntryError(debits, credits);
    }
  }

  private static sumWhere(
    postings: readonly Posting[],
    predicate: (posting: Posting) => boolean,
    currency: Currency,
  ): Money {
    return Money.total(
      postings.filter(predicate).map((posting) => posting.amount),
      currency,
    );
  }

  static create(props: {
    userId: UserId;
    postedOn: CalendarDate;
    narration: string;
    kind: EntryKind;
    postings: readonly Posting[];
    source?: EntrySource;
    reference?: string | null;
    importBatchId?: string | null;
    fingerprint?: string | null;
  }): JournalEntry {
    return new JournalEntry(
      JournalEntryId.create(),
      props.userId,
      props.postedOn,
      props.narration.trim(),
      props.kind,
      props.source ?? "MANUAL",
      // Renumber so stored order always reflects written order.
      props.postings.map((posting, index) => posting.withSeq(index)),
      props.reference?.trim() || null,
      props.importBatchId ?? null,
      null,
      props.fingerprint ?? null,
    );
  }

  /**
   * The common case: money leaving one account and arriving in another.
   *
   * Every user-facing transaction the app records — an expense, income, a
   * transfer, a card payment — is this shape. Naming it once keeps use cases from
   * hand-assembling posting pairs and getting a direction backwards.
   */
  static twoLegged(props: {
    userId: UserId;
    postedOn: CalendarDate;
    narration: string;
    kind: EntryKind;
    debitAccountId: AccountId;
    creditAccountId: AccountId;
    amount: Money;
    source?: EntrySource;
    reference?: string | null;
    importBatchId?: string | null;
    fingerprint?: string | null;
    memo?: string | null;
  }): JournalEntry {
    return JournalEntry.create({
      ...props,
      postings: [
        Posting.debit(props.debitAccountId, props.amount, props.memo ?? null),
        Posting.credit(props.creditAccountId, props.amount, props.memo ?? null),
      ],
    });
  }

  /** Rehydration from stored rows. Only mappers should call this. */
  static rehydrate(props: {
    id: JournalEntryId;
    userId: UserId;
    postedOn: CalendarDate;
    narration: string;
    kind: EntryKind;
    source: EntrySource;
    postings: readonly Posting[];
    reference: string | null;
    importBatchId: string | null;
    reversesEntryId: JournalEntryId | null;
    fingerprint: string | null;
  }): JournalEntry {
    return new JournalEntry(
      props.id,
      props.userId,
      props.postedOn,
      props.narration,
      props.kind,
      props.source,
      [...props.postings].sort((a, b) => a.seq - b.seq),
      props.reference,
      props.importBatchId,
      props.reversesEntryId,
      props.fingerprint,
    );
  }

  get currency(): Currency {
    return this.postings[0].amount.currency;
  }

  /**
   * The entry's headline amount — the total debited, which by the invariant also
   * equals the total credited. This is the number shown in a transaction list.
   */
  get amount(): Money {
    return JournalEntry.sumWhere(this.postings, (posting) => posting.isDebit, this.currency);
  }

  get isReversal(): boolean {
    return this.kind === "REVERSAL";
  }

  /** True for a transfer between two of the user's own balance-sheet accounts. */
  get isTransfer(): boolean {
    return this.kind === "TRANSFER";
  }

  involves(accountId: AccountId): boolean {
    return this.postings.some((posting) => posting.accountId.equals(accountId));
  }

  postingsFor(accountId: AccountId): readonly Posting[] {
    return this.postings.filter((posting) => posting.accountId.equals(accountId));
  }

  /**
   * Net movement this entry causes in one account. Sums all matching legs, so a
   * split transaction that touches the same account twice is handled correctly.
   */
  effectOn(accountId: AccountId, accountType: AccountType): Money {
    return Money.total(
      this.postingsFor(accountId).map((posting) => posting.signedEffectOn(accountType)),
      this.currency,
    );
  }

  /**
   * The correcting entry: the same legs with debits and credits swapped.
   *
   * Reversing rather than editing is what keeps the ledger auditable — the
   * original stays visible, and the pair nets to zero in every report. A reversal
   * posts on `reversedOn` (default: the original date) so the correction lands in
   * the period the mistake was made, not the period it was noticed.
   */
  reverse(props?: { reversedOn?: CalendarDate; narration?: string }): JournalEntry {
    const flipped = this.postings.map((posting, index) =>
      (posting.isDebit
        ? Posting.credit(posting.accountId, posting.amount, posting.memo)
        : Posting.debit(posting.accountId, posting.amount, posting.memo)
      ).withSeq(index),
    );

    return new JournalEntry(
      JournalEntryId.create(),
      this.userId,
      props?.reversedOn ?? this.postedOn,
      props?.narration ?? `Reversal of: ${this.narration}`,
      "REVERSAL",
      this.source,
      flipped,
      this.reference,
      this.importBatchId,
      this.id,
      // A reversal must not inherit the original's import fingerprint, or the
      // unique index would reject it as a duplicate of what it is undoing.
      null,
    );
  }

  /** Multi-line rendering, for debugging and for error messages. */
  toString(): string {
    const legs = this.postings.map((posting) => `  ${posting.toString()}`).join("\n");
    return `${this.postedOn.toISO()}  "${this.narration}" [${this.kind}]\n${legs}`;
  }
}

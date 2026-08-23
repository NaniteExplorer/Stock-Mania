/**
 * Transactions: the `Transaction` hierarchy, its postings, and the projections
 * read back off them.
 *
 * This file replaces `JournalEntry`. The reason is not tidiness: a single entry
 * class with a loose `kind` string can enforce that money balances, but it cannot
 * answer the four questions every downstream engine needs — how does this event
 * book into the ledger, what does it do to cost-basis lots, what does the tax
 * engine see, and what does a return calculation see. Those answers differ per
 * *kind of event*, so they are polymorphic hooks on a class per event
 * (`70-UPGRADE-PLAN.md`, "The four class hierarchies", §1).
 *
 * The consequence worth stating: adding an asset type or a corporate action never
 * touches the ledger, tax or returns code, because those engines consume only the
 * four hooks. The tax engine never learns what a share split is.
 *
 * `JournalEntry.assertBalances` is carried over and generalised in one way:
 * **balance is per currency** (`20-DOMAIN-MODEL.md` §3.5). That is what makes
 * `FxConversion` expressible at all, and it is why the old `MixedCurrencyEntryError`
 * is gone rather than renamed — a mixed-currency transaction is now legal and
 * merely has to balance twice.
 *
 * Two deliberate deviations from the plan's sketch, recorded rather than silent:
 *
 *   1. `lotEffects()`, `taxableEvents()` and `cashflows()` are concrete and return
 *      nothing in the base class rather than being abstract. Nine of the thirteen
 *      subclasses have no lots and no taxable event; making each write three empty
 *      methods would add 27 pieces of noise whose only purpose is to satisfy the
 *      compiler, and noise is where a real `return []` hides. `postings()` and
 *      `validate()` stay abstract, because a transaction that books nothing is
 *      meaningless.
 *   2. Subclass payloads are held by the base class as `details` rather than as
 *      subclass fields. This is forced by the language: a subclass field
 *      initialiser runs *after* `super()`, so a `validate()` called from the base
 *      constructor would see `undefined` for everything it is meant to check.
 *      Passing the payload down means the invariant really is enforced at
 *      construction, which is the entire point of enforcing it there.
 *
 * The repository and query ports are declared here with the aggregate they serve,
 * so `domain/` never imports `infra/`.
 */

import { AggregateRoot, DomainError, Entity, UniqueId, UserId, newUuid } from "@/core/kernel";
import { Currency, Money } from "@/core/money";
import { Quantity } from "@/core/numeric";
import { CalendarDate, DateRange } from "@/core/time";
import { Account, AccountId, AccountType, AccountTypeName, LegalityRole, PostingDirection, legalityRoleOf, oppositeOf } from "@/domain/accounts";
import type { TaxCategory, TaxableEvent } from "@/domain/tax";

/* ═══ Identity ════════════════════════════════════════════════════════ */

export class TransactionId extends UniqueId {
  private readonly __transactionId = true;

  static create(): TransactionId {
    return new TransactionId(newUuid());
  }

  static from(value: string): TransactionId {
    return new TransactionId(value);
  }
}

export class PostingId extends UniqueId {
  private readonly __postingId = true;

  static create(): PostingId {
    return new PostingId(newUuid());
  }

  static from(value: string): PostingId {
    return new PostingId(value);
  }
}

/* ═══ Kinds ═══════════════════════════════════════════════════════════ */

/**
 * The 18 transaction types of `20-DOMAIN-MODEL.md` §2.3.
 *
 * Declared here as well as in `infra/db/schema.ts` in the same sense that a port
 * is declared apart from its adapter: the domain owns the meaning, the schema owns
 * the column. `tests/schema-integrity.spec.ts` asserts the two lists are
 * identical, so they cannot drift.
 */
export const TRANSACTION_KIND_NAMES = [
  "OPENING_BALANCE",
  "WITHDRAWAL",
  "DEPOSIT",
  "TRANSFER",
  "RECONCILIATION",
  "LIABILITY_CREDIT",
  "BUY",
  "SELL",
  "DIVIDEND",
  "INTEREST",
  "FEE",
  "TAX",
  "REFUND",
  "FX_CONVERSION",
  "CORPORATE_ACTION",
  "TRANSFER_IN_KIND",
  "VALUATION_ADJUSTMENT",
  "REVERSAL",
] as const;

export type TransactionKind = (typeof TRANSACTION_KIND_NAMES)[number];

/** How the transaction got here — hand-entered, imported, or written by a trade. */
export type TransactionSource = "MANUAL" | "IMPORT" | "TRADE";

/** §2.6. A reconciled posting is immutable — invariant L10. */
export type PostingStatus = "PENDING" | "CLEARED" | "RECONCILED" | "VOID";

/* ═══ Errors ══════════════════════════════════════════════════════════ */

/**
 * The ledger's invariant violations.
 *
 * Thrown from constructors rather than returned as a `Result`, because an
 * unbalanced transaction is not a user-facing outcome to render — it means the
 * code that built the postings is wrong. Use cases validate their inputs *before*
 * constructing, so users see a `ValidationError` instead.
 */
export class UnbalancedTransactionError extends DomainError {
  constructor(currency: Currency, residual: Money) {
    super(
      "LEDGER_TXN_UNBALANCED",
      `Transaction does not balance in ${currency.code}: postings sum to ` +
        `${residual.toDecimalString()} instead of zero (invariant L01).`,
    );
  }
}

export class InsufficientPostingsError extends DomainError {
  constructor(count: number) {
    super(
      "LEDGER_TXN_TOO_FEW_POSTINGS",
      `A transaction needs at least two postings, got ${count} (invariant L02). ` +
        `Money always moves from somewhere to somewhere.`,
    );
  }
}

/** L03: a posting that moves neither money nor units records nothing. */
export class EmptyPostingError extends DomainError {
  constructor() {
    super(
      "LEDGER_POSTING_EMPTY",
      `A posting must move money or units: amount and quantity cannot both be zero ` +
        `(invariant L03).`,
    );
  }
}

/** L04: the three commodity columns are set together or not at all. */
export class IncoherentCommodityPostingError extends DomainError {
  constructor(reason: string) {
    super("LEDGER_POSTING_COMMODITY_INCOHERENT", `${reason} (invariant L04).`);
  }
}

/** L05: a posting's currency must be one its account holds. */
export class PostingCurrencyMismatchError extends DomainError {
  constructor(accountName: string, accountCurrency: Currency, postingCurrency: Currency) {
    super(
      "LEDGER_POSTING_CURRENCY_MISMATCH",
      `${accountName} is a ${accountCurrency.code} account, so it cannot take a ` +
        `${postingCurrency.code} posting (invariant L05). Record the movement as an ` +
        `FX conversion, which balances in each currency separately.`,
    );
  }
}

/**
 * L06, and with it L07.
 *
 * The message names the exact missing row, because the legality matrix is data: if
 * the combination should be legal, the fix *is* that row, and saying so turns the
 * error into its own remedy.
 */
export class IllegalTransactionError extends DomainError {
  constructor(kind: TransactionKind, source: LegalityRole, destination: LegalityRole) {
    super(
      "LEDGER_TXN_ILLEGAL",
      `A ${kind} cannot move from ${source} to ${destination} (invariant L06): there ` +
        `is no (${kind}, ${source}, ${destination}) row in the legality matrix.`,
    );
  }
}

/** L08: a closed or deleted account takes no new postings. */
export class ClosedAccountPostingError extends DomainError {
  constructor(accountName: string) {
    super(
      "LEDGER_POSTING_ACCOUNT_CLOSED",
      `${accountName} is closed or deleted and cannot take new postings (invariant L08).`,
    );
  }
}

/** L12: a transfer moves money between your own accounts and spends nothing. */
export class CategoryOnTransferError extends DomainError {
  constructor(kind: TransactionKind) {
    super(
      "LEDGER_POSTING_CATEGORY_ON_TRANSFER",
      `A ${kind} carries no budget category (invariant L12): it moves money between ` +
        `your own accounts, so counting it as spending would double-count the expense ` +
        `it eventually pays for.`,
    );
  }
}

export class TransactionAlreadyReversedError extends DomainError {
  constructor() {
    super("LEDGER_TXN_ALREADY_REVERSED", "That transaction has already been reversed.");
  }
}

export class UnsupportedCorporateActionError extends DomainError {
  constructor(actionType: string) {
    super(
      "LEDGER_CORPORATE_ACTION_UNSUPPORTED",
      `${actionType} is not yet modelled. Splits, reverse splits, bonuses and returns ` +
        `of capital are; mergers, demergers, spinoffs and rights arrive with the ` +
        `corporate-action engine, and guessing at them would silently misstate a basis.`,
    );
  }
}

/* ═══ Posting ═════════════════════════════════════════════════════════ */

/**
 * One leg of a transaction: an amount, a side, and the account it lands on —
 * optionally also a signed quantity of an instrument.
 *
 * A posting is never valid on its own: it exists only inside a
 * {@link Transaction}, which is what enforces that the legs balance. It is
 * therefore constructed through the transaction, not saved or loaded
 * independently.
 *
 * The money amount is never negative and direction carries the sign, so "is this a
 * negative expense or a positive refund?" is never ambiguous. {@link signedEffectOn}
 * is the single place that turns a debit or credit into a movement, given the
 * account's type.
 *
 * The **quantity is signed**, and deliberately not folded into `direction`. They
 * are different facts: `20-DOMAIN-MODEL.md` §3.4's `quantity NUMERIC(38,18)` beside
 * `amount_minor BIGINT` is Paisa's `Quantity`/`Amount` split, and one type cannot
 * serve fractional units and integer minor units well.
 */
export class Posting extends Entity<PostingId> {
  private constructor(
    id: PostingId,
    readonly accountId: AccountId,
    readonly direction: PostingDirection,
    readonly amount: Money,
    readonly seq: number,
    readonly memo: string | null,
    readonly instrumentId: string | null,
    readonly quantity: Quantity | null,
    readonly unitCost: Money | null,
    readonly categoryId: string | null,
    readonly status: PostingStatus,
  ) {
    super(id);

    if (amount.isNegative) {
      throw new DomainError(
        "LEDGER_POSTING_NEGATIVE",
        `A posting's amount must not be negative, got ${amount.toDecimalString()}. ` +
          `Flip the direction to ${oppositeOf(direction)} instead of negating the amount.`,
      );
    }

    // L03. Zero-amount postings are legal — a bonus issue moves units and no
    // money — but a posting with neither records nothing at all.
    if (amount.isZero && (quantity === null || quantity.isZero)) {
      throw new EmptyPostingError();
    }

    // L04, commodity coherence.
    if (instrumentId === null && quantity !== null) {
      throw new IncoherentCommodityPostingError(
        "A quantity with no instrument is a unit count of nothing",
      );
    }
    if (instrumentId !== null && quantity === null) {
      throw new IncoherentCommodityPostingError(
        `The posting for instrument ${instrumentId} has no quantity`,
      );
    }
    if (unitCost !== null && instrumentId === null) {
      throw new IncoherentCommodityPostingError("A unit cost with no instrument prices nothing");
    }

    // L12's structural half: a commodity leg is never budgeted spending.
    if (categoryId !== null && instrumentId !== null) {
      throw new DomainError(
        "LEDGER_POSTING_CATEGORY_ON_COMMODITY",
        `A posting that moves units carries no budget category (invariant L12): buying ` +
          `an asset is not spending, it is moving value between your own accounts.`,
      );
    }
  }

  static create(props: {
    accountId: AccountId;
    direction: PostingDirection;
    amount: Money;
    seq?: number;
    memo?: string | null;
    instrumentId?: string | null;
    quantity?: Quantity | null;
    unitCost?: Money | null;
    categoryId?: string | null;
    status?: PostingStatus;
  }): Posting {
    return new Posting(
      PostingId.create(),
      props.accountId,
      props.direction,
      props.amount,
      props.seq ?? 0,
      props.memo ?? null,
      props.instrumentId ?? null,
      props.quantity ?? null,
      props.unitCost ?? null,
      props.categoryId ?? null,
      props.status ?? "CLEARED",
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
    instrumentId?: string | null;
    quantity?: Quantity | null;
    unitCost?: Money | null;
    categoryId?: string | null;
    status?: PostingStatus;
  }): Posting {
    return new Posting(
      props.id,
      props.accountId,
      props.direction,
      props.amount,
      props.seq,
      props.memo,
      props.instrumentId ?? null,
      props.quantity ?? null,
      props.unitCost ?? null,
      props.categoryId ?? null,
      props.status ?? "CLEARED",
    );
  }

  get isDebit(): boolean {
    return this.direction === "DEBIT";
  }

  get currency(): Currency {
    return this.amount.currency;
  }

  /** True once reconciled against a statement, after which it is immutable (L10). */
  get isReconciled(): boolean {
    return this.status === "RECONCILED";
  }

  /**
   * The amount under the debit-positive convention, used to prove the transaction
   * balances: debits are positive, credits negative, and a valid transaction sums to
   * zero in every currency it touches. Independent of any account's type.
   */
  get balancingAmount(): Money {
    return this.isDebit ? this.amount : this.amount.negated();
  }

  /**
   * How much this posting moves the target account's own balance — positive when it
   * increases the account, negative when it decreases it.
   *
   * The same ₹1,240 credit lowers a bank balance and raises a credit-card debt; that
   * difference lives entirely in {@link AccountType.signedEffect}.
   */
  signedEffectOn(accountType: AccountType): Money {
    return accountType.signedEffect(this.direction) === 1 ? this.amount : this.amount.negated();
  }

  withSeq(seq: number): Posting {
    return new Posting(
      this.id, this.accountId, this.direction, this.amount, seq, this.memo,
      this.instrumentId, this.quantity, this.unitCost, this.categoryId, this.status,
    );
  }

  /** The mirror leg, for a reversal. New identity: this is a new posting. */
  flipped(): Posting {
    return Posting.create({
      accountId: this.accountId,
      direction: oppositeOf(this.direction),
      amount: this.amount,
      memo: this.memo,
      instrumentId: this.instrumentId,
      quantity: this.quantity?.negated() ?? null,
      unitCost: this.unitCost,
      categoryId: this.categoryId,
      status: "CLEARED",
    });
  }

  toString(): string {
    const units = this.quantity
      ? ` qty ${this.quantity.toDecimalString()} [${this.instrumentId}]`
      : "";
    return `${this.direction.padEnd(6)} ${this.accountId.value} ${this.amount.toDecimalString()}${units}`;
  }
}

/* ═══ Legality matrix ═════════════════════════════════════════════════ */

const ASSET_ROLES = [
  "ASSET_CASH",
  "ASSET_BANK",
  "ASSET_SAVINGS",
  "ASSET_BROKERAGE",
  "ASSET_RETIREMENT",
  "ASSET_DEPOSIT",
  "ASSET_PROPERTY",
  "ASSET_OTHER",
] as const satisfies readonly LegalityRole[];

const LIABILITY_ROLES = [
  "LIABILITY_CREDIT_CARD",
  "LIABILITY_LOAN",
  "LIABILITY_MORTGAGE",
  "LIABILITY_OTHER",
] as const satisfies readonly LegalityRole[];

const SPENDABLE = ["ASSET_CASH", "ASSET_BANK", "ASSET_SAVINGS"] as const satisfies readonly LegalityRole[];

export interface LegalityRow {
  readonly txnType: TransactionKind;
  readonly sourceRole: LegalityRole;
  readonly destinationRole: LegalityRole;
}

/**
 * The legality matrix of `20-DOMAIN-MODEL.md` §3.6, expanded from its wildcards.
 *
 * It lives in the domain, not in the seed file, because the constructor that checks
 * it is here: a copy in `infra/db/seeds.ts` would mean the rows SQL reporting joins
 * against and the rows a transaction is checked against could disagree, and the one
 * that would be wrong is the one nobody diffed. `infra/db/seeds.ts` now imports
 * this, so the table is a projection of the domain fact rather than a second
 * statement of it.
 *
 * Wildcards are expanded here rather than pattern-matched at check time so that a
 * rejection can name the exact missing row — the error message doubles as the fix.
 *
 * Note what is absent: no row has `EXPENSE` as a source. That is invariant L07, and
 * it is L06's *data* rather than a second check, because there is no such row to
 * find. Firefly states the same rule as code (`config/firefly.php:543`); stating it
 * as an absence means it cannot be forgotten at one call site.
 */
export function legalityRows(): LegalityRow[] {
  const rows: LegalityRow[] = [];
  const add = (
    txnType: TransactionKind,
    sources: readonly LegalityRole[],
    destinations: readonly LegalityRole[],
  ) => {
    for (const sourceRole of sources) {
      for (const destinationRole of destinations) {
        // A transfer from an account to itself moves nothing.
        if (sourceRole === destinationRole && txnType === "TRANSFER") continue;
        rows.push({ txnType, sourceRole, destinationRole });
      }
    }
  };

  // Spending and earning.
  add("WITHDRAWAL", [...ASSET_ROLES, ...LIABILITY_ROLES], ["EXPENSE"]);
  add("DEPOSIT", ["INCOME"], [...ASSET_ROLES]);
  add("FEE", [...ASSET_ROLES, ...LIABILITY_ROLES], ["EXPENSE"]);
  add("TAX", [...ASSET_ROLES], ["EXPENSE"]);
  add("REFUND", ["INCOME", "EXPENSE"], [...ASSET_ROLES, ...LIABILITY_ROLES]);

  // Moving your own money. A card payment is a TRANSFER, never an expense (L12).
  add("TRANSFER", [...ASSET_ROLES], [...ASSET_ROLES, ...LIABILITY_ROLES]);
  add("TRANSFER", [...LIABILITY_ROLES], [...ASSET_ROLES]);
  add("TRANSFER_IN_KIND", ["ASSET_BROKERAGE"], ["ASSET_BROKERAGE", "ASSET_RETIREMENT"]);

  // Opening balances and corrections, against the pseudo-accounts that make
  // sum-to-zero hold universally.
  add("OPENING_BALANCE", ["EQUITY_OPENING"], [...ASSET_ROLES, ...LIABILITY_ROLES]);
  add("OPENING_BALANCE", [...ASSET_ROLES, ...LIABILITY_ROLES], ["EQUITY_OPENING"]);
  add("RECONCILIATION", [...ASSET_ROLES, ...LIABILITY_ROLES], ["EQUITY_ADJUSTMENT"]);
  add("RECONCILIATION", ["EQUITY_ADJUSTMENT"], [...ASSET_ROLES, ...LIABILITY_ROLES]);
  add("VALUATION_ADJUSTMENT", ["ASSET_PROPERTY", "ASSET_OTHER"], ["EQUITY_ADJUSTMENT"]);
  add("VALUATION_ADJUSTMENT", ["EQUITY_ADJUSTMENT"], ["ASSET_PROPERTY", "ASSET_OTHER"]);
  add("LIABILITY_CREDIT", ["EQUITY_ADJUSTMENT"], [...LIABILITY_ROLES]);
  add(
    "REVERSAL",
    [...ASSET_ROLES, ...LIABILITY_ROLES, "EQUITY_OPENING", "EQUITY_ADJUSTMENT", "INCOME"],
    [...ASSET_ROLES, ...LIABILITY_ROLES, "EXPENSE", "EQUITY_OPENING", "EQUITY_ADJUSTMENT"],
  );

  // Investing — the seven rows §3.6 adds to Firefly's matrix.
  add("BUY", [...SPENDABLE, "ASSET_BROKERAGE"], ["ASSET_BROKERAGE", "ASSET_RETIREMENT"]);
  add("SELL", ["ASSET_BROKERAGE", "ASSET_RETIREMENT"], [...SPENDABLE, "ASSET_BROKERAGE"]);
  add("DIVIDEND", ["INCOME"], [...SPENDABLE, "ASSET_BROKERAGE"]);
  add("INTEREST", ["INCOME"], [...SPENDABLE, "ASSET_DEPOSIT", "ASSET_RETIREMENT"]);
  add("CORPORATE_ACTION", ["ASSET_BROKERAGE"], ["ASSET_BROKERAGE", "EQUITY_ADJUSTMENT"]);
  add("CORPORATE_ACTION", ["EQUITY_ADJUSTMENT"], ["ASSET_BROKERAGE"]);
  add("FX_CONVERSION", [...ASSET_ROLES], [...ASSET_ROLES]);

  return rows;
}

/**
 * The matrix as a lookup, built once.
 *
 * A `Set` of joined keys rather than a nested map: the question asked is always
 * "does this exact triple exist", never "what can a WITHDRAWAL reach", so the
 * simpler structure is also the honest one.
 */
export class LegalityMatrix {
  private static shared: LegalityMatrix | null = null;

  private readonly keys: ReadonlySet<string>;

  constructor(rows: readonly LegalityRow[]) {
    this.keys = new Set(rows.map((row) => LegalityMatrix.key(row.txnType, row.sourceRole, row.destinationRole)));
  }

  /** The shipped matrix. Shared because it is immutable and identical for everyone. */
  static standard(): LegalityMatrix {
    LegalityMatrix.shared ??= new LegalityMatrix(legalityRows());
    return LegalityMatrix.shared;
  }

  private static key(kind: TransactionKind, source: LegalityRole, destination: LegalityRole): string {
    return `${kind}|${source}|${destination}`;
  }

  get size(): number {
    return this.keys.size;
  }

  permits(kind: TransactionKind, source: LegalityRole, destination: LegalityRole): boolean {
    return this.keys.has(LegalityMatrix.key(kind, source, destination));
  }

  assertLegal(kind: TransactionKind, source: LegalityRole, destination: LegalityRole): void {
    if (!this.permits(kind, source, destination)) {
      throw new IllegalTransactionError(kind, source, destination);
    }
  }
}

/* ═══ Account references ══════════════════════════════════════════════ */

/**
 * What a transaction needs to know about an account: which one, what role it plays
 * in the legality matrix, what currency it holds, and whether it still takes
 * postings.
 *
 * Not the `Account` aggregate itself, so a transaction can be constructed in a test
 * or from an import row without loading the chart of accounts — and so that
 * `Transaction` cannot accidentally reach for an account's balance, which accounts
 * deliberately do not have.
 */
export interface AccountRef {
  readonly id: AccountId;
  readonly role: LegalityRole;
  readonly currency: Currency;
  readonly acceptsPostings: boolean;
  readonly displayName: string;
  /**
   * True for an account that legitimately holds more than one currency — a foreign
   * brokerage account holding USD cash inside an INR-reporting book. Only such an
   * account may take a posting in another currency, which is what keeps L05 from
   * being either wrong or toothless.
   */
  readonly multiCurrency: boolean;
}

export function accountRef(account: Account, options?: { multiCurrency?: boolean }): AccountRef {
  return {
    id: account.id,
    role: legalityRoleOf(account.type.name, account.subtype),
    currency: account.currency,
    acceptsPostings: account.acceptsPostings,
    displayName: account.displayName,
    multiCurrency: options?.multiCurrency ?? false,
  };
}

/* ═══ The four hooks' output types ════════════════════════════════════ */

/**
 * What a transaction does to cost-basis lots.
 *
 * A discriminated union rather than three methods, because a `CorporateActionTxn`
 * can rescale and open in one event (a bonus issue does both), and the lot engine
 * wants them in order.
 */
export type LotEffect =
  | {
      readonly kind: "OPEN";
      readonly instrumentId: string;
      readonly quantity: Quantity;
      readonly costBasis: Money;
      readonly acquiredOn: CalendarDate;
      /** Set when the lot inherits an earlier acquisition date, as a bonus issue does. */
      readonly inheritsAcquisitionFrom?: string | null;
    }
  | {
      readonly kind: "CONSUME";
      readonly instrumentId: string;
      readonly lotId: string;
      readonly quantity: Quantity;
      readonly disposedOn: CalendarDate;
    }
  | {
      readonly kind: "RESCALE";
      readonly instrumentId: string;
      /** New units per old unit: 5-for-1 split is 5, a 1-for-10 reverse split is 0.1. */
      readonly quantityFactor: Quantity;
      readonly effectiveOn: CalendarDate;
    }
  | {
      readonly kind: "REDUCE_BASIS";
      readonly instrumentId: string;
      readonly amount: Money;
      readonly effectiveOn: CalendarDate;
    };

/** What a return calculation sees: a dated, signed external cash movement. */
export interface Cashflow {
  readonly onDate: CalendarDate;
  /** Negative when money leaves the user, positive when it arrives. */
  readonly amount: Money;
  readonly kind: "CONTRIBUTION" | "WITHDRAWAL" | "INCOME" | "EXPENSE";
  readonly instrumentId: string | null;
}

/** One disposal out of a sale — the unit the tax engine reasons about. */
export interface Disposal {
  readonly lotId: string;
  readonly quantity: Quantity;
  readonly costBasis: Money;
  readonly acquiredOn: CalendarDate;
  /** FMV on the grandfathering date, when the holding predates one. */
  readonly fmvOnGrandfatherDate?: Money | null;
}

/* ═══ TransactionContext ══════════════════════════════════════════════ */

/**
 * The context a transaction happens in: who, when, where the value came from and
 * where it went, and the identifiers that tie it back to a statement or a provider.
 *
 * `source` and `destination` are what the legality matrix is checked against, and
 * they are required rather than optional: a transaction whose direction is unknown
 * cannot be checked, and an unenforceable invariant is worse than none because it
 * reads as enforced.
 */
export interface TransactionContext {
  readonly userId: UserId;
  /** The accounting date — a day, never an instant (`20-DOMAIN-MODEL.md` §3.4). */
  readonly txnDate: CalendarDate;
  readonly description: string;
  readonly source: AccountRef;
  readonly destination: AccountRef;
  readonly settlementDate?: CalendarDate | null;
  readonly institution?: string | null;
  readonly instrumentId?: string | null;
  readonly counterpartyId?: string | null;
  readonly txnSource?: TransactionSource;
  readonly reference?: string | null;
  /** The provider's own id for this row — unique per user among live rows (L09). */
  readonly externalId?: string | null;
  readonly importBatchId?: string | null;
  readonly fingerprint?: string | null;
  /** A dated-ahead transaction is legitimate only when it is marked a forecast (L11). */
  readonly isForecast?: boolean;
  /** Today, for the L11 future-date check. Injected rather than read from a clock. */
  readonly today?: CalendarDate;
}

/**
 * The stored half of a context: everything a row carries.
 *
 * A rehydrated transaction has no `source`/`destination` refs, and deliberately
 * does not go looking for them. Re-checking legality on read would mean loading
 * every referenced account, and — worse — an account legitimately re-subtyped
 * years later would make correct history un-loadable. The row was checked when it
 * was written; what is re-checked on read is the part that can actually be
 * corrupted by a bad write, which is the balance.
 */
export interface StoredTransactionContext {
  readonly userId: UserId;
  readonly txnDate: CalendarDate;
  readonly description: string;
  readonly settlementDate?: CalendarDate | null;
  readonly institution?: string | null;
  readonly instrumentId?: string | null;
  readonly counterpartyId?: string | null;
  readonly txnSource?: TransactionSource;
  readonly reference?: string | null;
  readonly externalId?: string | null;
  readonly importBatchId?: string | null;
  readonly fingerprint?: string | null;
  readonly isForecast?: boolean;
}

/* ═══ Transaction ═════════════════════════════════════════════════════ */

/**
 * The atomic financial event, and the ledger's aggregate root.
 *
 * **The invariants are enforced in the constructor**, so a transaction that does
 * not balance cannot be brought into existence — there is no setter, no
 * `validate()` a caller might forget to call, and no partially-built state to
 * persist. That is what makes drift unrepresentable rather than merely unlikely,
 * and it is the direct fix for v1 storing a balance beside an unrelated list of
 * transactions. Firefly states the same invariant as a *repair job*
 * (`20-DOMAIN-MODEL.md` §3.5); a repair job is an admission that the invalid state
 * exists.
 *
 * Transactions are **append-only**. Correcting one produces a {@link Reversal};
 * nothing rewrites history, so a report run twice gives the same answer.
 *
 * Subclasses answer four questions and nothing else:
 *
 *   - `buildPostings()` — how it books into the ledger
 *   - `lotEffects()` — what it does to cost-basis lots
 *   - `taxableEvents()` — what the tax engine sees
 *   - `cashflows()` — what XIRR and TWR see
 *
 * plus `validate()` for legality a base class cannot know about.
 */
export abstract class Transaction<D = unknown> extends AggregateRoot<TransactionId> {
  private readonly legs: readonly Posting[];

  /**
   * Non-blocking findings, in the user's language. L11 (a future-dated transaction
   * that is not marked a forecast) is a WARN in `30-CALCULATIONS.md` §8, not a
   * BLOCK, and warnings are carried on the aggregate so that whatever renders it
   * can say so — a warning thrown away at construction is a warning that does not
   * exist.
   */
  readonly warnings: readonly string[];

  protected constructor(
    id: TransactionId,
    readonly context: TransactionContext | StoredTransactionContext,
    protected readonly details: D,
    private readonly legality: LegalityMatrix = LegalityMatrix.standard(),
  ) {
    super(id);

    // `validate()` runs *before* the postings are built, and that order is
    // load-bearing. A zero-amount revaluation, a sale with no lots, and a charge
    // with nowhere to book it all produce an unbuildable posting, so building
    // first meant every one of them surfaced as "a posting must move money or
    // units (L03)" — true, and useless. The subclass knows what is actually
    // wrong; it gets to say so first.
    this.validate();

    // Renumbered so stored order always reflects written order.
    this.legs = this.buildPostings().map((posting, index) => posting.withSeq(index));

    this.assertBalanced();
    this.assertPostingCurrencies();
    this.assertAccountsAcceptPostings();
    this.assertLegal();
    this.warnings = this.collectWarnings();
  }

  /* ── The four hooks ──────────────────────────────────────────────── */

  abstract get kind(): TransactionKind;

  /** How this event books into the ledger. Called once, by the constructor. */
  protected abstract buildPostings(): readonly Posting[];

  /** Subclass-specific legality, beyond the matrix and the balance. */
  protected abstract validate(): void;

  postings(): readonly Posting[] {
    return this.legs;
  }

  /**
   * What this does to cost-basis lots. Empty for the nine subclasses that touch no
   * instrument — see this file's header for why these three are concrete.
   */
  lotEffects(): readonly LotEffect[] {
    return [];
  }

  /** What the tax engine sees. Never a transaction; only its consequences. */
  taxableEvents(): readonly TaxableEvent[] {
    return [];
  }

  /** What a return calculation sees. */
  cashflows(): readonly Cashflow[] {
    return [];
  }

  /* ── Invariants ──────────────────────────────────────────────────── */

  /**
   * L01 and L02 — and the reason `MixedCurrencyEntryError` no longer exists.
   *
   * The old `JournalEntry` rejected a transaction touching two currencies, because
   * it summed one total and could not compare rupees to dollars. Balance is
   * therefore checked **per currency**: an FX conversion balances twice, once in
   * each, which is exactly what Firefly's `foreign_amount`-on-the-same-row model
   * cannot express (`20-DOMAIN-MODEL.md` §3.5).
   */
  private assertBalanced(): void {
    if (this.legs.length < 2) {
      throw new InsufficientPostingsError(this.legs.length);
    }

    for (const currency of this.currencies()) {
      const residual = Money.total(
        this.legs.filter((posting) => posting.currency.code === currency.code).map((p) => p.balancingAmount),
        currency,
      );
      if (!residual.isZero) {
        throw new UnbalancedTransactionError(currency, residual);
      }
    }
  }

  /**
   * L05. Checked only against the accounts the transaction names as its source and
   * destination, because those are the only ones whose currency it was told.
   * Subclasses that post to a third account (a charge, a gain) check it themselves
   * in `validate()`, where the ref is in scope.
   */
  private assertPostingCurrencies(): void {
    const refs = this.refs();
    if (!refs) return;

    for (const ref of [refs.source, refs.destination]) {
      if (ref.multiCurrency) continue;
      for (const posting of this.legs) {
        if (!posting.accountId.equals(ref.id)) continue;
        if (posting.currency.code !== ref.currency.code) {
          throw new PostingCurrencyMismatchError(ref.displayName, ref.currency, posting.currency);
        }
      }
    }
  }

  /** L08. */
  private assertAccountsAcceptPostings(): void {
    const refs = this.refs();
    if (!refs) return;
    for (const ref of [refs.source, refs.destination]) {
      if (!ref.acceptsPostings) throw new ClosedAccountPostingError(ref.displayName);
    }
  }

  /** L06, and L07 by the absence of any row with `EXPENSE` as a source. */
  private assertLegal(): void {
    const refs = this.refs();
    if (!refs) return;
    this.legality.assertLegal(this.kind, refs.source.role, refs.destination.role);
  }

  /**
   * L11 — a WARN, not a BLOCK. A transaction dated ahead is legitimate (a standing
   * instruction, a known salary date) but is not yet a fact, and a forecast that
   * silently mixes into an actual balance is how a dashboard becomes fiction.
   */
  private collectWarnings(): readonly string[] {
    const context = this.context as TransactionContext;
    const today = "today" in context ? context.today : undefined;
    if (!today || this.context.isForecast) return [];

    const daysAhead = today.daysUntil(this.context.txnDate);
    if (daysAhead > 1) {
      return [
        `This is dated ${daysAhead} days in the future. It will count towards balances ` +
          `immediately; mark it a forecast if it has not happened yet (L11).`,
      ];
    }
    return [];
  }

  /** Present for a live construction, absent for a rehydrated row. */
  protected refs(): { source: AccountRef; destination: AccountRef } | null {
    const context = this.context;
    if (!("source" in context)) return null;
    return { source: context.source, destination: context.destination };
  }

  /**
   * L12, for a subclass that accepts a category it must not carry.
   *
   * It rejects the *input* rather than inspecting the built postings, because a
   * subclass that quietly drops the category would pass a posting-level check
   * while silently ignoring what the user asked for — and a silently ignored
   * budget category is a budget report that is wrong for a reason nobody can see.
   */
  protected assertNoCategory(categoryId: string | null | undefined): void {
    if (categoryId) throw new CategoryOnTransferError(this.kind);
  }

  /** Available to subclasses posting to an account beyond source and destination. */
  protected assertUsable(ref: AccountRef, currency: Currency): void {
    if (!ref.acceptsPostings) throw new ClosedAccountPostingError(ref.displayName);
    if (!ref.multiCurrency && ref.currency.code !== currency.code) {
      throw new PostingCurrencyMismatchError(ref.displayName, ref.currency, currency);
    }
  }

  /* ── Reading ─────────────────────────────────────────────────────── */

  get userId(): UserId {
    return this.context.userId;
  }

  get txnDate(): CalendarDate {
    return this.context.txnDate;
  }

  get description(): string {
    return this.context.description;
  }

  /** Every currency this transaction touches, in first-posting order. */
  currencies(): readonly Currency[] {
    const seen = new Map<string, Currency>();
    for (const posting of this.legs) seen.set(posting.currency.code, posting.currency);
    return [...seen.values()];
  }

  /** The transaction's primary currency: the one its first leg is in. */
  get currency(): Currency {
    return this.legs[0].currency;
  }

  /**
   * The headline amount — the total debited in the primary currency, which by L01
   * also equals the total credited. This is the number a transaction list shows.
   */
  get amount(): Money {
    return Money.total(
      this.legs
        .filter((posting) => posting.isDebit && posting.currency.code === this.currency.code)
        .map((posting) => posting.amount),
      this.currency,
    );
  }

  get isReversal(): boolean {
    return this.kind === "REVERSAL";
  }

  /** Set only on a {@link Reversal}. */
  get reversesTransactionId(): TransactionId | null {
    return null;
  }

  involves(accountId: AccountId): boolean {
    return this.legs.some((posting) => posting.accountId.equals(accountId));
  }

  postingsFor(accountId: AccountId): readonly Posting[] {
    return this.legs.filter((posting) => posting.accountId.equals(accountId));
  }

  /**
   * Net movement this transaction causes in one account. Sums all matching legs, so
   * a split transaction touching the same account twice is handled correctly.
   */
  effectOn(accountId: AccountId, accountType: AccountType): Money {
    return Money.total(
      this.postingsFor(accountId).map((posting) => posting.signedEffectOn(accountType)),
      this.currency,
    );
  }

  /**
   * The correcting transaction: the same legs with debits and credits swapped, and
   * every quantity negated.
   *
   * Reversing rather than editing is what keeps the ledger auditable — the original
   * stays visible, and the pair nets to zero in every report. The reversal posts on
   * `reversedOn` (default: the original date) so the correction lands in the period
   * the mistake was made, not the period it was noticed.
   */
  reverse(props?: { reversedOn?: CalendarDate; description?: string }): Reversal {
    return new Reversal(
      TransactionId.create(),
      {
        ...this.context,
        txnDate: props?.reversedOn ?? this.context.txnDate,
        description: props?.description ?? `Reversal of: ${this.context.description}`,
        // A reversal must not inherit the original's import fingerprint or external
        // id, or the unique index would reject it as a duplicate of what it undoes.
        fingerprint: null,
        externalId: null,
      },
      {
        reverses: this.id,
        originalKind: this.kind,
        legs: this.legs.map((posting) => posting.flipped()),
      },
    );
  }

  /** Multi-line rendering, for debugging and for error messages. */
  toString(): string {
    const legs = this.legs.map((posting) => `  ${posting.toString()}`).join("\n");
    return `${this.txnDate.toISO()}  "${this.description}" [${this.kind}]\n${legs}`;
  }
}

/* ═══ Reversal ════════════════════════════════════════════════════════ */

interface ReversalDetails {
  readonly reverses: TransactionId;
  readonly originalKind: TransactionKind;
  readonly legs: readonly Posting[];
}

/**
 * The mirror of another transaction.
 *
 * It carries the flipped legs it was handed rather than rebuilding them from the
 * original's inputs, because the original's inputs may no longer produce the same
 * postings — a charge table changed, an account was re-subtyped — and a reversal
 * that does not net its original to zero is worse than no reversal at all.
 */
export class Reversal extends Transaction<ReversalDetails> {
  get kind(): "REVERSAL" {
    return "REVERSAL";
  }

  constructor(
    id: TransactionId,
    context: TransactionContext | StoredTransactionContext,
    details: ReversalDetails,
  ) {
    super(id, context, details);
  }

  protected buildPostings(): readonly Posting[] {
    return this.details.legs;
  }

  protected validate(): void {
    /* Nothing to add: a reversal is legal exactly when its original was. */
  }

  override get reversesTransactionId(): TransactionId {
    return this.details.reverses;
  }

  /** What the reversal undoes, for a UI that wants to say so. */
  get originalKind(): TransactionKind {
    return this.details.originalKind;
  }
}

/* ═══ Cash-only subclasses ════════════════════════════════════════════ */

interface MovementDetails {
  readonly amount: Money;
  readonly categoryId?: string | null;
  readonly memo?: string | null;
}

/**
 * Common shape for the four subclasses that move money between exactly two
 * accounts: debit the destination, credit the source.
 *
 * All four fall out of the account types' normal balances, so there is no per-case
 * sign logic to get wrong — which is what v1's separate transaction, transfer and
 * credit-card paths each got wrong differently.
 */
abstract class TwoLegged<D extends MovementDetails> extends Transaction<D> {
  protected buildPostings(): readonly Posting[] {
    const refs = this.refs();
    if (!refs) throw new DomainError("LEDGER_TXN_NO_REFS", "A live transaction needs source and destination accounts.");
    return [
      Posting.create({
        accountId: refs.destination.id,
        direction: "DEBIT",
        amount: this.details.amount,
        memo: this.details.memo ?? null,
        categoryId: this.categoryOn === "DESTINATION" ? this.details.categoryId ?? null : null,
      }),
      Posting.create({
        accountId: refs.source.id,
        direction: "CREDIT",
        amount: this.details.amount,
        memo: this.details.memo ?? null,
        categoryId: this.categoryOn === "SOURCE" ? this.details.categoryId ?? null : null,
      }),
    ];
  }

  /** Which leg a budget category belongs on, or neither. */
  protected abstract get categoryOn(): "SOURCE" | "DESTINATION" | "NEITHER";

  protected validate(): void {
    if (!this.details.amount.isPositive) {
      throw new DomainError(
        "LEDGER_TXN_AMOUNT_NOT_POSITIVE",
        `A ${this.kind} must move a positive amount, got ${this.details.amount.toDecimalString()}. ` +
          `To record the opposite movement, swap the accounts.`,
      );
    }
    if (this.categoryOn === "NEITHER") this.assertNoCategory(this.details.categoryId);
  }

  get movementAmount(): Money {
    return this.details.amount;
  }
}

/** Money spent: an asset or a card pays an expense account. */
export class Expense extends TwoLegged<MovementDetails> {
  get kind(): "WITHDRAWAL" {
    return "WITHDRAWAL";
  }
  protected get categoryOn(): "DESTINATION" {
    return "DESTINATION";
  }

  constructor(id: TransactionId, context: TransactionContext, details: MovementDetails) {
    super(id, context, details);
  }

  static record(context: TransactionContext, details: MovementDetails): Expense {
    return new Expense(TransactionId.create(), context, details);
  }

  override cashflows(): readonly Cashflow[] {
    return [{ onDate: this.txnDate, amount: this.movementAmount.negated(), kind: "EXPENSE", instrumentId: null }];
  }
}

/** Money earned: an income account funds an asset. */
export class Income extends TwoLegged<MovementDetails> {
  get kind(): "DEPOSIT" {
    return "DEPOSIT";
  }
  protected get categoryOn(): "SOURCE" {
    return "SOURCE";
  }

  constructor(id: TransactionId, context: TransactionContext, details: MovementDetails) {
    super(id, context, details);
  }

  static record(context: TransactionContext, details: MovementDetails): Income {
    return new Income(TransactionId.create(), context, details);
  }

  override cashflows(): readonly Cashflow[] {
    return [{ onDate: this.txnDate, amount: this.movementAmount, kind: "INCOME", instrumentId: null }];
  }
}

/**
 * Money moved between two of the user's own accounts — including a credit-card
 * payment, which is a transfer and never an expense.
 *
 * It must not change net worth, and it must carry no budget category (L12):
 * counting the payment as spending would double-count the expense the card already
 * recorded. Firefly needs a `CorrectsTransferBudgets` job for exactly this;
 * rejecting it at construction means there is nothing to correct.
 */
export class Transfer extends TwoLegged<MovementDetails> {
  get kind(): "TRANSFER" {
    return "TRANSFER";
  }
  protected get categoryOn(): "NEITHER" {
    return "NEITHER";
  }

  constructor(id: TransactionId, context: TransactionContext, details: MovementDetails) {
    super(id, context, details);
  }

  static record(context: TransactionContext, details: MovementDetails): Transfer {
    return new Transfer(TransactionId.create(), context, details);
  }
}

/**
 * A fee, charge or tax paid out of an account.
 *
 * Separate from {@link Expense} despite the identical postings, because the two are
 * not the same fact: a brokerage charge is a cost of an investment and may be
 * deductible against a gain, while a grocery bill is consumption. The tax engine
 * reads `deductibility`; a budget report reads {@link Expense}.
 */
interface ChargeDetails extends MovementDetails {
  readonly deductibility: "DEDUCTIBLE" | "NOT_DEDUCTIBLE" | "CAPITALISED";
  readonly chargeType?: string | null;
}

export class Charge extends TwoLegged<ChargeDetails> {
  get kind(): "FEE" {
    return "FEE";
  }
  protected get categoryOn(): "DESTINATION" {
    return "DESTINATION";
  }

  constructor(id: TransactionId, context: TransactionContext, details: ChargeDetails) {
    super(id, context, details);
  }

  static record(context: TransactionContext, details: ChargeDetails): Charge {
    return new Charge(TransactionId.create(), context, details);
  }

  get deductibility(): ChargeDetails["deductibility"] {
    return this.details.deductibility;
  }

  override cashflows(): readonly Cashflow[] {
    return [{ onDate: this.txnDate, amount: this.movementAmount.negated(), kind: "EXPENSE", instrumentId: null }];
  }
}

/* ═══ OpeningBalance ══════════════════════════════════════════════════ */

interface OpeningBalanceDetails {
  /** The balance the account already has. Pass a liability as a positive amount owed. */
  readonly amount: Money;
  /** The account whose balance this is, as distinct from the equity counter-leg. */
  readonly account: AccountRef;
}

/**
 * The balance an account already had when the user started using the app.
 *
 * A user starting today has ₹3.4 lakh in a bank account and no history to explain
 * it, and a single-sided "just set the balance" would leave debits and credits
 * unequal forever. Posting it against `Equity:Opening Balances` is the standard
 * bookkeeping answer: net worth is right immediately, the ledger still balances, and
 * the equity account makes explicit how much of the position was never recorded as
 * income.
 */
export class OpeningBalance extends Transaction<OpeningBalanceDetails> {
  get kind(): "OPENING_BALANCE" {
    return "OPENING_BALANCE";
  }

  constructor(id: TransactionId, context: TransactionContext, details: OpeningBalanceDetails) {
    super(id, context, details);
  }

  static record(context: TransactionContext, details: OpeningBalanceDetails): OpeningBalance {
    return new OpeningBalance(TransactionId.create(), context, details);
  }

  protected buildPostings(): readonly Posting[] {
    const refs = this.refs()!;
    const equity = refs.source.id.equals(this.details.account.id) ? refs.destination : refs.source;
    // An asset's opening balance debits the asset; a liability's credits it. Reading
    // it off the role rather than writing the sign by hand is what keeps the two
    // cases from diverging.
    const increasesWithDebit = !isLiabilityRole(this.details.account.role);
    const amount = this.details.amount.abs();
    return increasesWithDebit
      ? [Posting.debit(this.details.account.id, amount), Posting.credit(equity.id, amount)]
      : [Posting.credit(this.details.account.id, amount), Posting.debit(equity.id, amount)];
  }

  protected validate(): void {
    if (this.details.amount.isZero) {
      throw new DomainError(
        "LEDGER_OPENING_BALANCE_ZERO",
        "An opening balance of zero records nothing: leave it out instead.",
      );
    }
  }
}

/* ═══ ValuationAdjustment ═════════════════════════════════════════════ */

interface ValuationAdjustmentDetails {
  /** Signed: positive when the asset is now worth more. */
  readonly delta: Money;
  readonly asset: AccountRef;
  readonly equityAdjustment: AccountRef;
  readonly basis?: string | null;
}

/**
 * A user-asserted revaluation of something no provider prices — a flat, a
 * collection, unlisted shares.
 *
 * The delta posts against `Equity:Adjustments` so the ledger stays balanced
 * (`20-DOMAIN-MODEL.md` §2.3), which is what lets an unpriceable asset appear in net
 * worth without corrupting the invariant. It produces no taxable event: an
 * unrealised revaluation is not income, and treating it as one is a mistake with a
 * tax consequence.
 */
export class ValuationAdjustment extends Transaction<ValuationAdjustmentDetails> {
  get kind(): "VALUATION_ADJUSTMENT" {
    return "VALUATION_ADJUSTMENT";
  }

  constructor(id: TransactionId, context: TransactionContext, details: ValuationAdjustmentDetails) {
    super(id, context, details);
  }

  static record(context: TransactionContext, details: ValuationAdjustmentDetails): ValuationAdjustment {
    return new ValuationAdjustment(TransactionId.create(), context, details);
  }

  protected buildPostings(): readonly Posting[] {
    const { delta, asset, equityAdjustment } = this.details;
    const magnitude = delta.abs();
    return delta.isPositive
      ? [Posting.debit(asset.id, magnitude), Posting.credit(equityAdjustment.id, magnitude)]
      : [Posting.credit(asset.id, magnitude), Posting.debit(equityAdjustment.id, magnitude)];
  }

  protected validate(): void {
    if (this.details.delta.isZero) {
      throw new DomainError(
        "LEDGER_VALUATION_UNCHANGED",
        "A revaluation to the same value records nothing.",
      );
    }
    this.assertUsable(this.details.equityAdjustment, this.details.delta.currency);
  }
}

/* ═══ Roles ═══════════════════════════════════════════════════════════ */

function isLiabilityRole(role: LegalityRole): boolean {
  return role.startsWith("LIABILITY_");
}

/* ═══ Buy ═════════════════════════════════════════════════════════════ */

interface BuyDetails {
  readonly instrumentId: string;
  readonly quantity: Quantity;
  /** Units × price, before charges. */
  readonly consideration: Money;
  readonly charges: Money;
  /**
   * Capitalising the charge into the cost basis is correct in most tax regimes and
   * is the default (`20-DOMAIN-MODEL.md` §5.3); expensing it books it to
   * `chargeAccount` instead. It is a policy choice, so it is a parameter rather than
   * a hidden convention.
   */
  readonly chargeTreatment?: "CAPITALISE" | "EXPENSE";
  readonly chargeAccount?: AccountRef | null;
  /** The instrument-holding account, as distinct from the cash that funded it. */
  readonly holding: AccountRef;
}

/**
 * A purchase: cash out, units in.
 *
 * Three postings when the charge is expensed, two when it is capitalised — and in
 * both cases the cash leg is the full amount that left the account, which is the
 * number on the bank statement. `20-DOMAIN-MODEL.md` §5.3 is reproduced exactly.
 *
 * It opens one lot and produces **no taxable event**: buying is not a taxable
 * event anywhere, and the cost basis it records is what makes the eventual sale's
 * gain computable.
 */
export class Buy extends Transaction<BuyDetails> {
  get kind(): "BUY" {
    return "BUY";
  }

  constructor(id: TransactionId, context: TransactionContext, details: BuyDetails) {
    super(id, context, details);
  }

  static record(context: TransactionContext, details: BuyDetails): Buy {
    return new Buy(TransactionId.create(), context, details);
  }

  private get capitalises(): boolean {
    return (this.details.chargeTreatment ?? "CAPITALISE") === "CAPITALISE";
  }

  /** What the lot is opened at: consideration, plus the charge when capitalised. */
  get costBasis(): Money {
    return this.capitalises ? this.details.consideration.plus(this.details.charges) : this.details.consideration;
  }

  /** What actually left the funding account. */
  get cashPaid(): Money {
    return this.details.consideration.plus(this.details.charges);
  }

  protected buildPostings(): readonly Posting[] {
    const refs = this.refs()!;
    const { instrumentId, quantity, charges, holding } = this.details;
    const basis = this.costBasis;

    const legs: Posting[] = [
      Posting.create({
        accountId: holding.id,
        direction: "DEBIT",
        amount: basis,
        instrumentId,
        quantity,
        // Per-unit cost as booked, so a re-read reproduces the basis without
        // dividing again — and so a capitalised charge is visible in the unit cost.
        unitCost: quantity.isZero ? null : quantity.perUnit(basis),
      }),
      Posting.create({
        accountId: refs.source.id,
        direction: "CREDIT",
        amount: this.cashPaid,
      }),
    ];

    if (!this.capitalises && charges.isPositive) {
      legs.splice(1, 0, Posting.debit(this.details.chargeAccount!.id, charges, "Charges"));
    }

    return legs;
  }

  protected validate(): void {
    if (!this.details.quantity.isPositive) {
      throw new DomainError(
        "LEDGER_BUY_QUANTITY_NOT_POSITIVE",
        `A purchase must acquire a positive quantity, got ${this.details.quantity.toDecimalString()}. ` +
          `A disposal is a Sell, not a negative Buy.`,
      );
    }
    if (!this.details.consideration.isPositive) {
      throw new DomainError(
        "LEDGER_BUY_CONSIDERATION_NOT_POSITIVE",
        "A purchase must have a positive consideration. Units received for nothing are a corporate action.",
      );
    }
    if (this.details.charges.isNegative) {
      throw new DomainError("LEDGER_BUY_CHARGES_NEGATIVE", "Charges cannot be negative.");
    }
    if (!this.capitalises && this.details.charges.isPositive && !this.details.chargeAccount) {
      throw new DomainError(
        "LEDGER_BUY_NO_CHARGE_ACCOUNT",
        "Expensing the charge needs an expense account to book it to; capitalise it instead, or name one.",
      );
    }
    this.assertUsable(this.details.holding, this.details.consideration.currency);
    if (this.details.chargeAccount) {
      this.assertUsable(this.details.chargeAccount, this.details.charges.currency);
    }
  }

  override lotEffects(): readonly LotEffect[] {
    return [
      {
        kind: "OPEN",
        instrumentId: this.details.instrumentId,
        quantity: this.details.quantity,
        costBasis: this.costBasis,
        acquiredOn: this.txnDate,
      },
    ];
  }

  override cashflows(): readonly Cashflow[] {
    return [
      {
        onDate: this.txnDate,
        amount: this.cashPaid.negated(),
        kind: "CONTRIBUTION",
        instrumentId: this.details.instrumentId,
      },
    ];
  }
}

/* ═══ Sell ════════════════════════════════════════════════════════════ */

interface SellDetails {
  readonly instrumentId: string;
  /** Which lots the units came out of, and at what basis. */
  readonly disposals: readonly Disposal[];
  /** Gross proceeds, before charges. */
  readonly proceeds: Money;
  readonly charges: Money;
  /** Only the portion deductible against the gain — never the total (see `TaxableEvent`). */
  readonly deductibleCharges: Money;
  readonly chargeAccount?: AccountRef | null;
  readonly holding: AccountRef;
  /** Where the realised gain lands. An income account, so gains show as income. */
  readonly gainAccount: AccountRef;
  readonly taxCategory: TaxCategory;
}

/**
 * A disposal: units out, cash in, and a realised gain.
 *
 * The gain is not a stored number — it is `proceeds − costBasis`, and it appears in
 * the ledger only as the leg that makes the transaction balance. That is the whole
 * argument for double entry here: a gain that is *derived* from the postings cannot
 * disagree with them, whereas v1's stored gain field could and did.
 *
 * Proceeds are allocated across disposals with {@link Money.allocate}, so the parts
 * sum to the whole exactly — a per-lot `share` computed independently would lose or
 * invent a paisa on almost every multi-lot sale.
 */
export class Sell extends Transaction<SellDetails> {
  get kind(): "SELL" {
    return "SELL";
  }

  constructor(id: TransactionId, context: TransactionContext, details: SellDetails) {
    super(id, context, details);
  }

  static record(context: TransactionContext, details: SellDetails): Sell {
    return new Sell(TransactionId.create(), context, details);
  }

  get quantitySold(): Quantity {
    return Quantity.sum(this.details.disposals.map((disposal) => disposal.quantity));
  }

  get costBasis(): Money {
    return Money.total(
      this.details.disposals.map((disposal) => disposal.costBasis),
      this.details.proceeds.currency,
    );
  }

  /** Signed: negative on a loss. Derived, never stored. */
  get gain(): Money {
    return this.details.proceeds.minus(this.costBasis);
  }

  get netProceeds(): Money {
    return this.details.proceeds.minus(this.details.charges);
  }

  protected buildPostings(): readonly Posting[] {
    const refs = this.refs()!;
    const { instrumentId, charges, holding, gainAccount } = this.details;
    const gain = this.gain;

    const legs: Posting[] = [
      Posting.create({
        accountId: holding.id,
        direction: "CREDIT",
        amount: this.costBasis,
        instrumentId,
        quantity: this.quantitySold.negated(),
      }),
      Posting.create({ accountId: refs.destination.id, direction: "DEBIT", amount: this.netProceeds }),
    ];

    if (charges.isPositive) {
      legs.push(Posting.debit(this.details.chargeAccount!.id, charges, "Charges"));
    }

    if (!gain.isZero) {
      // A gain credits income; a loss debits it, which is the same account read the
      // other way rather than a second "losses" account nobody would reconcile.
      legs.push(
        gain.isPositive
          ? Posting.credit(gainAccount.id, gain, "Realised gain")
          : Posting.debit(gainAccount.id, gain.abs(), "Realised loss"),
      );
    }

    return legs;
  }

  protected validate(): void {
    if (this.details.disposals.length === 0) {
      throw new DomainError(
        "LEDGER_SELL_NO_DISPOSALS",
        "A sale must say which lots it came out of: without a basis there is no gain to report.",
      );
    }
    for (const disposal of this.details.disposals) {
      if (!disposal.quantity.isPositive) {
        throw new DomainError(
          "LEDGER_SELL_DISPOSAL_NOT_POSITIVE",
          `Disposal from lot ${disposal.lotId} must consume a positive quantity.`,
        );
      }
      if (disposal.acquiredOn.isAfter(this.txnDate)) {
        throw new DomainError(
          "LEDGER_SELL_BEFORE_ACQUISITION",
          `Lot ${disposal.lotId} was acquired on ${disposal.acquiredOn.toISO()}, after this ` +
            `sale on ${this.txnDate.toISO()} — the holding period would be negative.`,
        );
      }
    }
    if (this.details.charges.isPositive && !this.details.chargeAccount) {
      throw new DomainError(
        "LEDGER_SELL_NO_CHARGE_ACCOUNT",
        "Charges on a sale need an expense account to book them to.",
      );
    }
    if (this.details.deductibleCharges.isGreaterThan(this.details.charges)) {
      throw new DomainError(
        "LEDGER_SELL_DEDUCTIBLE_EXCEEDS_TOTAL",
        `Deductible charges (${this.details.deductibleCharges.toDecimalString()}) cannot exceed ` +
          `total charges (${this.details.charges.toDecimalString()}). STT is a charge that is not deductible.`,
      );
    }
    this.assertUsable(this.details.holding, this.details.proceeds.currency);
    this.assertUsable(this.details.gainAccount, this.details.proceeds.currency);
    if (this.details.chargeAccount) {
      this.assertUsable(this.details.chargeAccount, this.details.charges.currency);
    }
  }

  override lotEffects(): readonly LotEffect[] {
    return this.details.disposals.map((disposal) => ({
      kind: "CONSUME" as const,
      instrumentId: this.details.instrumentId,
      lotId: disposal.lotId,
      quantity: disposal.quantity,
      disposedOn: this.txnDate,
    }));
  }

  /**
   * One `CAPITAL_GAIN` per disposal, because that is the unit the tax engine
   * reasons about: two lots of the same scrip sold together can be one short-term
   * and one long-term, and a single blended event cannot express that.
   */
  override taxableEvents(): readonly TaxableEvent[] {
    const { disposals, proceeds, deductibleCharges, instrumentId, taxCategory } = this.details;
    const weights = disposals.map((disposal) => disposal.quantity.toScaledNumber());
    const proceedsPerDisposal = proceeds.allocate(weights);
    const chargesPerDisposal = deductibleCharges.allocate(weights);

    return disposals.map((disposal, index) => ({
      id: `${this.id.value}:${disposal.lotId}`,
      kind: "CAPITAL_GAIN" as const,
      onDate: this.txnDate,
      taxCategory,
      instrumentId,
      acquiredOn: disposal.acquiredOn,
      holdingDays: disposal.acquiredOn.daysUntil(this.txnDate),
      proceeds: proceedsPerDisposal[index],
      costBasis: disposal.costBasis,
      gain: proceedsPerDisposal[index].minus(disposal.costBasis),
      deductibleCharges: chargesPerDisposal[index],
      fmvOnGrandfatherDate: disposal.fmvOnGrandfatherDate ?? null,
      sourceTransactionId: this.id.value,
      sourceLotId: disposal.lotId,
    }));
  }

  override cashflows(): readonly Cashflow[] {
    return [
      {
        onDate: this.txnDate,
        amount: this.netProceeds,
        kind: "WITHDRAWAL",
        instrumentId: this.details.instrumentId,
      },
    ];
  }
}

/* ═══ Dividend and Interest ═══════════════════════════════════════════ */

interface ReceiptDetails {
  /** Before any tax deducted at source. */
  readonly gross: Money;
  readonly taxDeductedAtSource?: Money | null;
  /** Where TDS goes — an asset, because it is a prepayment recoverable in the return. */
  readonly tdsAccount?: AccountRef | null;
  readonly instrumentId?: string | null;
  readonly taxCategory: TaxCategory;
}

/**
 * Income received on a holding: the gross amount, less anything deducted at source.
 *
 * TDS is booked as an **asset**, not an expense, and this is the shape both
 * subclasses share. It is money already paid towards the user's tax bill: expensing
 * it would understate net worth by the refund the return will produce.
 */
abstract class Receipt extends Transaction<ReceiptDetails> {
  protected buildPostings(): readonly Posting[] {
    const refs = this.refs()!;
    const { gross, taxDeductedAtSource, tdsAccount } = this.details;
    const tds = taxDeductedAtSource ?? Money.zero(gross.currency);

    const legs: Posting[] = [
      Posting.debit(refs.destination.id, gross.minus(tds)),
      Posting.credit(refs.source.id, gross),
    ];
    if (tds.isPositive) {
      legs.splice(1, 0, Posting.debit(tdsAccount!.id, tds, "Tax deducted at source"));
    }
    return legs;
  }

  protected validate(): void {
    const { gross, taxDeductedAtSource, tdsAccount } = this.details;
    if (!gross.isPositive) {
      throw new DomainError(
        "LEDGER_RECEIPT_NOT_POSITIVE",
        `A ${this.kind} must be a positive amount, got ${gross.toDecimalString()}.`,
      );
    }
    const tds = taxDeductedAtSource ?? Money.zero(gross.currency);
    if (tds.isNegative) {
      throw new DomainError("LEDGER_RECEIPT_TDS_NEGATIVE", "Tax deducted at source cannot be negative.");
    }
    if (tds.isGreaterThanOrEqual(gross) && !tds.isZero) {
      throw new DomainError(
        "LEDGER_RECEIPT_TDS_EXCEEDS_GROSS",
        `Tax deducted (${tds.toDecimalString()}) cannot be the whole of a ${gross.toDecimalString()} receipt.`,
      );
    }
    if (tds.isPositive && !tdsAccount) {
      throw new DomainError(
        "LEDGER_RECEIPT_NO_TDS_ACCOUNT",
        "Tax deducted at source needs an account to book it to, so it can be reclaimed in the return.",
      );
    }
    if (tdsAccount) this.assertUsable(tdsAccount, gross.currency);
  }

  get gross(): Money {
    return this.details.gross;
  }

  get net(): Money {
    return this.details.gross.minus(this.details.taxDeductedAtSource ?? Money.zero(this.details.gross.currency));
  }

  /** Slab income, both of them. The rate is the user's, and the engine applies it. */
  protected receiptEvent(kind: "DIVIDEND" | "INTEREST"): TaxableEvent {
    return {
      id: this.id.value,
      kind,
      onDate: this.txnDate,
      taxCategory: this.details.taxCategory,
      instrumentId: this.details.instrumentId ?? null,
      acquiredOn: null,
      holdingDays: null,
      proceeds: this.details.gross,
      costBasis: null,
      // The gross is the gain: there is no basis to recover from a receipt.
      gain: this.details.gross,
      deductibleCharges: Money.zero(this.details.gross.currency),
      fmvOnGrandfatherDate: null,
      sourceTransactionId: this.id.value,
      sourceLotId: null,
    };
  }

  override cashflows(): readonly Cashflow[] {
    return [
      {
        onDate: this.txnDate,
        amount: this.net,
        kind: "INCOME",
        instrumentId: this.details.instrumentId ?? null,
      },
    ];
  }
}

/** A dividend received on a holding. Taxed at slab since FY2020-21. */
export class Dividend extends Receipt {
  get kind(): "DIVIDEND" {
    return "DIVIDEND";
  }

  constructor(id: TransactionId, context: TransactionContext, details: ReceiptDetails) {
    super(id, context, details);
  }

  static record(context: TransactionContext, details: ReceiptDetails): Dividend {
    return new Dividend(TransactionId.create(), context, details);
  }

  override taxableEvents(): readonly TaxableEvent[] {
    return [this.receiptEvent("DIVIDEND")];
  }
}

/** Interest credited on a deposit or a savings balance. */
export class Interest extends Receipt {
  get kind(): "INTEREST" {
    return "INTEREST";
  }

  constructor(id: TransactionId, context: TransactionContext, details: ReceiptDetails) {
    super(id, context, details);
  }

  static record(context: TransactionContext, details: ReceiptDetails): Interest {
    return new Interest(TransactionId.create(), context, details);
  }

  override taxableEvents(): readonly TaxableEvent[] {
    return [this.receiptEvent("INTEREST")];
  }
}

/* ═══ CorporateActionTxn ══════════════════════════════════════════════ */

export type SupportedCorporateAction = "SPLIT" | "REVERSE_SPLIT" | "BONUS" | "RETURN_OF_CAPITAL";

interface CorporateActionDetails {
  readonly actionType: string;
  readonly instrumentId: string;
  readonly holding: AccountRef;
  /** Units held before the action, and after it. A 5-for-1 split turns 100 into 500. */
  readonly unitsBefore?: Quantity | null;
  readonly unitsAfter?: Quantity | null;
  /** Cash returned, for a return of capital. Reduces basis rather than being income. */
  readonly cashReturned?: Money | null;
}

/**
 * A corporate action, as the ledger sees it.
 *
 * Splits, reverse splits and bonus issues move **units and no money**: two
 * zero-amount postings on the holding account, which balance trivially and are
 * legal because L03 asks for money *or* units. That is the point of a signed
 * quantity beside a money amount rather than one blended number.
 *
 * A return of capital is the exception: it brings cash in and reduces the basis
 * rather than realising a gain, which is why it is not a `Dividend` — treating it as
 * income would tax money that is the user's own capital coming back.
 *
 * `lotEffects()` returns a `RESCALE`, and `taxableEvents()` returns nothing. **The
 * tax engine never learns what a split is** — that is the design claim of the whole
 * hierarchy, stated in one method.
 */
export class CorporateActionTxn extends Transaction<CorporateActionDetails> {
  get kind(): "CORPORATE_ACTION" {
    return "CORPORATE_ACTION";
  }

  constructor(id: TransactionId, context: TransactionContext, details: CorporateActionDetails) {
    super(id, context, details);
  }

  static record(context: TransactionContext, details: CorporateActionDetails): CorporateActionTxn {
    return new CorporateActionTxn(TransactionId.create(), context, details);
  }

  private get action(): SupportedCorporateAction {
    const { actionType } = this.details;
    if (
      actionType === "SPLIT" ||
      actionType === "REVERSE_SPLIT" ||
      actionType === "BONUS" ||
      actionType === "RETURN_OF_CAPITAL"
    ) {
      return actionType;
    }
    throw new UnsupportedCorporateActionError(actionType);
  }

  protected buildPostings(): readonly Posting[] {
    const { instrumentId, holding, unitsBefore, unitsAfter, cashReturned } = this.details;
    const refs = this.refs()!;

    if (this.action === "RETURN_OF_CAPITAL") {
      const cash = cashReturned!;
      return [
        Posting.create({ accountId: refs.destination.id, direction: "DEBIT", amount: cash }),
        Posting.create({
          accountId: holding.id,
          direction: "CREDIT",
          amount: cash,
          instrumentId,
          // No units move: the holding is worth less by exactly the cash returned.
          quantity: Quantity.ZERO,
        }),
      ];
    }

    const zero = Money.zero(this.currencyOfRecord());
    return [
      Posting.create({
        accountId: holding.id,
        direction: "CREDIT",
        amount: zero,
        instrumentId,
        quantity: unitsBefore!.negated(),
        memo: `${this.action}: ${unitsBefore!.toDecimalString()} units out`,
      }),
      Posting.create({
        accountId: holding.id,
        direction: "DEBIT",
        amount: zero,
        instrumentId,
        quantity: unitsAfter!,
        memo: `${this.action}: ${unitsAfter!.toDecimalString()} units in`,
      }),
    ];
  }

  private currencyOfRecord(): Currency {
    return this.details.cashReturned?.currency ?? this.details.holding.currency;
  }

  protected validate(): void {
    const { unitsBefore, unitsAfter, cashReturned } = this.details;

    if (this.action === "RETURN_OF_CAPITAL") {
      if (!cashReturned || !cashReturned.isPositive) {
        throw new DomainError(
          "LEDGER_CORPORATE_ACTION_NO_CASH",
          "A return of capital must return a positive amount.",
        );
      }
    } else {
      if (!unitsBefore?.isPositive || !unitsAfter?.isPositive) {
        throw new DomainError(
          "LEDGER_CORPORATE_ACTION_UNITS_MISSING",
          `A ${this.action} needs positive unit counts before and after, so the rescaling ` +
            `factor is a fact rather than an inference.`,
        );
      }
      const grows = unitsAfter.isGreaterThan(unitsBefore);
      if (this.action === "REVERSE_SPLIT" && grows) {
        throw new DomainError(
          "LEDGER_REVERSE_SPLIT_GREW",
          "A reverse split reduces the unit count; this one increases it.",
        );
      }
      if (this.action !== "REVERSE_SPLIT" && !grows) {
        throw new DomainError(
          "LEDGER_SPLIT_SHRANK",
          `A ${this.action} increases the unit count; this one does not.`,
        );
      }
    }

    this.assertUsable(this.details.holding, this.currencyOfRecord());
  }

  override lotEffects(): readonly LotEffect[] {
    if (this.action === "RETURN_OF_CAPITAL") {
      return [
        {
          kind: "REDUCE_BASIS",
          instrumentId: this.details.instrumentId,
          amount: this.details.cashReturned!,
          effectiveOn: this.txnDate,
        },
      ];
    }

    const { unitsBefore, unitsAfter } = this.details;
    return [
      {
        kind: "RESCALE",
        instrumentId: this.details.instrumentId,
        // New units per old unit. A bonus issue is a rescale rather than a new lot
        // because the basis is spread over more units, not added to.
        quantityFactor: unitsAfter!.ratioTo(unitsBefore!),
        effectiveOn: this.txnDate,
      },
    ];
  }

  override cashflows(): readonly Cashflow[] {
    if (this.action !== "RETURN_OF_CAPITAL") return [];
    return [
      {
        onDate: this.txnDate,
        amount: this.details.cashReturned!,
        kind: "WITHDRAWAL",
        instrumentId: this.details.instrumentId,
      },
    ];
  }
}

/* ═══ FxConversion ════════════════════════════════════════════════════ */

interface FxConversionDetails {
  readonly from: Money;
  readonly to: Money;
  /** `Equity:FX`, which holds both legs and nets to zero once the rate is settled. */
  readonly fxAccount: AccountRef;
}

/**
 * A currency conversion: four postings that balance **in each currency separately**.
 *
 * This is the transaction the old `JournalEntry` could not express, and the reason
 * balance is per currency. Firefly puts a `foreign_amount` on the same row
 * (`20-DOMAIN-MODEL.md` §5.4), which breaks the uniform invariant and forces its
 * repair job to special-case transfers; here the invariant is unchanged and simply
 * holds twice.
 *
 * The implied rate is *derived* from the two amounts rather than stored beside them,
 * so it cannot disagree with the money that actually moved. `40-MARKET-DATA.md`
 * reconciles it against `fx_rates`.
 */
export class FxConversion extends Transaction<FxConversionDetails> {
  get kind(): "FX_CONVERSION" {
    return "FX_CONVERSION";
  }

  constructor(id: TransactionId, context: TransactionContext, details: FxConversionDetails) {
    super(id, context, details);
  }

  static record(context: TransactionContext, details: FxConversionDetails): FxConversion {
    return new FxConversion(TransactionId.create(), context, details);
  }

  protected buildPostings(): readonly Posting[] {
    const refs = this.refs()!;
    const { from, to, fxAccount } = this.details;
    return [
      Posting.credit(refs.source.id, from, "Converted out"),
      Posting.debit(fxAccount.id, from, "FX in"),
      Posting.credit(fxAccount.id, to, "FX out"),
      Posting.debit(refs.destination.id, to, "Converted in"),
    ];
  }

  protected validate(): void {
    const { from, to, fxAccount } = this.details;
    if (from.currency.code === to.currency.code) {
      throw new DomainError(
        "LEDGER_FX_SAME_CURRENCY",
        `An FX conversion needs two currencies; both sides are ${from.currency.code}. ` +
          `Moving money within one currency is a Transfer.`,
      );
    }
    if (!from.isPositive || !to.isPositive) {
      throw new DomainError("LEDGER_FX_NOT_POSITIVE", "Both sides of a conversion must be positive.");
    }
    if (!fxAccount.multiCurrency) {
      throw new DomainError(
        "LEDGER_FX_ACCOUNT_SINGLE_CURRENCY",
        `${fxAccount.displayName} holds only ${fxAccount.currency.code}, so it cannot carry ` +
          `both legs of a conversion. An FX account is multi-currency by definition.`,
      );
    }
    if (!fxAccount.acceptsPostings) throw new ClosedAccountPostingError(fxAccount.displayName);
  }

  /**
   * Units of the source currency per unit of the destination — 84.00 for
   * ₹92,400 → $1,100.
   *
   * Computed in exact integer arithmetic from the minor units and each currency's
   * minor-unit factor, so no float appears between the money that moved and the rate
   * reported for it.
   */
  impliedRate(): Quantity {
    const { from, to } = this.details;
    const fromMinor = BigInt(from.toMinorNumber());
    const toMinor = BigInt(to.toMinorNumber());
    return Quantity.fromRatio(
      fromMinor * to.currency.minorUnitsPerMajor,
      toMinor * from.currency.minorUnitsPerMajor,
    );
  }
}

/* ═══ StoredTransaction ═══════════════════════════════════════════════ */

/**
 * A transaction read back from the database.
 *
 * Not a fourteenth kind of event: it is the *rehydration vehicle* for all of them.
 * The stored row carries the postings and the kind, and that is exactly what the
 * balance check, the balance calculator and every report need. What it cannot carry
 * is the subclass payload — which lots a sale consumed lives in `lots`, not in the
 * transaction row — so it answers the lot, tax and cashflow hooks with nothing
 * rather than with a guess.
 *
 * The consequence is deliberate: the engines that need those hooks consume freshly
 * constructed transactions, or (from Phase 2) rebuild them from the lot rows. A
 * `StoredTransaction` that invented a `taxableEvent` from a posting pair would be
 * the same class of error as v1 back-deriving exemption used from a total.
 */
export class StoredTransaction extends Transaction<{ kind: TransactionKind; legs: readonly Posting[]; reverses: TransactionId | null }> {
  get kind(): TransactionKind {
    return this.details.kind;
  }

  private constructor(
    id: TransactionId,
    context: StoredTransactionContext,
    details: { kind: TransactionKind; legs: readonly Posting[]; reverses: TransactionId | null },
  ) {
    super(id, context, details);
  }

  /** Rehydration from stored rows. Only mappers should call this. */
  static rehydrate(props: {
    id: TransactionId;
    context: StoredTransactionContext;
    kind: TransactionKind;
    postings: readonly Posting[];
    reversesTransactionId?: TransactionId | null;
  }): StoredTransaction {
    return new StoredTransaction(props.id, props.context, {
      kind: props.kind,
      legs: [...props.postings].sort((a, b) => a.seq - b.seq),
      reverses: props.reversesTransactionId ?? null,
    });
  }

  protected buildPostings(): readonly Posting[] {
    return this.details.legs;
  }

  protected validate(): void {
    /* The row was validated when written; see StoredTransactionContext. */
  }

  override get reversesTransactionId(): TransactionId | null {
    return this.details.reverses;
  }
}

/* ═══ BalanceCalculator ═══════════════════════════════════════════════ */

/**
 * The reference implementation of "what is this account's balance?" — a pure fold
 * over transactions, with no I/O.
 *
 * The production read path is SQL ({@link BalanceQuery}), because summing every
 * posting in JavaScript does not scale. This class is why that SQL can be trusted:
 * it is the same definition expressed in ~40 obviously-correct lines, so the
 * aggregate queries can be checked against it instead of being taken on faith. It
 * is also what tests and the in-memory fake use.
 *
 * Definitions, in one place:
 *   - balance-sheet accounts (asset/liability/equity) accumulate over all time up to
 *     a date;
 *   - income and expense accounts are only meaningful over a period;
 *   - a balance is signed in the account's own favour, via
 *     {@link AccountType.signedEffect}.
 *
 * Postings not in the calculator's currency are skipped rather than converted: a
 * balance in two currencies is two balances, and quietly translating one at today's
 * rate would report a number the user cannot reconcile against any statement.
 */
export class BalanceCalculator {
  constructor(private readonly currency: Currency = Currency.reporting) {}

  /**
   * Cumulative balances up to and including `asOf`, keyed by account id. Accounts
   * with no postings are present with a zero balance.
   */
  balancesAsOf(
    accounts: readonly Account[],
    transactions: readonly Transaction[],
    asOf: CalendarDate,
  ): Map<string, Money> {
    return this.fold(accounts, transactions, (txn) => txn.txnDate.isOnOrBefore(asOf));
  }

  /** Totals posted within `range` — the right question for income and expense. */
  balancesWithin(
    accounts: readonly Account[],
    transactions: readonly Transaction[],
    range: DateRange,
  ): Map<string, Money> {
    return this.fold(accounts, transactions, (txn) => range.contains(txn.txnDate));
  }

  private fold(
    accounts: readonly Account[],
    transactions: readonly Transaction[],
    include: (txn: Transaction) => boolean,
  ): Map<string, Money> {
    const typeById = new Map<string, AccountType>(
      accounts.map((account) => [account.id.value, account.type]),
    );
    const balances = new Map<string, Money>(
      accounts.map((account) => [account.id.value, Money.zero(this.currency)]),
    );

    for (const txn of transactions) {
      if (!include(txn)) continue;
      for (const posting of txn.postings()) {
        if (posting.currency.code !== this.currency.code) continue;
        const key = posting.accountId.value;
        const type = typeById.get(key);
        // A posting to an account outside `accounts` is skipped rather than guessed
        // at — the caller chose the account set.
        if (!type) continue;
        balances.set(
          key,
          (balances.get(key) ?? Money.zero(this.currency)).plus(posting.signedEffectOn(type)),
        );
      }
    }

    return balances;
  }

  balanceOf(account: Account, transactions: readonly Transaction[], asOf: CalendarDate): Money {
    return this.balancesAsOf([account], transactions, asOf).get(account.id.value) ?? Money.zero(this.currency);
  }

  /**
   * Net worth as of a date: assets minus liabilities.
   *
   * Income and expense accounts are excluded because they are flows, not holdings —
   * including them would double-count every transaction, once in the category and
   * once in the bank balance it came out of.
   */
  netWorthAsOf(
    accounts: readonly Account[],
    transactions: readonly Transaction[],
    asOf: CalendarDate,
  ): { assets: Money; liabilities: Money; netWorth: Money } {
    const balances = this.balancesAsOf(accounts, transactions, asOf);
    const zero = Money.zero(this.currency);

    let assets = zero;
    let liabilities = zero;
    for (const account of accounts) {
      const balance = balances.get(account.id.value) ?? zero;
      if (account.type === AccountType.ASSET) assets = assets.plus(balance);
      else if (account.type === AccountType.LIABILITY) liabilities = liabilities.plus(balance);
    }

    return { assets, liabilities, netWorth: assets.minus(liabilities) };
  }

  /**
   * Proves the ledger is internally consistent: across every posting ever made,
   * total debits equal total credits, in every currency.
   *
   * Each transaction guarantees this for itself at construction, so a failure here
   * means the *store* is corrupt — a partial write, or a row edited outside the app.
   * Cheap enough to run as a maintenance check, and it is the one assertion that
   * would have caught v1's drift.
   */
  verifyIntegrity(transactions: readonly Transaction[]): {
    ok: boolean;
    debits: Money;
    credits: Money;
    offendingTransactionIds: string[];
  } {
    const zero = Money.zero(this.currency);
    let debits = zero;
    let credits = zero;
    const offendingTransactionIds: string[] = [];

    for (const txn of transactions) {
      // Per currency, because a balanced FX conversion is not balanced in either
      // currency alone — and a check that ignored that would either reject every
      // conversion or accept a broken one.
      for (const currency of txn.currencies()) {
        let txnDebits = Money.zero(currency);
        let txnCredits = Money.zero(currency);
        for (const posting of txn.postings()) {
          if (posting.currency.code !== currency.code) continue;
          if (posting.isDebit) txnDebits = txnDebits.plus(posting.amount);
          else txnCredits = txnCredits.plus(posting.amount);
        }
        if (!txnDebits.equals(txnCredits)) offendingTransactionIds.push(txn.id.value);
        if (currency.code === this.currency.code) {
          debits = debits.plus(txnDebits);
          credits = credits.plus(txnCredits);
        }
      }
    }

    return {
      ok: debits.equals(credits) && offendingTransactionIds.length === 0,
      debits,
      credits,
      offendingTransactionIds,
    };
  }

  /** Sum of the given accounts' balances — used for subtree rollups. */
  totalOf(accountIds: readonly AccountId[], balances: ReadonlyMap<string, Money>): Money {
    return Money.total(
      accountIds.map((id) => balances.get(id.value) ?? Money.zero(this.currency)),
      this.currency,
    );
  }
}

/* ═══ TransactionRepository (port) ════════════════════════════════════ */

export interface TransactionQuery {
  /** Only transactions touching one of these accounts. */
  accountIds?: readonly AccountId[];
  range?: DateRange;
  /** Free-text match against the description and reference. */
  search?: string;
  kinds?: readonly TransactionKind[];
  importBatchId?: string;
  limit?: number;
  offset?: number;
}

export interface TransactionPage {
  transactions: readonly Transaction[];
  /** Total matching the query, ignoring limit/offset — for pagination. */
  totalCount: number;
}

/**
 * Persistence for transactions.
 *
 * Whole aggregates only: `save` writes the transaction and all its postings in one
 * database transaction, and there is deliberately no way to add, edit or remove a
 * single posting. A partial write would leave an unbalanced transaction in the
 * table, which is exactly the state the constructor exists to prevent — and it is
 * also how invariant L10 (reconciled postings are immutable) is enforced: there is
 * no posting-level write path to guard.
 *
 * There is no `update`. Transactions are append-only; corrections go through
 * `Transaction.reverse()` and are saved as new rows.
 */
export interface TransactionRepository {
  /** Writes the transaction and its postings atomically. */
  save(txn: Transaction): Promise<void>;

  /** Writes many in one database transaction — an import either lands or does not. */
  saveMany(transactions: readonly Transaction[]): Promise<void>;

  findById(userId: UserId, id: TransactionId): Promise<Transaction | null>;

  find(userId: UserId, query: TransactionQuery): Promise<TransactionPage>;

  /**
   * Whether an imported row is already present. Checked before building the
   * transaction so a duplicate is a friendly skip rather than a unique-index error.
   */
  existsWithFingerprint(userId: UserId, fingerprint: string): Promise<boolean>;

  /** Which of these fingerprints already exist — one round trip per import. */
  findExistingFingerprints(
    userId: UserId,
    fingerprints: readonly string[],
  ): Promise<ReadonlySet<string>>;

  /** True when this transaction has already been reversed, so it is not reversed twice. */
  hasReversal(userId: UserId, id: TransactionId): Promise<boolean>;

  /**
   * Undo an import. Returns how many transactions were tombstoned.
   *
   * Previously a hard delete that relied on `ON DELETE CASCADE` to take the postings
   * with it — which destroyed the evidence of what the import had done, so "undo it
   * and tell me what changed" was unanswerable.
   */
  softDeleteByImportBatch(userId: UserId, importBatchId: string, at: Date): Promise<number>;

  /**
   * Stamps `deletedAt` — invariant A03.
   *
   * Not how a *mistake* is corrected: a transaction that posted the wrong amount is
   * fixed with a reversal, so both the error and the correction stay visible. This is
   * for one that should never have existed, such as a duplicate from a re-import.
   */
  softDelete(userId: UserId, id: TransactionId, at: Date): Promise<void>;

  /** The earliest transaction date, used to size the net-worth timeline. */
  earliestTxnDate(userId: UserId): Promise<CalendarDate | null>;
}

/* ═══ BalanceQuery (port) ═════════════════════════════════════════════ */

/**
 * An account's balance, signed in the account's own favour: a positive figure means
 * "more asset" or "more debt", never a raw debit total.
 */
export interface AccountBalance {
  accountId: AccountId;
  code: string;
  name: string;
  type: AccountTypeName;
  subtype: string | null;
  institution: string | null;
  isClosed: boolean;
  /** Cumulative to the as-of date for balance-sheet accounts. */
  balance: Money;
  /** Postings behind this balance — distinguishes "₹0" from "never used". */
  postingCount: number;
}

/** Cumulative totals per account type, as of a date. */
export interface TypeTotals {
  asOf: CalendarDate;
  assets: Money;
  liabilities: Money;
  equity: Money;
  /** assets − liabilities. */
  netWorth: Money;
}

/** Income and expense for one month — the savings-rate series. */
export interface MonthlyFlow {
  /** `YYYY-MM`. */
  month: string;
  income: Money;
  expense: Money;
}

/** Total posted to one account over a period, for category comparisons. */
export interface AccountFlow {
  accountId: AccountId;
  code: string;
  name: string;
  type: AccountTypeName;
  amount: Money;
  postingCount: number;
}

/**
 * The ledger's read side.
 *
 * Separate from {@link TransactionRepository} on purpose. Balances are aggregates
 * over potentially every posting a user has ever made, so they belong in SQL —
 * `SUM(...)` with a `GROUP BY`, not a million transactions loaded into memory and
 * folded in JavaScript. Pretending these queries went through the aggregate
 * repository would either be a lie or a performance cliff.
 *
 * Nothing here returns a domain entity: these are read models, consumed directly by
 * reports and the dashboard.
 *
 * Every implementation must agree with {@link BalanceCalculator}, the pure fold over
 * the same data. That equivalence is what makes the fast SQL path trustworthy, and
 * it is checked by test rather than assumed.
 */
export interface BalanceQuery {
  /** Balances for all balance-sheet accounts, cumulative to `asOf`. */
  balanceSheet(
    userId: UserId,
    asOf: CalendarDate,
    options?: { includeClosed?: boolean; includeEmpty?: boolean },
  ): Promise<AccountBalance[]>;

  balanceOf(userId: UserId, accountId: AccountId, asOf: CalendarDate): Promise<Money>;

  /** Assets, liabilities and net worth as of a date. */
  totals(userId: UserId, asOf: CalendarDate): Promise<TypeTotals>;

  /** Income and expense totals for each month in `range`. */
  monthlyFlows(userId: UserId, range: DateRange): Promise<MonthlyFlow[]>;

  /**
   * Totals per income/expense account over a period — the category breakdown.
   * `rollUp` sums descendants into their parent, so `Expenses:Food` reports the whole
   * subtree rather than only what was posted to it directly.
   */
  flowsByAccount(
    userId: UserId,
    range: DateRange,
    options?: { type?: "INCOME" | "EXPENSE"; rollUp?: boolean },
  ): Promise<AccountFlow[]>;

  /** Running balance of one account over a period, for its detail chart. */
  balanceSeries(
    userId: UserId,
    accountId: AccountId,
    range: DateRange,
  ): Promise<{ date: CalendarDate; balance: Money }[]>;
}

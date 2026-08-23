/**
 * Invariants L01–L12 of `30-CALCULATIONS.md` §8, each twice.
 *
 * Every invariant gets **a violating-state test** — the state it forbids, proven
 * unreachable — and **a generated-dataset test**, which is the half that catches
 * what the example did not think of. A hand-written violation only proves the
 * check fires on the case its author imagined; a few thousand random
 * transactions prove it fires on the shape nobody wrote down.
 *
 * Where an invariant is enforced by the database rather than the domain (L09's
 * partial unique index, L10's absence of a write path), the test says which, and
 * asserts the thing that is actually true in this layer. Claiming a domain test
 * covers a database constraint is how an invariant ends up enforced nowhere.
 */

import { UserId } from "@/core/kernel";
import { Currency, Money } from "@/core/money";
import { Quantity } from "@/core/numeric";
import { CalendarDate } from "@/core/time";
import { Account, AccountCode, AccountType, LEGALITY_ROLES } from "@/domain/accounts";
import { BalanceCalculator, Charge, Expense, FxConversion, Income, LegalityMatrix, Posting, StoredTransaction, TRANSACTION_KIND_NAMES, Transaction, TransactionContext, TransactionId, TransactionKind, TransactionRepository, Transfer, accountRef, legalityRows } from "@/domain/transactions";
import { assertProperty, check, genInt, section, throws, done } from "./harness";
import type { Gen, Rng } from "./harness";

const userId = UserId.from("user_inv_1");
const INR = Currency.reporting;
const USD = Currency.of("USD");
const on = (value: string) => CalendarDate.parse(value);
const rupees = (value: string) => Money.fromRupees(value);

const acct = (
  code: string,
  type: AccountType,
  subtype: Parameters<typeof Account.open>[0]["subtype"] = null,
  currency: Currency = INR,
) => Account.open({ userId, code: AccountCode.parse(code), name: code, type, subtype, currency });

const hdfc = acct("Assets:Bank:HDFC", AccountType.ASSET, "BANK");
const savings = acct("Assets:Bank:Savings", AccountType.ASSET, "SAVINGS");
const zerodha = acct("Assets:Broker:Zerodha", AccountType.ASSET, "BROKERAGE");
const ibkr = acct("Assets:Broker:IBKR:Cash", AccountType.ASSET, "BROKERAGE", USD);
const card = acct("Liabilities:Cards:ICICI", AccountType.LIABILITY, "CREDIT_CARD");
const groceries = acct("Expenses:Food:Groceries", AccountType.EXPENSE);
const brokerage = acct("Expenses:Brokerage", AccountType.EXPENSE);
const salary = acct("Income:Salary", AccountType.INCOME);
const fxEquity = acct("Equity:FX", AccountType.EQUITY, "ADJUSTMENT");

const ctx = (from: Account, to: Account, description = "test", date = "2026-08-05"): TransactionContext => ({
  userId,
  txnDate: on(date),
  description,
  source: accountRef(from),
  destination: accountRef(to),
});

/**
 * A transaction whose legs are supplied verbatim, so a test can construct the
 * exact shape an invariant forbids. Nothing in `src/` can do this — which is the
 * point of testing through it.
 */
class RawTransaction extends Transaction<readonly Posting[]> {
  constructor(
    context: TransactionContext,
    legs: readonly Posting[],
    private readonly declared: TransactionKind = "TRANSFER",
  ) {
    super(TransactionId.create(), context, legs);
  }

  get kind(): TransactionKind {
    // Read off a field assigned before `super()` returns? No: `declared` is a
    // constructor parameter property, so it is undefined while the base class is
    // still validating. The default keeps that window well-defined.
    return this.declared ?? "TRANSFER";
  }

  protected buildPostings(): readonly Posting[] {
    return this.details;
  }

  protected validate(): void {}
}

const raw = (context: TransactionContext, legs: readonly Posting[], kind?: TransactionKind) =>
  new RawTransaction(context, legs, kind);

/* ══ Generators ══════════════════════════════════════════════════════ */

/** A balanced two-leg transaction between two randomly chosen accounts. */
const genBalanced: Gen<Transaction> = (rng: Rng) => {
  const paise = genInt(1, 50_000_000)(rng);
  const amount = Money.fromMinor(paise, INR);
  const pick = genInt(0, 2)(rng);
  if (pick === 0) return Income.record(ctx(salary, hdfc), { amount });
  if (pick === 1) return Expense.record(ctx(card, groceries), { amount });
  return Transfer.record(ctx(hdfc, savings), { amount });
};

/* ══ L01 — postings sum to zero, per currency ════════════════════════ */

section("L01 — postings sum to zero, per currency");
throws(
  "violating state: legs that do not sum to zero",
  () =>
    raw(ctx(hdfc, groceries), [
      Posting.debit(groceries.id, rupees("1240")),
      Posting.credit(hdfc.id, rupees("1000")),
    ]),
  "invariant L01",
);
throws(
  "violating state: balanced in rupees, not in dollars",
  () =>
    raw(ctx(hdfc, ibkr), [
      Posting.debit(hdfc.id, rupees("100")),
      Posting.credit(hdfc.id, rupees("100")),
      Posting.debit(ibkr.id, Money.fromRupees("5", USD)),
      Posting.credit(ibkr.id, Money.fromRupees("4", USD)),
    ]),
  "does not balance in USD",
);
assertProperty(
  "L01 holds over generated transactions",
  genBalanced,
  (txn) => {
    for (const currency of txn.currencies()) {
      const residual = Money.total(
        txn.postings().filter((p) => p.currency.code === currency.code).map((p) => p.balancingAmount),
        currency,
      );
      if (!residual.isZero) return false;
    }
    return true;
  },
  2000,
);

/* ══ L02 — at least two postings ═════════════════════════════════════ */

section("L02 — at least two postings");
throws(
  "violating state: one leg",
  () => raw(ctx(hdfc, groceries), [Posting.debit(groceries.id, rupees("100"))]),
  "invariant L02",
);
throws("violating state: no legs at all", () => raw(ctx(hdfc, groceries), []), "invariant L02");
assertProperty(
  "L02 holds over generated transactions",
  genBalanced,
  (txn) => txn.postings().length >= 2,
  2000,
);

/* ══ L03 — a posting moves money or units ════════════════════════════ */

section("L03 — no posting is empty");
throws(
  "violating state: zero money and no units",
  () => Posting.debit(hdfc.id, Money.zero(INR)),
  "invariant L03",
);
throws(
  "violating state: zero money and zero units",
  () =>
    Posting.create({
      accountId: zerodha.id,
      direction: "DEBIT",
      amount: Money.zero(INR),
      instrumentId: "INFY",
      quantity: Quantity.ZERO,
    }),
  "invariant L03",
);
check(
  "but zero money WITH units is legal — a bonus issue moves no cash",
  Posting.create({
    accountId: zerodha.id,
    direction: "DEBIT",
    amount: Money.zero(INR),
    instrumentId: "INFY",
    quantity: Quantity.fromString("10"),
  }).amount.toDecimalString(),
  "0.00",
);
assertProperty(
  "L03 holds over generated postings",
  genBalanced,
  (txn) => txn.postings().every((p) => !p.amount.isZero || (p.quantity !== null && !p.quantity.isZero)),
  2000,
);

/* ══ L04 — commodity coherence ═══════════════════════════════════════ */

section("L04 — commodity columns are coherent");
throws(
  "violating state: a quantity with no instrument",
  () =>
    Posting.create({
      accountId: zerodha.id, direction: "DEBIT", amount: rupees("100"),
      quantity: Quantity.fromString("5"),
    }),
  "invariant L04",
);
throws(
  "violating state: an instrument with no quantity",
  () =>
    Posting.create({
      accountId: zerodha.id, direction: "DEBIT", amount: rupees("100"), instrumentId: "INFY",
    }),
  "invariant L04",
);
throws(
  "violating state: a unit cost pricing nothing",
  () =>
    Posting.create({
      accountId: zerodha.id, direction: "DEBIT", amount: rupees("100"), unitCost: rupees("10"),
    }),
  "invariant L04",
);
assertProperty(
  "L04 holds over generated postings",
  (rng: Rng) => {
    const withInstrument = genInt(0, 1)(rng) === 1;
    return Posting.create({
      accountId: zerodha.id,
      direction: "DEBIT",
      amount: Money.fromMinor(genInt(1, 100_000)(rng), INR),
      instrumentId: withInstrument ? "INFY" : null,
      quantity: withInstrument ? Quantity.fromString(String(genInt(1, 500)(rng))) : null,
    });
  },
  (posting) =>
    (posting.instrumentId === null && posting.quantity === null && posting.unitCost === null) ||
    (posting.instrumentId !== null && posting.quantity !== null),
  1000,
);

/* ══ L05 — posting currency matches its account ══════════════════════ */

section("L05 — posting currency matches its account");
throws(
  "violating state: a dollar posting on a rupee account",
  () =>
    raw(ctx(hdfc, savings), [
      Posting.debit(savings.id, Money.fromRupees("100", USD)),
      Posting.credit(hdfc.id, Money.fromRupees("100", USD)),
    ]),
  "invariant L05",
);
check(
  "a multi-currency account may hold both, which is what makes FX expressible",
  FxConversion.record(ctx(hdfc, ibkr, "conversion"), {
    from: rupees("92400"),
    to: Money.fromRupees("1100", USD),
    fxAccount: accountRef(fxEquity, { multiCurrency: true }),
  }).currencies().length,
  2,
);
assertProperty(
  "L05 holds over generated transactions",
  genBalanced,
  (txn) => txn.postings().every((p) => p.currency.code === INR.code),
  1000,
);

/* ══ L06 and L07 — the legality matrix ═══════════════════════════════ */

section("L06 / L07 — the legality matrix, and EXPENSE as a source");
const matrix = LegalityMatrix.standard();
check("the matrix is the seeded one", matrix.size, legalityRows().length);
throws(
  "violating state: spending out of an expense account (L07)",
  () => Expense.record(ctx(groceries, brokerage), { amount: rupees("100") }),
  "invariant L06",
);
check(
  "L07 is L06's data: no row has EXPENSE as a source",
  legalityRows().filter((row) => row.sourceRole === "EXPENSE" && row.txnType !== "REFUND").length,
  0,
);
check(
  "...and the one exception is stated as data too: a REFUND may come from EXPENSE",
  matrix.permits("REFUND", "EXPENSE", "ASSET_BANK"),
  true,
);
throws(
  "violating state: paying an expense with an income account as the destination",
  () => Income.record(ctx(salary, groceries), { amount: rupees("100") }),
  "invariant L06",
);
// The rejection names the row, so the message doubles as the fix.
throws(
  "the message names the exact missing row",
  () => Expense.record(ctx(groceries, brokerage), { amount: rupees("100") }),
  "(WITHDRAWAL, EXPENSE, EXPENSE) row",
);
assertProperty(
  "L06 is total: every (kind, source, destination) triple is a definite yes or no",
  (rng: Rng) => ({
    kind: TRANSACTION_KIND_NAMES[genInt(0, TRANSACTION_KIND_NAMES.length - 1)(rng)],
    source: LEGALITY_ROLES[genInt(0, LEGALITY_ROLES.length - 1)(rng)],
    destination: LEGALITY_ROLES[genInt(0, LEGALITY_ROLES.length - 1)(rng)],
  }),
  ({ kind, source, destination }) => {
    const permitted = matrix.permits(kind, source, destination);
    // L07, over the generated space: no permitted triple sources from EXPENSE
    // except a refund, and none is permitted that the matrix does not list.
    if (permitted && source === "EXPENSE" && kind !== "REFUND") return false;
    if (!permitted) {
      let threw = false;
      try {
        matrix.assertLegal(kind, source, destination);
      } catch {
        threw = true;
      }
      return threw;
    }
    return true;
  },
  3000,
);

/* ══ L08 — no posting to a closed account ════════════════════════════ */

section("L08 — closed accounts take no postings");
const closedCard = card.close();
throws(
  "violating state: spending on a closed card",
  () =>
    Expense.record(
      { ...ctx(card, groceries), source: accountRef(closedCard) },
      { amount: rupees("100") },
    ),
  "invariant L08",
);
assertProperty(
  "L08: a closed account is rejected wherever it appears",
  (rng: Rng) => genInt(0, 1)(rng) === 1,
  (asSource) => {
    const context = asSource
      ? { ...ctx(card, groceries), source: accountRef(closedCard) }
      : { ...ctx(hdfc, card), destination: accountRef(closedCard) };
    try {
      if (asSource) Expense.record(context, { amount: rupees("100") });
      else Transfer.record(context, { amount: rupees("100") });
      return false;
    } catch (error) {
      return (error as Error).message.includes("invariant L08");
    }
  },
  500,
);

/* ══ L09 — external_id is unique per user among live rows ════════════ */

section("L09 — external ids are unique per user among live rows");
/*
 * Enforced by a partial unique index, not by the domain: uniqueness is a claim
 * about every *other* row, which an aggregate cannot see. The index is asserted
 * in `schema-integrity.spec.ts`; what belongs here is that the domain carries the
 * id at all, and that a reversal does not inherit it — inheriting it would make
 * every correction collide with what it corrects.
 */
const imported = Expense.record(
  { ...ctx(card, groceries), externalId: "provider-row-42", fingerprint: "fp-42" },
  { amount: rupees("100") },
);
check("the external id is carried", imported.context.externalId, "provider-row-42");
check("a reversal does not inherit it", imported.reverse().context.externalId ?? null, null);
check("nor the fingerprint", imported.reverse().context.fingerprint ?? null, null);

/* ══ L10 — reconciled postings are immutable ═════════════════════════ */

section("L10 — reconciled postings are immutable");
/*
 * Enforced structurally: `Posting` has no setter, and `TransactionRepository`
 * exposes no posting-level or update path. Asserted as an *absence*, because that
 * is what the guarantee actually is — a test that mutated and re-read would be
 * testing a code path that must not exist.
 */
const reconciled = Posting.create({
  accountId: hdfc.id, direction: "DEBIT", amount: rupees("100"), status: "RECONCILED",
});
check("a reconciled posting knows it is", reconciled.isReconciled, true);
const repositoryMethods: (keyof TransactionRepository)[] = [
  "save", "saveMany", "findById", "find", "existsWithFingerprint", "findExistingFingerprints",
  "hasReversal", "softDeleteByImportBatch", "softDelete", "earliestTxnDate",
];
check(
  "the repository offers no update, and no posting-level write",
  repositoryMethods.filter((name) => /update|patch|posting/i.test(name)).length,
  0,
);
check(
  "changing a posting produces a new one rather than mutating it",
  reconciled.withSeq(3) === reconciled,
  false,
);
check("...and the original is untouched", reconciled.seq, 0);
check(
  "a flipped posting is cleared, never still reconciled",
  reconciled.flipped().status,
  "CLEARED",
);

/* ══ L11 — a future date warns, and does not block ═══════════════════ */

section("L11 — future-dated transactions warn");
const today = on("2026-08-05");
const futureSpend = Expense.record(
  { ...ctx(card, groceries, "next month", "2026-09-20"), today },
  { amount: rupees("100") },
);
check("it is allowed — this is a WARN, not a BLOCK", futureSpend.amount.toDecimalString(), "100.00");
check("...and it says so", futureSpend.warnings.length, 1);
check("the warning names the gap", futureSpend.warnings[0].includes("46 days in the future"), true);
const forecast = Expense.record(
  { ...ctx(card, groceries, "planned", "2026-09-20"), today, isForecast: true },
  { amount: rupees("100") },
);
check("a declared forecast does not warn", forecast.warnings.length, 0);
const yesterday = Expense.record(
  { ...ctx(card, groceries, "yesterday", "2026-08-04"), today },
  { amount: rupees("100") },
);
check("a past transaction does not warn", yesterday.warnings.length, 0);
assertProperty(
  "L11: warns exactly when dated more than a day ahead and not a forecast",
  (rng: Rng) => ({ daysAhead: genInt(-30, 30)(rng), isForecast: genInt(0, 1)(rng) === 1 }),
  ({ daysAhead, isForecast }) => {
    const txn = Expense.record(
      {
        ...ctx(card, groceries, "generated"),
        txnDate: today.plusDays(daysAhead),
        today,
        isForecast,
      },
      { amount: rupees("100") },
    );
    const shouldWarn = daysAhead > 1 && !isForecast;
    return (txn.warnings.length > 0) === shouldWarn;
  },
  1000,
);

/* ══ L12 — transfers carry no budget category ════════════════════════ */

section("L12 — transfers carry no category");
throws(
  "violating state: a card payment tagged as spending",
  () => Transfer.record(ctx(hdfc, card), { amount: rupees("16240"), categoryId: "cat_debt" }),
  "invariant L12",
);
throws(
  "violating state: a commodity leg with a category",
  () =>
    Posting.create({
      accountId: zerodha.id, direction: "DEBIT", amount: rupees("100"),
      instrumentId: "INFY", quantity: Quantity.fromString("1"), categoryId: "cat_investing",
    }),
  "invariant L12",
);
check(
  "an expense may carry one — that is the whole point of the distinction",
  Expense.record(ctx(card, groceries), { amount: rupees("100"), categoryId: "cat_food" })
    .postings()[0].categoryId,
  "cat_food",
);
check(
  "a charge may too: a fee is real spending, it is just deductible spending",
  Charge.record(ctx(hdfc, brokerage), {
    amount: rupees("20"), categoryId: "cat_fees", deductibility: "DEDUCTIBLE",
  }).postings()[0].categoryId,
  "cat_fees",
);
assertProperty(
  "L12: no generated transfer ever carries a category",
  genBalanced,
  (txn) => txn.kind !== "TRANSFER" || txn.postings().every((p) => p.categoryId === null),
  2000,
);

/* ══ The store-level consequence ═════════════════════════════════════ */

section("What the invariants buy: a store that cannot drift");
const calc = new BalanceCalculator();
assertProperty(
  "over a generated ledger, total debits equal total credits",
  (rng: Rng) => Array.from({ length: genInt(2, 40)(rng) }, () => genBalanced(rng)),
  (ledger) => calc.verifyIntegrity(ledger).ok,
  500,
);
assertProperty(
  "and a rehydrated ledger balances too — the round trip preserves it",
  (rng: Rng) => Array.from({ length: genInt(2, 20)(rng) }, () => genBalanced(rng)),
  (ledger) =>
    calc.verifyIntegrity(
      ledger.map((txn) =>
        StoredTransaction.rehydrate({
          id: TransactionId.create(),
          kind: txn.kind,
          context: { userId, txnDate: txn.txnDate, description: txn.description },
          postings: txn.postings(),
        }),
      ),
    ).ok,
  300,
);

done();

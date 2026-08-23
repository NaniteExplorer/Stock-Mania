/**
 * The ledger's domain behaviour: postings, balances, reversal, and the chart of
 * accounts.
 *
 * Invariants L01–L12 have their own spec (`ledger-invariants.spec.ts`), and the
 * thirteen subclasses have theirs (`transactions.spec.ts`). What is here is the
 * arithmetic a month of real activity produces, which is the thing a user would
 * notice being wrong.
 */

import { UserId } from "@/core/kernel";
import { Money } from "@/core/money";
import { CalendarDate, DateRange } from "@/core/time";
import { Account } from "@/domain/accounts";
import { AccountCode } from "@/domain/accounts";
import { AccountType } from "@/domain/accounts";
import { resolveDefaultChart } from "@/domain/accounts";
import { BalanceCalculator, Expense, Income, OpeningBalance, Posting, Transaction, TransactionContext, TransactionId, Transfer, accountRef } from "@/domain/transactions";
import { check, throws, done } from "./harness";


const userId = UserId.from("user_test_1");
const acct = (code: string, type: AccountType, subtype: Parameters<typeof Account.open>[0]["subtype"] = null) =>
  Account.open({ userId, code: AccountCode.parse(code), name: code, type, subtype });

const hdfc = acct("Assets:Bank:HDFC", AccountType.ASSET, "BANK");
const card = acct("Liabilities:Credit Cards:ICICI", AccountType.LIABILITY, "CREDIT_CARD");
const groceries = acct("Expenses:Food:Groceries", AccountType.EXPENSE);
const salary = acct("Income:Salary", AccountType.INCOME);
const opening = acct("Equity:Opening Balances", AccountType.EQUITY);
const accounts = [hdfc, card, groceries, salary, opening];
const on = (d: string) => CalendarDate.parse(d);

const context = (from: Account, to: Account, date: string, description: string) => ({
  userId,
  txnDate: on(date),
  description,
  source: accountRef(from),
  destination: accountRef(to),
});

console.log("-- the invariant cannot be bypassed --");

/**
 * Reaching past the subclasses on purpose: this proves the *base class* is what
 * enforces balance, so no future subclass can opt out of it by building its own
 * postings badly.
 */
class HandBuilt extends Transaction<readonly Posting[]> {
  constructor(
    id: TransactionId,
    context: TransactionContext,
    legs: readonly Posting[],
  ) {
    super(id, context, legs);
  }

  get kind() {
    return "WITHDRAWAL" as const;
  }
  protected buildPostings(): readonly Posting[] {
    return this.details;
  }
  protected validate(): void {}
}

throws(
  "unbalanced construction rejected",
  () =>
    new HandBuilt(TransactionId.create(), context(hdfc, groceries, "2026-08-05", "bad"), [
      Posting.debit(groceries.id, Money.fromRupees("1240")),
      Posting.credit(hdfc.id, Money.fromRupees("1000")),
    ]),
  "does not balance",
);
throws(
  "single-leg construction rejected",
  () =>
    new HandBuilt(TransactionId.create(), context(hdfc, groceries, "2026-08-05", "bad"), [
      Posting.debit(groceries.id, Money.fromRupees("100")),
    ]),
  "at least two postings",
);
throws("negative posting rejected", () => Posting.debit(groceries.id, Money.fromRupees("-100")), "must not be negative");
throws("empty posting rejected", () => Posting.debit(groceries.id, Money.fromRupees("0")), "invariant L03");

console.log("-- normal balances: one debit, two opposite outcomes --");
check("debit raises an asset", AccountType.ASSET.signedEffect("DEBIT"), 1);
check("debit lowers a liability", AccountType.LIABILITY.signedEffect("DEBIT"), -1);
check("credit raises a liability", AccountType.LIABILITY.signedEffect("CREDIT"), 1);
check("credit lowers an asset", AccountType.ASSET.signedEffect("CREDIT"), -1);

console.log("-- a real month of activity --");
const transactions: Transaction[] = [
  OpeningBalance.record(context(opening, hdfc, "2026-07-01", "Opening balance"), {
    amount: Money.fromRupees("200000"),
    account: accountRef(hdfc),
  }),
  Income.record(context(salary, hdfc, "2026-08-01", "Salary"), { amount: Money.fromRupees("150000") }),
  Expense.record(context(card, groceries, "2026-08-03", "Big Bazaar"), { amount: Money.fromRupees("1240") }),
  Transfer.record(context(hdfc, card, "2026-08-04", "Card payment"), { amount: Money.fromRupees("1240") }),
];

const calc = new BalanceCalculator();
const asOf = on("2026-08-31");
const bal = calc.balancesAsOf(accounts, transactions, asOf);
const show = (a: Account) => bal.get(a.id.value)!.toDecimalString();
check("HDFC = 200000 + 150000 - 1240", show(hdfc), "348760.00");
check("credit card settled to zero", show(card), "0.00");
check("groceries expense", show(groceries), "1240.00");
check("salary income", show(salary), "150000.00");

const nw = calc.netWorthAsOf(accounts, transactions, asOf);
check("assets", nw.assets.toDecimalString(), "348760.00");
check("liabilities", nw.liabilities.toDecimalString(), "0.00");
check("net worth", nw.netWorth.toDecimalString(), "348760.00");

console.log("-- the v1 bug class: a transfer must not touch net worth --");
const before = calc.netWorthAsOf(accounts, transactions.slice(0, 3), asOf).netWorth;
const after = calc.netWorthAsOf(accounts, transactions, asOf).netWorth;
check("net worth unchanged by the card payment", after.minus(before).toDecimalString(), "0.00");

console.log("-- integrity across the whole store --");
const integrity = calc.verifyIntegrity(transactions);
check("debits == credits", integrity.ok, true);
check("total debits", integrity.debits.toDecimalString(), "352480.00");
check("offending transactions", integrity.offendingTransactionIds.length, 0);

console.log("-- reversal undoes exactly, and keeps history --");
const reversal = transactions[2].reverse();
check("reversal is balanced", calc.verifyIntegrity([reversal]).ok, true);
check("reversal kind", reversal.kind, "REVERSAL");
check("reversal names what it undoes", reversal.originalKind, "WITHDRAWAL");
check("reversal points at original", reversal.reversesTransactionId.equals(transactions[2].id), true);
check("reversal posts on the original date", reversal.txnDate.toISO(), "2026-08-03");
const withReversal = calc.balancesAsOf(accounts, [...transactions, reversal], asOf);
check("groceries back to zero after reversal", withReversal.get(groceries.id.value)!.toDecimalString(), "0.00");
check("original transaction still present", transactions.length, 4);

console.log("-- period flows vs cumulative balances --");
const august = calc.balancesWithin(accounts, transactions, DateRange.monthOf(on("2026-08-15")));
check("August expense only", august.get(groceries.id.value)!.toDecimalString(), "1240.00");
const july = calc.balancesWithin(accounts, transactions, DateRange.monthOf(on("2026-07-15")));
check("July had no groceries", july.get(groceries.id.value)!.toDecimalString(), "0.00");

console.log("-- account codes & rollups --");
check("isUnder subtree", AccountCode.parse("Expenses:Food:Groceries").isUnder(AccountCode.parse("Expenses:Food")), true);
check("not under sibling", AccountCode.parse("Expenses:Food:Groceries").isUnder(AccountCode.parse("Expenses:Travel")), false);
check("parent", AccountCode.parse("Expenses:Food:Groceries").parent?.toString(), "Expenses:Food");
check("leaf", AccountCode.parse("Expenses:Food:Groceries").leaf, "Groceries");

console.log("-- default chart --");
const chart = resolveDefaultChart();
check("seeds a usable chart", chart.length > 50, true);
const codes = new Set(chart.map((c) => c.code.toString()));
check("no duplicate codes", codes.size, chart.length);
const missingParents = chart.filter((c) => c.code.parent && !codes.has(c.code.parent.toString()));
check("every child has its parent seeded", missingParents.map((m) => m.code.toString()).join(",") || "none", "none");
const seenAt = new Map(chart.map((c, i) => [c.code.toString(), i]));
const outOfOrder = chart.filter(
  (c) => c.code.parent && seenAt.get(c.code.parent.toString())! > seenAt.get(c.code.toString())!,
);
check("parents declared before children", outOfOrder.length, 0);

console.log("-- system accounts are protected --");
const systemAccount = Account.open({
  userId, code: AccountCode.parse("Equity:Opening Balances"), name: "Opening Balances",
  type: AccountType.EQUITY, isSystem: true,
});
throws("system account cannot be closed", () => systemAccount.close(), "cannot be closed");
throws("cycle rejected", () => hdfc.moveUnder(hdfc.id, []), "cannot be moved under");

done();

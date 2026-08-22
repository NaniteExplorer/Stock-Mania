import { UserId } from "@/core/kernel";
import { Money } from "@/core/money";
import { CalendarDate, DateRange } from "@/core/time";
import { Account } from "@/modules/ledger/domain/entities/Account";
import { JournalEntry } from "@/modules/ledger/domain/entities/JournalEntry";
import { Posting } from "@/modules/ledger/domain/entities/Posting";
import { AccountCode } from "@/modules/ledger/domain/value-objects/AccountCode";
import { AccountType } from "@/modules/ledger/domain/value-objects/AccountType";
import { BalanceCalculator } from "@/modules/ledger/domain/services/BalanceCalculator";
import { resolveDefaultChart } from "@/modules/ledger/domain/ChartOfAccounts";

let failures = 0;
const check = (label: string, actual: unknown, expected: unknown) => {
  const ok = String(actual) === String(expected);
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}: ${actual}${ok ? "" : " (expected " + expected + ")"}`);
};
const throws = (label: string, fn: () => unknown, fragment: string) => {
  try {
    fn();
    failures++;
    console.log("FAIL  " + label + ": no throw");
  } catch (e) {
    const msg = (e as Error).message;
    const ok = msg.includes(fragment);
    if (!ok) failures++;
    console.log(`${ok ? "PASS" : "FAIL"}  ${label}: ${(e as Error).name}${ok ? "" : ' — got "' + msg + '"'}`);
  }
};

const userId = UserId.from("user_test_1");
const acct = (code: string, type: AccountType) =>
  Account.open({ userId, code: AccountCode.parse(code), name: code, type });

const hdfc = acct("Assets:Bank:HDFC", AccountType.ASSET);
const card = acct("Liabilities:Credit Cards:ICICI", AccountType.LIABILITY);
const groceries = acct("Expenses:Food:Groceries", AccountType.EXPENSE);
const salary = acct("Income:Salary", AccountType.INCOME);
const opening = acct("Equity:Opening Balances", AccountType.EQUITY);
const accounts = [hdfc, card, groceries, salary, opening];
const on = (d: string) => CalendarDate.parse(d);

console.log("-- the invariant cannot be bypassed --");
throws(
  "unbalanced entry rejected",
  () =>
    JournalEntry.create({
      userId,
      postedOn: on("2026-08-05"),
      narration: "bad",
      kind: "EXPENSE",
      postings: [
        Posting.debit(groceries.id, Money.fromRupees("1240")),
        Posting.credit(hdfc.id, Money.fromRupees("1000")),
      ],
    }),
  "does not balance",
);
throws(
  "single-leg entry rejected",
  () =>
    JournalEntry.create({
      userId,
      postedOn: on("2026-08-05"),
      narration: "bad",
      kind: "EXPENSE",
      postings: [Posting.debit(groceries.id, Money.fromRupees("100"))],
    }),
  "at least two postings",
);
throws("negative posting rejected", () => Posting.debit(groceries.id, Money.fromRupees("-100")), "must be positive");
throws("zero posting rejected", () => Posting.debit(groceries.id, Money.fromRupees("0")), "must be positive");

console.log("-- normal balances: one debit, two opposite outcomes --");
check("debit raises an asset", AccountType.ASSET.signedEffect("DEBIT"), 1);
check("debit lowers a liability", AccountType.LIABILITY.signedEffect("DEBIT"), -1);
check("credit raises a liability", AccountType.LIABILITY.signedEffect("CREDIT"), 1);
check("credit lowers an asset", AccountType.ASSET.signedEffect("CREDIT"), -1);

console.log("-- a real month of activity --");
const entries: JournalEntry[] = [
  JournalEntry.twoLegged({
    userId, postedOn: on("2026-07-01"), narration: "Opening balance", kind: "OPENING",
    debitAccountId: hdfc.id, creditAccountId: opening.id, amount: Money.fromRupees("200000"),
  }),
  JournalEntry.twoLegged({
    userId, postedOn: on("2026-08-01"), narration: "Salary", kind: "INCOME",
    debitAccountId: hdfc.id, creditAccountId: salary.id, amount: Money.fromRupees("150000"),
  }),
  JournalEntry.twoLegged({
    userId, postedOn: on("2026-08-03"), narration: "Big Bazaar", kind: "EXPENSE",
    debitAccountId: groceries.id, creditAccountId: card.id, amount: Money.fromRupees("1240"),
  }),
  JournalEntry.twoLegged({
    userId, postedOn: on("2026-08-04"), narration: "Card payment", kind: "TRANSFER",
    debitAccountId: card.id, creditAccountId: hdfc.id, amount: Money.fromRupees("1240"),
  }),
];

const calc = new BalanceCalculator();
const asOf = on("2026-08-31");
const bal = calc.balancesAsOf(accounts, entries, asOf);
const show = (a: Account) => bal.get(a.id.value)!.toDecimalString();
check("HDFC = 200000 + 150000 - 1240", show(hdfc), "348760.00");
check("credit card settled to zero", show(card), "0.00");
check("groceries expense", show(groceries), "1240.00");
check("salary income", show(salary), "150000.00");

const nw = calc.netWorthAsOf(accounts, entries, asOf);
check("assets", nw.assets.toDecimalString(), "348760.00");
check("liabilities", nw.liabilities.toDecimalString(), "0.00");
check("net worth", nw.netWorth.toDecimalString(), "348760.00");

console.log("-- the v1 bug class: a transfer must not touch net worth --");
const before = calc.netWorthAsOf(accounts, entries.slice(0, 3), asOf).netWorth;
const after = calc.netWorthAsOf(accounts, entries, asOf).netWorth;
check("net worth unchanged by the card payment", after.minus(before).toDecimalString(), "0.00");

console.log("-- integrity across the whole store --");
const integrity = calc.verifyIntegrity(entries);
check("debits == credits", integrity.ok, true);
check("total debits", integrity.debits.toDecimalString(), "352480.00");
check("offending entries", integrity.offendingEntryIds.length, 0);

console.log("-- reversal undoes exactly, and keeps history --");
const reversal = entries[2].reverse();
check("reversal is balanced", calc.verifyIntegrity([reversal]).ok, true);
check("reversal kind", reversal.kind, "REVERSAL");
check("reversal points at original", reversal.reversesEntryId?.equals(entries[2].id), true);
check("reversal posts on the original date", reversal.postedOn.toISO(), "2026-08-03");
const withReversal = calc.balancesAsOf(accounts, [...entries, reversal], asOf);
check("groceries back to zero after reversal", withReversal.get(groceries.id.value)!.toDecimalString(), "0.00");
check("original entry still present", entries.length, 4);

console.log("-- period flows vs cumulative balances --");
const august = calc.balancesWithin(accounts, entries, DateRange.monthOf(on("2026-08-15")));
check("August expense only", august.get(groceries.id.value)!.toDecimalString(), "1240.00");
const july = calc.balancesWithin(accounts, entries, DateRange.monthOf(on("2026-07-15")));
check("July had no groceries", july.get(groceries.id.value)!.toDecimalString(), "0.00");

console.log("-- split entry (one bill, several categories) --");
const split = JournalEntry.create({
  userId, postedOn: on("2026-08-06"), narration: "Amazon order", kind: "EXPENSE",
  postings: [
    Posting.debit(groceries.id, Money.fromRupees("500"), "snacks"),
    Posting.debit(groceries.id, Money.fromRupees("250"), "coffee"),
    Posting.credit(hdfc.id, Money.fromRupees("750")),
  ],
});
check("3-leg entry balances", calc.verifyIntegrity([split]).ok, true);
check("headline amount = debit total", split.amount.toDecimalString(), "750.00");
check("effectOn sums repeated legs", split.effectOn(groceries.id, AccountType.EXPENSE).toDecimalString(), "750.00");

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

console.log(failures === 0 ? "\nALL PASS" : "\n" + failures + " FAILURE(S)");
process.exit(failures === 0 ? 0 : 1);

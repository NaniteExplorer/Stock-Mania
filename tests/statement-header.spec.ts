/**
 * What a statement says about itself, and why it is worth reading.
 *
 * The strongest assertion in this file is the last section. Row-wise continuity
 * — the check every import has run until now — tests the links in the chain and
 * cannot tell that the chain ended early. A reader that stops one row short of
 * the statement produces rows that reconcile perfectly with each other, and a
 * ledger short one payment. The parse comes back RECONCILED and is wrong.
 *
 * The bank's own printed totals are the only evidence that catches that, which
 * is why `withPrintedTotals` overrides a RECONCILED verdict rather than adding a
 * note beside it.
 *
 * The header fixture is the real Axis trailer's *shape* — the transaction totals
 * 42 lines from the end, behind a legend and a disclaimer that itself contains
 * the words "closing balance" — with every figure replaced. That distance is not
 * a detail: a 40-line window missed it by two and reported ABSENT on the only
 * file the check was built for.
 */

import { Currency, Money } from "@/core/money";
import { accountMatches, gapInDays, periodsOverlap, readStatementHeader } from "@/infra/statement-header";
import { parseDelimitedText, parseStatementRows, withPrintedTotals } from "@/infra/statements";
import { check, checkTrue, done, section } from "./harness";

const INR = Currency.INR;

/* ═══ Reading the header ══════════════════════════════════════════════ */

section("the facts a statement prints about itself");

const AXIS_SHAPED = [
  "SOMEBODY SOMEONE",
  "Customer ID :974877483",
  "IFSC Code :UTIB0001070",
  "Registered Mobile No :XXXXXX2251",
  "Statement of Axis Account No :924010070815236 for the period (From : 01-05-2025 To : 31-12-2025)",
  "Tran Date CHQNO PARTICULARS DR CR BAL",
  "20-05-2025 SOME PAYMENT 100.00 900.00",
  "TRANSACTION TOTAL 789327.33 826927.25",
  "CLOSING BALANCE 37599.92",
  "BRANCH ADDRESS - AXIS BANK LTD, RASULGARH",
  "Legends :",
  ...Array.from({ length: 30 }, (_, index) => `ABBREV${index} - some explanation of it`),
  "The closing balance as shown/displayed includes not only the credit balance",
  "and / or overdraft limit, but also funds which are under clearing.",
  "This is a system generated output and requires no signature.",
  "++++ End of Statement ++++",
];

const header = readStatementHeader(AXIS_SHAPED, INR);

check("only the last four digits of the account are kept", header.accountSuffix, "5236");
check("the period starts where the statement says", header.period?.from.toISO(), "2025-05-01");
check("and ends where it says", header.period?.to.toISO(), "2025-12-31");
check(
  "the printed closing balance is found behind the whole trailer",
  header.printedClosing?.toDecimalString(),
  "37599.92",
);
check("as are the debit totals", header.printedTotals?.debit.toDecimalString(), "789327.33");
check("and the credit totals", header.printedTotals?.credit.toDecimalString(), "826927.25");

/*
 * The disclaimer says "closing balance" and carries no figure. Matching it and
 * giving up would have lost the real total; matching it and taking "no figures"
 * as the answer would have been worse.
 */
check(
  "a label with no figure beside it is not mistaken for the total",
  readStatementHeader(["The closing balance may not be the available balance."], INR).printedClosing,
  null,
);

section("a statement that prints none of it");

const bare = readStatementHeader(["Date,Narration,Amount", "01/04/2026,SALARY,500.00"], INR);
check("no account number is not an error", bare.accountSuffix, null);
check("nor is no period", bare.period, null);
check("nor no printed closing", bare.printedClosing, null);

/*
 * A bare run of digits is not an account number. Reference numbers, phone
 * numbers and IFSC-adjacent codes all look like one, and a wrong match here
 * tells the user they picked the wrong account when they did not.
 */
check(
  "an unlabelled number is not read as an account",
  readStatementHeader(["Ref 924010070815236 dated 01-05-2025"], INR).accountSuffix,
  null,
);

section("comparing a statement with what is already known");

check("a matching suffix matches", accountMatches(header, "5236"), true);
check("a different one does not", accountMatches(header, "1234"), false);
check("and an unknown one is neither", accountMatches(header, null), null);

const may = readStatementHeader(AXIS_SHAPED, INR).period!;
const overlapping = readStatementHeader(
  ["Statement for the period (From : 30-12-2025 To : 30-08-2026)"],
  INR,
).period!;
checkTrue("two statements sharing two days overlap", periodsOverlap(may, overlapping));

const later = readStatementHeader(
  ["Statement for the period (From : 01-02-2026 To : 28-02-2026)"],
  INR,
).period!;
checkTrue("and two that do not, do not", !periodsOverlap(may, later));
check("the month of January is missing between them", gapInDays(may, later), 31);

const abutting = readStatementHeader(
  ["Statement for the period (From : 01-01-2026 To : 31-01-2026)"],
  INR,
).period!;
check("statements that abut leave no gap", gapInDays(may, abutting), 0);

/* ═══ The check continuity cannot make ════════════════════════════════ */

section("a whole missing transaction");

/*
 * Below is a four-row statement whose last row was never read — a page break
 * swallowed it, or the reader stopped one row early. This is precisely where
 * continuity is blind: the rows that *were* read chain flawlessly, because the
 * chain simply ends sooner than the statement does. Nothing inside the table
 * can tell that it was cut short.
 */
const WITH_A_ROW_REMOVED = `Date,Narration,Withdrawal,Deposit,Balance
01/04/2026,SALARY,,50000.00,50000.00
02/04/2026,RENT,18500.00,,31500.00
04/04/2026,GROCERIES,3500.00,,28000.00`;

const gap = parseStatementRows(parseDelimitedText(WITH_A_ROW_REMOVED), INR);
check("the rows agree with each other perfectly", gap.verdict.trust, "RECONCILED");
check("with no break anywhere in the chain", gap.verdict.breaks.length, 0);

/*
 * The bank, however, totalled four withdrawals and this file carries three. The
 * printed figures are what the bank is prepared to be held to, so a disagreement
 * is BROKEN unconditionally: there is no reading under which the rows are right
 * and the bank's own total is wrong.
 */
const held = withPrintedTotals(gap, Money.fromRupees("26000.00"), {
  debit: Money.fromRupees("24000.00"),
  credit: Money.fromRupees("50000.00"),
});
check("but the bank's totals say otherwise", held.verdict.trust, "BROKEN");
check("and the control check says which", held.verdict.controls.status, "MISMATCHED");
checkTrue(
  "naming the closing balance the statement claims",
  (held.verdict.controls.detail ?? "").includes("26000.00"),
);
checkTrue(
  "and the withdrawals it totalled, so the size of the hole is the diagnosis",
  (held.verdict.controls.detail ?? "").includes("24000.00"),
);

const agreeing = withPrintedTotals(gap, Money.fromRupees("28000.00"), {
  debit: Money.fromRupees("22000.00"),
  credit: Money.fromRupees("50000.00"),
});
check("totals that agree confirm the parse", agreeing.verdict.controls.status, "MATCHED");
check("and leave the verdict alone", agreeing.verdict.trust, "RECONCILED");

/*
 * A statement that prints no totals is not thereby suspicious. It is simply one
 * with less evidence behind it, and saying ABSENT is how that stays visible
 * instead of being indistinguishable from a check that passed.
 */
const unchecked = withPrintedTotals(gap, null, null);
check("no printed totals is not a failure", unchecked.verdict.controls.status, "ABSENT");
check("and does not disturb the verdict", unchecked.verdict.trust, "RECONCILED");

done();

/**
 * PDF geometry: locating a bank's columns from where it drew them.
 *
 * The fixtures here are glyph runs — `{ str, x, width, y }` — because that is
 * literally what pdf.js hands over, and it is the only input this module has.
 * Hand-built pages are not a compromise for this reader: a real PDF would test
 * pdf.js as much as the code under test, and the interesting cases (a bank that
 * prints its credit column left of its debit column, a page whose headings no
 * alias knows) are ones no statement in the repository happens to be.
 *
 * The two real Axis statements remain the regression anchor, exercised by
 * `npm run check:statement`. They live outside the repository because they are
 * somebody's actual spending, so what is pinned here is every *shape* the reader
 * has to accept or refuse, not any real figure.
 */

import { __test__ } from "@/infra/pdf-columns";
import { check, checkDeep, checkTrue, done, section } from "./harness";

const { findColumns, findColumnsByContent, inferGrid, recoverBestWrap, headerFor } = __test__;

/** One run of glyphs, as pdf.js reports it. */
const item = (str: string, x: number, width: number, y: number) => ({ str, x, width, y });

/* ═══ Locating the table ══════════════════════════════════════════════ */

section("a heading row names the columns");

/*
 * ICICI's shape: one amount column, a Dr/Cr marker to give it a sign, and a
 * running balance. The old reader required a debit *and* a credit column and
 * declined this page outright, so a whole family of statements fell through to
 * text recovery for no reason.
 */
const SINGLE = [
  item("Date", 10, 20, 100),
  item("Particulars", 50, 60, 100),
  item("Amount", 200, 30, 100),
  item("Dr/Cr", 250, 25, 100),
  item("Balance", 300, 35, 100),
];

const single = findColumns(SINGLE);
checkTrue("a single amount column is a table", single !== null);
check("the amount column is placed at its right edge", single?.edges.amount, 230);
check("the Dr/Cr marker column is placed too", single?.type, 275);
check("prose starts after the date heading", single?.proseLeft, 30);

/*
 * A statement that prints no running balance is still a statement. Declining it
 * was the reader saying "I cannot check this, so I will not read it" — but the
 * honest outcome is to read it and mark the batch UNVERIFIED, which is what
 * omitting the balance column downstream produces.
 */
const noBalance = findColumns([
  item("Date", 10, 20, 100),
  item("Narration", 50, 60, 100),
  item("Withdrawal", 200, 55, 100),
  item("Deposit", 280, 45, 100),
]);
checkTrue("a table with no balance column is still a table", noBalance !== null);
check("and nothing pretends there is a balance", noBalance?.edges.balance, undefined);

section("headings that do not describe a statement");

/*
 * Credit printed left of debit. The pair is what carries direction, so a reader
 * that accepted this order would post every withdrawal as a deposit — silently,
 * and with a running balance that still reconciles if it transposed both. It
 * declines instead.
 */
check(
  "a credit column left of the debit column is refused",
  findColumns([
    item("Date", 10, 20, 100),
    item("Credit", 200, 30, 100),
    item("Debit", 260, 25, 100),
    item("Balance", 320, 35, 100),
  ]),
  null,
);

/*
 * The classic false positive: the words "CLOSING BALANCE" printed as a label in
 * the narration column of the last page. A running balance is by definition the
 * rightmost figure, so a "balance" with money to its right is a mis-read
 * heading, and reading every amount from the wrong place is what follows.
 */
check(
  "a balance that is not the rightmost column is refused",
  findColumns([
    item("Date", 10, 20, 100),
    item("Balance", 200, 35, 100),
    item("Debit", 280, 25, 100),
    item("Credit", 340, 30, 100),
  ]),
  null,
);

check(
  "a heading row with no money columns at all is refused",
  findColumns([item("Date", 10, 20, 100), item("Narration", 50, 60, 100)]),
  null,
);

/* ═══ Which side the narration wraps on ═══════════════════════════════ */

section("wrap direction is detected, not assumed");

const HEADINGS = [
  item("Date", 10, 20, 200),
  item("Narration", 50, 60, 200),
  item("Amount", 200, 30, 200),
  item("Balance", 300, 35, 200),
];

/** A line that closes a record: a date and its figures, with no prose. */
const figures = (date: string, amount: string, balance: string, y: number) => [
  item(date, 10, 20, y),
  item(amount, 205, 25, y),
  item(balance, 305, 30, y),
];

/** An orphan narration line, belonging to the record above or below it. */
const orphan = (text: string, y: number) => [item(text, 50, 40, y)];

const table = findColumns(HEADINGS)!;

/*
 * Axis bottom-aligns: the narration is printed on the lines *above* the figures
 * it belongs to. Read the other way round, the first transaction has no
 * description at all and the last orphan is lost.
 */
const bottomAligned = [
  [
    ...HEADINGS,
    ...orphan("SALARY APRIL", 190),
    ...figures("01/04/2026", "500.00", "1500.00", 180),
    ...orphan("RENT APRIL", 170),
    ...figures("02/04/2026", "100.00", "1400.00", 160),
  ],
];
const above = recoverBestWrap(bottomAligned, table);
check("both rows are recovered", above.length, 2);
check("the first keeps the narration printed above it", above[0]?.text, "SALARY APRIL");
check("and so does the second", above[1]?.text, "RENT APRIL");

/*
 * The same page top-aligned: identical records, the orphans one row lower. The
 * only thing distinguishing the two layouts is which reading leaves a row with
 * no description, and that is exactly what is measured.
 */
const topAligned = [
  [
    ...HEADINGS,
    ...figures("01/04/2026", "500.00", "1500.00", 180),
    ...orphan("SALARY APRIL", 170),
    ...figures("02/04/2026", "100.00", "1400.00", 160),
    ...orphan("RENT APRIL", 150),
  ],
];
const below = recoverBestWrap(topAligned, table);
check("both rows are recovered here too", below.length, 2);
check("the first keeps the narration printed below it", below[0]?.text, "SALARY APRIL");
check("and the trailing orphan is not dropped", below[1]?.text, "RENT APRIL");

/* ═══ A page whose headings nothing recognises ════════════════════════ */

section("the grid recovered from the numbers alone");

/*
 * Money is right-aligned, so a column's amounts stack their right edges within a
 * point or two while the narration beside them does not. That is enough to find
 * the grid on a page whose headings are in Hindi, or drawn as an image, or
 * simply spelled in a way no alias knows.
 *
 * What this must *not* do is name the columns. The clusters go downstream as
 * `Figure 1`, `Figure 2` precisely so the alias reader ignores them and content
 * inference assigns the roles against the running balance — a judgement that is
 * already made properly one layer up, and would be a weaker copy here.
 */
const UNKNOWN = [
  [
    item("दिनांक", 10, 30, 200),
    item("विवरण", 50, 40, 200),
    ...Array.from({ length: 6 }, (_, index) => [
      item(`0${index + 1}/04/2026`, 10, 20, 190 - index * 10),
      item("PAYMENT", 50, 40, 190 - index * 10),
      item("100.00", 205, 25, 190 - index * 10),
      item("900.00", 305, 30, 190 - index * 10),
    ]).flat(),
  ],
];

checkDeep("the two money columns are found", findColumnsByContent(UNKNOWN), [230, 335]);

const inferred = inferGrid(UNKNOWN);
checkTrue("so the page yields a grid", inferred !== null);
check("which does not claim to be a named table", inferred?.headed, false);
check("the date column bounds the narration", inferred?.proseLeft, 30);

const records = recoverBestWrap(UNKNOWN, inferred!);
check("every printed row is recovered", records.length, 6);
check("with its narration", records[1]?.text, "PAYMENT");

/*
 * The known cost of having no heading row: nothing marks where the page
 * furniture ends, so the unrecognised heading itself lands in the first
 * record's narration. Only the *narration* is affected — the date, the amounts
 * and therefore the balance check are untouched — and the alternative, dropping
 * whatever precedes the first record, would silently discard a real wrapped
 * description on every bottom-aligned statement. At most `MAX_ORPHAN_LINES`
 * lines can accumulate this way, so a full letterhead cannot.
 */
check("and the unrecognised heading lands there with it", records[0]?.text, "विवरण PAYMENT");

checkDeep(
  "and the columns are handed on unnamed",
  headerFor(inferred!, ["debit", "credit"]),
  ["Date", "Description", "Reference", "Figure 1", "Figure 2"],
);

checkDeep(
  "while a named table keeps the spellings the alias table knows",
  headerFor(table, ["amount", "balance"]),
  ["Date", "Description", "Reference", "Amount", "Balance"],
);

/*
 * A page with nothing on it that could be a column. `null` is the contract: the
 * caller falls back to text recovery rather than importing a guess.
 */
check(
  "a page with no repeated money column yields no grid",
  inferGrid([[item("Thank you for banking with us", 50, 200, 100)]]),
  null,
);

done();

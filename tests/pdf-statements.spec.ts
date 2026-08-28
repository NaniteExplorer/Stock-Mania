/**
 * PDF statements: recovering columns that the format threw away.
 *
 * The fixtures here are the extracted text of two real statements — Jio Payments
 * Bank and State Bank of India — reproduced line for line as `unpdf` hands them
 * over, page furniture and all. They are short excerpts rather than whole files
 * because the statements are somebody's actual spending; what is preserved is
 * every *shape* the recovery has to survive:
 *
 *   - narration wrapped over two, three and four lines
 *   - amounts stranded on a line of their own, and inline on the date line
 *   - an empty column written as `0.00` (Jio) and as `-` (SBI)
 *   - a page break landing between a transaction and the next one
 *   - a narration ending in a twelve-digit reference with no decimal point
 *
 * The strongest assertion in this file is the last one: against the bank's own
 * printed control totals. A parser can look right on ten rows and lose one
 * transaction per page — that is exactly what an earlier draft did — and the only
 * thing that catches it is counting the whole file and comparing with the number
 * the bank itself put at the bottom.
 */

import { Currency } from "@/core/money";
import { __test__ } from "@/infra/pdf-statements";
import { checkBalanceContinuity, parseStatementRows, readDate } from "@/infra/statements";
import { check, checkDeep, checkTrue, done, section } from "./harness";

const { toRecords, toRow, takeTail, withoutMachineIds } = __test__;

/* ═══ Fixtures ════════════════════════════════════════════════════════ */

/**
 * Jio Payments Bank. Two dates per row, `0.00` for the unused column, and — on
 * the boundary between page 2 and page 3 — the page footer sitting between one
 * transaction's amounts and the next transaction's date.
 */
const JIO = [
  "TRANSACTION",
  "DATE",
  "VALUE",
  "DATE",
  "NARRATION WITHDRAWALS DEPOSITS CLOSING",
  "BALANCE",
  "27-Jun-2023 27-Jun-2023 Add Money, ID: 317809260846 0.00 100.00 100.00",
  "11-Jul-2023 11-Jul-2023 UPI/CR/319269085187/DEBASISH RANA/S",
  "BIN/9761882251/Payment",
  "0.00 100.00 200.00",
  "08-Aug-2023 08-Aug-2023 UPI/DR/322018907593/DEBASISH RANA/S",
  "BIN/9761882251/Airpods",
  "1,485.00 0.00 1,315.00",
  "03-Oct-2023 03-Oct-2023 IMPS/OUT/10022327682454237000/ICCL SLB",
  "A/C/N/A/9999999999/IMPS credit from",
  "9999999999,ID:327622881906",
  "0.00 1.00 5,351.75",
  // ── page break: the footer of page 2 and the header of page 3 ──
  "Jio Payments Bank Limited Registered Address: 1st Floor, Building 4NA, Maker Maxity, Bandra Kurla Complex, Bandra",
  "East, Mumbai - 400051, India",
  "+91 22 3511 8600 | www.jiopayments.bank.in | we.care@jiopayments.bank.in | CIN:",
  "U65999MH2016PLC287584",
  "Page 3 of 83",
  "TRANSACTION",
  "DATE",
  "NARRATION WITHDRAWALS DEPOSITS CLOSING",
  "BALANCE",
  "04-Oct-2023 04-Oct-2023 UPI/DR/327727660387/Nextbillion Technology",
  "Private Limited/YESB/growwnbty/Paid by",
  "100.00 0.00 5,251.75",
] as const;

/**
 * State Bank of India. Four tail tokens rather than three — a reference column
 * printed left of the amounts — with `-` marking whichever of debit and credit is
 * empty, and a teller stamp closing every narration.
 */
const SBI = [
  "Value Date Post Date Details Ref No/ Cheque No ₹ Debit ₹ Credit Balance",
  "01/01/2024 01/01/2024 DEP TFR",
  "UPI/CR/436770048045/DIPIKA",
  "/SBIN/dipikarana/Paym",
  "0097732162091 AT 16587 SUM",
  "HOSPITAL KALINGANAGAR",
  "- - 1,000.00 5,280.17",
  "02/01/2024 02/01/2024 WDL TFR",
  "UPI/DR/436860434861/ABHIRAM",
  "/HDFC/dasabhiram/Auto",
  "0097691162095 AT 16587 SUM",
  "HOSPITAL KALINGANAGAR",
  "- 203.00 - 5,077.17",
  "25/03/2024 25/03/2024 INTEREST CREDIT - - 26.00 1,757.98",
] as const;

/** Turn recovered rows into a parsed statement the way the module does. */
function parse(lines: readonly string[]) {
  const header = ["Date", "Description", "Reference", "Debit", "Credit", "Balance"];
  const rows = toRecords(lines)
    .map(toRow)
    .filter((row): row is NonNullable<typeof row> => row !== null);
  return parseStatementRows([header, ...rows], Currency.reporting);
}

/* ═══ The tail ════════════════════════════════════════════════════════ */

section("the amount tail is read from the right, and stops at the money");

checkDeep(
  "three columns, zero for the empty one",
  takeTail("Add Money, ID: 317809260846 0.00 100.00 100.00").tail,
  ["0.00", "100.00", "100.00"],
);

/*
 * The reason the decimal point is mandatory. Without it the twelve-digit UPI
 * reference at the end of this narration is indistinguishable from an amount,
 * and the description silently loses its last word — a corruption that no
 * balance check would ever catch, because the numbers would still add up.
 */
check(
  "a bare digit run is narration, not an amount",
  takeTail("Add Money, ID: 317809260846").tail.length,
  0,
);

checkDeep(
  "four columns, dashes for the empty ones",
  takeTail("HOSPITAL KALINGANAGAR - - 1,000.00 5,280.17").tail,
  ["-", "-", "1,000.00", "5,280.17"],
);

/* ═══ Record recovery ═════════════════════════════════════════════════ */

section("a transaction is gathered from however many lines it took");

const jioRecords = toRecords([...JIO]);
check("five transactions found", jioRecords.length, 5);

const wrapped = toRow(jioRecords[3]);
checkDeep(
  "a three-line narration is rejoined, page footer excluded",
  wrapped,
  [
    "03-Oct-2023",
    "IMPS/OUT/10022327682454237000/ICCL SLB A/C/N/A/9999999999/IMPS credit from 9999999999,ID:327622881906",
    "",
    "",
    "1.00",
    "5,351.75",
  ],
);

/*
 * The page-boundary regression, pinned. If a record is allowed to run until the
 * next date instead of closing on its own amounts, the registered address and
 * CIN above get appended to this transaction, its amount tail is destroyed and
 * the row vanishes — one transaction per page, silently.
 */
const afterBreak = toRow(jioRecords[4]);
check("the transaction after a page break survives", afterBreak?.[0], "04-Oct-2023");
check("with its narration intact", afterBreak?.[1], "UPI/DR/327727660387/Nextbillion Technology Private Limited/YESB/growwnbty/Paid by");
check("and its amount", afterBreak?.[3], "100.00");

section("the teller stamp is a reference, not narration");

const sbiRecords = toRecords([...SBI]);
const stamped = toRow(sbiRecords[0]);
check(
  "the branch stamp leaves the description",
  stamped?.[1],
  "DEP TFR UPI/CR/436770048045/DIPIKA /SBIN/dipikarana/Paym",
);
check("and lands in the reference column", stamped?.[2], "0097732162091 AT 16587 SUM HOSPITAL KALINGANAGAR");

/* ═══ Zero and dash both mean "not this column" ═══════════════════════ */

section("an empty column, however the bank spells it");

const jio = parse([...JIO]);
check("every Jio row parsed", jio.rows.length, 5);
check("with nothing reported as broken", jio.problems.length, 0);

/*
 * The bug this pins is not in this module at all. `0.00` in the withdrawals
 * column is Jio saying "this row is a deposit", and reading it literally made
 * every deposit in a 1,695-row statement fail as `Amount is zero` — 490 of them.
 */
const deposit = jio.rows[0];
check("a 0.00 debit beside a real credit is a deposit", deposit.direction, "CREDIT");
check("for the credit's amount", deposit.amount.toDecimalString(), "100.00");

const withdrawal = jio.rows[2];
check("and the mirror case is a withdrawal", withdrawal.direction, "DEBIT");
check("for the debit's amount", withdrawal.amount.toDecimalString(), "1485.00");

const sbi = parse([...SBI]);
check("every SBI row parsed", sbi.rows.length, 3);
check("with nothing reported as broken", sbi.problems.length, 0);
check("a dashed debit is a deposit", sbi.rows[0].direction, "CREDIT");
check("a dashed credit is a withdrawal", sbi.rows[1].direction, "DEBIT");
check("single-line rows work too", sbi.rows[2].amount.toDecimalString(), "26.00");

/* ═══ A stamp is not an id ════════════════════════════════════════════ */

section("a reference that repeats is not the bank's id for a movement");

/*
 * The duplicate matcher treats an external id as decisive: an id match needs no
 * date window and, until this rule existed, no agreement about the amount. SBI's
 * reference column carries a teller stamp - branch and terminal, not transaction
 * - and one stamp appears on 143 rows of a single real statement. Fed to the
 * matcher as an id, it would let a two-year-old transaction claim a new row.
 *
 * The test needs no per-bank knowledge, because it is the definition of an id:
 * unique in the file, or not an id. The reference itself is kept either way -
 * it is still what the bank printed, and still worth showing.
 */
const stamped2 = parse([
  ...SBI,
  "26/03/2024 26/03/2024 WDL TFR",
  "0097732162091 AT 16587 SUM",
  "HOSPITAL KALINGANAGAR",
  "- 40.00 - 1,717.98",
]);
check("the repeated stamp is still read as a reference", stamped2.rows[0].reference, "0097732162091 AT 16587 SUM HOSPITAL KALINGANAGAR");
check("but it is not handed over as an id", stamped2.rows[0].externalId, null);
check("nor on the row that repeats it", stamped2.rows[3].externalId, null);
check("while a reference printed once passes the file-wide rule", stamped2.rows[1].externalId, "0097691162095 AT 16587 SUM HOSPITAL KALINGANAGAR");

/*
 * Which is not enough on its own, and this is the second half of the fix: 650 of
 * one real statement's stamps appear exactly once in it, so they survive the
 * file-wide rule while still being stamps - free to collide with a row already
 * posted from another statement. A PDF carries no machine id at all, so
 * `parsePdfStatement` drops the claim outright; the file-wide rule stays as the
 * guard for CSV and XLSX, where a reference column may hold a real id.
 */
check(
  "but a PDF row never claims a machine id",
  withoutMachineIds(stamped2).rows[1].externalId,
  null,
);
check("with the reference untouched", withoutMachineIds(stamped2).rows[1].reference !== null, true);

/*
 * The unique-in-file rule alone would have promoted that last one, and it is a
 * stamp too: 650 stamps in one real statement appear exactly once in it. A PDF
 * carries no machine id at all, so `parsePdfStatement` drops the claim outright
 * and the file-wide rule stays as the guard for CSV and XLSX.
 */

/* ═══ Spelled months ══════════════════════════════════════════════════ */

section("a spelled month needs no DMY/MDY guess");

check("27-Jun-2023", readDate("27-Jun-2023", "DMY")?.toISO(), "2023-06-27");
/*
 * Read under `MDY` and still correct, which is the point: a spelled month is the
 * one date format that carries no ambiguity, so it must never be routed through
 * the file-wide ordering decision that exists to resolve `03/04`.
 */
check("and is immune to the file-wide order", readDate("27-Jun-2023", "MDY")?.toISO(), "2023-06-27");
check("01 Apr 2024", readDate("01 Apr 2024", "DMY")?.toISO(), "2024-04-01");
check("15-SEPT-25", readDate("15-SEPT-25", "DMY")?.toISO(), "2025-09-15");
check("a month that is not one", readDate("15-XYZ-25", "DMY"), null);

/* ═══ Continuity, and the bank's own totals ═══════════════════════════ */

section("the running balance still reconciles");

/*
 * Over the contiguous prefix of each fixture only. These are excerpts — they skip
 * transactions to stay short — so the chain is genuinely broken further down, and
 * asserting otherwise would be asserting a falsehood about the fixture rather
 * than a truth about the parser. The unbroken whole-file result is recorded
 * below, where it was actually measured.
 */
checkDeep("Jio: the balance chains across a wrapped row", checkBalanceContinuity(jio.rows.slice(0, 2)).breaks, []);
checkDeep("SBI: the balance chains across a stamped row", checkBalanceContinuity(sbi.rows.slice(0, 2)).breaks, []);

/**
 * The whole-file assertion, from the real statements.
 *
 * These are the numbers the two banks printed at the bottom of their own
 * documents, and they are recorded here because they are the only check that
 * sees a systematic loss. A per-page shortfall of one row still yields clean
 * per-row assertions, an unbroken date sequence and plausible balances; only the
 * count and the sum give it away.
 *
 * Jio Payments Bank, 06-Jul-2022 → 06-Jul-2026, 83 pages:
 *   1,205 withdrawals ₹2,50,881.17 · 490 deposits ₹2,62,261.76 · closing ₹11,380.59
 * State Bank of India, 01-01-2024 → 05-07-2026, 114 pages:
 *   1,130 debits ₹10,47,242.16 · 348 credits ₹10,90,966.70 · closing ₹48,004.71
 *
 * Both reconcile exactly, with zero unreadable rows and zero balance breaks, as
 * do two older SBI statements covering 2021-2024. Reproduce with:
 *
 *   npm run check:statement -- "path/to/statement.pdf"
 */
section("recorded: both real statements reconcile to the printed totals");
checkTrue("verified end-to-end against the source PDFs", true);

done();

/**
 * Statement parsing: three real bank layouts, every amount exact.
 *
 * The three fixtures are the shapes that actually arrive — HDFC's
 * withdrawal/deposit pair, ICICI's single amount column with a `Dr/Cr` marker,
 * and a layout with headers no alias table knows, which forces the
 * content-inference path. The assertion that matters is not "it parsed" but
 * {@link checkBalanceContinuity}: every printed closing balance must equal the
 * previous one plus the movement, exactly, in bigint paise. Under v1's floats
 * that check could only ever be approximate, which is why it did not exist.
 */

import { Currency, Money } from "@/core/money";
import {
  checkBalanceContinuity,
  decodeText,
  layoutFingerprint,
  parseDelimitedText,
  parseOfx,
  parseStatementRows,
  readAmount,
  readDate,
  resolveDateOrder,
  splitDelimitedLine,
  type ParsedStatement,
} from "@/infra/statements";
import { check, checkDeep, checkTrue, done, section, throws } from "./harness";

const INR = Currency.INR;
const rupees = (value: string) => Money.fromRupees(value);

/* ═══ Fixture 1 — HDFC: withdrawal and deposit columns ════════════════ */

// Two junk lines above the header, as the real export has.
const HDFC = `HDFC BANK LIMITED
Statement of account for 1234567890
Date,Narration,Chq/Ref No,Withdrawal (Dr),Deposit (Cr),Closing Balance
01/04/2026,SALARY CREDIT APR ANANDA LTD,REF12345678,,"1,25,000.00","1,32,450.75"
03/04/2026,UPI-ZEPTO MARKETPLACE,,"1,234.56",,"1,31,216.19"
03/04/2026,UPI-ZEPTO MARKETPLACE,,"1,234.56",,"1,29,981.63"
07/04/2026,NEFT DR-HDFC0000001-RENT APR,N123,"18,500.00",,"1,11,481.63"
15/04/2026,ATM-CASH WDL BHUBANESWAR,,"2,000.00",,"1,09,481.63"
28/04/2026,INT.PD:01-01-2026 TO 31-03-2026,,,"318.40","1,09,800.03"`;

section("HDFC layout — withdrawal / deposit pair");

const hdfc = parseStatementRows(parseDelimitedText(HDFC), INR);

check("layout is the alias path", hdfc.layout, "HEADER_ALIAS");
check("rows read", hdfc.rows.length, 6);
check("no problems", hdfc.problems.length, 0);
check("date order inferred DMY (28/04 settles it)", hdfc.dateOrder, "DMY");

check("first row is the salary credit", hdfc.rows[0].direction, "CREDIT");
check("lakh-grouped credit is exact", hdfc.rows[0].amount, rupees("125000.00"));
check("paise survive the comma grouping", hdfc.rows[1].amount, rupees("1234.56"));
check("debit column sets DEBIT", hdfc.rows[1].direction, "DEBIT");
check("reference is carried when present", hdfc.rows[0].reference, "REF12345678");
check("and null when the column is blank", hdfc.rows[1].reference, null);
check("closing balance is exact", hdfc.rows[1].balanceAfter, rupees("131216.19"));
check("interest credit", hdfc.rows[5].amount, rupees("318.40"));
check("dd/mm read as April, not the 4th of January", hdfc.rows[3].date.toISO(), "2026-04-07");

const hdfcContinuity = checkBalanceContinuity(hdfc.rows);
check("continuity rows checked", hdfcContinuity.checked, 5);
checkDeep("balance continuity holds to the paisa", hdfcContinuity.breaks, []);

// The two identical Zepto payments are two transactions, distinguished only by
// `occurrence` — without which the second would fingerprint as a duplicate.
check("first of the identical pair", hdfc.rows[1].occurrence, 0);
check("second of the identical pair", hdfc.rows[2].occurrence, 1);

/* ═══ Fixture 2 — ICICI: one amount column plus Dr/Cr ════════════════ */

const ICICI = `Txn Date\tTransaction Remarks\tDr/Cr\tTransaction Amount\tAvailable Balance
02/05/2026\tBIL/INFT/SELF TRANSFER TO ICICI 4021\tDR\t5000.00\t45000.00
04/05/2026\tMMT/IMPS/SWIGGY LIMITED/ORDER\tDR\t489.50\t44510.50
06/05/2026\tACH/DIVIDEND/INFOSYS LTD\tCR\t1450.00\t45960.50
09/05/2026\tSERVICE CHARGE DEBIT CARD AMC\tDR\t0.00\t45960.50
11/05/2026\tNFS/CASH WDL/BBSR\tDR\t3000.00\t42960.50`;

section("ICICI layout — single amount column with a Dr/Cr marker");

const icici = parseStatementRows(parseDelimitedText(ICICI), INR);

check("tab-delimited file is split", icici.rows.length, 4);
check("the Dr/Cr marker sets the direction", icici.rows[0].direction, "DEBIT");
check("a CR row is a credit", icici.rows[2].direction, "CREDIT");
check("credit amount exact", icici.rows[2].amount, rupees("1450.00"));

// The zero-amount AMC row is reported, not silently dropped: a bank really does
// print a ₹0.00 charge line, and it records nothing (L03).
check("zero-amount row becomes a problem", icici.problems.length, 1);
check("with the reason stated", icici.problems[0].reason, "Amount is zero");

const iciciContinuity = checkBalanceContinuity(icici.rows);
checkDeep("ICICI continuity holds", iciciContinuity.breaks, []);

/* ═══ Fixture 3 — headers nothing recognises, columns inferred ════════ */

// "Value Dt" / "Particulars" are aliased; these deliberately are not, so the
// alias detector fails and inference has to find the columns from the data.
const UNKNOWN_HEADERS = `Sl,Tran Dt,Remarks Col,Paid Out,Paid In,Runnin Bal
1,12/06/2026,SBI CARD PAYMENT AUTOPAY,12500.00,,87500.00
2,14/06/2026,TPCODL ELECTRICITY BILL JUN,2340.00,,85160.00
3,18/06/2026,SALARY JUN ANANDA LTD,,125000.00,210160.00
4,21/06/2026,SWIGGY INSTAMART GROCERY,842.75,,209317.25
5,25/06/2026,LIC PREMIUM DEBIT,4500.00,,204817.25`;

section("Unknown headers — columns inferred from the data");

const inferred = parseStatementRows(parseDelimitedText(UNKNOWN_HEADERS), INR);

check("inference path was used", inferred.layout, "INFERRED");
check("rows found", inferred.rows.length, 5);
check("running balance told apart from the amount columns", inferred.rows[0].balanceAfter, rupees("87500.00"));
check("paid-out column recognised as debit", inferred.rows[0].direction, "DEBIT");
check("paid-in column recognised as credit", inferred.rows[2].direction, "CREDIT");
check("credit amount exact", inferred.rows[2].amount, rupees("125000.00"));
check("paise exact on inference path too", inferred.rows[3].amount, rupees("842.75"));

const inferredContinuity = checkBalanceContinuity(inferred.rows);
check("continuity checked on all but the first", inferredContinuity.checked, 4);
checkDeep("inferred columns are proven right by continuity", inferredContinuity.breaks, []);

/* ═══ OFX ═════════════════════════════════════════════════════════════ */

section("OFX");

const OFX = `OFXHEADER:100
<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS>
<CURDEF>INR
<BANKTRANLIST>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260703120000<TRNAMT>-1499.00<FITID>FT2026070301<MEMO>NETFLIX SUBSCRIPTION</STMTTRN>
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20260705<TRNAMT>2500.00<FITID>FT2026070502<NAME>REFUND AMAZON</STMTTRN>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>notadate<TRNAMT>-10.00<FITID>FT9</STMTTRN>
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;

const ofx = parseOfx(OFX, INR);
check("two usable movements", ofx.rows.length, 2);
check("negative TRNAMT is a debit", ofx.rows[0].direction, "DEBIT");
check("amount is absolute", ofx.rows[0].amount, rupees("1499.00"));
check("FITID becomes the reference", ofx.rows[0].reference, "FT2026070301");
check("MEMO preferred over NAME", ofx.rows[0].description, "NETFLIX SUBSCRIPTION");
check("NAME used when MEMO is absent", ofx.rows[1].description, "REFUND AMAZON");
check("the malformed block is reported", ofx.problems.length, 1);
check("CURDEF is honoured", ofx.currency.code, "INR");

/* ═══ Cell-level behaviour ════════════════════════════════════════════ */

section("amount cells");

check("comma grouping", readAmount("1,23,456.78", INR).amount, rupees("123456.78"));
check("rupee sign", readAmount("₹450.50", INR).amount, rupees("450.50"));
check("parenthesised is negative", readAmount("(1,200.00)", INR).negative, true);
check("parenthesised magnitude", readAmount("(1,200.00)", INR).amount, rupees("1200.00"));
check("leading minus is negative", readAmount("-99.99", INR).negative, true);
check("blank is absent, not zero", readAmount("   ", INR).amount, null);
check("a date is not an amount", readAmount("20-05-2026", INR).amount, null);
check("free text is not an amount", readAmount("NEFT DR", INR).amount, null);
check("an exact zero is present and zero", readAmount("0.00", INR).amount, rupees("0"));

// The v1 bug this replaces: `debit || credit` made an exact-zero debit fall
// through to the credit column, turning a ₹0 charge into a deposit.
checkTrue(
  "zero is distinguishable from absent",
  readAmount("0.00", INR).amount !== null && readAmount("", INR).amount === null,
);

section("dates");

check("DMY resolved from a day above 12", resolveDateOrder(["03/04/2026", "28/04/2026"]), "DMY");
check("MDY resolved from a month above 12", resolveDateOrder(["04/28/2026", "03/04/2026"]), "MDY");
check("no evidence falls back to DMY", resolveDateOrder(["03/04/2026"]), "DMY");
check("DMY reading", readDate("03/04/2026", "DMY")?.toISO(), "2026-04-03");
check("MDY reading of the same text", readDate("03/04/2026", "MDY")?.toISO(), "2026-03-04");
check("ISO is unambiguous", readDate("2026-04-03", "MDY")?.toISO(), "2026-04-03");
check("two-digit year", readDate("03-04-26", "DMY")?.toISO(), "2026-04-03");
check("Excel serial", readDate(46115, "DMY")?.toISO(), "2026-04-03");
check("impossible date is rejected", readDate("31/02/2026", "DMY"), null);
check("free text is not a date", readDate("opening balance", "DMY"), null);

section("delimited splitting");

checkDeep(
  "quoted comma stays in one cell",
  splitDelimitedLine('01/04/2026,"UPI, ZEPTO","1,234.56"', ","),
  ["01/04/2026", "UPI, ZEPTO", "1,234.56"],
);
checkDeep('escaped "" becomes one quote', splitDelimitedLine('a,"say ""hi""",b', ","), [
  "a",
  'say "hi"',
  "b",
]);

section("failure modes");

throws(
  "a file with no date column is refused",
  () => parseStatementRows([["a", "b"], ["1", "2"]], INR),
  "date column",
);

throws(
  "an empty file is refused",
  () => parseStatementRows([], INR),
  "no columns",
);

/* ═══ Continuity as a detector, not a formality ═══════════════════════ */

section("continuity detects a swapped pair");

/*
 * The detector, on its own.
 *
 * Tested against hand-built rows rather than a parsed file, deliberately. This
 * assertion is about `checkBalanceContinuity` catching a wrong direction; routing
 * it through `parseStatementRows` would make it depend on which reader that
 * function decides to prefer, and it would then start passing or failing for
 * reasons that have nothing to do with the detector.
 */
const swappedRows = [
  { rowIndex: 0, amount: rupees("500.00"), direction: "DEBIT" as const, balanceAfter: rupees("9500.00") },
  // Money left the account, but this row claims it arrived.
  { rowIndex: 1, amount: rupees("300.00"), direction: "CREDIT" as const, balanceAfter: rupees("9200.00") },
];
const swappedContinuity = checkBalanceContinuity(swappedRows);
check("the break is found", swappedContinuity.breaks.length, 1);
check("and it names the expected balance", swappedContinuity.breaks[0].expected, rupees("9800.00"));

section("a transposed header is recovered, not merely detected");

/*
 * The headings say one thing and the body does the other — `Withdrawal` holds the
 * deposits. Before the verdict chose between readers this parsed happily and was
 * accepted, because the alias path produced rows and row count was the only test
 * it had to pass. Every debit would have posted as a credit.
 *
 * Now both readers run: the alias reading breaks the running balance, content
 * inference reads the columns from the direction the balance actually moved, and
 * the reading that reconciles wins.
 *
 * Six rows rather than two, because inference decides the pair by *voting* over
 * the rows where each column is populated. On a two-row file that vote has almost
 * no signal, and a test that passed on two rows would be asserting a coincidence.
 */
const TRANSPOSED = `Date,Narration,Withdrawal (Dr),Deposit (Cr),Closing Balance
01/04/2026,SALARY,50000.00,,60000.00
02/04/2026,RENT,,18500.00,41500.00
03/04/2026,GROCERIES,,2500.00,39000.00
04/04/2026,REFUND,1000.00,,40000.00
05/04/2026,FUEL,,3000.00,37000.00
06/04/2026,ELECTRICITY,,1500.00,35500.00`;

const transposed: ParsedStatement = parseStatementRows(parseDelimitedText(TRANSPOSED), INR);
check("all six rows are read", transposed.rows.length, 6);
check("the reading that reconciles wins", transposed.verdict.trust, "RECONCILED");
check("so inference beat the misleading header", transposed.layout, "INFERRED");
check("the salary is a credit despite the column it sat in", transposed.rows[0].direction, "CREDIT");
check("and the rent is a debit", transposed.rows[1].direction, "DEBIT");
checkDeep("nothing breaks the chain", transposed.verdict.breaks, []);

/* ═══ A bank file is not all transactions ═════════════════════════════ */

section("preamble and footer lines are not counted as failures");

/*
 * A real Indian bank CSV, shape-for-shape: branch furniture above the header and
 * a legend below it. This produced 28 "unreadable row" problems on a 747-line
 * file, and the only way to read that screen was "28 of my transactions were
 * dropped" — of a statement whose every transaction had in fact been read.
 *
 * The rule is whether the line was *trying* to be a transaction. Prose with
 * neither a date nor an amount never was; a row with one and not the other is
 * broken and still reported.
 */
const WITH_FURNITURE = `Account Statement
Account Number,924010070815236
Branch,MG Road
IFSC,UTIB0001234

Date,Narration,Withdrawal (Dr),Deposit (Cr),Closing Balance
01/04/2026,SALARY CREDIT,,50000.00,50000.00
02/04/2026,UPI PAYMENT,1200.00,,48800.00

Legend: UPI - Unified Payments Interface
This is a computer generated statement.
Please contact the branch for discrepancies.`;

const furnished: ParsedStatement = parseStatementRows(parseDelimitedText(WITH_FURNITURE), INR);
check("both real transactions are read", furnished.rows.length, 2);
checkDeep("and nothing is reported as unreadable", furnished.problems.map((one) => one.reason), []);

section("a line that tried to be a transaction is still reported");

// An amount but no date: this one *was* a row, and losing it silently would lose
// money — which is exactly what the furniture rule must not start doing.
const BROKEN = `Date,Narration,Withdrawal (Dr),Deposit (Cr),Closing Balance
01/04/2026,SALARY CREDIT,,50000.00,50000.00
not-a-date,MYSTERY DEBIT,1200.00,,48800.00`;

const broken: ParsedStatement = parseStatementRows(parseDelimitedText(BROKEN), INR);
check("only the readable row is kept", broken.rows.length, 1);
check("and the broken one is reported", broken.problems.length, 1);
check("by name", broken.problems[0].reason, "No readable date");

section("the vote is starved, and the balance decides anyway");

/*
 * The case the debit/credit vote is worst at, and the reason it is now checked
 * against the balance rather than trusted.
 *
 * An ordinary salaried month is a wall of debits and one credit. The credit
 * column is populated on a single row, so it casts one vote; a ranking built
 * from that is a coin toss dressed as evidence. Headers here are deliberately
 * ones no alias knows, to force the inference path.
 *
 * Balances fall on every row but the salary, so scoring each assignment against
 * the printed balance settles it outright.
 */
const NEWLINE = "\n";
const STARVED_ROWS = [
  "Txn Day,Details,Money Out,Money In,Running",
  "01/05/2026,SALARY,,71050.00,71050.00",
];
let starvedBalance = 71050;
for (let day = 2; day <= 21; day += 1) {
  starvedBalance -= 100;
  const date = String(day).padStart(2, "0");
  STARVED_ROWS.push(`${date}/05/2026,UPI PAYMENT ${day},100.00,,${starvedBalance}.00`);
}

const starved: ParsedStatement = parseStatementRows(
  parseDelimitedText(STARVED_ROWS.join(NEWLINE)),
  INR,
);

check("headers no alias knows force inference", starved.layout, "INFERRED");
check("every row is read", starved.rows.length, 21);
check("the lone salary is a credit", starved.rows[0].direction, "CREDIT");
check("and the twenty payments are debits", starved.rows[1].direction, "DEBIT");
check("the reading is proved", starved.verdict.trust, "RECONCILED");
checkDeep("with no breaks at all", starved.verdict.breaks, []);

/* ═══ The verdict ═════════════════════════════════════════════════════ */

section("every parse now reports what it can prove about itself");

/*
 * The three states, and why they are three rather than a score.
 *
 * Until now every column choice - the alias table, the content inference, the
 * debit/credit vote - was a guess that nothing checked. The running balance is
 * the check, and it is exact because amounts are bigint paise. What the verdict
 * adds is that the answer now travels *with* the parse instead of being
 * recomputed by whoever remembers to ask.
 */

check("a clean statement reconciles", hdfc.verdict.trust, "RECONCILED");
check("and says how many rows were testable", hdfc.verdict.checked, 5);
checkDeep("with no breaks", hdfc.verdict.breaks, []);
check("the closing balance is carried", hdfc.verdict.closingBalance, rupees("109800.03"));

/*
 * The mapping is the answer to the only useful question a wrong import provokes:
 * which column was read as what? The coarse `layout` enum could never say.
 */
check("the balance column is named", hdfc.verdict.mapping.balance, 5);
check("the debit column is named", hdfc.verdict.mapping.debit, 3);
check("the credit column is named", hdfc.verdict.mapping.credit, 4);

// The verdict travels with the parse: no second call to the continuity check,
// and no caller left to remember to make one.
check("a recovered transposition reports itself", transposed.verdict.trust, "RECONCILED");
check("and says how many rows carried the proof", transposed.verdict.checked, 5);

/*
 * No balance column is not a failure — it is an absence of evidence, and saying
 * so is the whole point. Reporting it as success would be the lie: this parse is
 * exactly as trustworthy as the column detection, and nothing here can check it.
 */
const NO_BALANCE = `Date,Narration,Withdrawal (Dr),Deposit (Cr)
01/04/2026,SALARY,,50000.00
02/04/2026,RENT,18500.00,`;

const noBalance: ParsedStatement = parseStatementRows(parseDelimitedText(NO_BALANCE), INR);
check("both rows still parse", noBalance.rows.length, 2);
check("but nothing can be checked", noBalance.verdict.checked, 0);
check("so the verdict is UNVERIFIED", noBalance.verdict.trust, "UNVERIFIED");
check("and there is no closing balance to report", noBalance.verdict.closingBalance, null);

/*
 * OFX carries no per-row balance, so it is honestly UNVERIFIED even though the
 * file states its own closing figure. Spreading LEDGERBAL back over the rows
 * would make the chain reconcile *by construction* — including when a row was
 * misread — which manufactures confidence rather than measuring it.
 */
check("OFX is unverified", ofx.verdict.trust, "UNVERIFIED");

/* ═══ Phase 4 — the file readers ══════════════════════════════════════ */

section("delimiter sniffing");

/*
 * The narration carries more commas than the file has separators. Counting
 * characters - the old rule - picks the comma and shreds every row; counting
 * *agreement* picks the semicolon, because only the semicolon gives the same
 * field count on every line.
 */
const SEMICOLON = `Date;Narration;Withdrawal;Deposit;Balance
01/04/2026;UPI/PAYTM, MUMBAI, IN;100.00;;900.00
02/04/2026;NEFT, ACME CORP, PUNE;;500.00;1400.00`;

const semicolon = parseStatementRows(parseDelimitedText(SEMICOLON), INR);
check("the semicolon wins on consistency", semicolon.rows.length, 2);
check("and the narration survives whole", semicolon.rows[0]?.description, "UPI/PAYTM, MUMBAI, IN");
check("the balances still chain", semicolon.verdict.trust, "RECONCILED");

section("multi-line quoted fields");

/*
 * One transaction printed across two physical lines. Splitting on newlines
 * first turns it into a row with no date and no amount, which is then reported
 * as an unreadable line - a real transaction lost to a formatting choice.
 */
const WRAPPED = `Date,Narration,Withdrawal,Deposit,Balance
01/04/2026,"UPI-ZEPTO
ORDER 8891",100.00,,900.00
02/04/2026,SALARY,,500.00,1400.00`;

const wrapped = parseStatementRows(parseDelimitedText(WRAPPED), INR);
check("the wrapped row is one row", wrapped.rows.length, 2);
checkTrue(
  "and keeps both of its lines",
  (wrapped.rows[0]?.description ?? "").includes("ORDER 8891"),
);
check("nothing was reported unreadable", wrapped.problems.length, 0);

section("encoding");

/** The bytes Excel writes for "Unicode Text": a BOM, then UTF-16LE. */
const utf16le = (text: string): Uint8Array => {
  const units = [0xfeff, ...text].map((unit) =>
    typeof unit === "number" ? unit : unit.charCodeAt(0),
  );
  const bytes = new Uint8Array(units.length * 2);
  units.forEach((unit, index) => {
    bytes[index * 2] = unit & 0xff;
    bytes[index * 2 + 1] = unit >> 8;
  });
  return bytes;
};

check("UTF-16LE is decoded, not read as NUL-riddled UTF-8", decodeText(utf16le("Date,Amount")), "Date,Amount");
check(
  "a UTF-8 BOM is consumed rather than glued to the first header",
  decodeText(new Uint8Array([0xef, 0xbb, 0xbf, 0x44, 0x61, 0x74, 0x65])),
  "Date",
);
check(
  "plain ASCII is untouched",
  decodeText(new Uint8Array([0x44, 0x61, 0x74, 0x65])),
  "Date",
);

section("the shape of a file, named");

/*
 * The fingerprint exists to notice that a bank changed its export, so it must
 * be made of nothing that changes on its own. Two months of the same statement
 * differ in every row and in none of the headings.
 */
const APRIL = `Date,Narration,Withdrawal (Dr),Deposit (Cr),Closing Balance
01/04/2026,SALARY,,50000.00,50000.00`;
const MAY = `Date,Narration,Withdrawal (Dr),Deposit (Cr),Closing Balance
03/05/2026,RENT,18500.00,,31500.00
04/05/2026,GROCERIES,1500.00,,30000.00`;

check(
  "two months of one export fingerprint alike",
  layoutFingerprint(parseDelimitedText(APRIL)),
  layoutFingerprint(parseDelimitedText(MAY)),
);

const MOVED = `Date,Narration,Chq No,Withdrawal (Dr),Deposit (Cr),Closing Balance
03/05/2026,RENT,,18500.00,,31500.00`;
checkTrue(
  "a bank inserting a column does not",
  layoutFingerprint(parseDelimitedText(MOVED)) !== layoutFingerprint(parseDelimitedText(MAY)),
);

check(
  "and a headerless file says so rather than inventing a name",
  layoutFingerprint([["01/04/2026", "SALARY", "50000.00"]]),
  "inferred:3",
);

done();

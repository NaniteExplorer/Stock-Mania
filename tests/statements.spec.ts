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

// Debit and credit swapped on one row: the amounts are all still exact, and the
// only thing that notices is the running balance.
const SWAPPED = `Date,Narration,Withdrawal (Dr),Deposit (Cr),Closing Balance
01/04/2026,OPENING SPEND,500.00,,9500.00
02/04/2026,SHOULD HAVE BEEN A DEBIT,,300.00,9200.00`;

const swapped: ParsedStatement = parseStatementRows(parseDelimitedText(SWAPPED), INR);
check("both rows parse", swapped.rows.length, 2);
const swappedContinuity = checkBalanceContinuity(swapped.rows);
check("the break is found", swappedContinuity.breaks.length, 1);
check("and it names the expected balance", swappedContinuity.breaks[0].expected, rupees("9800.00"));

done();

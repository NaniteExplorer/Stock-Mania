/**
 * Bank statements that arrive as PDF.
 *
 * A PDF has no columns. It has glyphs at coordinates, and a text extractor hands
 * back the reading order it can infer — which for every Indian bank statement
 * tried here means one transaction is spread over two to five lines, with the
 * amounts stranded on a line of their own:
 *
 *     "02-Sep-2023 02-Sep-2023 UPI/CR/324510400265/DEBASISH RANA/S"
 *     "BIN/9761882251/Payment"
 *     "0.00 200.00 4,325.90"
 *
 * So this module does exactly one job: put the columns back. It recovers a
 * `RawRow[]` — the same shape a CSV parse produces — and hands it to
 * `parseStatementRows`, which already knows how to read dates, amounts, running
 * balances and duplicates. Nothing about what a transaction *means* lives here,
 * because a second copy of those rules would be a second set of bugs.
 *
 * The layout is not configured per bank. A statement is recovered from two facts
 * that hold across formats: a transaction begins with a date at the start of a
 * line, and it ends with a run of money-shaped tokens. Everything between them is
 * the narration, however many lines it took.
 */
import { Currency } from "@/core/money";

import {
  type ParsedStatement,
  type RawRow,
  StatementParseError,
  parseStatementRows,
} from "./statements";

/* ═══ Text extraction ═════════════════════════════════════════════════ */

/**
 * The lines of a PDF, in reading order, with page furniture removed.
 *
 * `unpdf` bundles pdf.js and needs no native build, no service and no API key —
 * the statement never leaves the machine, which for a file listing every payment
 * somebody made in three years is the only acceptable arrangement.
 */
export async function extractPdfLines(bytes: Uint8Array): Promise<string[]> {
  const { extractText, getDocumentProxy } = await import("unpdf");

  let pages: string[];
  try {
    const document = await getDocumentProxy(bytes);
    const extracted = await extractText(document, { mergePages: false });
    pages = Array.isArray(extracted.text) ? extracted.text : [extracted.text];
  } catch (cause) {
    throw new StatementParseError(
      "That PDF could not be read. If it is a scan or a photograph of a statement " +
        "there is no text in it to import — ask the bank for a CSV or an Excel export.",
      { cause },
    );
  }

  return pages
    .flatMap((page) => page.split("\n"))
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line !== "" && !isFurniture(line));
}

/**
 * Lines that repeat on every page and belong to no transaction.
 *
 * Deliberately narrow. Anything dropped here is invisible afterwards, so the
 * patterns match only what is unmistakably chrome — a page number, a column
 * heading, a registered address. A line that merely *looks* administrative is
 * left in and allowed to fail loudly as an unreadable row instead.
 */
const FURNITURE: readonly RegExp[] = [
  /^page\s+(no\.?\s*)?\d+(\s+of\s+\d+)?$/i,
  /^(transaction|value|post|closing|running|available)\s*(date|balance)?$/i,
  /^(date|balance|narration|details|particulars|description|withdrawals?|deposits?|debit|credit|cheque|no)$/i,
  /^(₹\s*)?(debit|credit)$/i,
  /^ref no\/?$/i,
  /narration\s+withdrawals\s+deposits/i,
  /value date\s+post date\s+details/i,
  /^statement of account$/i,
  /registered address/i,
  /computer generated/i,
  /^cin[:\s]/i,
  /this statement will be considered correct/i,
];

function isFurniture(line: string): boolean {
  return FURNITURE.some((pattern) => pattern.test(line));
}

/* ═══ Putting the columns back ════════════════════════════════════════ */

/** `27-Jun-2023`, `02/01/2024`, `2024-01-02` — anchored to the start of a line. */
const RECORD_START = /^(\d{1,2}[-/](?:\d{1,2}|[A-Za-z]{3,})[-/]\d{2,4}|\d{4}-\d{2}-\d{2})\b/;

/**
 * A money-shaped token, or the dash a bank prints for "nothing in this column".
 *
 * The decimal point is required, and that is what makes the tail safe to read
 * from the right: `Add Money, ID: 317809260846` ends in twelve digits, and
 * without the `.dd` those digits would be eaten as an amount and the narration
 * silently truncated.
 */
const TAIL_TOKEN = /(?:(?:\d{1,3}(?:,\d{2,3})*|\d+)\.\d{1,2}|-)\s*$/;

/** The teller stamp SBI appends to every row: a journal number and a branch. */
const TELLER_STAMP = /\s*(\d{10,}\s+AT\s+\d+\s+.*)$/i;

interface StatementRecord {
  readonly text: string;
  /** Line number of the record's first line, for problem reporting. */
  readonly at: number;
}

/**
 * Group lines into records: one starts at a date and ends at its own amounts.
 *
 * The end condition is the subtle half. "Runs until the next date" is the obvious
 * rule and it is wrong, because it swallows whatever the printer put between the
 * last transaction on a page and the first on the next one — a registered
 * address, a phone number, a CIN. That trailing prose destroys the record's
 * amount tail, so the row is dropped, and the damage is invisible in the way that
 * matters most: it costs exactly one transaction per page, silently, and the
 * statement still looks complete. It cost 82 rows of 1,695 here before the
 * printed totals gave it away.
 *
 * Closing a record on its amounts instead is bank-agnostic and self-limiting: the
 * amounts are the last thing a statement line has, by construction, so anything
 * after them belongs to the page rather than the transaction.
 */
function toRecords(lines: readonly string[]): StatementRecord[] {
  const records: StatementRecord[] = [];
  let current: string[] = [];
  let complete = false;
  let at = 0;

  const flush = () => {
    if (current.length > 0) records.push({ text: current.join(" "), at });
    current = [];
    complete = false;
  };

  lines.forEach((line, index) => {
    if (RECORD_START.test(line)) {
      flush();
      at = index;
      current.push(line);
    } else if (current.length > 0 && !complete) {
      /*
       * Lines before the first date are the statement's preamble — account
       * number, branch, IFSC, the opening-balance summary. They are dropped
       * rather than reported, on the same reasoning the CSV parser applies to
       * furniture: a line that was never trying to be a transaction is not a
       * failed transaction.
       */
      current.push(line);
    } else {
      return;
    }

    complete = takeTail(current.join(" ")).tail.length >= 3;
  });
  flush();

  return records;
}

/** The trailing money columns of a record, read right to left. */
function takeTail(text: string, limit = 5): { head: string; tail: string[] } {
  let head = text;
  const tail: string[] = [];

  while (tail.length < limit) {
    const match = TAIL_TOKEN.exec(head);
    if (!match) break;
    tail.unshift(match[0].trim());
    head = head.slice(0, match.index).trimEnd();
  }

  return { head, tail };
}

/**
 * One recovered record as a row of cells.
 *
 * The tail identifies the layout, and it is read positionally from the right
 * because that is the only end of the row that is stable:
 *
 *   `0.00 200.00 4,325.90`      → debit, credit, balance
 *   `- 150.00 - 5,957.17`       → reference, debit, credit, balance
 *
 * A bank writes the empty column either as a dash or as an exact `0.00`; both
 * become an empty cell here, so the difference never reaches the amount reader.
 */
function toRow(record: StatementRecord): RawRow | null {
  const { head, tail } = takeTail(record.text);
  if (tail.length < 3) return null;

  const dateMatch = RECORD_START.exec(head);
  if (!dateMatch) return null;
  const date = dateMatch[1];

  /*
   * A statement that prints both a transaction date and a value date repeats
   * itself. The first is the one the ledger wants: the value date is when the
   * bank chose to earn interest from, not when the money moved.
   */
  let rest = head.slice(dateMatch[0].length).trim();
  const secondDate = RECORD_START.exec(rest);
  if (secondDate) rest = rest.slice(secondDate[0].length).trim();

  // Last token is the running balance; the two before it are the debit/credit
  // pair; anything further left is a reference printed beside the amounts.
  const balance = tail[tail.length - 1] ?? "";
  const credit = tail[tail.length - 2] ?? "";
  const debit = tail[tail.length - 3] ?? "";
  const leading = tail.slice(0, Math.max(0, tail.length - 3));

  const stamp = TELLER_STAMP.exec(rest);
  const description = stamp ? rest.slice(0, stamp.index).trim() : rest;
  const reference = [...leading, stamp?.[1] ?? ""]
    .map(blankIfEmpty)
    .filter((token) => token !== "")
    .join(" ");

  if (description === "") return null;

  return [date, description, reference, blankIfEmpty(debit), blankIfEmpty(credit), balance];
}

/** A dash or an exact zero is the bank saying "no amount here". */
function blankIfEmpty(token: string): string {
  if (token === "-" || token === "") return "";
  return /^0(\.0{1,2})?$/.test(token.replace(/,/g, "")) ? "" : token;
}

/* ═══ Entry point ═════════════════════════════════════════════════════ */

const HEADER: RawRow = ["Date", "Description", "Reference", "Debit", "Credit", "Balance"];

/**
 * Why a PDF that plainly shows a statement yielded no text at all.
 *
 * Three different files reach this point and only one of them is a scan, so the
 * message has to distinguish them - "ask the bank for an export" is useless
 * advice to someone whose bank has already given them one.
 *
 * The tell is `/Font`. A PDF that draws its words as vector outlines needs no
 * font at all: SBI's `Account Summary` export does exactly this, 20 content
 * streams of Bezier paths, zero text-showing operators, and it looks perfectly
 * crisp on screen while containing not one readable character. That is not a
 * scan and it is not corrupt - it is the wrong export, and the same account's
 * `Account Statement` download has real text in it.
 */
function whyThereIsNoText(bytes: Uint8Array): string {
  // The structural keys are ASCII in the file's own bytes, whatever the streams
  // are compressed with, so this needs no second parse of the document.
  const head = new TextDecoder("latin1").decode(bytes);
  const hasFonts = head.includes("/Font");
  const hasImages = head.includes("/Image");

  if (!hasFonts && !hasImages) {
    /*
     * Plain prose: this reaches the user as text, not as markdown, so backticks
     * and asterisks would arrive on screen exactly as written.
     */
    return (
      "Every word in that PDF is drawn as artwork rather than stored as text, so " +
      "there is nothing in it to read — no parser can import it. This is what an " +
      "account summary export looks like. Download the account statement for the " +
      "same account instead, or a CSV or Excel export."
    );
  }
  return (
    "There is no text in that PDF — it looks like a scan or a photograph of a " +
    "statement. Ask the bank for a downloaded PDF, a CSV or an Excel export."
  );
}

/** A file that had text, but no transactions in it. */
const NO_TRANSACTIONS =
  "No transactions were found in that PDF. It may be a summary or a passbook " +
  "cover page rather than a statement of account.";

/** Parse a PDF bank statement into the `ParsedStatement` a CSV would produce. */
export async function parsePdfStatement(
  bytes: Uint8Array,
  currency: Currency = Currency.reporting,
): Promise<ParsedStatement> {
  const lines = await extractPdfLines(bytes);
  const rows: RawRow[] = [HEADER];

  for (const record of toRecords(lines)) {
    const row = toRow(record);
    if (row) rows.push(row);
  }

  if (rows.length === 1) {
    throw new StatementParseError(
      lines.length === 0 ? whyThereIsNoText(bytes) : NO_TRANSACTIONS,
    );
  }

  const parsed = parseStatementRows(rows, currency);

  /*
   * A PDF statement carries no machine id, so no row from one may claim to.
   *
   * What looks like an id in these files is a teller stamp - branch and terminal
   * - and the matcher treats an external id as decisive, matching across any
   * distance in time. `withIdentifiedReferences` would clear a stamp that repeats
   * within the file, but 650 of one real statement's stamps appear exactly once
   * there and would pass that test while still being stamps, free to collide with
   * a row already posted from another statement. The reference is kept; only the
   * claim of identity is dropped.
   */
  return withoutMachineIds(parsed);
}

/** Strip the id claim from every row, keeping the reference. */
function withoutMachineIds(parsed: ParsedStatement): ParsedStatement {
  return { ...parsed, rows: parsed.rows.map((row) => ({ ...row, externalId: null })) };
}

/** Internals, exposed for the spec — not part of the module's contract. */
export const __test__ = { toRecords, toRow, takeTail, isFurniture, withoutMachineIds, whyThereIsNoText };

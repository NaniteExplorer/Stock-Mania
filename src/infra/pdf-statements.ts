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
  StatementLockedError,
  StatementParseError,
  describeBreaks,
  parseStatementRows,
  readAmount,
  withOpeningBalance,
  withPrintedTotals,
} from "./statements";
import { readStatementHeader } from "./statement-header";

/**
 * pdf.js `PasswordResponses`, inlined.
 *
 * The enum lives in pdf.js's `shared/util`, which `unpdf` does not re-export;
 * reaching it would mean resolving the whole pdf.js module just to compare two
 * integers, on a path that has already failed. The values are part of the
 * exception's public shape and have not moved in the life of the library.
 */
const NEED_PASSWORD = 1;
const INCORRECT_PASSWORD = 2;

/* ═══ Text extraction ═════════════════════════════════════════════════ */

/**
 * The lines of a PDF, in reading order, with page furniture removed.
 *
 * `unpdf` bundles pdf.js and needs no native build, no service and no API key —
 * the statement never leaves the machine, which for a file listing every payment
 * somebody made in three years is the only acceptable arrangement.
 */
export async function extractPdfLines(bytes: Uint8Array, password?: string): Promise<string[]> {
  const { extractText, getDocumentProxy } = await import("unpdf");

  let pages: string[];
  try {
    /*
     * The password is handed straight to pdf.js, which uses it to derive the
     * file's decryption key and keeps it nowhere the rest of this module can
     * reach. Passing `undefined` is exactly the same call as before, so the
     * unencrypted path is untouched.
     */
    const document = await getDocumentProxy(bytes, password ? { password } : undefined);
    const extracted = await extractText(document, { mergePages: false });
    pages = Array.isArray(extracted.text) ? extracted.text : [extracted.text];
  } catch (cause) {
    /*
     * An encrypted statement is the common case here, not a corrupt one: SBI's
     * own e-statement download is password-protected as a matter of course. It
     * deserves its own answer, because "that file could not be read" sends
     * someone off to re-download a file that was never broken.
     */
    const locked = passwordProblem(cause);
    if (locked !== null) throw new StatementLockedError(locked === INCORRECT_PASSWORD, { cause });

    throw new StatementParseError(
      "That PDF could not be read. If it is a scan or a photograph of a " +
        "statement there is no text in it to import — ask the bank for a CSV " +
        "or an Excel export.",
      { cause },
    );
  }

  return pages
    .flatMap((page) => page.split("\n"))
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line !== "" && !isFurniture(line));
}

/**
 * Whether a failed open was about the password, and which way.
 *
 * Returns the pdf.js response code, or `null` if the file failed for some other
 * reason. The `code` is checked first because it is the exception's actual
 * contract; the name and message are a fallback for the same error arriving
 * through a wrapper that flattened it, which is how a rejected worker sometimes
 * surfaces. The message test stays last so it can never outvote a real code.
 */
function passwordProblem(cause: unknown): number | null {
  if (!(cause instanceof Error)) return null;

  const code = (cause as { code?: unknown }).code;
  if (code === NEED_PASSWORD || code === INCORRECT_PASSWORD) return code;

  if (cause.name === "PasswordException" || /password/i.test(cause.message)) {
    // No code to go on: assume the file has not been asked about yet. Guessing
    // "wrong password" instead would accuse the user of a typo they may not have
    // made, on the very first attempt.
    return /incorrect|invalid/i.test(cause.message) ? INCORRECT_PASSWORD : NEED_PASSWORD;
  }

  return null;
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
 * What the file says about itself, read before pdf.js is allowed near it.
 *
 * Not a convenience struct: `getDocumentProxy` hands the array to pdf.js, which
 * takes ownership and detaches it, so after extraction `bytes` is a zero-length
 * view and every question asked of it answers "no". That silently turned the
 * diagnosis below into its own fallback - the honest-looking wrong answer, which
 * is the worst kind. Reading first, and passing facts rather than the array, is
 * what stops it happening again.
 */
interface PdfProvenance {
  readonly producer: string;
  readonly hasFonts: boolean;
  readonly hasImages: boolean;
}

function readProvenance(bytes: Uint8Array): PdfProvenance {
  // The structural keys and the metadata strings are ASCII in the file's own
  // bytes whatever the streams are compressed with, so this needs no parse.
  const text = new TextDecoder("latin1").decode(bytes);
  return {
    producer: /\/Producer\s*\(([^)]*)\)/.exec(text)?.[1] ?? "",
    hasFonts: text.includes("/Font"),
    hasImages: text.includes("/Image"),
  };
}

/**
 * Why a PDF that plainly shows a statement yielded no text at all.
 *
 * Three different files reach this point and only one of them is a scan, so the
 * message has to tell them apart - "ask the bank for an export" is useless
 * advice to someone whose bank has already given them one.
 */
function whyThereIsNoText(source: PdfProvenance): string {
  /*
   * The Windows print driver is the single most likely cause, and naming it
   * turns an unanswerable complaint into a one-click fix. It redraws every glyph
   * as filled outlines: the page looks perfect and holds no text at all. The two
   * SBI statements that import cleanly name `PDFium` as their producer; the one
   * that cannot names `Microsoft: Print To PDF`.
   */
  if (/print to pdf/i.test(source.producer)) {
    return (
      "That PDF was made with Microsoft Print to PDF, which redraws every word as " +
      "line art — the page looks perfect and contains no text at all, so there is " +
      "nothing to import. In the print dialog choose Save as PDF instead of " +
      "Microsoft Print to PDF, or download the statement from the bank directly."
    );
  }

  /*
   * A PDF that draws its words needs no font at all, and plain prose is right
   * here: this reaches the user as text, not as markdown.
   */
  if (!source.hasFonts && !source.hasImages) {
    return (
      "Every word in that PDF is drawn as artwork rather than stored as text, so " +
      "there is nothing in it to read — no parser can import it. Printing a page " +
      "to PDF usually does this. Save it as a PDF from the browser instead, or " +
      "download the statement from the bank."
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

/**
 * Parse a PDF bank statement into the `ParsedStatement` a CSV would produce.
 *
 * `password` is optional and transient: it exists for the length of this call,
 * is given only to pdf.js, and is never stored, logged, or put in an error — a
 * `StatementLockedError` reports *that* the password was wrong, never what was
 * tried.
 */
export async function parsePdfStatement(
  bytes: Uint8Array,
  currency: Currency = Currency.reporting,
  password?: string,
): Promise<ParsedStatement> {
  // Before extraction, not after: pdf.js detaches the array it is handed.
  const source = readProvenance(bytes);

  /*
   * The geometry reader first, because it does not have to infer anything: it
   * reads which column an amount was printed in rather than deducing it from the
   * shape of the text. It declines (returns null) for every statement whose
   * table it cannot positively identify, which is when the text recovery below -
   * the path SBI and Jio already take - is the right one.
   *
   * pdf.js detaches the array it is given, so each reader gets its own copy.
   */
  const { readColumnStatement } = await import("./pdf-columns");
  const byColumn = await readColumnStatement(Uint8Array.from(bytes), password);

  /*
   * A geometry reading that does not reconcile is a candidate, not an answer.
   *
   * It used to be final: the reader judged itself and threw, so the text path
   * never got its turn on a file the geometry merely misread. Both readers now
   * run and the better verdict wins, which is the same rule `parseStatementRows`
   * applies to its own two readers.
   */
  let geometry: ParsedStatement | null = null;
  if (byColumn) {
    /*
     * The bank's own control totals, applied before the verdict is acted on. A
     * reader that stops one row short produces rows that chain flawlessly and a
     * closing balance short by exactly what it lost - RECONCILED, and wrong.
     * Only a figure printed outside the table catches that, so it is checked
     * here rather than left to the review screen.
     */
    const header = readStatementHeader(byColumn.text, currency);
    geometry = describedBy(
      header,
      withoutMachineIds(
        withPrintedTotals(
          withOpeningBalance(
            parseStatementRows(byColumn.rows, currency),
            byColumn.opening === null ? null : readAmount(byColumn.opening, currency).amount,
          ),
          header.printedClosing,
          header.printedTotals,
        ),
      ),
    );
    if (geometry.verdict.trust !== "BROKEN") return geometry;
  }

  /*
   * Text recovery can fail outright on a file the geometry reader understood -
   * it looks for a shape that a column-drawn statement need not have. When that
   * happens the geometry breaks are the more useful complaint, so its error is
   * held rather than thrown.
   */
  let lines: string[];
  try {
    lines = await extractPdfLines(bytes, password);
  } catch (error) {
    if (geometry && !(error instanceof StatementLockedError)) return refuse(geometry);
    throw error;
  }

  const rows: RawRow[] = [HEADER];

  for (const record of toRecords(lines)) {
    const row = toRow(record);
    if (row) rows.push(row);
  }

  if (rows.length === 1) {
    if (geometry) return refuse(geometry);
    throw new StatementParseError(
      lines.length === 0 ? whyThereIsNoText(source) : NO_TRANSACTIONS,
    );
  }

  const header = readStatementHeader(lines, currency);
  const parsed = withPrintedTotals(
    parseStatementRows(rows, currency),
    header.printedClosing,
    header.printedTotals,
  );

  // Both readings are broken: report the one that at least found the columns.
  if (geometry && parsed.verdict.trust === "BROKEN") return refuse(geometry);

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
  return describedBy(header, withoutMachineIds(parsed));
}

/** The parse, carrying what the statement said about itself. */
function describedBy(
  header: ReturnType<typeof readStatementHeader>,
  parsed: ParsedStatement,
): ParsedStatement {
  return {
    ...parsed,
    header: {
      accountSuffix: header.accountSuffix,
      periodFrom: header.period?.from.toISO() ?? null,
      periodTo: header.period?.to.toISO() ?? null,
    },
  };
}

/**
 * A statement whose columns were found but whose arithmetic does not follow.
 *
 * Refused rather than imported with the bad rows flagged. A balance sheet built
 * on a statement that does not reconcile is worse than no statement at all,
 * because it looks finished.
 */
function refuse(parsed: ParsedStatement): never {
  /*
   * A control-total mismatch is the more specific complaint and takes
   * precedence: "the rows read total 12,000 but the statement says 13,500" tells
   * the user a transaction is missing, where a list of balance breaks only tells
   * them where the chain first noticed.
   */
  const why =
    parsed.verdict.controls.status === "MISMATCHED" && parsed.verdict.controls.detail
      ? parsed.verdict.controls.detail
      : `the running balance stops adding up at ${describeBreaks(parsed.verdict)}`;

  throw new StatementParseError(
    `That statement could not be read reliably: ${why}. Nothing has been ` +
      "imported, because a statement that does not reconcile would put the " +
      "wrong figures in your ledger.",
  );
}

/** Strip the id claim from every row, keeping the reference. */
function withoutMachineIds(parsed: ParsedStatement): ParsedStatement {
  return { ...parsed, rows: parsed.rows.map((row) => ({ ...row, externalId: null })) };
}

/** Internals, exposed for the spec — not part of the module's contract. */
export const __test__ = { toRecords, toRow, takeTail, isFurniture, withoutMachineIds, whyThereIsNoText, readProvenance, passwordProblem };

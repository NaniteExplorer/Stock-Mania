/**
 * Bank-statement parsing: bytes in, exact `Money` out.
 *
 * A port of v1's `features/transactions/statement-parser.ts`, which was genuinely
 * good — the header-alias table covers the Indian bank layouts, and the
 * content-inference fallback (find the date column, tell a running balance from
 * an amount column by whether its row-to-row delta equals another column, decide
 * debit-vs-credit by which way the balance moved) works on a layout nobody wrote
 * an alias for. All of that survives. **What does not survive is `parseFloat`.**
 *
 * Retyping to `Money` is not a cosmetic change. v1 read `1,234.56` into a float,
 * summed those floats into a balance, and the balance it displayed could not be
 * reproduced from the statement it came from. Every amount here is parsed from its
 * digits into `bigint` minor units, so a round-trip is exact by construction and
 * the "does the running balance agree with the movements?" check below is
 * meaningful rather than approximate.
 *
 * Infra rather than domain because this is about *file formats* — delimiters,
 * Excel serial dates, OFX tags, `exceljs`. What a row then *means* (is it a
 * duplicate, what category, does it reconcile) is domain policy and lives in
 * `domain/banking.ts`.
 */

import { Currency, Money } from "@/core/money";
import { CalendarDate } from "@/core/time";

/* ═══ Inputs and outputs ══════════════════════════════════════════════ */

/** One cell of a spreadsheet or delimited file, as the reader hands it over. */
export type Cell = string | number | Date | null | undefined;
export type RawRow = readonly Cell[];

export type StatementDirection = "DEBIT" | "CREDIT";

/** How the columns were worked out — surfaced so a bad parse is diagnosable. */
export type StatementLayout = "HEADER_ALIAS" | "INFERRED" | "OFX";

/** Which reading of `03/04/2026` the file was parsed under. */
export type DateOrder = "DMY" | "MDY";

/**
 * One movement, from the account holder's point of view: `DEBIT` is money leaving
 * the account.
 *
 * `amount` is always positive and `direction` carries the sign, matching `Posting`
 * — a signed amount would make "−500" ambiguous between a withdrawal and a
 * reversed deposit.
 */
export interface StatementRow {
  /** Index in the source file, so a problem can be pointed at a line. */
  readonly rowIndex: number;
  readonly date: CalendarDate;
  readonly description: string;
  readonly reference: string | null;
  readonly amount: Money;
  readonly direction: StatementDirection;
  /** The running balance the statement printed, when it printed one. */
  readonly balanceAfter: Money | null;
  /**
   * Which repeat of an otherwise identical row this is.
   *
   * Two ₹40 UPI payments to the same shop on the same day are two real
   * transactions, and without this they would fingerprint identically and the
   * second would be discarded as a duplicate of the first.
   */
  readonly occurrence: number;
}

/** A row that could not be read, kept rather than dropped. */
export interface StatementProblem {
  readonly rowIndex: number;
  readonly reason: string;
  /** The offending line, joined, for the review screen. */
  readonly raw: string;
}

export interface ParsedStatement {
  readonly rows: readonly StatementRow[];
  readonly currency: Currency;
  readonly layout: StatementLayout;
  readonly dateOrder: DateOrder;
  /**
   * Rows read but not usable. v1 returned `[]` for these, so a statement whose
   * amount column was misdetected imported as "0 transactions found" with no
   * indication that 214 lines had been silently discarded.
   */
  readonly problems: readonly StatementProblem[];
}

export class StatementParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StatementParseError";
  }
}

/* ═══ Header aliases ══════════════════════════════════════════════════ */

/**
 * The alias table, carried over verbatim: these are the actual header spellings
 * of HDFC, ICICI, SBI, Axis and Kotak exports, and the list is the accumulated
 * result of looking at real files.
 */
const HEADER_ALIASES = {
  date: ["date", "transaction date", "txn date", "value date", "posting date", "tran date"],
  description: ["description", "narration", "transaction details", "particulars", "remarks", "details"],
  reference: ["reference", "reference no", "ref no", "transaction id", "cheque no", "utr", "chq/ref no"],
  debit: ["debit", "withdrawal", "withdrawal amount", "debit amount", "dr amount", "dr", "withdrawal (dr)"],
  credit: ["credit", "deposit", "deposit amount", "credit amount", "cr amount", "cr", "deposit (cr)"],
  amount: ["amount", "transaction amount", "txn amount"],
  type: ["type", "dr/cr", "debit/credit", "transaction type"],
  balance: ["balance", "closing balance", "running balance", "available balance", "bal"],
} as const;

type ColumnKey = keyof typeof HEADER_ALIASES;
type ColumnMap = Record<ColumnKey, number>;

const normalizeHeader = (value: Cell): string =>
  String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");

const isBlank = (cell: Cell): boolean => String(cell ?? "").trim() === "";

const text = (cell: Cell): string => String(cell ?? "").trim();

/* ═══ Numbers, exactly ════════════════════════════════════════════════ */

/** The digits of an amount cell, with its sign and whether it was there at all. */
interface AmountCell {
  readonly amount: Money | null;
  /** `(1,234.56)` and `-1234.56` both mean negative. */
  readonly negative: boolean;
}

const CURRENCY_NOISE = /[₹$€£,\s]/g;
const NUMERIC_CELL = /^-?\(?\d+(\.\d+)?\)?$/;

/**
 * Reads a cell as an exact amount.
 *
 * The absolute value is returned in `amount` with the sign in `negative`,
 * deliberately: a statement's debit column holds `1,234.56` and means "out", so
 * the sign is carried by the column, and mixing the two conventions in one field
 * is how v1 ended up deciding direction three different ways.
 */
export function readAmount(cell: Cell, currency: Currency): AmountCell {
  if (cell === null || cell === undefined || isBlank(cell)) {
    return { amount: null, negative: false };
  }

  if (typeof cell === "number") {
    if (!Number.isFinite(cell)) return { amount: null, negative: false };
    // A spreadsheet cell arrives as a float; the string form is what gets parsed,
    // so the bigint conversion is exact even though the source was not.
    const asMoney = Money.fromRupees(Math.abs(cell), currency);
    return { amount: asMoney, negative: cell < 0 };
  }

  const raw = text(cell);
  const cleaned = raw.replace(CURRENCY_NOISE, "");
  if (!NUMERIC_CELL.test(cleaned)) return { amount: null, negative: false };

  const negative = cleaned.startsWith("-") || /^\(.*\)$/.test(cleaned);
  const digits = cleaned.replace(/[()-]/g, "");
  if (digits === "") return { amount: null, negative: false };

  return { amount: Money.fromRupees(digits, currency), negative };
}

/** Whole-cell numeric test, so `20-05-2025` is not read as the number 20. */
function looksNumeric(cell: Cell): boolean {
  if (typeof cell === "number") return Number.isFinite(cell);
  if (cell instanceof Date) return false;
  const cleaned = text(cell).replace(CURRENCY_NOISE, "");
  return cleaned !== "" && NUMERIC_CELL.test(cleaned);
}

/* ═══ Dates, resolved once for the whole file ═════════════════════════ */

const SLASHED = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/;
const ISO = /^(\d{4})-(\d{2})-(\d{2})/;
/** Excel's epoch is 1899-12-30; anything below this is not a plausible date serial. */
const MIN_EXCEL_SERIAL = 20000;

function looksDate(cell: Cell): boolean {
  if (cell instanceof Date) return !Number.isNaN(cell.getTime());
  if (typeof cell === "number") return Number.isInteger(cell) && cell > MIN_EXCEL_SERIAL;
  const value = text(cell);
  return SLASHED.test(value) || ISO.test(value);
}

/**
 * Decides `dd/mm` versus `mm/dd` for the **whole file**, from the evidence in it.
 *
 * This is a correction to v1, not a port. v1 assumed `dd/mm` unconditionally,
 * which is right for every Indian bank and wrong for a card statement exported
 * from a US-locale tool — and a per-row guess is worse than either, because
 * `03/04` and `13/04` in the same file would be read under different conventions
 * and the statement would silently reorder itself.
 *
 * A component above 12 can only be a day, so the first such value in the file
 * settles it. With no evidence either way — every date in the first twelve days
 * of its month — it stays `DMY`, because the users are Indian and that is the
 * documented assumption rather than a coin toss.
 */
export function resolveDateOrder(cells: readonly Cell[]): DateOrder {
  for (const cell of cells) {
    const match = SLASHED.exec(text(cell));
    if (!match) continue;
    const first = Number(match[1]);
    const second = Number(match[2]);
    if (first > 12 && second <= 12) return "DMY";
    if (second > 12 && first <= 12) return "MDY";
  }
  return "DMY";
}

/** Parses one date cell under an already-decided ordering. */
export function readDate(cell: Cell, order: DateOrder): CalendarDate | null {
  if (cell instanceof Date) {
    return Number.isNaN(cell.getTime()) ? null : CalendarDate.fromUtcInstant(cell);
  }
  if (typeof cell === "number") {
    if (!Number.isInteger(cell) || cell <= MIN_EXCEL_SERIAL) return null;
    return CalendarDate.fromUtcInstant(new Date(Date.UTC(1899, 11, 30 + cell)));
  }

  const value = text(cell);
  const iso = ISO.exec(value);
  if (iso) return safeDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  const slashed = SLASHED.exec(value);
  if (!slashed) return null;
  const a = Number(slashed[1]);
  const b = Number(slashed[2]);
  const yearPart = slashed[3];
  const year = yearPart.length === 2 ? 2000 + Number(yearPart) : Number(yearPart);
  return order === "DMY" ? safeDate(year, b, a) : safeDate(year, a, b);
}

function safeDate(year: number, month: number, day: number): CalendarDate | null {
  try {
    return CalendarDate.of(year, month, day);
  } catch {
    return null;
  }
}

/* ═══ Occurrence keys ═════════════════════════════════════════════════ */

class OccurrenceCounter {
  private readonly seen = new Map<string, number>();

  next(parts: readonly string[]): number {
    const key = parts.join("|");
    const count = this.seen.get(key) ?? 0;
    this.seen.set(key, count + 1);
    return count;
  }
}

/* ═══ Path 1: recognised headers ══════════════════════════════════════ */

function findColumn(headers: readonly string[], aliases: readonly string[]): number {
  const exact = headers.findIndex((header) => aliases.includes(header));
  if (exact >= 0) return exact;
  return headers.findIndex((header) => aliases.some((alias) => header.includes(alias)));
}

function detectByAliases(rows: readonly RawRow[]): { headerIndex: number; columns: ColumnMap } | null {
  const amountish = [
    ...HEADER_ALIASES.description,
    ...HEADER_ALIASES.debit,
    ...HEADER_ALIASES.credit,
    ...HEADER_ALIASES.amount,
  ];

  const headerIndex = rows.findIndex((row) => {
    const cells = row.map(normalizeHeader);
    const hasDate = cells.some((cell) => (HEADER_ALIASES.date as readonly string[]).includes(cell));
    const hasBody = cells.some((cell) => amountish.some((alias) => cell.includes(alias)));
    return hasDate && hasBody;
  });
  if (headerIndex < 0) return null;

  const headers = rows[headerIndex].map(normalizeHeader);
  const columns = Object.fromEntries(
    (Object.keys(HEADER_ALIASES) as ColumnKey[]).map((key) => [
      key,
      findColumn(headers, HEADER_ALIASES[key]),
    ]),
  ) as ColumnMap;

  const hasAnyAmount = columns.amount >= 0 || columns.debit >= 0 || columns.credit >= 0;
  if (columns.date < 0 || columns.description < 0 || !hasAnyAmount) return null;
  return { headerIndex, columns };
}

function buildFromAliases(
  rows: readonly RawRow[],
  headerIndex: number,
  columns: ColumnMap,
  currency: Currency,
): ParsedStatement {
  const body = rows.slice(headerIndex + 1);
  const order = resolveDateOrder(body.map((row) => row[columns.date]));
  const occurrences = new OccurrenceCounter();
  const out: StatementRow[] = [];
  const problems: StatementProblem[] = [];

  body.forEach((row, offset) => {
    const rowIndex = headerIndex + 1 + offset;
    // A wholly blank line is a separator, not a failure; a statement export is
    // full of them and listing 40 "blank row" problems would bury the real ones.
    if (row.every(isBlank)) return;

    const date = readDate(row[columns.date], order);
    const description = columns.description >= 0 ? text(row[columns.description]) : "";
    const debit = columns.debit >= 0 ? readAmount(row[columns.debit], currency) : null;
    const credit = columns.credit >= 0 ? readAmount(row[columns.credit], currency) : null;
    const signed = columns.amount >= 0 ? readAmount(row[columns.amount], currency) : null;

    if (!date) {
      problems.push({ rowIndex, reason: "No readable date", raw: joinRow(row) });
      return;
    }
    if (description === "") {
      problems.push({ rowIndex, reason: "No description", raw: joinRow(row) });
      return;
    }

    // `??`, not `||`. v1 wrote `debit || credit || signed`, so a debit column
    // holding an exact zero fell through to the credit column and the row came
    // out as a deposit. Zero and absent are different facts.
    const chosen =
      debit?.amount != null
        ? { amount: debit.amount, direction: "DEBIT" as StatementDirection }
        : credit?.amount != null
          ? { amount: credit.amount, direction: "CREDIT" as StatementDirection }
          : signed?.amount != null
            ? { amount: signed.amount, direction: directionFromSigned(row, columns, signed) }
            : null;

    if (!chosen) {
      problems.push({ rowIndex, reason: "No amount in any amount column", raw: joinRow(row) });
      return;
    }
    if (chosen.amount.isZero) {
      problems.push({ rowIndex, reason: "Amount is zero", raw: joinRow(row) });
      return;
    }

    const reference = columns.reference >= 0 ? text(row[columns.reference]) : "";
    const balance = columns.balance >= 0 ? readAmount(row[columns.balance], currency) : null;

    out.push({
      rowIndex,
      date,
      description,
      reference: reference === "" ? null : reference,
      amount: chosen.amount,
      direction: chosen.direction,
      balanceAfter: signedBalance(balance),
      occurrence: occurrences.next([
        date.toISO(),
        chosen.amount.toDecimalString(),
        chosen.direction,
        description.toLowerCase(),
        reference.toLowerCase(),
      ]),
    });
  });

  return { rows: out, currency, layout: "HEADER_ALIAS", dateOrder: order, problems };
}

/** A single amount column needs a `Dr/Cr` marker or a sign to be readable. */
function directionFromSigned(
  row: RawRow,
  columns: ColumnMap,
  signed: AmountCell,
): StatementDirection {
  const marker = columns.type >= 0 ? normalizeHeader(row[columns.type]) : "";
  if (marker.includes("dr") || marker.includes("debit") || marker.includes("withdraw")) return "DEBIT";
  if (marker.includes("cr") || marker.includes("credit") || marker.includes("deposit")) return "CREDIT";
  return signed.negative ? "DEBIT" : "CREDIT";
}

function signedBalance(cell: AmountCell | null): Money | null {
  if (!cell?.amount) return null;
  // An overdrawn account prints its balance as `(1,200.00)` or `-1200.00`; keeping
  // the sign is what lets the balance-continuity check work on such a statement.
  return cell.negative ? cell.amount.negated() : cell.amount;
}

function joinRow(row: RawRow): string {
  return row.map((cell) => text(cell)).join(" | ");
}

/* ═══ Path 2: infer the columns from the data ═════════════════════════ */

/**
 * Header-agnostic fallback, ported from v1 with the arithmetic made exact.
 *
 * The insight worth keeping: a running balance is the column whose row-to-row
 * change equals plus-or-minus another column's value. That relationship is what
 * separates a balance from an amount when both columns are fully populated, and
 * it is decided here by exact `Money` subtraction rather than by `Math.abs(d - a)
 * < 0.5` — the float tolerance v1 needed, which would accept a 49-paise
 * disagreement as a match.
 */
function inferByContent(rows: readonly RawRow[], currency: Currency): ParsedStatement {
  const width = Math.max(0, ...rows.map((row) => row.length));
  if (width === 0) throw new StatementParseError("The file has no columns.");

  const dateHits = new Array<number>(width).fill(0);
  const textLength = new Array<number>(width).fill(0);
  for (const row of rows) {
    for (let column = 0; column < width; column += 1) {
      const cell = row[column];
      if (looksDate(cell)) dateHits[column] += 1;
      else if (!looksNumeric(cell) && !isBlank(cell)) textLength[column] += text(cell).length;
    }
  }

  const dateColumn = dateHits.indexOf(Math.max(...dateHits));
  if (dateColumn < 0 || dateHits[dateColumn] < 2) {
    throw new StatementParseError(
      "Could not find a date column. Export the statement with a date column.",
    );
  }

  const dataRows = rows
    .map((row, rowIndex) => ({ row, rowIndex }))
    .filter((entry) => looksDate(entry.row[dateColumn]));
  if (dataRows.length === 0) throw new StatementParseError("No transaction rows were found.");

  const order = resolveDateOrder(dataRows.map((entry) => entry.row[dateColumn]));

  /*
   * A numeric column is one that holds numbers and blanks — not one that is
   * mostly numbers.
   *
   * v1 required a column to be numeric on at least 30% of rows, which quietly
   * disqualifies the credit column of an ordinary salaried statement: one salary
   * credit among a hundred debits is 1%. The column would then be dropped, the
   * debit/credit vote would be left with one amount column, and every credit in
   * the file would be read as a debit. Purity plus a small text tolerance (for a
   * stray "NIL") identifies the same columns without that cliff.
   */
  const numericColumns: number[] = [];
  for (let column = 0; column < width; column += 1) {
    if (column === dateColumn) continue;
    const numeric = dataRows.filter((entry) => looksNumeric(entry.row[column])).length;
    const textish = dataRows.filter(
      (entry) => !isBlank(entry.row[column]) && !looksNumeric(entry.row[column]),
    ).length;
    if (numeric >= 1 && textish <= dataRows.length * 0.1) numericColumns.push(column);
  }

  const amountAt = (row: RawRow, column: number): Money | null =>
    readAmount(row[column], currency).amount;

  /** How often `balanceColumn`'s delta equals ±`amountColumn` — exactly. */
  const continuityScore = (balanceColumn: number, amountColumn: number): number => {
    let previous: Money | null = null;
    let hits = 0;
    for (const { row } of dataRows) {
      const balance = amountAt(row, balanceColumn);
      const amount = amountAt(row, amountColumn);
      if (balance && previous && amount && !isBlank(row[amountColumn])) {
        const delta = balance.minus(previous);
        if (delta.abs().equals(amount)) hits += 1;
      }
      if (balance) previous = balance;
    }
    return hits;
  };

  const fullColumns = numericColumns.filter(
    (column) =>
      dataRows.filter((entry) => looksNumeric(entry.row[column])).length >= dataRows.length * 0.9,
  );

  let balanceColumn = -1;
  if (fullColumns.length === 1) {
    balanceColumn = fullColumns[0];
  } else if (fullColumns.length > 1) {
    balanceColumn = fullColumns
      .map((column) => ({
        column,
        score: Math.max(
          0,
          ...numericColumns.filter((other) => other !== column).map((other) => continuityScore(column, other)),
        ),
        distinct: new Set(
          dataRows.map((entry) => amountAt(entry.row, column)?.toDecimalString() ?? ""),
        ).size,
      }))
      .sort((a, b) => b.score - a.score || b.distinct - a.distinct)[0].column;
  }

  const candidateAmountColumns = numericColumns.filter((column) => column !== balanceColumn);

  /*
   * A debit/credit pair is inherently sparse — a row is one or the other, never
   * both — so when two or more sparse columns exist, the fully-populated ones are
   * not amounts. This is a correction to v1, which kept every numeric column and
   * therefore let a serial-number column ("Sl", 1..n) win the credit vote: the
   * salary row in `tests/statements.spec.ts` came out as ₹3.00, its row number.
   * The guard is conditional because a single-amount-column layout IS fully
   * populated, and that layout still has to work.
   */
  const sparseAmountColumns = candidateAmountColumns.filter(
    (column) =>
      dataRows.filter((entry) => looksNumeric(entry.row[column])).length < dataRows.length * 0.9,
  );
  const amountColumns =
    sparseAmountColumns.length >= 2 ? sparseAmountColumns : candidateAmountColumns;

  const descriptionColumn = textLength.indexOf(Math.max(...textLength));
  if (descriptionColumn < 0 || textLength[descriptionColumn] === 0) {
    throw new StatementParseError("Could not find a description column.");
  }

  // Which amount column is credit and which debit, voted on by the direction the
  // balance moved on the rows where each is populated.
  let creditColumn = -1;
  let debitColumn = -1;
  if (amountColumns.length >= 2 && balanceColumn >= 0) {
    const votes = new Map<number, number>();
    let previous: Money | null = null;
    for (const { row } of dataRows) {
      const balance = amountAt(row, balanceColumn);
      if (balance && previous) {
        const up = balance.isGreaterThan(previous);
        for (const column of amountColumns) {
          if (looksNumeric(row[column])) votes.set(column, (votes.get(column) ?? 0) + (up ? 1 : -1));
        }
      }
      if (balance) previous = balance;
    }
    const ranked = [...amountColumns].sort((a, b) => (votes.get(b) ?? 0) - (votes.get(a) ?? 0));
    creditColumn = ranked[0];
    debitColumn = ranked[ranked.length - 1];
  }

  const occurrences = new OccurrenceCounter();
  const out: StatementRow[] = [];
  const problems: StatementProblem[] = [];
  let previousBalance: Money | null = null;

  for (const { row, rowIndex } of dataRows) {
    const date = readDate(row[dateColumn], order);
    const description = text(row[descriptionColumn]);
    const balance = balanceColumn >= 0 ? signedBalance(readAmount(row[balanceColumn], currency)) : null;

    if (!date || description === "") {
      problems.push({
        rowIndex,
        reason: !date ? "No readable date" : "No description",
        raw: joinRow(row),
      });
      if (balance) previousBalance = balance;
      continue;
    }

    let amount: Money | null = null;
    let direction: StatementDirection | null = null;

    if (debitColumn >= 0 && creditColumn >= 0) {
      const debit = readAmount(row[debitColumn], currency);
      const credit = readAmount(row[creditColumn], currency);
      if (debit.amount) {
        amount = debit.amount;
        direction = "DEBIT";
      } else if (credit.amount) {
        amount = credit.amount;
        direction = "CREDIT";
      }
    } else if (amountColumns.length >= 1) {
      const cell = readAmount(row[amountColumns[0]], currency);
      if (cell.amount) {
        amount = cell.amount;
        direction = cell.negative
          ? "DEBIT"
          : balance && previousBalance
            ? balance.isGreaterThanOrEqual(previousBalance)
              ? "CREDIT"
              : "DEBIT"
            : "CREDIT";
      }
    }

    if (balance) previousBalance = balance;

    if (!amount || amount.isZero || !direction) {
      problems.push({ rowIndex, reason: "No usable amount", raw: joinRow(row) });
      continue;
    }

    out.push({
      rowIndex,
      date,
      description,
      reference: null,
      amount,
      direction,
      balanceAfter: balance,
      occurrence: occurrences.next([
        date.toISO(),
        amount.toDecimalString(),
        direction,
        description.toLowerCase(),
      ]),
    });
  }

  return { rows: out, currency, layout: "INFERRED", dateOrder: order, problems };
}

/* ═══ Entry points ════════════════════════════════════════════════════ */

/**
 * Parses already-tabulated rows: the alias path first, content inference second.
 *
 * The alias result is used only if it produced rows — a header row that matched
 * but whose body is laid out differently should fall through rather than report
 * an empty statement.
 */
export function parseStatementRows(
  rows: readonly RawRow[],
  currency: Currency = Currency.reporting,
): ParsedStatement {
  const aliased = detectByAliases(rows);
  if (aliased) {
    const parsed = buildFromAliases(rows, aliased.headerIndex, aliased.columns, currency);
    if (parsed.rows.length > 0) return parsed;
  }
  return inferByContent(rows, currency);
}

/** Splits one delimited line, honouring `""`-escaped quotes. */
export function splitDelimitedLine(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"' && line[index + 1] === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === delimiter && !quoted) {
      cells.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  cells.push(current);
  return cells;
}

/** Guesses the delimiter from whichever splits the first ten lines most. */
export function parseDelimitedText(content: string): RawRow[] {
  const lines = content
    .replace(/^﻿/, "")
    .split(/\r?\n/)
    .filter((line) => line.trim() !== "");
  const sample = lines.slice(0, 10).join("\n");
  const delimiter = [",", "\t", ";", "|"].sort(
    (a, b) => sample.split(b).length - sample.split(a).length,
  )[0];
  return lines.map((line) => splitDelimitedLine(line, delimiter));
}

/** OFX/QFX: one `STMTTRN` block per movement, with the sign carrying direction. */
export function parseOfx(content: string, currency: Currency = Currency.reporting): ParsedStatement {
  const declared = /<CURDEF>([^<\r\n]+)/i.exec(content)?.[1]?.trim();
  const resolved = declared ? safeCurrency(declared, currency) : currency;

  const occurrences = new OccurrenceCounter();
  const rows: StatementRow[] = [];
  const problems: StatementProblem[] = [];

  const blocks = [...content.matchAll(/<STMTTRN>([\s\S]*?)(?:<\/STMTTRN>|(?=<STMTTRN>)|$)/gi)];
  blocks.forEach((match, rowIndex) => {
    const block = match[1];
    const tag = (name: string) =>
      new RegExp(`<${name}>([^<\\r\\n]+)`, "i").exec(block)?.[1]?.trim() ?? "";

    const posted = tag("DTPOSTED").slice(0, 8);
    const raw = tag("TRNAMT");
    if (!/^\d{8}$/.test(posted)) {
      problems.push({ rowIndex, reason: "DTPOSTED is not YYYYMMDD", raw: block.trim() });
      return;
    }
    const cell = readAmount(raw, resolved);
    if (!cell.amount || cell.amount.isZero) {
      problems.push({ rowIndex, reason: "TRNAMT is missing or zero", raw: block.trim() });
      return;
    }

    const date = safeDate(
      Number(posted.slice(0, 4)),
      Number(posted.slice(4, 6)),
      Number(posted.slice(6, 8)),
    );
    if (!date) {
      problems.push({ rowIndex, reason: "DTPOSTED is not a real date", raw: block.trim() });
      return;
    }

    const description = tag("MEMO") || tag("NAME") || "Bank transaction";
    const fitId = tag("FITID");
    rows.push({
      rowIndex,
      date,
      description,
      reference: fitId === "" ? null : fitId,
      amount: cell.amount,
      direction: cell.negative ? "DEBIT" : "CREDIT",
      balanceAfter: null,
      occurrence: occurrences.next([
        date.toISO(),
        cell.amount.toDecimalString(),
        cell.negative ? "DEBIT" : "CREDIT",
        description.toLowerCase(),
        fitId.toLowerCase(),
      ]),
    });
  });

  return { rows, currency: resolved, layout: "OFX", dateOrder: "DMY", problems };
}

function safeCurrency(code: string, fallback: Currency): Currency {
  try {
    return Currency.of(code);
  } catch {
    return fallback;
  }
}

/**
 * Balance continuity: does each printed balance equal the one before it plus the
 * movement on that row?
 *
 * Only meaningful because the amounts are exact. It is the cheapest possible
 * proof that the column detection was right — if the debit and credit columns had
 * been swapped, every row after the first would fail — and the plan's "three real
 * bank statements round-trip with every amount exact" is asserted with it rather
 * than by eyeballing totals.
 */
export function checkBalanceContinuity(rows: readonly StatementRow[]): {
  checked: number;
  breaks: readonly { rowIndex: number; expected: Money; printed: Money }[];
} {
  const breaks: { rowIndex: number; expected: Money; printed: Money }[] = [];
  let checked = 0;
  let previous: Money | null = null;

  for (const row of rows) {
    if (row.balanceAfter && previous) {
      const movement = row.direction === "DEBIT" ? row.amount.negated() : row.amount;
      const expected: Money = previous.plus(movement);
      checked += 1;
      if (!expected.equals(row.balanceAfter)) {
        breaks.push({ rowIndex: row.rowIndex, expected, printed: row.balanceAfter });
      }
    }
    if (row.balanceAfter) previous = row.balanceAfter;
  }

  return { checked, breaks };
}

/**
 * Reads an uploaded file. `exceljs` is imported lazily so the spreadsheet reader
 * is not in the bundle of every page that merely links to the import screen.
 */
export async function parseStatementFile(
  file: File,
  currency: Currency = Currency.reporting,
): Promise<ParsedStatement> {
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";

  if (["ofx", "qfx"].includes(extension)) return parseOfx(await file.text(), currency);
  if (["csv", "tsv", "txt"].includes(extension)) {
    return parseStatementRows(parseDelimitedText(await file.text()), currency);
  }
  if (["xlsx", "xls"].includes(extension)) {
    const ExcelJS = (await import("exceljs")).default;
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await file.arrayBuffer());
    const sheet = workbook.worksheets[0];
    if (!sheet) throw new StatementParseError("The workbook has no sheets.");
    const rows: RawRow[] = [];
    // `row.values` is 1-based with a leading hole.
    sheet.eachRow((row) => rows.push((row.values as Cell[]).slice(1)));
    return parseStatementRows(rows, currency);
  }

  throw new StatementParseError("Supported files: CSV, TSV, XLSX, XLS, OFX and QFX.");
}

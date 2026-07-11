import type { ParsedStatementRow, TransactionDirection } from "./transaction.types";

type Cell = string | number | Date | null | undefined;
type RawRow = Cell[];

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

const normalize = (value: Cell) => String(value ?? "").trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
const numberValue = (value: Cell): number | null => {
  if (typeof value === "number") return Number.isFinite(value) ? Math.abs(value) : null;
  const cleaned = String(value ?? "").replace(/[₹$€£,\s]/g, "").replace(/^\((.*)\)$/, "-$1");
  const parsed = Number.parseFloat(cleaned);
  return Number.isFinite(parsed) ? Math.abs(parsed) : null;
};

function isoDate(value: Cell): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  if (typeof value === "number" && value > 20000) return new Date(Date.UTC(1899, 11, 30 + value)).toISOString();
  const text = String(value ?? "").trim();
  const indian = text.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})/);
  if (indian) {
    const year = indian[3].length === 2 ? 2000 + Number(indian[3]) : Number(indian[3]);
    const date = new Date(Date.UTC(year, Number(indian[2]) - 1, Number(indian[1])));
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  const timestamp = Date.parse(text);
  return Number.isNaN(timestamp) ? null : new Date(timestamp).toISOString();
}

function findColumn(headers: string[], aliases: readonly string[]) {
  return headers.findIndex((header) => aliases.includes(header) || aliases.some((alias) => header.includes(alias)));
}

type ColumnMap = Record<keyof typeof HEADER_ALIASES, number>;

/** Whole-cell numeric test (so a date like "20-05-2025" isn't seen as the number 20). */
const looksNumeric = (cell: Cell): boolean => {
  if (typeof cell === "number") return Number.isFinite(cell);
  const t = String(cell ?? "").trim();
  return t !== "" && /^[₹$€£]?\s*-?\(?[\d,]+(\.\d+)?\)?$/.test(t.replace(/\s/g, ""));
};
/** Whole-cell date test (dd/mm/yyyy, dd-mm-yyyy or ISO yyyy-mm-dd). */
const looksDate = (cell: Cell): boolean => {
  if (cell instanceof Date) return !Number.isNaN(cell.getTime());
  const t = String(cell ?? "").trim();
  return /^\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}/.test(t) || /^\d{4}-\d{2}-\d{2}/.test(t);
};
const isBlank = (cell: Cell) => String(cell ?? "").trim() === "";

/** Locate the header row + column map from known aliases; null if it can't. */
function detectByAliases(rawRows: RawRow[]): { headerIndex: number; col: ColumnMap } | null {
  const headerIndex = rawRows.findIndex((row) => {
    const cells = row.map(normalize);
    return cells.some((cell) => HEADER_ALIASES.date.includes(cell as never)) && cells.some((cell) => [...HEADER_ALIASES.description, ...HEADER_ALIASES.debit, ...HEADER_ALIASES.credit, ...HEADER_ALIASES.amount].some((alias) => cell.includes(alias)));
  });
  if (headerIndex < 0) return null;
  const headers = rawRows[headerIndex].map(normalize);
  const col = Object.fromEntries(Object.entries(HEADER_ALIASES).map(([key, aliases]) => [key, findColumn(headers, aliases)])) as ColumnMap;
  if (col.date < 0 || col.description < 0 || (col.amount < 0 && col.debit < 0 && col.credit < 0)) return null;
  return { headerIndex, col };
}

/** Build normalized rows from a resolved column map (alias path). */
function buildRows(rawRows: RawRow[], headerIndex: number, col: ColumnMap, currency: string): ParsedStatementRow[] {
  const occurrence = new Map<string, number>();
  return rawRows.slice(headerIndex + 1).flatMap((row) => {
    const date = isoDate(row[col.date]);
    const description = String(row[col.description] ?? "").trim();
    const debit = col.debit >= 0 ? numberValue(row[col.debit]) : null;
    const credit = col.credit >= 0 ? numberValue(row[col.credit]) : null;
    const signedRaw = col.amount >= 0 ? Number.parseFloat(String(row[col.amount] ?? "").replace(/[₹$€£,\s]/g, "")) : Number.NaN;
    const amount = debit || credit || (Number.isFinite(signedRaw) ? Math.abs(signedRaw) : null);
    if (!date || !description || !amount) return [];
    const typeCell = col.type >= 0 ? normalize(row[col.type]) : "";
    const direction: TransactionDirection = debit ? "DEBIT" : credit ? "CREDIT" : typeCell.includes("dr") || typeCell.includes("debit") || signedRaw < 0 ? "DEBIT" : "CREDIT";
    const reference = col.reference >= 0 ? String(row[col.reference] ?? "").trim() : "";
    const key = `${date.slice(0, 10)}|${amount.toFixed(2)}|${direction}|${description.toLowerCase()}|${reference.toLowerCase()}`;
    const count = occurrence.get(key) ?? 0; occurrence.set(key, count + 1);
    return [{ transactionDate: date, description, reference: reference || null, amount, direction, balanceAfter: col.balance >= 0 ? numberValue(row[col.balance]) : null, currency, occurrence: count }];
  });
}

/**
 * Header-agnostic fallback. Infers columns from the DATA rather than column
 * names, so any bank's layout works without an alias for it:
 *  - date column = the one whose cells parse as dates,
 *  - numeric columns = detected by content; the fully-populated one that varies
 *    the most is the running balance, sparse ones are debit/credit,
 *  - debit vs credit is decided by whether the balance went UP or DOWN — no need
 *    to know which column is which,
 *  - description = the widest free-text column.
 */
function inferByContent(rawRows: RawRow[], currency: string): ParsedStatementRow[] {
  const width = Math.max(0, ...rawRows.map((r) => r.length));
  if (width === 0) return [];

  // Per-column tallies across every row.
  const dateHits = new Array(width).fill(0);
  const numHits = new Array(width).fill(0);
  const textLen = new Array(width).fill(0);
  for (const row of rawRows) {
    for (let c = 0; c < width; c += 1) {
      const cell = row[c];
      if (looksDate(cell)) dateHits[c] += 1;
      else if (looksNumeric(cell)) numHits[c] += 1;
      else if (!isBlank(cell)) textLen[c] += String(cell).trim().length;
    }
  }

  const dateCol = dateHits.indexOf(Math.max(...dateHits));
  if (dateCol < 0 || dateHits[dateCol] < 2) throw new Error("Could not find a date column. Export the statement with a date column.");

  // Data rows = those with a real date in the date column.
  const dataRows = rawRows.filter((r) => looksDate(r[dateCol]));
  if (dataRows.length < 1) throw new Error("No transaction rows were found.");

  // Numeric columns (exclude the date column).
  const numericCols: number[] = [];
  for (let c = 0; c < width; c += 1) {
    if (c === dateCol) continue;
    const filledNumeric = dataRows.filter((r) => looksNumeric(r[c])).length;
    if (filledNumeric >= Math.max(1, dataRows.length * 0.3)) numericCols.push(c);
  }
  // A running balance is the column whose row-to-row change equals ± another
  // column's value. Score each candidate against that relationship to tell a
  // balance apart from an amount column (both can be fully populated).
  const matchScore = (balC: number, amtC: number): number => {
    let prev: number | null = null, hits = 0;
    for (const r of dataRows) {
      const b = numberValue(r[balC]);
      const a = numberValue(r[amtC]);
      if (b != null && prev != null && a != null && !isBlank(r[amtC])) {
        const d = b - prev;
        if (Math.abs(d - a) < 0.5 || Math.abs(d + a) < 0.5) hits += 1;
      }
      if (b != null) prev = b;
    }
    return hits;
  };
  const fullCols = numericCols.filter((c) => dataRows.filter((r) => looksNumeric(r[c])).length >= dataRows.length * 0.9);
  let balanceCol = -1;
  if (fullCols.length === 1) {
    balanceCol = fullCols[0];
  } else if (fullCols.length > 1) {
    balanceCol = fullCols
      .map((c) => ({
        c,
        score: Math.max(0, ...numericCols.filter((a) => a !== c).map((a) => matchScore(c, a))),
        distinct: new Set(dataRows.map((r) => numberValue(r[c]))).size,
      }))
      .sort((a, b) => b.score - a.score || b.distinct - a.distinct)[0].c;
  }
  const amountCols = numericCols.filter((c) => c !== balanceCol);

  // Description = widest free-text column.
  const descCol = textLen.indexOf(Math.max(...textLen));
  if (descCol < 0) throw new Error("Could not find a description column.");

  // Decide which amount column is credit vs debit by voting against the balance
  // movement (balance up on the row ⇒ that filled column is a credit).
  let creditCol = -1, debitCol = -1;
  if (amountCols.length >= 2 && balanceCol >= 0) {
    const score = new Map<number, number>(); // +ve ⇒ behaves like credit
    let prev: number | null = null;
    for (const r of dataRows) {
      const bal = numberValue(r[balanceCol]);
      if (bal != null && prev != null) {
        const up = bal > prev;
        for (const c of amountCols) if (looksNumeric(r[c])) score.set(c, (score.get(c) ?? 0) + (up ? 1 : -1));
      }
      if (bal != null) prev = bal;
    }
    const ranked = amountCols.slice().sort((a, b) => (score.get(b) ?? 0) - (score.get(a) ?? 0));
    creditCol = ranked[0]; debitCol = ranked[ranked.length - 1];
  }

  const occurrence = new Map<string, number>();
  let prevBal: number | null = null;
  const out: ParsedStatementRow[] = [];
  for (const row of dataRows) {
    const date = isoDate(row[dateCol]);
    const description = String(row[descCol] ?? "").trim();
    if (!date || !description) { continue; }
    const bal = balanceCol >= 0 ? numberValue(row[balanceCol]) : null;

    let amount: number | null = null;
    let direction: TransactionDirection | null = null;
    if (debitCol >= 0 && creditCol >= 0) {
      const dr = numberValue(row[debitCol]);
      const cr = numberValue(row[creditCol]);
      if (dr != null && !isBlank(row[debitCol])) { amount = dr; direction = "DEBIT"; }
      else if (cr != null && !isBlank(row[creditCol])) { amount = cr; direction = "CREDIT"; }
    } else if (amountCols.length >= 1) {
      // Single amount column: sign or balance movement gives direction.
      const a = numberValue(row[amountCols[0]]);
      if (a != null) {
        amount = a;
        const rawText = String(row[amountCols[0]] ?? "").trim();
        const negative = /^\(.*\)$/.test(rawText) || rawText.startsWith("-");
        direction = negative ? "DEBIT" : bal != null && prevBal != null ? (bal >= prevBal ? "CREDIT" : "DEBIT") : "CREDIT";
      }
    }
    if (bal != null) prevBal = bal;
    if (amount == null || amount === 0 || !direction) continue;

    const key = `${date.slice(0, 10)}|${amount.toFixed(2)}|${direction}|${description.toLowerCase()}`;
    const count = occurrence.get(key) ?? 0; occurrence.set(key, count + 1);
    out.push({ transactionDate: date, description, reference: null, amount, direction, balanceAfter: bal, currency, occurrence: count });
  }
  return out;
}

export function normalizeStatementRows(rawRows: RawRow[], currency = "INR"): ParsedStatementRow[] {
  // Fast path: recognized column headers.
  const aliased = detectByAliases(rawRows);
  if (aliased) {
    const rows = buildRows(rawRows, aliased.headerIndex, aliased.col, currency);
    if (rows.length) return rows;
  }
  // Fallback: infer columns from the data itself (works for any bank layout).
  return inferByContent(rawRows, currency);
}

function splitDelimitedLine(line: string, delimiter: string): string[] {
  const cells: string[] = []; let current = ""; let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"' && line[index + 1] === '"') { current += '"'; index += 1; }
    else if (char === '"') quoted = !quoted;
    else if (char === delimiter && !quoted) { cells.push(current); current = ""; }
    else current += char;
  }
  cells.push(current); return cells;
}

function parseDelimited(text: string): RawRow[] {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim());
  const sample = lines.slice(0, 10).join("\n");
  const delimiter = [",", "\t", ";", "|"].sort((a, b) => sample.split(b).length - sample.split(a).length)[0];
  return lines.map((line) => splitDelimitedLine(line, delimiter));
}

function parseOfx(text: string, currency: string): ParsedStatementRow[] {
  const detectedCurrency = text.match(/<CURDEF>([^<\r\n]+)/i)?.[1]?.trim() || currency;
  return [...text.matchAll(/<STMTTRN>([\s\S]*?)(?:<\/STMTTRN>|(?=<STMTTRN>)|$)/gi)].flatMap((match, occurrence) => {
    const block = match[1]; const get = (tag: string) => block.match(new RegExp(`<${tag}>([^<\\r\\n]+)`, "i"))?.[1]?.trim() || "";
    const rawDate = get("DTPOSTED").slice(0, 8); const amount = Number.parseFloat(get("TRNAMT"));
    if (!/^\d{8}$/.test(rawDate) || !Number.isFinite(amount)) return [];
    return [{ transactionDate: `${rawDate.slice(0, 4)}-${rawDate.slice(4, 6)}-${rawDate.slice(6, 8)}T00:00:00.000Z`, description: get("MEMO") || get("NAME") || "Bank transaction", reference: get("FITID") || null, amount: Math.abs(amount), direction: amount < 0 ? "DEBIT" : "CREDIT", currency: detectedCurrency, occurrence } as ParsedStatementRow];
  });
}

export async function parseStatementFile(file: File, currency = "INR"): Promise<ParsedStatementRow[]> {
  const extension = file.name.split(".").pop()?.toLowerCase();
  if (["ofx", "qfx"].includes(extension || "")) return parseOfx(await file.text(), currency);
  if (["csv", "tsv", "txt"].includes(extension || "")) return normalizeStatementRows(parseDelimited(await file.text()), currency);
  if (["xlsx", "xls"].includes(extension || "")) {
    const ExcelJS = (await import("exceljs")).default;
    const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(await file.arrayBuffer());
    const sheet = workbook.worksheets[0];
    const rows: RawRow[] = [];
    sheet.eachRow((row) => rows.push((row.values as Cell[]).slice(1)));
    return normalizeStatementRows(rows, currency);
  }
  throw new Error("Supported files: CSV, TSV, XLSX, XLS, OFX and QFX.");
}

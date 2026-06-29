import type { ParsedStatementRow, TransactionDirection } from "./transaction.types";

type Cell = string | number | Date | null | undefined;
type RawRow = Cell[];

const HEADER_ALIASES = {
  date: ["date", "transaction date", "txn date", "value date", "posting date", "tran date"],
  description: ["description", "narration", "transaction details", "particulars", "remarks", "details"],
  reference: ["reference", "reference no", "ref no", "transaction id", "cheque no", "utr", "chq/ref no"],
  debit: ["debit", "withdrawal", "withdrawal amount", "debit amount", "dr amount"],
  credit: ["credit", "deposit", "deposit amount", "credit amount", "cr amount"],
  amount: ["amount", "transaction amount", "txn amount"],
  type: ["type", "dr/cr", "debit/credit", "transaction type"],
  balance: ["balance", "closing balance", "running balance", "available balance"],
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

export function normalizeStatementRows(rawRows: RawRow[], currency = "INR"): ParsedStatementRow[] {
  const headerIndex = rawRows.findIndex((row) => {
    const cells = row.map(normalize);
    return cells.some((cell) => HEADER_ALIASES.date.includes(cell as never)) && cells.some((cell) => [...HEADER_ALIASES.description, ...HEADER_ALIASES.debit, ...HEADER_ALIASES.credit, ...HEADER_ALIASES.amount].some((alias) => cell.includes(alias)));
  });
  if (headerIndex < 0) throw new Error("Could not identify the transaction table. Export a statement with column headers.");
  const headers = rawRows[headerIndex].map(normalize);
  const col = Object.fromEntries(Object.entries(HEADER_ALIASES).map(([key, aliases]) => [key, findColumn(headers, aliases)])) as Record<keyof typeof HEADER_ALIASES, number>;
  if (col.date < 0 || col.description < 0 || (col.amount < 0 && col.debit < 0 && col.credit < 0)) throw new Error("The statement needs date, description and amount/debit/credit columns.");

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

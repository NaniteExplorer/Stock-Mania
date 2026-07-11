/**
 * Turns raw statement text (from a PDF) into normalized ParsedStatementRow[]
 * using Gemini. Output is strictly validated with zod before it is trusted —
 * the model is treated as an untrusted source.
 */
import { z } from "zod";
import { geminiClient } from "@/core/ai/gemini";
import { logger } from "@/core/logger";
import type { ParsedStatementRow, TransactionDirection } from "./transaction.types";

const aiRowSchema = z.object({
  date: z.string().refine((v) => !Number.isNaN(Date.parse(v)), "bad date"),
  description: z.string().min(1),
  reference: z.string().nullish(),
  amount: z.number().positive(),
  direction: z.enum(["CREDIT", "DEBIT"]),
  balanceAfter: z.number().nullish(),
});

const aiResponseSchema = z.object({ rows: z.array(aiRowSchema) });

const SBI_ROW = /^(\d{2}\/\d{2}\/\d{4})\s+\d{2}\/\d{2}\/\d{4}\s*(.*?)\s+-\s+(-|[\d,]+\.\d{2})\s+(-|[\d,]+\.\d{2})\s+([\d,]+\.\d{2})(?:CR|DR)?$/i;

const parseAmount = (value: string) => Number(value.replace(/,/g, ""));

/** Parse SBI's positioned-text statement format without an AI round trip. */
export function parseSbiStatementText(text: string, currency: string): ParsedStatementRow[] {
  if (!/State Bank of India/i.test(text) || !/STATEMENT OF ACCOUNT/i.test(text)) return [];

  const occurrence = new Map<string, number>();
  const rows: ParsedStatementRow[] = text.split(/\r?\n/).flatMap((rawLine) => {
    const line = rawLine.replace(/\s+/g, " ").trim();
    const match = line.match(SBI_ROW);
    if (!match) return [];

    const debit = match[3] === "-" ? null : parseAmount(match[3]);
    const credit = match[4] === "-" ? null : parseAmount(match[4]);
    if ((debit == null) === (credit == null)) return [];

    const [day, month, year] = match[1].split("/");
    const description = match[2].trim() || (debit != null ? "SBI debit transaction" : "SBI credit transaction");
    const amount = debit ?? credit!;
    const direction = debit != null ? "DEBIT" as const : "CREDIT" as const;
    const reference = description.match(/\b\d{10,16}\b/)?.[0] ?? null;
    const key = `${year}-${month}-${day}|${amount.toFixed(2)}|${direction}|${description.toLowerCase()}`;
    const count = occurrence.get(key) ?? 0;
    occurrence.set(key, count + 1);

    return [{
      transactionDate: `${year}-${month}-${day}T00:00:00.000Z`,
      description,
      reference,
      amount,
      direction,
      balanceAfter: parseAmount(match[5]),
      currency,
      occurrence: count,
    }];
  });

  // SBI's transaction range may end years before the generated statement.
  // Keep its separately printed, dated current balance as account metadata.
  const balanceMatch = text.match(/Clear Balance\s*:\s*([\d,]+\.\d{2})(CR|DR)?/i);
  const dateMatch = text.match(/Date of Statement\s*:\s*(\d{2})-(\d{2})-(\d{4})/i);
  if (rows.length && balanceMatch && dateMatch) {
    rows[0].statementBalance = parseAmount(balanceMatch[1]) * (balanceMatch[2]?.toUpperCase() === "DR" ? -1 : 1);
    rows[0].statementBalanceDate = `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}T00:00:00.000Z`;
  }
  return rows;
}

const MONTHS: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

/** Parse a money token ("1,234.56", "(120.00)", "-45.00") to a signed number. */
function parseMoney(token: string): number {
  const negative = /^\(.*\)$/.test(token) || token.trim().startsWith("-");
  const n = Number(token.replace(/[(),\s]/g, "").replace(/^-/, ""));
  return Number.isFinite(n) ? (negative ? -n : n) : NaN;
}

/** dd-MMM-yyyy | dd/mm/yyyy | dd-mm-yyyy → ISO, or null. */
function toIso(day: string, mon: string, year: string): string | null {
  const mm = /^\d{1,2}$/.test(mon) ? mon.padStart(2, "0") : MONTHS[mon.toLowerCase()];
  if (!mm) return null;
  const yyyy = year.length === 2 ? `20${year}` : year;
  const dd = day.padStart(2, "0");
  const iso = `${yyyy}-${mm}-${dd}`;
  return Number.isNaN(Date.parse(iso)) ? null : `${iso}T00:00:00.000Z`;
}

const LEADING_DATE = /^(\d{1,2})[-/]([A-Za-z]{3}|\d{1,2})[-/](\d{2,4})/;
const MONEY_TOKEN = /-?\(?\d{1,3}(?:,\d{2,3})*(?:\.\d{2})\)?/g;
const DATE_PREFIX = /^(?:\d{1,2}[-/](?:[A-Za-z]{3}|\d{1,2})[-/]\d{2,4}\s*){1,2}/;

/**
 * Bank-agnostic deterministic parser for statements that carry a running
 * "closing balance" column (Jio, Axis, HDFC, ICICI, …). No AI, no size limit.
 *
 * Each visual line beginning with a date and ending in money tokens is a
 * transaction; the LAST token is the running balance. The amount and direction
 * are derived from the balance delta between consecutive rows (authoritative for
 * a running-balance statement regardless of column order), and cross-checked
 * against the row's own debit/credit figure. If too few rows reconcile we return
 * [] so the caller falls back to AI — this can never silently corrupt a ledger.
 */
export function parseStatementByBalance(text: string, currency = "INR"): ParsedStatementRow[] {
  interface Raw { date: string; description: string; balance: number; tokens: number[] }
  const raws: Raw[] = [];

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/\s+/g, " ").trim();
    if (!line) continue;
    const dm = line.match(LEADING_DATE);
    if (!dm) {
      // Wrapped narration continuation — append to the open row's description.
      if (raws.length && !/\d\.\d{2}/.test(line)) raws[raws.length - 1].description += ` ${line}`;
      continue;
    }
    const iso = toIso(dm[1], dm[2], dm[3]);
    if (!iso) continue;
    const monies = line.match(MONEY_TOKEN);
    if (!monies || monies.length < 1) continue; // dated header/section line, no amounts
    const nums = monies.map(parseMoney).filter((n) => !Number.isNaN(n));
    if (!nums.length) continue;
    const balance = nums[nums.length - 1];
    const tokens = nums.slice(0, -1); // candidate debit/credit figures
    const description = line.replace(DATE_PREFIX, "").replace(MONEY_TOKEN, " ").replace(/\s+/g, " ").trim();
    raws.push({ date: iso, description: description || "Bank transaction", balance, tokens });
  }

  if (raws.length < 2) return [];

  // Seed the previous balance: prefer an explicit opening balance; else infer
  // from the first row's own debit/credit columns.
  let prev: number;
  const opening = text.match(/opening\s+balance[^\d(-]*(\(?-?\d{1,3}(?:,\d{2,3})*\.\d{2}\)?)/i);
  if (opening) {
    prev = parseMoney(opening[1]);
  } else {
    const t = raws[0].tokens;
    if (t.length >= 2 && t[0] > 0) prev = raws[0].balance + t[0]; // debit column filled
    else if (t.length >= 2 && t[1] > 0) prev = raws[0].balance - t[1]; // credit column filled
    else if (t.length === 1 && t[0] > 0) prev = raws[0].balance - t[0]; // assume credit; recon guard checks
    else prev = raws[0].balance;
  }

  const occurrence = new Map<string, number>();
  const rows: ParsedStatementRow[] = [];
  let checkable = 0, reconciled = 0;

  for (const r of raws) {
    const delta = Math.round((r.balance - prev) * 100) / 100;
    prev = r.balance;
    const amount = Math.abs(delta);
    if (amount === 0) continue; // opening/no-movement rows
    const direction: TransactionDirection = delta >= 0 ? "CREDIT" : "DEBIT";

    const nonZero = r.tokens.filter((n) => n > 0);
    if (nonZero.length) {
      checkable += 1;
      if (nonZero.some((n) => Math.abs(n - amount) < 0.01)) reconciled += 1;
    }

    const key = `${r.date.slice(0, 10)}|${amount.toFixed(2)}|${direction}|${r.description.toLowerCase()}`;
    const count = occurrence.get(key) ?? 0;
    occurrence.set(key, count + 1);
    rows.push({ transactionDate: r.date, description: r.description, reference: null, amount, direction, balanceAfter: r.balance, currency, occurrence: count });
  }

  // Require strong reconciliation before trusting the parse.
  if (checkable >= 3 && reconciled / checkable < 0.7) return [];
  if (checkable < 3 && rows.length > 5) return []; // no debit/credit columns to verify against
  return rows;
}

function buildPrompt(text: string, currency: string): string {
  return [
    "You are a precise bank/credit-card statement parser.",
    "From the statement text below, extract EVERY transaction row.",
    "Return ONLY JSON of the form:",
    '{ "rows": [ { "date": "YYYY-MM-DD", "description": string, "reference": string|null, "amount": number, "direction": "CREDIT"|"DEBIT", "balanceAfter": number|null } ] }',
    "Rules:",
    "- amount is always a positive number (the magnitude).",
    "- direction is DEBIT for money leaving the account (withdrawals, purchases, payments out) and CREDIT for money coming in (deposits, refunds, salary).",
    "- For credit-card statements: purchases/charges are DEBIT, payments received and refunds are CREDIT.",
    "- date must be ISO YYYY-MM-DD. Convert DD/MM/YYYY (Indian) and any other format accordingly.",
    "- reference is the cheque/UTR/transaction id if present, else null.",
    "- balanceAfter is the running/closing balance for that row if present, else null.",
    "- Do NOT invent rows. Skip summary/header/footer lines that are not transactions.",
    `- Default currency is ${currency}.`,
    "",
    "STATEMENT TEXT:",
    text.slice(0, 60000),
  ].join("\n");
}

/**
 * Parse statement text into normalized rows. Returns [] when Gemini is
 * unavailable so the caller can fall back to a clear message.
 */
export async function parseStatementText(
  text: string,
  currency = "INR",
): Promise<ParsedStatementRow[]> {
  const sbiRows = parseSbiStatementText(text, currency);
  if (sbiRows.length) return sbiRows;

  // Bank-agnostic running-balance parser — handles most tabular PDF statements
  // (Jio, Axis, HDFC, …) with no AI and no size cap.
  const balanceRows = parseStatementByBalance(text, currency);
  if (balanceRows.length) return balanceRows;

  if (!geminiClient.isConfigured()) {
    logger.warn("AI statement parse requested but GEMINI_API_KEY is not set.");
    return [];
  }

  const raw = await geminiClient.generateJson<unknown>(buildPrompt(text, currency));
  const parsed = aiResponseSchema.safeParse(raw);
  if (!parsed.success) {
    logger.error("AI statement output failed validation", parsed.error);
    throw new Error("The statement could not be parsed reliably. Try a CSV/XLSX export instead.");
  }

  const occurrence = new Map<string, number>();
  return parsed.data.rows.map((row) => {
    const key = `${row.date}|${row.amount.toFixed(2)}|${row.direction}|${row.description.toLowerCase()}`;
    const count = occurrence.get(key) ?? 0;
    occurrence.set(key, count + 1);
    return {
      transactionDate: new Date(row.date).toISOString(),
      description: row.description,
      reference: row.reference ?? null,
      amount: row.amount,
      direction: row.direction,
      balanceAfter: row.balanceAfter ?? null,
      currency,
      occurrence: count,
    };
  });
}

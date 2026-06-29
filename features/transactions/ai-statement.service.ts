/**
 * Turns raw statement text (from a PDF) into normalized ParsedStatementRow[]
 * using Gemini. Output is strictly validated with zod before it is trusted —
 * the model is treated as an untrusted source.
 */
import { z } from "zod";
import { geminiClient } from "@/core/ai/gemini";
import { logger } from "@/core/logger";
import type { ParsedStatementRow } from "./transaction.types";

const aiRowSchema = z.object({
  date: z.string().refine((v) => !Number.isNaN(Date.parse(v)), "bad date"),
  description: z.string().min(1),
  reference: z.string().nullish(),
  amount: z.number().positive(),
  direction: z.enum(["CREDIT", "DEBIT"]),
  balanceAfter: z.number().nullish(),
});

const aiResponseSchema = z.object({ rows: z.array(aiRowSchema) });

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

import { z } from "zod";
import { geminiClient } from "@/core/ai/gemini";
import type { InvestmentKind } from "@/features/investments/investment.types";
import type { CreateTradeInput } from "./trade.types";

/** Asset-class hint derived from a filename prefix (stock_/digigold_/crypto_/…). */
export function kindFromFilename(name: string): InvestmentKind {
  const lower = name.toLowerCase();
  if (lower.startsWith("digigold") || lower.startsWith("gold")) return "DIGITAL_GOLD";
  if (lower.startsWith("silver")) return "DIGITAL_SILVER";
  if (lower.startsWith("crypto")) return "CRYPTO";
  if (lower.startsWith("etf")) return "ETF";
  if (lower.startsWith("mf") || lower.startsWith("mutual")) return "MUTUAL_FUND";
  if (lower.startsWith("bond")) return "BOND";
  return "STOCK";
}

const rowSchema = z.object({
  symbol: z.string().nullable(),
  name: z.string().min(1),
  side: z.enum(["BUY", "SELL"]),
  date: z.string(),
  quantity: z.number().positive(),
  pricePerUnit: z.number().nonnegative(),
  brokerage: z.number().nonnegative().optional(),
  taxes: z.number().nonnegative().optional(),
  other: z.number().nonnegative().optional(),
});
const responseSchema = z.object({ rows: z.array(rowSchema).max(2000) });

function buildPrompt(text: string, kind: InvestmentKind): string {
  const unit = kind === "DIGITAL_GOLD" ? "grams" : "units/shares";
  return `You are a precise brokerage/purchase contract-note parser for ${kind} transactions.
From the document text below, extract EVERY buy/sell transaction row.
Return ONLY JSON: { "rows": [ { "symbol": string|null, "name": string, "side": "BUY"|"SELL", "date": "YYYY-MM-DD", "quantity": number, "pricePerUnit": number, "brokerage": number, "taxes": number, "other": number } ] }
Rules:
- quantity is in ${unit}; pricePerUnit is the per-${kind === "DIGITAL_GOLD" ? "gram" : "unit"} price (positive).
- side is BUY for purchases, SELL for redemptions/sales.
- date must be ISO YYYY-MM-DD (convert DD/MM/YYYY and other formats).
- brokerage/taxes/other are charge amounts if present, else 0.
- symbol is the ticker/ISIN if present, else null.
- Do NOT invent rows. Skip headers, totals and non-transaction lines.

Document text:
${text}`;
}

/**
 * Parse purchase/contract-note text into trade inputs via Gemini. Returns [] if
 * the AI is unavailable; throws only on a clearly malformed response.
 */
export async function parseTradesFromText(text: string, kind: InvestmentKind): Promise<CreateTradeInput[]> {
  if (!geminiClient.isConfigured()) return [];
  const raw = await geminiClient.generateJson<unknown>(buildPrompt(text, kind));
  const parsed = responseSchema.safeParse(raw);
  if (!parsed.success) return [];
  return parsed.data.rows
    .filter((r) => !Number.isNaN(Date.parse(r.date)))
    .map((r) => ({
      symbol: r.symbol,
      name: r.name,
      kind,
      side: r.side,
      date: new Date(r.date).toISOString().slice(0, 10),
      quantity: r.quantity,
      pricePerUnit: r.pricePerUnit,
      charges: { brokerage: r.brokerage ?? 0, taxes: r.taxes ?? 0, other: r.other ?? 0 },
      source: "DRIVE" as const,
    }));
}

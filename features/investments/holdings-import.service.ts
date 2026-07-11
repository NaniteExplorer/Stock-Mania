/**
 * Broker holdings import (INDmoney / Groww / Zerodha exports, etc.).
 *
 * No official APIs for INDmoney/Groww — users export holdings (CSV/XLSX/PDF)
 * and we map them to investments, upserting by symbol so re-imports refresh
 * quantities/prices instead of duplicating. CSV/XLSX are parsed
 * deterministically; PDF falls back to Gemini.
 */
import { z } from "zod";
import { geminiClient } from "@/core/ai/gemini";
import { logger } from "@/core/logger";
import { extractPdfText } from "@/features/transactions/pdf-parser";
import { investmentRepository } from "./investment.repository";
import type { CreateInvestmentInput, InvestmentKind } from "./investment.types";

export interface ParsedHolding {
  name: string;
  symbol: string | null;
  kind: InvestmentKind;
  units: number;
  avgCost: number;
  currentPrice: number;
}

export interface HoldingsImportResult {
  success: boolean;
  inserted: number;
  updated: number;
  rejected: number;
  error?: string;
}

const COLUMN_ALIASES = {
  symbol: ["symbol", "ticker", "tradingsymbol", "scrip", "instrument", "isin", "coin", "asset"],
  name: ["name", "company", "security", "instrument name", "scheme name", "stock name", "coin name"],
  units: ["quantity", "qty", "units", "shares", "holdings", "holding", "grams", "balance"],
  avgCost: ["avg cost", "average price", "buy avg", "avg price", "average cost", "buy average", "avg. cost", "avg buy price"],
  currentPrice: ["ltp", "last price", "current price", "market price", "nav", "cmp", "closing price", "rate"],
  kind: ["type", "asset type", "asset class", "category", "instrument type", "segment"],
} as const;

/**
 * Map a free-text asset-type label (from a "type" column) to an InvestmentKind.
 * Falls back to the caller's chosen kind when the label is missing/unknown.
 */
export function kindFromLabel(value: string, fallback: InvestmentKind): InvestmentKind {
  const v = value.toLowerCase();
  if (/crypto|coin|usdt|\bbtc\b|\beth\b/.test(v)) return "CRYPTO";
  if (/gold|silver|metal|bullion/.test(v)) return "DIGITAL_GOLD";
  if (/\betf\b/.test(v)) return "ETF";
  if (/mutual|\bmf\b|fund/.test(v)) return "MUTUAL_FUND";
  if (/bond|debenture|g-?sec/.test(v)) return "BOND";
  if (/commodit|\bmcx\b/.test(v)) return "COMMODITY";
  if (/stock|equity|share|scrip/.test(v)) return "STOCK";
  return fallback;
}

const normalize = (value: unknown) => String(value ?? "").trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
const num = (value: unknown): number => {
  const cleaned = String(value ?? "").replace(/[₹$€£,\s]/g, "");
  const parsed = Number.parseFloat(cleaned);
  return Number.isFinite(parsed) ? Math.abs(parsed) : 0;
};

function findColumn(headers: string[], aliases: readonly string[]) {
  return headers.findIndex((header) => aliases.includes(header) || aliases.some((alias) => header.includes(alias)));
}

function rowsToHoldings(rawRows: string[][], defaultKind: InvestmentKind = "STOCK"): ParsedHolding[] {
  const headerIndex = rawRows.findIndex((row) => {
    const cells = row.map(normalize);
    const hasName = cells.some((c) => [...COLUMN_ALIASES.symbol, ...COLUMN_ALIASES.name].some((a) => c.includes(a)));
    const hasQty = cells.some((c) => COLUMN_ALIASES.units.some((a) => c.includes(a)));
    return hasName && hasQty;
  });
  if (headerIndex < 0) throw new Error("Could not find a holdings table with name/symbol and quantity columns.");

  const headers = rawRows[headerIndex].map(normalize);
  const col = Object.fromEntries(
    Object.entries(COLUMN_ALIASES).map(([key, aliases]) => [key, findColumn(headers, aliases)]),
  ) as Record<keyof typeof COLUMN_ALIASES, number>;

  return rawRows.slice(headerIndex + 1).flatMap((row) => {
    const symbol = col.symbol >= 0 ? String(row[col.symbol] ?? "").trim() : "";
    const name = col.name >= 0 ? String(row[col.name] ?? "").trim() : symbol;
    const units = col.units >= 0 ? num(row[col.units]) : 0;
    if (!name && !symbol) return [];
    if (units <= 0) return [];
    // A "type" column (if present) wins per-row; otherwise the caller's chosen kind.
    const kind = col.kind >= 0 ? kindFromLabel(String(row[col.kind] ?? ""), defaultKind) : defaultKind;
    return [{
      name: name || symbol,
      symbol: symbol || null,
      kind,
      units,
      avgCost: col.avgCost >= 0 ? num(row[col.avgCost]) : 0,
      currentPrice: col.currentPrice >= 0 ? num(row[col.currentPrice]) : 0,
    }];
  });
}

function splitDelimited(text: string): string[][] {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((line) => line.trim());
  const sample = lines.slice(0, 10).join("\n");
  const delimiter = [",", "\t", ";", "|"].sort((a, b) => sample.split(b).length - sample.split(a).length)[0];
  return lines.map((line) => line.split(delimiter).map((cell) => cell.replace(/^"|"$/g, "").trim()));
}

const aiHoldingSchema = z.object({
  holdings: z.array(z.object({
    name: z.string().min(1),
    symbol: z.string().nullish(),
    units: z.number().positive(),
    avgCost: z.number().nonnegative(),
    currentPrice: z.number().nonnegative(),
  })),
});

async function parsePdfHoldings(data: Uint8Array, password: string, defaultKind: InvestmentKind = "STOCK"): Promise<ParsedHolding[]> {
  if (!geminiClient.isConfigured()) throw new Error("PDF holdings need AI — set GEMINI_API_KEY or use a CSV/XLSX export.");
  const text = await extractPdfText(data, password);
  const prompt = [
    "Extract the investment/stock holdings from this broker statement text.",
    'Return ONLY JSON: { "holdings": [ { "name": string, "symbol": string|null, "units": number, "avgCost": number, "currentPrice": number } ] }.',
    "units = quantity held; avgCost = average buy price per unit; currentPrice = latest/market price per unit.",
    "Skip totals and non-holding rows. Do not invent rows.",
    "",
    text.slice(0, 60000),
  ].join("\n");
  const raw = await geminiClient.generateJson<unknown>(prompt);
  const parsed = aiHoldingSchema.safeParse(raw);
  if (!parsed.success) throw new Error("Holdings could not be parsed reliably. Try a CSV/XLSX export instead.");
  return parsed.data.holdings.map((h) => ({
    name: h.name, symbol: h.symbol ?? null, kind: defaultKind,
    units: h.units, avgCost: h.avgCost, currentPrice: h.currentPrice,
  }));
}

export async function parseHoldingsFile(file: File, password = "", defaultKind: InvestmentKind = "STOCK"): Promise<ParsedHolding[]> {
  const extension = file.name.split(".").pop()?.toLowerCase();
  if (extension === "pdf") return parsePdfHoldings(new Uint8Array(await file.arrayBuffer()), password, defaultKind);
  if (["csv", "tsv", "txt"].includes(extension || "")) return rowsToHoldings(splitDelimited(await file.text()), defaultKind);
  if (["xlsx", "xls"].includes(extension || "")) {
    const ExcelJS = (await import("exceljs")).default;
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await file.arrayBuffer());
    const sheet = workbook.worksheets[0];
    const rows: string[][] = [];
    sheet.eachRow((row) => rows.push((row.values as unknown[]).slice(1).map((cell) => String(cell ?? ""))));
    return rowsToHoldings(rows, defaultKind);
  }
  throw new Error("Supported files: CSV, TSV, XLSX and PDF.");
}

export async function importHoldings(userId: string, holdings: ParsedHolding[]): Promise<HoldingsImportResult> {
  if (!holdings.length || holdings.length > 2000) {
    return { success: false, inserted: 0, updated: 0, rejected: holdings.length, error: "A holdings file must contain between 1 and 2,000 rows." };
  }
  let inserted = 0, updated = 0, rejected = 0;
  for (const holding of holdings) {
    if (!holding.name || holding.units <= 0) { rejected += 1; continue; }
    const input: CreateInvestmentInput = {
      name: holding.name, symbol: holding.symbol, kind: holding.kind,
      units: holding.units, avgCost: holding.avgCost, currentPrice: holding.currentPrice || holding.avgCost,
    };
    try {
      const outcome = await investmentRepository.upsertBySymbol(userId, input);
      if (outcome === "inserted") inserted += 1; else updated += 1;
    } catch (err) {
      logger.error("holding upsert failed", err);
      rejected += 1;
    }
  }
  return { success: true, inserted, updated, rejected };
}

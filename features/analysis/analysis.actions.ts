"use server";

import { getCurrentSession } from "@/lib/better-auth/auth";
import { logger } from "@/core/logger";
import { config } from "@/core/config/env";
import { getNews } from "@/features/news/news.service";
import { priceService } from "@/features/prices/price.service";
import { analysisService } from "./analysis.service";
import type { MarketAnalysis } from "./analysis.types";

async function finnhubQuote(symbol: string): Promise<number> {
  try {
    const { apiKey, baseUrl } = config.finnhub();
    if (!apiKey) return 0;
    const res = await fetch(`${baseUrl}/quote?symbol=${encodeURIComponent(symbol)}&token=${apiKey}`, { cache: "no-store" });
    if (!res.ok) return 0;
    const json = (await res.json()) as { c?: number };
    return typeof json.c === "number" ? json.c : 0;
  } catch {
    return 0;
  }
}

export async function getStockAnalysis(symbol: string): Promise<MarketAnalysis> {
  const session = await getCurrentSession();
  const subject = symbol.toUpperCase();
  if (!session?.user) {
    return { subject, outlook: "NEUTRAL", confidence: "LOW", horizon: "n/a", reasoning: "Sign in to view analysis.", keyFactors: [], generatedAt: new Date().toISOString(), available: false };
  }
  try {
    const [price, news] = await Promise.all([finnhubQuote(subject), getNews([subject])]);
    return await analysisService.analyze({
      subject,
      label: subject,
      currentValue: price,
      unit: "$",
      headlines: news.map((n) => n.headline).filter(Boolean).slice(0, 6),
    });
  } catch (err) {
    logger.error("getStockAnalysis failed", err);
    return { subject, outlook: "NEUTRAL", confidence: "LOW", horizon: "n/a", reasoning: "Analysis unavailable.", keyFactors: [], generatedAt: new Date().toISOString(), available: false };
  }
}

export async function getGoldAnalysis(): Promise<MarketAnalysis> {
  const session = await getCurrentSession();
  if (!session?.user) {
    return { subject: "GOLD", outlook: "NEUTRAL", confidence: "LOW", horizon: "n/a", reasoning: "Sign in to view analysis.", keyFactors: [], generatedAt: new Date().toISOString(), available: false };
  }
  try {
    const pricePerGram = (await priceService.goldInrPerGram()) ?? 0;
    return await analysisService.analyze({
      subject: "GOLD",
      label: "Gold (₹/gram)",
      currentValue: Number(pricePerGram.toFixed(2)),
      unit: "₹",
    });
  } catch (err) {
    logger.error("getGoldAnalysis failed", err);
    return { subject: "GOLD", outlook: "NEUTRAL", confidence: "LOW", horizon: "n/a", reasoning: "Analysis unavailable.", keyFactors: [], generatedAt: new Date().toISOString(), available: false };
  }
}

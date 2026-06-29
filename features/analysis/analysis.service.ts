import { z } from "zod";
import { geminiClient } from "@/core/ai/gemini";
import { logger } from "@/core/logger";
import type { MarketAnalysis } from "./analysis.types";

const responseSchema = z.object({
  outlook: z.enum(["UP", "DOWN", "NEUTRAL"]),
  confidence: z.enum(["LOW", "MEDIUM", "HIGH"]),
  horizon: z.string().min(1).max(60),
  reasoning: z.string().min(1).max(800),
  keyFactors: z.array(z.string().max(160)).max(6),
});

export interface AnalysisInput {
  subject: string; // symbol or "GOLD"
  label: string; // human name e.g. "RELIANCE" or "Gold (₹/gram)"
  currentValue: number;
  unit: string; // "₹" or "$"
  headlines?: string[];
}

function buildPrompt(input: AnalysisInput): string {
  const news = input.headlines?.length
    ? input.headlines.slice(0, 6).map((h) => `- ${h}`).join("\n")
    : "- (no recent headlines provided)";
  return `You are a markets analyst. Produce a SHORT-TERM outlook for the asset below.
Asset: ${input.label}
Current value: ${input.unit}${input.currentValue}
Recent headlines:
${news}

Respond with raw JSON only (no markdown):
{
  "outlook": "UP" | "DOWN" | "NEUTRAL",
  "confidence": "LOW" | "MEDIUM" | "HIGH",
  "horizon": "short phrase e.g. 1-3 months",
  "reasoning": "2-4 sentences grounded ONLY in the data above",
  "keyFactors": ["3-5 short bullet factors"]
}
Rules:
- Base everything ONLY on the data provided; do NOT invent specific facts or numbers.
- If data is thin, use "NEUTRAL" and "LOW".
- This is an estimate for planning, not financial advice.`;
}

/**
 * AI analysis/outlook. Reuses the Gemini client. Returns an `available: false`
 * NEUTRAL placeholder when the AI isn't configured or fails — never throws.
 */
export const analysisService = {
  async analyze(input: AnalysisInput): Promise<MarketAnalysis> {
    const fallback: MarketAnalysis = {
      subject: input.subject,
      outlook: "NEUTRAL",
      confidence: "LOW",
      horizon: "n/a",
      reasoning: "AI analysis is unavailable. Configure GEMINI_API_KEY to enable outlooks.",
      keyFactors: [],
      generatedAt: new Date().toISOString(),
      available: false,
    };
    if (!geminiClient.isConfigured()) return fallback;
    try {
      const raw = await geminiClient.generateJson<unknown>(buildPrompt(input));
      const parsed = responseSchema.safeParse(raw);
      if (!parsed.success) return fallback;
      return {
        subject: input.subject,
        ...parsed.data,
        generatedAt: new Date().toISOString(),
        available: true,
      };
    } catch (err) {
      logger.warn("analysis failed", { subject: input.subject, err });
      return fallback;
    }
  },
};

import { signalRepository } from "./signal.repository";
import type { TradingSignal, GenerateSignalInput, SignalDirection, SignalConfidence } from "./signal.types";

export const SIGNAL_TTL_HOURS = 6;

interface GeminiSignalResponse {
  direction: SignalDirection;
  confidence: SignalConfidence;
  reasoning: string;
  targetPrice: number | null;
  stopLoss: number | null;
}

export function buildSignalPrompt(input: GenerateSignalInput): string {
  const headlines = input.newsHeadlines?.slice(0, 5).join("\n- ") ?? "No recent news.";
  return `You are a quantitative stock analyst. Analyze the following data and produce a short-term trading signal.

Symbol: ${input.symbol}
Current Price: $${input.currentPrice.toFixed(2)}

Recent News Headlines:
- ${headlines}

Respond with a JSON object (no markdown, raw JSON only):
{
  "direction": "BUY" | "SELL" | "HOLD",
  "confidence": "LOW" | "MEDIUM" | "HIGH",
  "reasoning": "2-3 sentence explanation referencing the data above",
  "targetPrice": number or null,
  "stopLoss": number or null
}

Rules:
- targetPrice and stopLoss must be realistic (within 15% of current price for short-term)
- Do NOT invent facts. Base reasoning ONLY on the data provided.
- If data is insufficient, set direction to "HOLD" and confidence to "LOW".`;
}

export function parseSignalResponse(raw: string): GeminiSignalResponse | null {
  try {
    const cleaned = raw.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(cleaned) as Partial<GeminiSignalResponse>;
    if (!parsed.direction || !parsed.confidence || !parsed.reasoning) return null;
    return {
      direction: parsed.direction,
      confidence: parsed.confidence,
      reasoning: parsed.reasoning,
      targetPrice: parsed.targetPrice ?? null,
      stopLoss: parsed.stopLoss ?? null,
    };
  } catch {
    return null;
  }
}

export const signalService = {
  async save(
    input: GenerateSignalInput,
    parsed: GeminiSignalResponse,
  ): Promise<TradingSignal> {
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + SIGNAL_TTL_HOURS);

    return signalRepository.save({
      symbol: input.symbol.toUpperCase(),
      direction: parsed.direction,
      confidence: parsed.confidence,
      reasoning: parsed.reasoning,
      currentPrice: input.currentPrice,
      targetPrice: parsed.targetPrice,
      stopLoss: parsed.stopLoss,
      generatedAt: new Date(),
      expiresAt,
    });
  },

  async getLatest(limit = 20): Promise<TradingSignal[]> {
    return signalRepository.findLatest(limit);
  },

  async getForSymbol(symbol: string): Promise<TradingSignal[]> {
    return signalRepository.findBySymbol(symbol);
  },
};

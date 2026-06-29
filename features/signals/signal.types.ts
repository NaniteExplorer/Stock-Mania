export type SignalDirection = "BUY" | "SELL" | "HOLD";
export type SignalConfidence = "LOW" | "MEDIUM" | "HIGH";

export interface TradingSignal {
  id: string;
  symbol: string;
  direction: SignalDirection;
  confidence: SignalConfidence;
  reasoning: string;
  currentPrice: number;
  targetPrice: number | null;
  stopLoss: number | null;
  generatedAt: Date;
  expiresAt: Date;
}

export interface GenerateSignalInput {
  symbol: string;
  currentPrice: number;
  newsHeadlines?: string[];
}

export type AnalysisOutlook = "UP" | "DOWN" | "NEUTRAL";
export type AnalysisConfidence = "LOW" | "MEDIUM" | "HIGH";

export interface MarketAnalysis {
  subject: string; // symbol or "GOLD"
  outlook: AnalysisOutlook;
  confidence: AnalysisConfidence;
  horizon: string; // e.g. "1-3 months"
  reasoning: string;
  keyFactors: string[];
  generatedAt: string; // ISO
  /** True only when produced by the AI; false = engine unavailable fallback. */
  available: boolean;
}

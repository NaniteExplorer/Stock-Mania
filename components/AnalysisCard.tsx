"use client";

import { useState, useTransition } from "react";
import { Sparkles, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { getStockAnalysis, getGoldAnalysis } from "@/features/analysis/analysis.actions";
import type { MarketAnalysis } from "@/features/analysis/analysis.types";

const OUTLOOK_UI = {
  UP: { Icon: TrendingUp, cls: "text-green-500", label: "Bullish" },
  DOWN: { Icon: TrendingDown, cls: "text-red-500", label: "Bearish" },
  NEUTRAL: { Icon: Minus, cls: "text-gray-400", label: "Neutral" },
} as const;

export default function AnalysisCard({ symbol }: { symbol?: string }) {
  const [analysis, setAnalysis] = useState<MarketAnalysis | null>(null);
  const [pending, startTransition] = useTransition();

  const run = () =>
    startTransition(async () => {
      setAnalysis(symbol ? await getStockAnalysis(symbol) : await getGoldAnalysis());
    });

  return (
    <section className="cockpit-panel flex flex-col gap-3 p-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="icon-chip"><Sparkles className="h-5 w-5" /></span>
          <div>
            <h2 className="text-base font-semibold text-gray-100">AI outlook</h2>
            <p className="text-xs text-gray-500">Short-term, AI-generated estimate — not financial advice.</p>
          </div>
        </div>
        <button onClick={run} disabled={pending} className="yellow-btn px-4 py-2 text-sm">
          {pending ? "Analyzing…" : analysis ? "Refresh" : "Generate"}
        </button>
      </div>

      {analysis && (
        analysis.available ? (
          <div className="flex flex-col gap-3 border-t border-gray-700 pt-3">
            <div className="flex flex-wrap items-center gap-3">
              {(() => {
                const ui = OUTLOOK_UI[analysis.outlook];
                return (
                  <span className={`inline-flex items-center gap-1.5 font-semibold ${ui.cls}`}>
                    <ui.Icon className="h-4 w-4" /> {ui.label}
                  </span>
                );
              })()}
              <span className="pill">Confidence: {analysis.confidence}</span>
              <span className="pill">Horizon: {analysis.horizon}</span>
            </div>
            <p className="text-sm text-gray-300">{analysis.reasoning}</p>
            {analysis.keyFactors.length > 0 && (
              <ul className="list-inside list-disc text-xs text-gray-400">
                {analysis.keyFactors.map((f, i) => <li key={i}>{f}</li>)}
              </ul>
            )}
          </div>
        ) : (
          <p className="border-t border-gray-700 pt-3 text-sm text-gray-500">{analysis.reasoning}</p>
        )
      )}
    </section>
  );
}

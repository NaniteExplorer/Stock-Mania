import type { Metadata } from "next";
import { getMyInvestments } from "@/features/investments/investment.actions";
import { getMyTrades } from "@/features/trades/trade.actions";
import { getPortfolioReturns } from "@/features/returns/returns.actions";
import InvestmentsManager from "@/components/wealth/InvestmentsManager";
import HoldingsImporter from "@/components/wealth/HoldingsImporter";
import TradeLedger from "@/components/wealth/TradeLedger";
import ReturnsSummary from "@/components/wealth/ReturnsSummary";
import AnalysisCard from "@/components/AnalysisCard";
import RefreshPricesButton from "@/components/wealth/RefreshPricesButton";
import { formatINR, formatSignedINRCompact, formatSignedPercent } from "@/lib/utils";
import { LineChart } from "lucide-react";

export const metadata: Metadata = { title: "Investments" };

export default async function InvestmentsPage() {
  const [items, trades, returns] = await Promise.all([
    getMyInvestments(),
    getMyTrades(),
    getPortfolioReturns(),
  ]);
  const invested = items.reduce((s, i) => s + i.invested, 0);
  const current = items.reduce((s, i) => s + i.currentValue, 0);
  const pnl = current - invested;
  const pnlPct = invested > 0 ? (pnl / invested) * 100 : 0;
  const realizedNet = items.reduce((s, i) => s + i.realizedNet, 0);
  const up = pnl >= 0;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="page-title">Investments</h1>
          <p className="page-subtitle">
            Stocks, ETFs, mutual funds &amp; more — values update from live prices.
          </p>
        </div>
        {items.length > 0 && <RefreshPricesButton />}
      </div>

      <div className="networth-hero">
        <div className="flex flex-wrap items-center gap-3">
          <span className="icon-chip h-11 w-11">
            <LineChart className="h-5 w-5" />
          </span>
          <div>
            <p className="text-sm font-medium text-gray-500">Current value</p>
            <p className="text-3xl font-bold tracking-tight text-gray-100 tnum">
              {formatINR(current)}
            </p>
          </div>
          <span className={`chip ml-auto ${up ? "chip-pos" : "chip-neg"}`}>
            {formatSignedINRCompact(pnl)} ({formatSignedPercent(pnlPct)})
          </span>
        </div>
        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <div className="stat-tile">
            <p className="text-xs text-gray-500">Invested</p>
            <p className="mt-1 text-lg font-bold text-gray-100 tnum">{formatINR(invested)}</p>
          </div>
          <div className="stat-tile">
            <p className="text-xs text-gray-500">Holdings</p>
            <p className="mt-1 text-lg font-bold text-gray-100 tnum">{items.length}</p>
          </div>
          <div className="stat-tile">
            <p className="text-xs text-gray-500">Realized P&amp;L (net)</p>
            <p className={`mt-1 text-lg font-bold tnum ${realizedNet >= 0 ? "text-green-500" : "text-red-500"}`}>
              {formatSignedINRCompact(realizedNet)}
            </p>
          </div>
        </div>
      </div>

      <ReturnsSummary returns={returns} />
      <HoldingsImporter />
      <TradeLedger trades={trades} />
      <AnalysisCard />
      <InvestmentsManager items={items} />
    </div>
  );
}

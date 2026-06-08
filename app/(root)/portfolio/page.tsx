import { getPortfolio } from "@/features/portfolio/portfolio.actions";
import { HoldingsTable, PositionsTable } from "@/components/PortfolioTable";
import Link from "next/link";

function StatCard({ label, value, sub, positive }: {
  label: string;
  value: string;
  sub?: string;
  positive?: boolean;
}) {
  return (
    <div className="rounded-xl border border-gray-700 bg-gray-800/60 p-5">
      <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${
        positive === undefined ? "text-gray-100" : positive ? "text-green-400" : "text-red-400"
      }`}>
        {value}
      </p>
      {sub && <p className="mt-0.5 text-xs text-gray-500">{sub}</p>}
    </div>
  );
}

export default async function PortfolioPage() {
  const portfolio = await getPortfolio();

  if (!portfolio) {
    return (
      <div className="flex flex-col items-center gap-4 py-20 text-center">
        <p className="text-gray-400">Sign in to view your portfolio.</p>
      </div>
    );
  }

  const noConnections = !portfolio.zerodhaConnected && !portfolio.alpacaConnected;

  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-100">Portfolio</h1>
          <p className="text-sm text-gray-500 mt-1">Real-time holdings and P&amp;L</p>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span className={`flex items-center gap-1 ${portfolio.zerodhaConnected ? "text-green-400" : "text-gray-600"}`}>
            <span className={`h-2 w-2 rounded-full ${portfolio.zerodhaConnected ? "bg-green-400" : "bg-gray-700"}`} />
            Zerodha
          </span>
          <span className={`flex items-center gap-1 ${portfolio.alpacaConnected ? "text-green-400" : "text-gray-600"}`}>
            <span className={`h-2 w-2 rounded-full ${portfolio.alpacaConnected ? "bg-green-400" : "bg-gray-700"}`} />
            Alpaca
          </span>
        </div>
      </div>

      {noConnections ? (
        <div className="rounded-xl border border-dashed border-gray-700 p-10 text-center">
          <p className="text-gray-400 mb-4">Connect a broker to see your portfolio.</p>
          <Link
            href="/settings"
            className="inline-block rounded-lg border border-yellow-600 px-5 py-2 text-sm font-medium text-yellow-400 hover:bg-yellow-500/10 transition-colors"
          >
            Go to Settings →
          </Link>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <StatCard
              label="Invested"
              value={`₹${portfolio.totalInvested.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`}
            />
            <StatCard
              label="Current Value"
              value={`₹${portfolio.currentValue.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`}
            />
            <StatCard
              label="Total P&L"
              value={`${portfolio.totalPnl >= 0 ? "+" : ""}₹${Math.abs(portfolio.totalPnl).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`}
              sub={`${portfolio.totalPnlPercent >= 0 ? "+" : ""}${portfolio.totalPnlPercent.toFixed(2)}%`}
              positive={portfolio.totalPnl >= 0}
            />
            <StatCard
              label="Day P&L"
              value={`${portfolio.dayPnl >= 0 ? "+" : ""}₹${Math.abs(portfolio.dayPnl).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`}
              positive={portfolio.dayPnl >= 0}
            />
          </div>

          <section className="flex flex-col gap-3">
            <h2 className="text-lg font-semibold text-gray-100">Holdings</h2>
            <HoldingsTable holdings={portfolio.holdings} />
          </section>

          {portfolio.positions.length > 0 && (
            <section className="flex flex-col gap-3">
              <h2 className="text-lg font-semibold text-gray-100">Open Positions</h2>
              <PositionsTable positions={portfolio.positions} />
            </section>
          )}
        </>
      )}
    </div>
  );
}

import {
  BASELINE_WIDGET_CONFIG,
  CANDLE_CHART_WIDGET_CONFIG,
  COMPANY_FINANCIALS_WIDGET_CONFIG,
  COMPANY_PROFILE_WIDGET_CONFIG,
  SYMBOL_INFO_WIDGET_CONFIG,
  TECHNICAL_ANALYSIS_WIDGET_CONFIG
} from "@/lib/constants";
import TradingViewWidget from "@/components/TradingViewWidgets";
import WatchlistButton from "@/components/WatchlistButton";
import TradePanel from "@/components/TradePanel";
import AlertsPanel from "@/components/AlertsPanel";
import { RequestSignalButton } from "@/components/SignalCard";
import { getCurrentSession } from "@/lib/better-auth/auth";
import { watchlistService } from "@/features/watchlist/watchlist.service";
import { isConnected as isZerodhaConnected } from "@/features/orders/zerodha.client";
import { getUserAlerts } from "@/features/alerts/alert.actions";
import { getSignalsForSymbol } from "@/features/signals/signal.actions";
import { SignalCard } from "@/components/SignalCard";
import Link from "next/link";
import { ArrowLeft, Activity } from "lucide-react";

export default async function StockDetails({ params }: StockDetailsPageProps) {
  const { symbol } = await params;
  const upperSymbol = symbol.toUpperCase();
  const scriptUrl = `https://s3.tradingview.com/external-embedding/embed-widget-`;

  const session = await getCurrentSession();
  const [isInWatchlist, zerodhaConnected, allAlerts, signals] = await Promise.all([
    session?.user?.id
      ? watchlistService.has(session.user.id, upperSymbol)
      : Promise.resolve(false),
    session?.user?.id
      ? isZerodhaConnected(session.user.id)
      : Promise.resolve(false),
    session?.user?.id ? getUserAlerts() : Promise.resolve([]),
    session?.user?.id ? getSignalsForSymbol(upperSymbol) : Promise.resolve([]),
  ]);

  const symbolAlerts = allAlerts.filter(
    (a) => a.symbol === upperSymbol && a.status === "ACTIVE",
  );

  return (
    <div className="flex w-full flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Link href="/search" className="icon-chip focus-cockpit" aria-label="Back to stock search"><ArrowLeft className="h-4 w-4" /></Link>
          <div><p className="section-kicker">Market workspace</p><h1 className="page-title">{upperSymbol}</h1><p className="page-subtitle">Price, execution, alerts and evidence in one view.</p></div>
        </div>
        <span className="data-status"><Activity className="h-3.5 w-3.5" /> Live market surface</span>
      </div>
      <section className="grid w-full grid-cols-1 items-start gap-6 xl:grid-cols-[1.45fr_.75fr]">
        {/* Left column */}
        <div className="flex flex-col gap-6 xl:sticky xl:top-24">
          <TradingViewWidget
            scriptUrl={`${scriptUrl}symbol-info.js`}
            config={SYMBOL_INFO_WIDGET_CONFIG(symbol)}
            height={170}
          />

          <TradingViewWidget
            scriptUrl={`${scriptUrl}advanced-chart.js`}
            config={CANDLE_CHART_WIDGET_CONFIG(symbol)}
            className="custom-chart"
            height={600}
          />

          <TradingViewWidget
            scriptUrl={`${scriptUrl}advanced-chart.js`}
            config={BASELINE_WIDGET_CONFIG(symbol)}
            className="custom-chart"
            height={600}
          />
        </div>

        {/* Right column */}
        <div className="flex flex-col gap-6">
          <div className="flex items-center justify-between">
            <WatchlistButton
              symbol={upperSymbol}
              company={upperSymbol}
              isInWatchlist={isInWatchlist}
            />
            <RequestSignalButton symbol={upperSymbol} />
          </div>

          <TradePanel
            symbol={upperSymbol}
            isZerodhaConnected={zerodhaConnected}
          />

          <AlertsPanel
            symbol={upperSymbol}
            initialAlerts={symbolAlerts}
          />

          {signals.length > 0 && (
            <div className="flex flex-col gap-3">
              <h3 className="section-kicker">AI evidence</h3>
              {signals.map((s) => (
                <SignalCard key={s.id} signal={s} />
              ))}
            </div>
          )}

          <TradingViewWidget
            scriptUrl={`${scriptUrl}technical-analysis.js`}
            config={TECHNICAL_ANALYSIS_WIDGET_CONFIG(symbol)}
            height={400}
          />

          <TradingViewWidget
            scriptUrl={`${scriptUrl}company-profile.js`}
            config={COMPANY_PROFILE_WIDGET_CONFIG(symbol)}
            height={440}
          />

          <TradingViewWidget
            scriptUrl={`${scriptUrl}financials.js`}
            config={COMPANY_FINANCIALS_WIDGET_CONFIG(symbol)}
            height={464}
          />
        </div>
      </section>
    </div>
  );
}

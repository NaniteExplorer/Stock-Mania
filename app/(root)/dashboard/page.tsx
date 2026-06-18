import TradingViewWidget from "@/components/TradingViewWidgets";
import {
  HEATMAP_WIDGET_CONFIG,
  MARKET_DATA_WIDGET_CONFIG,
  MARKET_OVERVIEW_WIDGET_CONFIG,
  TOP_STORIES_WIDGET_CONFIG,
} from "@/lib/constants";
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  BarChart3,
  BriefcaseBusiness,
  Building2,
  CircleDollarSign,
  Landmark,
  LineChart,
  PieChart,
  ShieldCheck,
  Sparkles,
  WalletCards,
} from "lucide-react";
import React from "react";

const kpis = [
  {
    label: "Net worth view",
    value: "Rs 24.8L",
    change: "+2.4% today",
    icon: WalletCards,
    tone: "text-green-400",
  },
  {
    label: "Invested capital",
    value: "Rs 18.3L",
    change: "Across live equities",
    icon: BriefcaseBusiness,
    tone: "text-yellow-400",
  },
  {
    label: "Day P&L",
    value: "+Rs 42.6K",
    change: "Realized + unrealized",
    icon: LineChart,
    tone: "text-green-400",
  },
  {
    label: "Watchlist moves",
    value: "17",
    change: "5 alerts in focus",
    icon: Activity,
    tone: "text-blue-400",
  },
];

const assets = [
  { label: "Stocks", value: "62%", icon: BarChart3, status: "Live" },
  { label: "Mutual Funds", value: "18%", icon: PieChart, status: "Roadmap" },
  { label: "EPF", value: "9%", icon: Building2, status: "Roadmap" },
  { label: "PPF", value: "7%", icon: Landmark, status: "Roadmap" },
  { label: "Cash", value: "4%", icon: CircleDollarSign, status: "Roadmap" },
];

const Home = () => {
  const scriptURL =
    "https://s3.tradingview.com/external-embedding/embed-widget-";
  return (
    <div className="flex min-h-screen home-wrapper">
      <section className="enterprise-card relative flex flex-col gap-5 overflow-hidden p-6 lg:flex-row lg:items-end lg:justify-between">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(36rem_18rem_at_0%_0%,rgba(245,158,11,0.10),transparent_60%),radial-gradient(32rem_18rem_at_100%_100%,rgba(13,148,136,0.10),transparent_60%)]" />
        <div className="relative">
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <span className="inline-flex items-center gap-2 rounded-full border border-yellow-500/20 bg-yellow-500/10 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-yellow-400">
              <ShieldCheck className="h-3.5 w-3.5" />
              Enterprise finance workspace
            </span>
            <span className="inline-flex items-center gap-2 rounded-full border border-green-500/20 bg-green-500/10 px-3 py-1.5 text-xs font-semibold text-green-400">
              Markets open
            </span>
          </div>
          <h1 className="max-w-4xl text-3xl font-bold tracking-tight text-gray-100 md:text-4xl">
            Portfolio command center for stocks today and total wealth tomorrow.
          </h1>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-gray-500 md:text-base">
            Monitor live markets, watchlist movement, trading signals, and the
            future asset stack for mutual funds, EPF, PPF, ETFs, and cash.
          </p>
        </div>
        <div className="relative grid min-w-full grid-cols-2 gap-3 lg:min-w-[360px]">
          <div className="rounded-xl border border-gray-600 bg-gray-700/70 p-3.5">
            <p className="text-xs text-gray-500">Risk posture</p>
            <p className="mt-1 text-lg font-bold text-yellow-600">Balanced</p>
          </div>
          <div className="rounded-xl border border-gray-600 bg-gray-700/70 p-3.5">
            <p className="text-xs text-gray-500">Broker sync</p>
            <p className="mt-1 text-lg font-bold text-green-500">Ready</p>
          </div>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {kpis.map(({ label, value, change, icon: Icon, tone }) => (
          <div key={label} className="enterprise-card p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-gray-500">{label}</p>
                <p className="mt-3 text-2xl font-bold tracking-tight text-gray-100">
                  {value}
                </p>
              </div>
              <Icon className={`h-10 w-10 rounded-lg border border-gray-600 bg-gray-700/70 p-2 ${tone}`} />
            </div>
            <p className={`mt-4 flex items-center gap-1 text-sm font-semibold ${tone}`}>
              <ArrowUpRight className="h-4 w-4" />
              {change}
            </p>
          </div>
        ))}
      </section>

      <section className="grid gap-5 xl:grid-cols-[1fr_360px]">
        <div className="enterprise-card p-5">
          <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-semibold text-gray-100">
                Asset allocation readiness
              </p>
              <p className="text-sm text-gray-500">
                Presentational modules for upcoming complete asset tracking.
              </p>
            </div>
            <span className="w-fit rounded-full border border-gray-600 bg-gray-700/70 px-3 py-1 text-xs font-semibold text-gray-400">
              Stocks live / other assets staged
            </span>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {assets.map(({ label, value, icon: Icon, status }) => (
              <div
                key={label}
                className="rounded-lg border border-gray-600 bg-gray-700/60 p-4"
              >
                <div className="mb-4 flex items-center justify-between">
                  <Icon className="h-8 w-8 rounded-md border border-gray-600 bg-gray-800 p-1.5 text-yellow-400" />
                  <span className="rounded-full bg-gray-700 px-2 py-1 text-[11px] font-semibold text-gray-400">
                    {status}
                  </span>
                </div>
                <p className="text-sm text-gray-500">{label}</p>
                <p className="mt-1 text-xl font-bold text-gray-100">{value}</p>
              </div>
            ))}
          </div>
        </div>

        <aside className="enterprise-card p-5">
          <div className="mb-5 flex items-center gap-3">
            <Sparkles className="h-10 w-10 rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-2 text-yellow-400" />
            <div>
              <p className="font-semibold text-gray-100">Intelligence rail</p>
              <p className="text-sm text-gray-500">Signals and risk events</p>
            </div>
          </div>
          <div className="space-y-3">
            {[
              ["AI signal queue", "3 symbols ready for review", "text-yellow-400"],
              ["Watchlist alerts", "RELIANCE and NVDA near thresholds", "text-green-400"],
              ["Portfolio risk", "Concentration check pending", "text-blue-400"],
            ].map(([title, body, tone]) => (
              <div key={title} className="rounded-md border border-gray-600 bg-gray-700/60 p-3">
                <p className={`text-sm font-semibold ${tone}`}>{title}</p>
                <p className="mt-1 text-xs leading-5 text-gray-500">{body}</p>
              </div>
            ))}
          </div>
          <div className="mt-4 rounded-md border border-red-500/20 bg-red-500/10 p-3">
            <p className="flex items-center gap-2 text-sm font-semibold text-red-400">
              <AlertTriangle className="h-4 w-4" />
              No investment advice
            </p>
            <p className="mt-1 text-xs leading-5 text-gray-500">
              Signals and analytics are informational surfaces until you connect
              your own decision workflow.
            </p>
          </div>
        </aside>
      </section>

      <section className="grid w-full gap-5 home-section">
        <div className="enterprise-card p-4 md:col-span-1 xl:col-span-1">
          <TradingViewWidget
            title="Market Overview"
            scriptUrl={`${scriptURL}advanced-chart.js`}
            config={MARKET_OVERVIEW_WIDGET_CONFIG}
            className="custom-chart"
            height={560}
          />
        </div>
        <div className="enterprise-card p-4 md:col-span-1 xl:col-span-2">
          <TradingViewWidget
            title="Stock Heatmap"
            scriptUrl={`${scriptURL}stock-heatmap.js`}
            config={HEATMAP_WIDGET_CONFIG}
            className="custom-chart"
            height={560}
          />
        </div>
      </section>
      <section className="grid w-full gap-5 home-section">
        <div className="enterprise-card h-full p-4 md:col-span-1 xl:col-span-1">
          <TradingViewWidget
            title="Top Stories"
            scriptUrl={`${scriptURL}timeline.js`}
            config={TOP_STORIES_WIDGET_CONFIG}
            className="custom-chart"
            height={560}
          />
        </div>
        <div className="enterprise-card h-full p-4 md:col-span-1 xl:col-span-2">
          <TradingViewWidget
            title="Market Data"
            scriptUrl={`${scriptURL}market-quotes.js`}
            config={MARKET_DATA_WIDGET_CONFIG}
            className="custom-chart"
            height={560}
          />
        </div>
      </section>
    </div>
  );
};

export default Home;

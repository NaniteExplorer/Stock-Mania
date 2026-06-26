import Link from "next/link";
import TradingViewWidget from "@/components/TradingViewWidgets";
import AllocationDonut from "@/components/wealth/AllocationDonut";
import { MARKET_OVERVIEW_WIDGET_CONFIG } from "@/lib/constants";
import { getNetWorthOverview } from "@/features/networth/networth.actions";
import { getMyAccounts } from "@/features/accounts/account.actions";
import { getMyInvestments } from "@/features/investments/investment.actions";
import { ACCOUNT_TYPE_LABELS } from "@/features/accounts/account.types";
import {
  formatINR,
  formatINRCompact,
  formatSignedINRCompact,
  formatSignedPercent,
} from "@/lib/utils";
import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  Building2,
  Gem,
  Landmark,
  LineChart,
  BriefcaseBusiness,
  Plus,
  Sparkles,
} from "lucide-react";

const CLASS_CARDS = [
  { key: "accounts", label: "Cash & Bank", href: "/accounts", icon: Landmark, totalKey: "accounts" as const },
  { key: "investments", label: "Investments", href: "/investments", icon: LineChart, totalKey: "investments" as const },
  { key: "brokerage", label: "Brokerage", href: "/portfolio", icon: BriefcaseBusiness, totalKey: "brokerage" as const },
  { key: "esops", label: "ESOPs", href: "/esops", icon: Building2, totalKey: "esops" as const },
  { key: "assets", label: "Assets", href: "/assets", icon: Gem, totalKey: "assets" as const },
];

const ONBOARD = [
  { label: "Link a bank account", desc: "Track cash & deposits", href: "/accounts", icon: Landmark },
  { label: "Add investments", desc: "Stocks, ETFs & funds", href: "/investments", icon: LineChart },
  { label: "Add ESOP grants", desc: "Vested equity value", href: "/esops", icon: Building2 },
  { label: "Add assets", desc: "Property, gold & more", href: "/assets", icon: Gem },
];

export default async function DashboardPage() {
  const [overview, accounts, investments] = await Promise.all([
    getNetWorthOverview(),
    getMyAccounts(),
    getMyInvestments(),
  ]);

  const positive = overview.dayChange >= 0;
  const scriptURL = "https://s3.tradingview.com/external-embedding/embed-widget-";

  const movers = [...investments]
    .sort((a, b) => Math.abs(b.pnlPercent) - Math.abs(a.pnlPercent))
    .slice(0, 5);

  return (
    <div className="flex flex-col gap-6">
      {/* Page header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="page-title">Net worth</h1>
          <p className="page-subtitle">Everything you own, in one clear view.</p>
        </div>
        <Link
          href="/accounts"
          className="inline-flex h-10 items-center gap-2 rounded-xl bg-yellow-500 px-4 text-sm font-semibold text-white transition-colors hover:brightness-110"
        >
          <Plus className="h-4 w-4" /> Add holding
        </Link>
      </div>

      {/* Hero + allocation */}
      <section className="grid gap-5 xl:grid-cols-[1.25fr_1fr]">
        <div className="networth-hero">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-gray-500">Total net worth</p>
              <p className="mt-2 text-4xl font-bold tracking-tight text-gray-100 tnum md:text-5xl">
                {formatINR(overview.netWorth)}
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className={`chip ${positive ? "chip-pos" : "chip-neg"}`}>
                  {positive ? (
                    <ArrowUpRight className="h-3.5 w-3.5" />
                  ) : (
                    <ArrowDownRight className="h-3.5 w-3.5" />
                  )}
                  {formatSignedINRCompact(overview.dayChange)} ({formatSignedPercent(overview.dayChangePercent)})
                </span>
                <span className="text-xs text-gray-500">today</span>
              </div>
            </div>
            <span className="pill pill-brand">
              <Sparkles className="h-3.5 w-3.5" />
              Live + manual
            </span>
          </div>

          {/* Stacked allocation bar */}
          {overview.allocation.length > 0 && (
            <div className="mt-6">
              <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-gray-700">
                {overview.allocation.map((s) => (
                  <span
                    key={s.key}
                    style={{ width: `${s.percent}%`, background: s.color }}
                    className="h-full"
                  />
                ))}
              </div>
            </div>
          )}

          <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div className="stat-tile">
              <p className="text-xs text-gray-500">Cash & Bank</p>
              <p className="mt-1 text-lg font-bold text-gray-100 tnum">
                {formatINRCompact(overview.totals.accounts)}
              </p>
            </div>
            <div className="stat-tile">
              <p className="text-xs text-gray-500">Investments</p>
              <p className="mt-1 text-lg font-bold text-gray-100 tnum">
                {formatINRCompact(overview.totals.investments + overview.totals.brokerage)}
              </p>
            </div>
            <div className="stat-tile">
              <p className="text-xs text-gray-500">ESOPs + Assets</p>
              <p className="mt-1 text-lg font-bold text-gray-100 tnum">
                {formatINRCompact(overview.totals.esops + overview.totals.assets)}
              </p>
            </div>
          </div>
        </div>

        <div className="panel p-6">
          <h2 className="text-base font-semibold text-gray-100">Allocation</h2>
          <p className="mb-5 text-sm text-gray-500">How your wealth is spread.</p>
          {overview.allocation.length > 0 ? (
            <AllocationDonut
              slices={overview.allocation}
              centerLabel="Net worth"
              centerValue={formatINRCompact(overview.netWorth)}
            />
          ) : (
            <div className="flex h-44 flex-col items-center justify-center rounded-xl border border-dashed border-gray-600 text-center">
              <p className="text-sm text-gray-500">No holdings yet.</p>
              <Link href="/accounts" className="mt-2 text-sm font-semibold text-yellow-500 hover:underline">
                Add your first one →
              </Link>
            </div>
          )}
        </div>
      </section>

      {/* Onboarding band — only when empty */}
      {!overview.hasData && (
        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {ONBOARD.map(({ label, desc, href, icon: Icon }) => (
            <Link key={href} href={href} className="panel panel-hover flex items-start gap-3 p-4">
              <span className="icon-chip">
                <Icon className="h-5 w-5" />
              </span>
              <span>
                <span className="block text-sm font-semibold text-gray-100">{label}</span>
                <span className="block text-xs text-gray-500">{desc}</span>
              </span>
            </Link>
          ))}
        </section>
      )}

      {/* Wealth class tiles */}
      <section className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        {CLASS_CARDS.map(({ key, label, href, icon: Icon, totalKey }) => {
          const value = overview.totals[totalKey];
          const pct = overview.netWorth > 0 ? (value / overview.netWorth) * 100 : 0;
          return (
            <Link key={key} href={href} className="panel panel-hover p-4">
              <div className="flex items-center justify-between">
                <span className="icon-chip">
                  <Icon className="h-5 w-5" />
                </span>
                <ArrowRight className="h-4 w-4 text-gray-500" />
              </div>
              <p className="mt-3 text-xs text-gray-500">{label}</p>
              <p className="mt-1 text-lg font-bold text-gray-100 tnum">{formatINRCompact(value)}</p>
              <p className="mt-0.5 text-[11px] text-gray-500 tnum">{pct.toFixed(1)}% of net worth</p>
            </Link>
          );
        })}
      </section>

      {/* Accounts + Movers */}
      <section className="grid gap-5 lg:grid-cols-2">
        <div className="panel p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-base font-semibold text-gray-100">Accounts</h2>
            <Link href="/accounts" className="text-sm font-medium text-yellow-500 hover:underline">
              Manage
            </Link>
          </div>
          {accounts.length > 0 ? (
            <ul className="flex flex-col gap-2">
              {accounts.slice(0, 5).map((a) => (
                <li
                  key={a.id}
                  className="flex items-center justify-between gap-3 rounded-xl border border-gray-600 bg-gray-700/40 px-4 py-3"
                >
                  <span className="flex min-w-0 items-center gap-3">
                    <span className="icon-chip h-9 w-9">
                      <Landmark className="h-4 w-4" />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold text-gray-100">
                        {a.name}
                      </span>
                      <span className="block truncate text-xs text-gray-500">
                        {a.institution || ACCOUNT_TYPE_LABELS[a.type]}
                        {a.last4 ? ` ••${a.last4}` : ""}
                      </span>
                    </span>
                  </span>
                  <span className="text-sm font-semibold text-gray-100 tnum">
                    {formatINRCompact(a.balance)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyRow href="/accounts" label="Add a bank account" />
          )}
        </div>

        <div className="panel p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-base font-semibold text-gray-100">Top movers</h2>
            <Link href="/investments" className="text-sm font-medium text-yellow-500 hover:underline">
              View all
            </Link>
          </div>
          {movers.length > 0 ? (
            <ul className="flex flex-col gap-2">
              {movers.map((m) => {
                const up = m.pnl >= 0;
                return (
                  <li
                    key={m.id}
                    className="flex items-center justify-between gap-3 rounded-xl border border-gray-600 bg-gray-700/40 px-4 py-3"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold text-gray-100">
                        {m.symbol || m.name}
                      </span>
                      <span className="block truncate text-xs text-gray-500">{m.name}</span>
                    </span>
                    <span className="text-right">
                      <span className="block text-sm font-semibold text-gray-100 tnum">
                        {formatINRCompact(m.currentValue)}
                      </span>
                      <span
                        className={`block text-xs font-semibold tnum ${up ? "text-green-500" : "text-red-500"}`}
                      >
                        {formatSignedPercent(m.pnlPercent)}
                      </span>
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <EmptyRow href="/investments" label="Add an investment" />
          )}
        </div>
      </section>

      {/* Markets */}
      <section className="panel p-4">
        <TradingViewWidget
          title="Markets overview"
          scriptUrl={`${scriptURL}advanced-chart.js`}
          config={MARKET_OVERVIEW_WIDGET_CONFIG}
          className="custom-chart"
          height={460}
        />
      </section>
    </div>
  );
}

function EmptyRow({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="flex items-center justify-center gap-2 rounded-xl border border-dashed border-gray-600 py-8 text-sm font-medium text-gray-500 transition-colors hover:border-yellow-500/40 hover:text-yellow-500"
    >
      <Plus className="h-4 w-4" /> {label}
    </Link>
  );
}

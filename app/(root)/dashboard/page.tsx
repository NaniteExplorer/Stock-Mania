import Link from "next/link";
import AllocationDonut from "@/components/wealth/AllocationDonut";
import NetWorthTimeline from "@/components/wealth/NetWorthTimeline";
import { getNetWorthOverview } from "@/features/networth/networth.actions";
import { getMyAccounts } from "@/features/accounts/account.actions";
import { getMyInvestments } from "@/features/investments/investment.actions";
import { getMySnapshotTimeline, getLatestSnapshot } from "@/features/tracking/snapshot.actions";
import { getPortfolioReturns } from "@/features/returns/returns.actions";
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
  CreditCard,
  Gem,
  Landmark,
  LineChart,
  Plus,
  Sparkles,
  ShieldCheck,
  CircleGauge,
  TrendingUp,
} from "lucide-react";

const CLASS_CARDS = [
  { key: "accounts", label: "Cash & Bank", href: "/accounts", icon: Landmark, totalKey: "accounts" as const },
  { key: "investments", label: "Investments", href: "/investments", icon: LineChart, totalKey: "investments" as const },
  { key: "assets", label: "Assets", href: "/assets", icon: Gem, totalKey: "assets" as const },
];

const ONBOARD = [
  { label: "Link a bank account", desc: "Track cash & deposits", href: "/accounts", icon: Landmark },
  { label: "Add investments", desc: "Stocks, ETFs & funds", href: "/investments", icon: LineChart },
  { label: "Add assets", desc: "Property, gold & more", href: "/assets", icon: Gem },
];

export default async function DashboardPage() {
  const [overview, accounts, investments, timeline, latestSnapshot, returns] = await Promise.all([
    getNetWorthOverview(),
    getMyAccounts(),
    getMyInvestments(),
    getMySnapshotTimeline(),
    getLatestSnapshot(),
    getPortfolioReturns(),
  ]);
  const portfolioXirr = returns.xirr;
  const displayedNetWorth = latestSnapshot?.metrics?.totalWorth ?? overview.netWorth;
  const displayedAssets = latestSnapshot?.totalAssets ?? overview.totalAssets;
  const displayedLiabilities = latestSnapshot?.totalLiabilities ?? overview.totalLiabilities;

  const positive = overview.dayChange >= 0;
  const liquidCashPercent = overview.totalAssets > 0 ? (overview.totals.accounts / overview.totalAssets) * 100 : 0;
  const debtRatio = overview.totalAssets > 0 ? (overview.totalLiabilities / overview.totalAssets) * 100 : 0;

  const movers = [...investments]
    .sort((a, b) => Math.abs(b.pnlPercent) - Math.abs(a.pnlPercent))
    .slice(0, 5);

  return (
    <div className="flex flex-col gap-6">
      {overview.degraded && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          We couldn&apos;t load your latest figures — the numbers below may be
          incomplete. Refresh in a moment.
        </div>
      )}
      {/* Page header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="page-title">Net worth</h1>
          <p className="page-subtitle">Your financial position, composition and next actions.</p>
        </div>
        <Link
          href="/accounts"
          className="inline-flex h-10 items-center gap-2 rounded-xl bg-brand-500 px-4 text-sm font-semibold text-white transition-colors hover:brightness-110"
        >
          <Plus className="h-4 w-4" /> Add holding
        </Link>
      </div>

      {/* Hero + allocation */}
      <section className="grid gap-5 xl:grid-cols-[1.25fr_1fr]">
        <div className="networth-hero panel">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-gray-500">Total net worth</p>
              <p className="mt-2 text-4xl font-bold tracking-tight text-gray-100 tnum md:text-5xl">
                {formatINR(displayedNetWorth)}
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
              <p className="mt-2 text-xs text-gray-500">
                Assets{" "}
                <span className="font-semibold text-gray-300 tnum">
                  {formatINRCompact(displayedAssets)}
                </span>
                {"  ·  "}Liabilities{" "}
                <span className="font-semibold text-red-500 tnum">
                  {formatINRCompact(displayedLiabilities)}
                </span>
              </p>
            </div>
            <span className="pill pill-brand">
              <Sparkles className="h-3.5 w-3.5" />
              Manual + on-demand prices
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
              <p className="text-xs text-gray-500">Total assets</p>
              <p className="mt-1 text-lg font-bold text-gray-100 tnum">
                {formatINRCompact(displayedAssets)}
              </p>
            </div>
            <div className="stat-tile">
              <p className="text-xs text-gray-500">Liabilities</p>
              <p className="mt-1 text-lg font-bold text-red-500 tnum">
                {formatINRCompact(displayedLiabilities)}
              </p>
            </div>
            <div className="stat-tile">
              <p className="text-xs text-gray-500">Investments</p>
              <p className="mt-1 text-lg font-bold text-gray-100 tnum">
                {formatINRCompact(overview.totals.investments + overview.totals.brokerage)}
              </p>
            </div>
          </div>
        </div>

        <div className="panel p-6">
          <span className="section-kicker">Wealth map</span>
          <h2 className="mt-1 text-base font-semibold text-gray-100">Allocation</h2>
          <p className="mb-5 text-sm text-gray-500">Select a segment to inspect its source.</p>
          {overview.allocation.length > 0 ? (
            <AllocationDonut
              slices={overview.allocation}
              centerLabel="Net worth"
              centerValue={formatINRCompact(displayedNetWorth)}
              links={{
                accounts: "/accounts",
                investments: "/investments",
                brokerage: "/investments",
                esops: "/assets",
                assets: "/assets",
              }}
            />
          ) : (
            <div className="flex h-44 flex-col items-center justify-center rounded-xl border border-dashed border-gray-600 text-center">
              <p className="text-sm text-gray-500">No holdings yet.</p>
              <Link href="/accounts" className="mt-2 text-sm font-semibold text-brand-500 hover:underline">
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
      <section className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        {CLASS_CARDS.map(({ key, label, href, icon: Icon, totalKey }) => {
          const value = overview.totals[totalKey];
          const pct = overview.totalAssets > 0 ? (value / overview.totalAssets) * 100 : 0;
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
              <p className="mt-0.5 text-[11px] text-gray-500 tnum">{pct.toFixed(1)}% of assets</p>
            </Link>
          );
        })}
        <Link href="/liabilities" className="panel panel-hover p-4">
          <div className="flex items-center justify-between">
            <span className="icon-chip">
              <CreditCard className="h-5 w-5" />
            </span>
            <ArrowRight className="h-4 w-4 text-gray-500" />
          </div>
          <p className="mt-3 text-xs text-gray-500">Liabilities</p>
          <p className="mt-1 text-lg font-bold text-red-500 tnum">
            {overview.totalLiabilities > 0 ? "−" : ""}
            {formatINRCompact(overview.totalLiabilities)}
          </p>
          <p className="mt-0.5 text-[11px] text-gray-500 tnum">{overview.counts.liabilities} owed</p>
        </Link>
      </section>

      {/* Accounts + Movers */}
      <section className="grid gap-5 lg:grid-cols-2">
        <div className="panel p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-base font-semibold text-gray-100">Accounts</h2>
            <Link href="/accounts" className="text-sm font-medium text-brand-500 hover:underline">
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
            <Link href="/investments" className="text-sm font-medium text-brand-500 hover:underline">
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

      <section className="panel p-5 md:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <span className="section-kicker">Financial dynamics</span>
            <h2 className="mt-1 text-lg font-semibold text-gray-100">How your wealth is moving</h2>
            <p className="mt-1 text-sm text-gray-500">
              {latestSnapshot
                ? `Net worth over time · attribution for ${latestSnapshot.periodKey}`
                : "Movement attribution begins as snapshots are recorded."}
            </p>
          </div>
          <Link href="/history" className="data-status hover:text-brand-500">Manage history →</Link>
        </div>
        <div className="mt-6 grid min-h-44 gap-4 lg:grid-cols-[1.6fr_1fr]">
          <div className="relative overflow-hidden rounded-xl border border-gray-600 bg-gray-900/45 p-5">
            <NetWorthTimeline points={timeline} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: "Contributions", value: latestSnapshot?.contributions, positive: true },
              { label: "Market return", value: latestSnapshot?.marketMovement, signed: true },
              { label: "Debt reduced", value: latestSnapshot?.debtReduction, signed: true },
              { label: "Money out", value: latestSnapshot?.withdrawals, positive: false },
            ].map(({ label, value, signed }) => (
              <div key={label} className="stat-tile">
                <p className="metric-label">{label}</p>
                <p className={`mt-3 text-xl font-bold tnum ${
                  value == null ? "text-gray-300" : signed ? (value >= 0 ? "text-green-500" : "text-red-500") : "text-gray-100"
                }`}>
                  {value == null ? "—" : signed ? formatSignedINRCompact(value) : formatINRCompact(value)}
                </p>
                <p className="mt-1 text-xs text-gray-500">{latestSnapshot ? "vs previous month" : "Awaiting history"}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        <div className="panel p-5"><CircleGauge className="h-5 w-5 text-blue-500" /><p className="metric-label mt-4">Liquid position</p><p className="mt-2 text-2xl font-bold text-gray-100 tnum">{formatINRCompact(overview.totals.accounts)}</p><p className="mt-1 text-xs text-gray-500">{liquidCashPercent.toFixed(1)}% of assets in cash and accounts</p></div>
        <div className="panel p-5"><ShieldCheck className="h-5 w-5 text-green-500" /><p className="metric-label mt-4">Debt health</p><p className={`mt-2 text-2xl font-bold tnum ${debtRatio > 50 ? "text-red-500" : "text-gray-100"}`}>{debtRatio.toFixed(1)}%</p><p className="mt-1 text-xs text-gray-500">Liabilities as a share of total assets</p></div>
        <div className="panel p-5"><TrendingUp className="h-5 w-5 text-purple-500" /><p className="metric-label mt-4">Portfolio XIRR</p><p className={`mt-2 text-2xl font-bold tnum ${portfolioXirr == null ? "text-gray-100" : portfolioXirr >= 0 ? "text-green-500" : "text-red-500"}`}>{portfolioXirr == null ? "—" : formatSignedPercent(portfolioXirr * 100)}</p><p className="mt-1 text-xs text-gray-500">Annualized money-weighted return across your holdings</p></div>
      </section>
    </div>
  );
}

function EmptyRow({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="flex items-center justify-center gap-2 rounded-xl border border-dashed border-gray-600 py-8 text-sm font-medium text-gray-500 transition-colors hover:border-brand-500/40 hover:text-brand-500"
    >
      <Plus className="h-4 w-4" /> {label}
    </Link>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { ShieldCheck } from "lucide-react";
import type {
  LiveDataCenterOutput,
  LiveDataFreshness,
  LiveDataProviderProfile,
  LiveDataProviderState,
} from "@/domain/live-data";
import { StatusBadge } from "@/components/ui/status-badge";
import { count } from "@/core/format";
import { Page as Shell, Kpi, KpiStrip, Masthead, Panel } from "../../../../components/ui/page-shell";
import { Banner } from "../../../../components/ui/banner";
import { currentUserId, ensureSeeded, services } from "@/infra/container";
import RefreshPricesButton from "../refresh-prices-button";

export const metadata: Metadata = { title: "Investment live data" };

const STATE_LABEL: Record<LiveDataProviderState, string> = {
  READY: "Ready",
  CONFIG_REQUIRED: "Setup needed",
  CACHE_ONLY: "Cached only",
  UNAVAILABLE: "Unavailable",
};

const FRESHNESS_LABEL: Record<LiveDataFreshness, string> = {
  LIVE: "Current / live",
  DELAYED: "Delayed",
  EOD: "End of day",
  NAV_DAILY: "Daily NAV",
  STALE: "Stale cache",
  UNAVAILABLE: "Unavailable",
};

const COST_LABEL: Record<LiveDataProviderProfile["cost"], string> = {
  FREE: "Free",
  PAID: "Paid entitlement",
  OPTIONAL_KEY: "Optional API key",
};

export default async function LiveDataPage() {
  await connection();

  const userId = await currentUserId();
  await ensureSeeded(userId);
  const data = await services().liveData.view.execute({ userId });

  return (
    <Shell>
      <Masthead title="Live Data Center" side={<><StatusBadge tone="accent">Data tracking</StatusBadge><RefreshPricesButton /></>} />
      <p className="text-sm text-(--fg-muted)">See which catalogues and quote feeds are available, how fresh each source is, and which holdings can be refreshed now.</p>

      <section aria-labelledby="coverage-title" className="space-y-3">
        <div>
          <p className="section-kicker">Portfolio coverage</p>
          <h2 id="coverage-title" className="text-lg font-semibold text-(--fg)">Tracked markets</h2>
          <p className="mt-1 text-sm text-(--fg-muted)">Read at {formatDateTime(data.asOf)}. Counts include registered instruments, even before a price is available.</p>
        </div>
        <KpiStrip>
          <Kpi label="Indian stocks" value={count(data.coverage.indianStocks)} detail="NSE and exchange-traded holdings" />
          <Kpi label="Indian mutual funds" value={count(data.coverage.indianFunds)} detail="AMFI scheme-code tracking" />
          <Kpi label="US stocks" value={count(data.coverage.usStocks)} detail="USD holdings and optional quotes" />
          <Kpi label="Other instruments" value={count(data.coverage.other)} detail="Manual or non-streaming assets" />
        </KpiStrip>
      </section>

      <section aria-labelledby="providers-title" className="space-y-3">
        <div>
          <p className="section-kicker">Provider truth</p>
          <h2 id="providers-title" className="text-lg font-semibold text-(--fg)">Readiness, cost and freshness</h2>
          <p className="mt-1 max-w-3xl text-sm text-(--fg-muted)">Live means the provider adapter and required entitlement are configured. Daily NAV, delayed and catalogue-only sources are labelled separately.</p>
        </div>
        <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
          {data.providers.map((provider) => <ProviderCard key={provider.id} provider={provider} />)}
        </div>
      </section>

      <section aria-labelledby="tracking-title" className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="section-kicker">Tracking inventory</p>
            <h2 id="tracking-title" className="text-lg font-semibold text-(--fg)">Registered instruments</h2>
            <p className="mt-1 text-sm text-(--fg-muted)">Freshness describes the preferred data lane for each holding. It is not an execution price.</p>
          </div>
          <Link href="/investments/new" className="ghost-btn h-10 px-4 text-xs">Add investment</Link>
        </div>

        {data.tracked.length === 0 ? (
          <Banner title="No instruments to track">
            <p>Add an Indian stock, AMFI mutual fund or USD US stock to see its data coverage here.</p>
            <Link href="/investments/new" className="primary-btn h-10 px-4 text-xs">Add first investment</Link>
          </Banner>
        ) : (
          <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {data.tracked.map((instrument) => (
              <li key={instrument.instrumentId}>
                <Panel
                  title={instrument.symbol}
                  description={instrument.name}
                  actions={<><StatusBadge tone={instrument.preferredPriceFreshness === "LIVE" ? "accent" : "neutral"}>{FRESHNESS_LABEL[instrument.preferredPriceFreshness]}</StatusBadge><Link href={`/investments/${instrument.instrumentId}`} className="focus-brand text-xs font-semibold text-(--fg) hover:text-brand-400" aria-label={`Open ${instrument.symbol}`}>{instrument.symbol}</Link></>}
                >
                <dl className="mt-4 grid grid-cols-3 gap-2 text-xs">
                  <div><dt className="text-(--fg-muted)">Market</dt><dd className="mt-1 text-(--fg)">{marketLabel(instrument.market)}</dd></div>
                  <div><dt className="text-(--fg-muted)">Currency</dt><dd className="mt-1 text-(--fg)">{instrument.currency}</dd></div>
                  <div><dt className="text-(--fg-muted)">Type</dt><dd className="mt-1 truncate text-(--fg)" title={instrument.kind}>{instrument.kind.replaceAll("_", " ")}</dd></div>
                </dl>
                <p className="mt-4 border-t border-(--border)/60 pt-3 text-xs leading-5 text-(--fg-muted)">{instrument.readinessReason}</p>
                </Panel>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="automation-title" className="space-y-3">
        <div>
          <p className="section-kicker">Future data seam</p>
          <h2 id="automation-title" className="text-lg font-semibold text-(--fg)">Streaming and HFT readiness</h2>
          <p className="mt-1 max-w-3xl text-sm text-(--fg-muted)">These checks cover market-data inputs only. Automated execution, strategy loops and order placement are disabled and have no controls on this page.</p>
        </div>
        <div className="grid gap-4 lg:grid-cols-3">
          {data.automationReadiness.map((item) => (
            <Panel
              key={item.label}
              title={item.label}
              description={automationStateLabel(item.state)}
            >
              <p className="text-sm leading-6 text-(--fg-secondary)">{item.detail}</p>
            </Panel>
          ))}
        </div>
        <div className="flex gap-3 rounded-xl border border-(--warn)/25 bg-(--warn)/[0.06] p-4" role="note">
          <ShieldCheck className="mt-0.5 size-5 shrink-0 text-(--warn)" aria-hidden />
          <div>
            <p className="text-sm font-semibold text-(--fg)">Execution boundary</p>
            <p className="mt-1 text-sm leading-6 text-(--fg-secondary)">Quotes and NAVs can update portfolio valuation. They cannot create trades, submit broker orders or supply an execution price to the investment-entry form.</p>
          </div>
        </div>
      </section>
    </Shell>
  );
}

function ProviderCard({ provider }: { provider: LiveDataProviderProfile }) {
  const ready = provider.state === "READY";
  return (
    <Panel
      title={provider.name}
      description={`${provider.market === "GLOBAL" ? "Global" : provider.market} market`}
      actions={<StatusBadge tone={ready ? "accent" : "neutral"}>{STATE_LABEL[provider.state]}</StatusBadge>}
    >
      <dl className="grid grid-cols-2 gap-3 border-y border-(--border)/60 py-3 text-xs">
        <div><dt className="text-(--fg-muted)">Freshness</dt><dd className="mt-1 font-medium text-(--fg)">{FRESHNESS_LABEL[provider.freshness]}</dd></div>
        <div><dt className="text-(--fg-muted)">Cost</dt><dd className="mt-1 font-medium text-(--fg)">{COST_LABEL[provider.cost]}</dd></div>
        <div className="col-span-2"><dt className="text-(--fg-muted)">Last catalogue fetch</dt><dd className="mt-1 font-medium text-(--fg)">{provider.lastFetch ? formatDateTime(provider.lastFetch) : "No cached fetch recorded"}</dd></div>
      </dl>
      <div className="mt-3 flex flex-wrap gap-2">
        {provider.assetClasses.map((assetClass) => <StatusBadge key={assetClass}>{assetClass.replaceAll("_", " ")}</StatusBadge>)}
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div>
          <p className="text-xs font-medium text-(--fg-secondary)">Available</p>
          <ul className="mt-1 space-y-1 text-xs leading-5 text-(--fg-muted)">{provider.capabilities.map((capability) => <li key={capability}>• {capability}</li>)}</ul>
        </div>
        <div>
          <p className="text-xs font-medium text-(--fg-secondary)">Limits</p>
          <ul className="mt-1 space-y-1 text-xs leading-5 text-(--fg-muted)">{provider.limitations.map((limitation) => <li key={limitation}>• {limitation}</li>)}</ul>
        </div>
      </div>
    </Panel>
  );
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Kolkata",
  }).format(new Date(value));
}

function marketLabel(market: LiveDataCenterOutput["tracked"][number]["market"]): string {
  return market === "IN" ? "India" : market === "US" ? "United States" : "Other";
}

function automationStateLabel(state: LiveDataCenterOutput["automationReadiness"][number]["state"]): string {
  if (state === "READY") return "Data seam ready";
  if (state === "NEEDS_CONFIG") return "Configuration needed";
  return "Deferred by design";
}

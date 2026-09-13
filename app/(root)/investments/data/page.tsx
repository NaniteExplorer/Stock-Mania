import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import {
  Activity,
  BadgeDollarSign,
  DatabaseZap,
  Gauge,
  Globe2,
  Landmark,
  RadioTower,
  ShieldCheck,
} from "lucide-react";
import type {
  LiveDataCenterOutput,
  LiveDataFreshness,
  LiveDataProviderProfile,
  LiveDataProviderState,
} from "@/domain/live-data";
import { Card, EmptyState, PageHeader, Pill, Stat } from "@/ui/primitives";
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
    <>
      <PageHeader
        title="Live Data Center"
        subtitle="See which catalogues and quote feeds are available, how fresh each source is, and which holdings can be refreshed now."
        badge={<Pill tone="brand" icon={DatabaseZap}>Data tracking</Pill>}
        action={<RefreshPricesButton />}
      />

      <section aria-labelledby="coverage-title" className="space-y-3">
        <div>
          <p className="section-kicker">Portfolio coverage</p>
          <h2 id="coverage-title" className="text-lg font-semibold text-gray-100">Tracked markets</h2>
          <p className="mt-1 text-sm text-gray-500">Read at {formatDateTime(data.asOf)}. Counts include registered instruments, even before a price is available.</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Stat label="Indian stocks" value={String(data.coverage.indianStocks)} hint="NSE and exchange-traded holdings" icon={Landmark} />
          <Stat label="Indian mutual funds" value={String(data.coverage.indianFunds)} hint="AMFI scheme-code tracking" icon={Activity} />
          <Stat label="US stocks" value={String(data.coverage.usStocks)} hint="USD holdings and optional quotes" icon={Globe2} />
          <Stat label="Other instruments" value={String(data.coverage.other)} hint="Manual or non-streaming assets" icon={Gauge} />
        </div>
      </section>

      <section aria-labelledby="providers-title" className="space-y-3">
        <div>
          <p className="section-kicker">Provider truth</p>
          <h2 id="providers-title" className="text-lg font-semibold text-gray-100">Readiness, cost and freshness</h2>
          <p className="mt-1 max-w-3xl text-sm text-gray-500">Live means the provider adapter and required entitlement are configured. Daily NAV, delayed and catalogue-only sources are labelled separately.</p>
        </div>
        <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
          {data.providers.map((provider) => <ProviderCard key={provider.id} provider={provider} />)}
        </div>
      </section>

      <section aria-labelledby="tracking-title" className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="section-kicker">Tracking inventory</p>
            <h2 id="tracking-title" className="text-lg font-semibold text-gray-100">Registered instruments</h2>
            <p className="mt-1 text-sm text-gray-500">Freshness describes the preferred data lane for each holding. It is not an execution price.</p>
          </div>
          <Link href="/investments/new" className="ghost-btn h-10 px-4 text-xs">Add investment</Link>
        </div>

        {data.tracked.length === 0 ? (
          <section className="panel p-0">
            <EmptyState
              icon={DatabaseZap}
              title="No instruments to track"
              body="Add an Indian stock, AMFI mutual fund or USD US stock to see its data coverage here."
              action={<Link href="/investments/new" className="primary-btn h-10 px-4 text-xs">Add first investment</Link>}
            />
          </section>
        ) : (
          <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {data.tracked.map((instrument) => (
              <li key={instrument.instrumentId} className="panel p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Link href={`/investments/${instrument.instrumentId}`} className="focus-brand font-semibold text-gray-100 hover:text-brand-400">{instrument.symbol}</Link>
                    <p className="mt-1 truncate text-xs text-gray-500" title={instrument.name}>{instrument.name}</p>
                  </div>
                  <Pill tone={instrument.preferredPriceFreshness === "LIVE" ? "brand" : "neutral"}>{FRESHNESS_LABEL[instrument.preferredPriceFreshness]}</Pill>
                </div>
                <dl className="mt-4 grid grid-cols-3 gap-2 text-xs">
                  <div><dt className="text-gray-500">Market</dt><dd className="mt-1 text-gray-200">{marketLabel(instrument.market)}</dd></div>
                  <div><dt className="text-gray-500">Currency</dt><dd className="mt-1 text-gray-200">{instrument.currency}</dd></div>
                  <div><dt className="text-gray-500">Type</dt><dd className="mt-1 truncate text-gray-200" title={instrument.kind}>{instrument.kind.replaceAll("_", " ")}</dd></div>
                </dl>
                <p className="mt-4 border-t border-gray-600/60 pt-3 text-xs leading-5 text-gray-500">{instrument.readinessReason}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="automation-title" className="space-y-3">
        <div>
          <p className="section-kicker">Future data seam</p>
          <h2 id="automation-title" className="text-lg font-semibold text-gray-100">Streaming and HFT readiness</h2>
          <p className="mt-1 max-w-3xl text-sm text-gray-500">These checks cover market-data inputs only. Automated execution, strategy loops and order placement are disabled and have no controls on this page.</p>
        </div>
        <div className="grid gap-4 lg:grid-cols-3">
          {data.automationReadiness.map((item) => (
            <Card
              key={item.label}
              title={item.label}
              kicker={automationStateLabel(item.state)}
              className={item.state === "READY" ? "border-brand-500/40" : undefined}
            >
              <p className="text-sm leading-6 text-gray-400">{item.detail}</p>
            </Card>
          ))}
        </div>
        <div className="flex gap-3 rounded-xl border border-amber-500/25 bg-amber-500/[0.06] p-4" role="note">
          <ShieldCheck className="mt-0.5 size-5 shrink-0 text-amber-400" aria-hidden />
          <div>
            <p className="text-sm font-semibold text-gray-100">Execution boundary</p>
            <p className="mt-1 text-sm leading-6 text-gray-400">Quotes and NAVs can update portfolio valuation. They cannot create trades, submit broker orders or supply an execution price to the investment-entry form.</p>
          </div>
        </div>
      </section>
    </>
  );
}

function ProviderCard({ provider }: { provider: LiveDataProviderProfile }) {
  const ready = provider.state === "READY";
  return (
    <Card
      title={provider.name}
      kicker={`${provider.market === "GLOBAL" ? "Global" : provider.market} market`}
      className={ready ? "border-brand-500/40" : undefined}
      action={<Pill tone={ready ? "brand" : "neutral"}>{STATE_LABEL[provider.state]}</Pill>}
    >
      <dl className="grid grid-cols-2 gap-3 border-y border-gray-600/60 py-3 text-xs">
        <div><dt className="text-gray-500">Freshness</dt><dd className="mt-1 font-medium text-gray-200">{FRESHNESS_LABEL[provider.freshness]}</dd></div>
        <div><dt className="text-gray-500">Cost</dt><dd className="mt-1 font-medium text-gray-200">{COST_LABEL[provider.cost]}</dd></div>
        <div className="col-span-2"><dt className="text-gray-500">Last catalogue fetch</dt><dd className="mt-1 font-medium text-gray-200">{provider.lastFetch ? formatDateTime(provider.lastFetch) : "No cached fetch recorded"}</dd></div>
      </dl>
      <div className="mt-3 flex flex-wrap gap-2">
        {provider.assetClasses.map((assetClass) => <Pill key={assetClass}>{assetClass.replaceAll("_", " ")}</Pill>)}
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div>
          <p className="text-xs font-medium text-gray-300">Available</p>
          <ul className="mt-1 space-y-1 text-xs leading-5 text-gray-500">{provider.capabilities.map((capability) => <li key={capability}>• {capability}</li>)}</ul>
        </div>
        <div>
          <p className="text-xs font-medium text-gray-300">Limits</p>
          <ul className="mt-1 space-y-1 text-xs leading-5 text-gray-500">{provider.limitations.map((limitation) => <li key={limitation}>• {limitation}</li>)}</ul>
        </div>
      </div>
    </Card>
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

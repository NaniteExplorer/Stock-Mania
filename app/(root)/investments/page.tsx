import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, BarChart3, BriefcaseBusiness, LineChart, PlusCircle } from "lucide-react";
import { connection } from "next/server";
import { CalendarDate } from "@/core/time";
import { Currency, Money } from "@/core/money";
import { groupLabel, groupOfKind } from "@/domain/asset-groups";
import type { InvestmentMetric, InvestmentWorkspaceOutput } from "@/app/investing.usecases";
import { Card, EmptyState, PageHeader, Pill, Stat } from "@/ui/primitives";
import { formatMoney, formatMoneyCompact } from "@/ui/format";
import { currentUserId, ensureSeeded, services } from "@/infra/container";
import AllocationDashboard, { type AllocationSlice } from "./allocation-dashboard";

export const metadata: Metadata = { title: "Investments" };

const metricCards = ["marketValue", "unrealisedPnl", "realisedPnl"] as const;

export default async function Page() {
  await connection();

  const workspace = await readWorkspace();

  if (!workspace) {
    return (
      <>
        <PageHeader
          title="Investments"
          subtitle="Track holdings, performance and realised activity from one ledger-backed workspace."
          badge={<Pill tone="brand">Workspace</Pill>}
          action={<AddInvestmentLink />}
        />
        <section className="panel p-0">
          <EmptyState
            icon={BriefcaseBusiness}
            title="No investments recorded yet"
            body="Add an investment, then record the actual trade. The overview starts showing valuation, realised gain and allocation once the ledger has a holding."
            action={<AddInvestmentLink />}
          />
        </section>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Investments"
        subtitle="Portfolio value, gain and activity from verified ledger and valuation inputs."
        badge={<Pill tone={workspace.dataQuality.status === "COMPLETE" ? "brand" : "neutral"}>{qualityLabel(workspace)}</Pill>}
        action={<AddInvestmentLink />}
      />

      <section className="mb-6 grid gap-3 md:grid-cols-3" aria-label="Investment overview metrics">
        {metricCards.map((key) => (
          <MetricStat key={key} label={metricLabel(key)} metric={workspace.metrics[key]} />
        ))}
      </section>

      <Card className="mb-6" title="Valuation status" subtitle={`As of ${workspace.asOf}`}>
        <div className="grid gap-3 text-sm md:grid-cols-3">
          <QualityList title="Unpriced" items={workspace.dataQuality.unpricedPositions} />
          <QualityList title="Stale" items={workspace.dataQuality.stalePositions} />
          <QualityList title="FX unavailable" items={workspace.dataQuality.unconvertedPositions} />
        </div>
        {workspace.dataQuality.status === "PARTIAL" && (
          <p className="mt-4 flex items-start gap-2 text-sm text-amber-500">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            The portfolio total is withheld until every holding has a price and required FX conversion.
          </p>
        )}
      </Card>

      <AllocationDashboard slices={allocationSlices(workspace)} reportingCurrency={workspace.reportingCurrency} />

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4" aria-label="Investment workspace routes">
        <RouteCard
          href="/investments/holdings"
          icon={BriefcaseBusiness}
          title="Holdings"
          body="Search and filter open positions, with stale and unpriced rows called out."
        />
        <RouteCard
          href="/investments/performance"
          icon={BarChart3}
          title="Performance"
          body="Invested amount, market value, realised gain and unavailable return inputs."
        />
        <RouteCard
          href="/investments/activity"
          icon={LineChart}
          title="Activity"
          body="Durable links to holding records and realised-gain history."
        />
        <RouteCard
          href="/investments/new"
          icon={PlusCircle}
          title="Add investment"
          body="Search the catalogue or enter a historical trade manually."
        />
      </section>
    </>
  );
}

async function readWorkspace(): Promise<InvestmentWorkspaceOutput | null> {
  const userId = await currentUserId();
  await ensureSeeded(userId);

  const { investing, repositories } = services();
  const instruments = await repositories.instruments.list(userId, { includeClosed: true });
  if (instruments.length === 0) return null;

  const asOf = CalendarDate.parse(new Date().toISOString().slice(0, 10));
  const workspace = await investing.workspace.execute({ userId, asOf });
  if (!workspace.ok) throw new Error(workspace.error.message);
  return workspace.value;
}

function MetricStat({ label, metric }: { label: string; metric: InvestmentMetric }) {
  const value = metric.status === "AVAILABLE" ? formatMetricValue(metric) : "Unavailable";
  const hint = metric.status === "AVAILABLE" ? metricLabelLine(metric) : metric.message;
  return <Stat label={label} value={<span className="tnum">{value}</span>} hint={hint} />;
}

function RouteCard({
  href,
  icon: Icon,
  title,
  body,
}: {
  href: string;
  icon: typeof BriefcaseBusiness;
  title: string;
  body: string;
}) {
  return (
    <Link href={href} className="panel panel-hover focus-brand block p-5">
      <span className="icon-chip mb-4 h-10 w-10">
        <Icon className="h-4 w-4" aria-hidden />
      </span>
      <span className="block text-base font-semibold text-gray-100">{title}</span>
      <span className="mt-1 block text-sm text-gray-500">{body}</span>
    </Link>
  );
}

function AddInvestmentLink() {
  return (
    <Link href="/investments/new" className="primary-btn h-10 px-4 text-xs">
      <PlusCircle className="h-4 w-4" aria-hidden />
      Add investment
    </Link>
  );
}

function QualityList({ title, items }: { title: string; items: readonly string[] }) {
  return (
    <div>
      <p className="metric-label">{title}</p>
      {items.length === 0 ? (
        <p className="mt-1 text-gray-500">None</p>
      ) : (
        <ul className="mt-1 space-y-1 text-gray-300">
          {items.slice(0, 3).map((item) => (
            <li key={item}>{item}</li>
          ))}
          {items.length > 3 && <li className="text-gray-500">+{items.length - 3} more</li>}
        </ul>
      )}
    </div>
  );
}

function allocationSlices(workspace: InvestmentWorkspaceOutput): AllocationSlice[] {
  const byGroup = new Map<string, { label: string; minor: bigint }>();
  for (const position of workspace.positions) {
    if (!position.marketValue) continue;
    const group = groupOfKind(position.kind);
    const money = Money.fromRupees(position.marketValue.amount, Currency.of(position.marketValue.currency));
    const existing = byGroup.get(group);
    byGroup.set(group, {
      label: groupLabel(group),
      minor: (existing?.minor ?? 0n) + money.minor,
    });
  }

  return [...byGroup.entries()]
    .map(([id, row]) => {
      const value = Money.fromMinor(row.minor, Currency.of(workspace.reportingCurrency));
      return {
        id,
        label: row.label,
        value: value.toMinorNumber(),
        formatted: formatMoney(value),
      };
    })
    .sort((a, b) => b.value - a.value);
}

function metricLabel(key: (typeof metricCards)[number]): string {
  const labels: Record<(typeof metricCards)[number], string> = {
    marketValue: "Market value",
    unrealisedPnl: "Unrealised P&L",
    realisedPnl: "Realised P&L",
  };
  return labels[key];
}

function formatMetricValue(metric: InvestmentMetric): string {
  if (metric.status !== "AVAILABLE") return "Unavailable";
  if (metric.unit === "PERCENTAGE") return `${trimDecimal(metric.value, 2)}%`;
  return formatMoneyCompact(Money.fromRupees(metric.value, Currency.of(metric.currency ?? "INR")));
}

function metricLabelLine(metric: InvestmentMetric): string {
  return `${metric.scope.toLowerCase()}, ${metric.period.from.toLowerCase()} through ${metric.period.through}`;
}

function qualityLabel(workspace: InvestmentWorkspaceOutput): string {
  if (workspace.dataQuality.status === "COMPLETE") return `Complete valuation - ${workspace.asOf}`;
  if (workspace.dataQuality.status === "STALE") return `Stale prices - ${workspace.asOf}`;
  return `Partial valuation - ${workspace.asOf}`;
}

function trimDecimal(value: string, places: number): string {
  const negative = value.startsWith("-");
  const [whole, fraction = ""] = value.replace("-", "").split(".");
  const trimmed = fraction.padEnd(places, "0").slice(0, places);
  return `${negative ? "-" : ""}${whole}${places > 0 ? `.${trimmed}` : ""}`;
}

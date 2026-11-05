import type { Metadata } from "next";
import { connection } from "next/server";
import { CalendarDate } from "@/core/time";
import type { InvestmentMetric, InvestmentWorkspaceOutput } from "@/app/investing.usecases";
import { StatusBadge } from "@/components/ui/status-badge";
import { Page as Shell, Masthead, Panel } from "../../../../components/ui/page-shell";
import { Banner } from "../../../../components/ui/banner";
import { currentUserId, ensureSeeded, services } from "@/infra/container";
import PerformanceChart from "./performance-chart";

export const metadata: Metadata = { title: "Investment performance" };

const MONEY_METRICS = [
  "investedAmount",
  "marketValue",
  "unrealisedPnl",
  "realisedPnl",
  "income",
  "totalInvestmentGain",
] as const;

const RETURN_METRICS = ["absoluteReturn", "xirr", "twr"] as const;

export default async function Page() {
  await connection();

  const workspace = await readWorkspace();

  if (!workspace) {
    return (
      <Shell>
        <Masthead title="Performance" side={<StatusBadge tone="accent">Performance</StatusBadge>} />
        <p className="text-sm text-(--fg-muted)">Returns appear once the ledger has investment cashflows.</p>
        <Banner title="No performance yet">
          <p>Record an investment and its trades first. This page will show only metrics the ledger can prove.</p>
        </Banner>
      </Shell>
    );
  }

  return (
    <Shell>
      <Masthead
        title="Performance"
        side={<StatusBadge tone={workspace.dataQuality.status === "COMPLETE" ? "accent" : "neutral"}>{workspace.asOf}</StatusBadge>}
      />
      <p className="text-sm text-(--fg-muted)">Every metric names its scope, valuation date and source inputs.</p>

      <PerformanceChart metrics={workspace.metrics} reportingCurrency={workspace.reportingCurrency} asOf={workspace.asOf} />

      <section className="mb-6 grid gap-3 md:grid-cols-2 xl:grid-cols-3" aria-label="Money performance metrics">
        {MONEY_METRICS.map((key) => (
          <MetricPanel key={key} label={metricLabel(key)} metric={workspace.metrics[key]} />
        ))}
      </section>

      <section className="grid gap-3 md:grid-cols-3" aria-label="Return metrics">
        {RETURN_METRICS.map((key) => (
          <MetricPanel key={key} label={metricLabel(key)} metric={workspace.metrics[key]} />
        ))}
      </section>
    </Shell>
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

function MetricPanel({ label, metric }: { label: string; metric: InvestmentMetric }) {
  return (
    <Panel title={label} description={`${metric.scope.toLowerCase()} through ${metric.period.through}`}>
      {metric.status === "AVAILABLE" ? (
        <p className="tnum text-2xl font-semibold text-(--fg)">
          {metric.unit === "PERCENTAGE" ? `${trimDecimal(metric.value, 2)}%` : `${metric.currency} ${metric.value}`}
        </p>
      ) : (
        <>
          <p className="text-sm font-medium text-(--warn)">{reasonLabel(metric.reason)}</p>
          <p className="mt-2 text-sm text-(--fg-secondary)">{metric.message}</p>
        </>
      )}
      <p className="mt-3 text-xs text-(--fg-muted)">As of {metric.asOf}</p>
      <ul className="mt-2 flex flex-wrap gap-1.5" aria-label={`${label} provenance`}>
        {metric.provenance.map((source) => (
          <li key={source} className="rounded-md border border-(--border) px-2 py-1 text-xs text-(--fg-muted)">
            {source}
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function metricLabel(key: keyof InvestmentWorkspaceOutput["metrics"]): string {
  const labels: Record<keyof InvestmentWorkspaceOutput["metrics"], string> = {
    investedAmount: "Invested amount",
    marketValue: "Market value",
    unrealisedPnl: "Unrealised P&L",
    realisedPnl: "Realised P&L",
    income: "Income",
    totalInvestmentGain: "Total investment gain",
    absoluteReturn: "Absolute return",
    xirr: "XIRR",
    twr: "TWR",
  };
  return labels[key];
}

function reasonLabel(reason: string): string {
  return reason.toLowerCase().replaceAll("_", " ");
}

function trimDecimal(value: string, places: number): string {
  const negative = value.startsWith("-");
  const [whole, fraction = ""] = value.replace("-", "").split(".");
  const trimmed = fraction.padEnd(places, "0").slice(0, places);
  return `${negative ? "-" : ""}${whole}${places > 0 ? `.${trimmed}` : ""}`;
}

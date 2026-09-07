import type { Metadata } from "next";
import { BarChart3 } from "lucide-react";
import { connection } from "next/server";
import { CalendarDate } from "@/core/time";
import type { InvestmentMetric, InvestmentWorkspaceOutput } from "@/app/investing.usecases";
import { Card, EmptyState, PageHeader, Pill } from "@/ui/primitives";
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
      <>
        <PageHeader title="Performance" subtitle="Returns appear once the ledger has investment cashflows." badge={<Pill tone="brand">Performance</Pill>} />
        <section className="panel p-0">
          <EmptyState
            icon={BarChart3}
            title="No performance yet"
            body="Record an investment and its trades first. This page will show only metrics the ledger can prove."
          />
        </section>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Performance"
        subtitle="Every metric names its scope, valuation date and source inputs."
        badge={<Pill tone={workspace.dataQuality.status === "COMPLETE" ? "brand" : "neutral"}>{workspace.asOf}</Pill>}
      />

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

function MetricPanel({ label, metric }: { label: string; metric: InvestmentMetric }) {
  return (
    <Card title={label} subtitle={`${metric.scope.toLowerCase()} through ${metric.period.through}`}>
      {metric.status === "AVAILABLE" ? (
        <p className="tnum text-2xl font-semibold text-gray-100">
          {metric.unit === "PERCENTAGE" ? `${trimDecimal(metric.value, 2)}%` : `${metric.currency} ${metric.value}`}
        </p>
      ) : (
        <>
          <p className="text-sm font-medium text-amber-500">{reasonLabel(metric.reason)}</p>
          <p className="mt-2 text-sm text-gray-400">{metric.message}</p>
        </>
      )}
      <p className="mt-3 text-xs text-gray-500">As of {metric.asOf}</p>
      <ul className="mt-2 flex flex-wrap gap-1.5" aria-label={`${label} provenance`}>
        {metric.provenance.map((source) => (
          <li key={source} className="rounded-md border border-gray-600 px-2 py-1 text-xs text-gray-500">
            {source}
          </li>
        ))}
      </ul>
    </Card>
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

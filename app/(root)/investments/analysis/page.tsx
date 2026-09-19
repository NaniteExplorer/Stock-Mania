import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { AlertTriangle, BarChart3, DatabaseZap, Gauge, Radar } from "lucide-react";
import type { InvestmentAnalysisRow } from "@/app/investment-analysis.usecases";
import { CalendarDate } from "@/core/time";
import type { AssetGroup } from "@/domain/asset-groups";
import { groupLabel } from "@/domain/asset-groups";
import { currentUserId, ensureSeeded, services } from "@/infra/container";
import { Card, EmptyState, PageHeader, Pill, Stat } from "@/ui/primitives";
import AnalysisChart from "./analysis-chart";

export const metadata: Metadata = { title: "Investment analysis" };

type Query = { range?: string | string[]; family?: string | string[]; instrument?: string | string[] };
const RANGES = { "1M": 30, "3M": 90, "6M": 180, "1Y": 365, "3Y": 1095 } as const;
const FAMILIES: readonly AssetGroup[] = ["EQUITY", "FUNDS", "DIGITAL_METALS", "FIXED_INCOME", "REAL_ESTATE", "CRYPTO"];

export default async function AnalysisPage({ searchParams }: { searchParams: Promise<Query> }) {
  await connection();
  const query = await searchParams;
  const rangeKey = one(query.range) in RANGES ? one(query.range) as keyof typeof RANGES : "1Y";
  const family = FAMILIES.includes(one(query.family) as AssetGroup) ? one(query.family) as AssetGroup : null;
  const instrumentId = cleanId(one(query.instrument));
  const through = CalendarDate.parse(new Date().toISOString().slice(0, 10));
  const from = through.plusDays(-(RANGES[rangeKey] - 1));
  const userId = await currentUserId();
  await ensureSeeded(userId);
  const output = await services().investing.analysis.execute({ userId, from, through, instrumentId: instrumentId ?? undefined });
  const eligibleRows = family && !instrumentId ? output.rows.filter((row) => row.assetFamily === family) : output.rows;
  const selected = instrumentId ? eligibleRows[0] : eligibleRows.find((row) => row.series.length > 0) ?? eligibleRows[0];

  return (
    <>
      <PageHeader title="Investment analysis" subtitle="Auditable technical and risk measures calculated from your stored daily observations." badge={<Pill tone="brand" icon={Radar}>Descriptive analysis</Pill>} />
      <Card title="Analysis scope" subtitle="Filters are retained in the URL and calculations stay on the server." className="mb-6">
        <form method="get" className="grid gap-4 md:grid-cols-3">
          <Filter label="Range" name="range" defaultValue={rangeKey} options={Object.keys(RANGES).map((key) => [key, key])} />
          <Filter label="Asset family" name="family" defaultValue={family ?? ""} options={[["", "All eligible families"], ...FAMILIES.map((value) => [value, assetFamilyLabel(value)])]} />
          <Filter label="Instrument" name="instrument" defaultValue={instrumentId ?? ""} options={[["", "Automatic selection"], ...output.rows.map((row) => [row.instrumentId, `${row.symbol} - ${row.name}`])]} />
          <div className="md:col-span-3 flex flex-wrap items-center gap-3"><button className="primary-btn h-10 px-4 text-xs" type="submit">Apply scope</button><Link className="ghost-btn h-10 px-4 text-xs" href="/investments/analysis">Reset</Link><p className="text-xs text-gray-500">{from.toISO()} through {through.toISO()}</p></div>
        </form>
      </Card>

      {output.selection === "NOT_FOUND" ? <section className="panel p-0"><EmptyState icon={AlertTriangle} title="Instrument unavailable" body="This instrument is not in your active portfolio or is not eligible for stored-bar analysis." /></section>
      : !selected ? <section className="panel p-0"><EmptyState icon={BarChart3} title="No eligible analysis data" body="Add a supported non-digital holding and ingest daily bars before using this workspace." /></section>
      : <AnalysisWorkspace row={selected} rows={eligibleRows} rangeKey={rangeKey} family={family} />}
    </>
  );
}

function AnalysisWorkspace({ row, rows, rangeKey, family }: { row: InvestmentAnalysisRow; rows: readonly InvestmentAnalysisRow[]; rangeKey: string; family: AssetGroup | null }) {
  const metric = (needle: string) => row.indicators.find((item) => item.name.toLowerCase().includes(needle));
  return <div className="space-y-6">
    <section className="flex flex-wrap items-end justify-between gap-3" aria-labelledby="selected-analysis"><div><p className="section-kicker">{groupLabel(row.assetFamily)} / {row.kind.replaceAll("_", " ")}</p><h2 id="selected-analysis" className="text-xl font-semibold text-gray-100">{row.symbol} <span className="font-normal text-gray-500">{row.name}</span></h2><p className="mt-1 text-sm text-gray-500">{rangeKey} range · as of {row.asOf ?? "unavailable"} · {row.barsUsed} bars</p></div><Pill tone={row.series.length > 0 ? "brand" : "neutral"}>{row.series.length > 0 ? "Stored observations" : "Unavailable"}</Pill></section>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <MetricStat label="Period return" metric={row.periodReturn} icon={BarChart3} />
      <MetricStat label="Maximum drawdown" metric={row.maximumDrawdown} icon={Gauge} />
      <MetricStat label="RSI" metric={metric("rsi") ?? null} icon={Radar} />
      <MetricStat label="Realised volatility" metric={metric("volatility") ?? null} icon={DatabaseZap} />
    </div>
    <AnalysisChart row={row} />
    <div className="grid gap-4 xl:grid-cols-[1.35fr_0.65fr]">
      <Card title="Technical indicators" subtitle="Unavailable values remain explicit when the lookback is insufficient." padding="none"><div className="table-scroll"><table className="w-full text-sm"><caption className="sr-only">Technical indicators for {row.symbol}</caption><thead><tr className="border-b border-gray-600"><th scope="col" className="metric-label px-4 py-3 text-left">Indicator</th><th scope="col" className="metric-label px-4 py-3 text-right">Window</th><th scope="col" className="metric-label px-4 py-3 text-right">Value</th><th scope="col" className="metric-label px-4 py-3 text-left">Status</th></tr></thead><tbody>{row.indicators.map((item) => <tr key={item.name} className="border-b border-gray-600/50 last:border-0"><th scope="row" className="px-4 py-3 text-left font-medium text-gray-200">{item.name}</th><td className="tnum px-4 py-3 text-right text-gray-400">{item.window}</td><td className="tnum px-4 py-3 text-right text-gray-100">{item.status === "AVAILABLE" ? formatNumber(item.value) : "-"}</td><td className="px-4 py-3 text-xs text-gray-500">{item.status === "AVAILABLE" ? "Available" : item.reason}</td></tr>)}</tbody></table></div></Card>
      <div className="space-y-4"><Card title="Data provenance" subtitle={`Latest stored bar: ${row.asOf ?? "unavailable"}`}><dl className="space-y-3 text-sm"><Fact term="Sources" value={row.provenance.length ? row.provenance.join(", ") : "No source observations"} /><Fact term="Stored range" value={`${row.range.from} to ${row.range.through}`} /><Fact term="Data gaps" value={row.gaps.length ? `${row.gaps.length} recorded gap(s)` : "No recorded gaps"} /><Fact term="Eligible instruments" value={`${rows.length}${family ? ` in ${assetFamilyLabel(family)}` : ""}`} /></dl></Card>{(row.warnings.length > 0 || row.gaps.length > 0) && <Card title="Data-quality notes" className="border-amber-500/30"><ul className="space-y-2 text-sm text-gray-400">{row.warnings.map((warning) => <li key={warning}>• {warning}</li>)}{row.gaps.map((gap) => <li key={`${gap.from}-${gap.through}`}>• Missing observations: {gap.from} to {gap.through}</li>)}</ul></Card>}</div>
    </div>
    <p className="text-xs leading-5 text-gray-500" role="note">Indicators summarize historical observations and do not constitute investment advice, a forecast, or a buy/sell signal.</p>
  </div>;
}

function MetricStat({ label, metric, icon }: { label: string; metric: { status: string; value?: number | null; unit?: string; message?: string; reason?: string } | null; icon: typeof Radar }) { const available = metric?.status === "AVAILABLE" && metric.value != null; return <Stat label={label} value={available ? `${formatNumber(metric.value)}${metric.unit === "PERCENTAGE" ? "%" : ""}` : "Unavailable"} hint={available ? "Stored daily bars" : metric?.message ?? metric?.reason ?? "Insufficient data"} icon={icon} />; }
function Filter({ label, name, defaultValue, options }: { label: string; name: string; defaultValue: string; options: readonly (readonly string[])[] }) { return <label className="space-y-2"><span className="form-label">{label}</span><select name={name} defaultValue={defaultValue} className="form-control w-full">{options.map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select></label>; }
function Fact({ term, value }: { term: string; value: string }) { return <div><dt className="text-xs text-gray-500">{term}</dt><dd className="mt-1 text-gray-200">{value}</dd></div>; }
function one(value: string | string[] | undefined): string { return Array.isArray(value) ? value[0] ?? "" : value ?? ""; }
function cleanId(value: string): string | null { return /^[a-zA-Z0-9_-]{1,100}$/.test(value) ? value : null; }
function formatNumber(value: number | null | undefined): string { return value == null || !Number.isFinite(value) ? "-" : new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(value); }
function assetFamilyLabel(value: AssetGroup): string { return value === "DIGITAL_METALS" ? "Metals and gold securities" : groupLabel(value); }

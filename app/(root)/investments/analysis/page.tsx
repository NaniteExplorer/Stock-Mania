import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import type { InvestmentAnalysisRow } from "@/app/investment-analysis.usecases";
import { CalendarDate } from "@/core/time";
import type { AssetGroup } from "@/domain/asset-groups";
import { groupLabel } from "@/domain/asset-groups";
import { currentUserId, ensureSeeded, services } from "@/infra/container";
import { StatusBadge } from "@/components/ui/status-badge";
import { unknown, type Figure } from "@/core/format";
import { Page as Shell, Kpi, KpiStrip, Masthead, Panel } from "../../../../components/ui/page-shell";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../../../components/ui/table";
import { NativeSelect } from "../../../../components/ui/native-select";
import { Banner } from "../../../../components/ui/banner";
import AnalysisChart from "./analysis-chart";
import { formatAnalysisValue } from "@/ui/format-analysis-value";

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
    <Shell>
      <Masthead title="Investment analysis" side={<StatusBadge tone="accent">Descriptive analysis</StatusBadge>} />
      <p className="text-sm text-(--fg-muted)">Auditable technical and risk measures calculated from your stored daily observations.</p>
      <Panel title="Analysis scope" description="Filters are retained in the URL and calculations stay on the server.">
        <form method="get" className="grid gap-4 md:grid-cols-3">
          <Filter label="Range" name="range" defaultValue={rangeKey} options={Object.keys(RANGES).map((key) => [key, key])} />
          <Filter label="Asset family" name="family" defaultValue={family ?? ""} options={[["", "All eligible families"], ...FAMILIES.map((value) => [value, assetFamilyLabel(value)])]} />
          <Filter label="Instrument" name="instrument" defaultValue={instrumentId ?? ""} options={[["", "Automatic selection"], ...output.rows.map((row) => [row.instrumentId, `${row.symbol} - ${row.name}`])]} />
          <div className="md:col-span-3 flex flex-wrap items-center gap-3"><button className="primary-btn h-10 px-4 text-xs" type="submit">Apply scope</button><Link className="ghost-btn h-10 px-4 text-xs" href="/investments/analysis">Reset</Link><p className="text-xs text-(--fg-muted)">{from.toISO()} through {through.toISO()}</p></div>
        </form>
      </Panel>

      {output.selection === "NOT_FOUND" ? <Banner tone="warning" title="Instrument unavailable"><p>This instrument is not in your active portfolio or is not eligible for stored-bar analysis.</p></Banner>
      : !selected ? <Banner title="No eligible analysis data"><p>Add a supported non-digital holding and ingest daily bars before using this workspace.</p></Banner>
      : <AnalysisWorkspace row={selected} rows={eligibleRows} rangeKey={rangeKey} family={family} />}
    </Shell>
  );
}

function AnalysisWorkspace({ row, rows, rangeKey, family }: { row: InvestmentAnalysisRow; rows: readonly InvestmentAnalysisRow[]; rangeKey: string; family: AssetGroup | null }) {
  const metric = (needle: string) => row.indicators.find((item) => item.name.toLowerCase().includes(needle));
  return <div className="space-y-6">
    <section className="flex flex-wrap items-end justify-between gap-3" aria-labelledby="selected-analysis"><div><p className="section-kicker">{groupLabel(row.assetFamily)} / {row.kind.replaceAll("_", " ")}</p><h2 id="selected-analysis" className="text-xl font-semibold text-(--fg)">{row.symbol} <span className="font-normal text-(--fg-muted)">{row.name}</span></h2><p className="mt-1 text-sm text-(--fg-muted)">{rangeKey} range · as of {row.asOf ?? "unavailable"} · {row.barsUsed} bars</p></div><StatusBadge tone={row.series.length > 0 ? "accent" : "neutral"}>{row.series.length > 0 ? "Stored observations" : "Unavailable"}</StatusBadge></section>
    <KpiStrip>
      <MetricStat label="Period return" metric={row.periodReturn} />
      <MetricStat label="Maximum drawdown" metric={row.maximumDrawdown} />
      <MetricStat label="RSI" metric={metric("rsi") ?? null} />
      <MetricStat label="Realised volatility" metric={metric("volatility") ?? null} />
    </KpiStrip>
    <AnalysisChart row={row} />
    <div className="grid gap-4 xl:grid-cols-[1.35fr_0.65fr]">
      <Panel title="Technical indicators" description="Unavailable values remain explicit when the lookback is insufficient." flush><Table><caption className="sr-only">Technical indicators for {row.symbol}</caption><TableHeader><TableRow><TableHead className="text-left">Indicator</TableHead><TableHead className="text-right">Window</TableHead><TableHead className="text-right">Value</TableHead><TableHead className="text-left">Status</TableHead></TableRow></TableHeader><TableBody>{row.indicators.map((item) => <TableRow key={item.name}><TableHead scope="row" className="text-left">{item.name}</TableHead><TableCell className="tnum text-right">{item.window}</TableCell><TableCell className="tnum text-right">{item.status === "AVAILABLE" ? formatAnalysisValue(item.value, item.unit) : "-"}</TableCell><TableCell className="text-xs text-(--fg-muted)">{item.status === "AVAILABLE" ? "Available" : item.reason}</TableCell></TableRow>)}</TableBody></Table></Panel>
      <div className="space-y-4"><Panel title="Data provenance" description={`Latest stored bar: ${row.asOf ?? "unavailable"}`}><dl className="space-y-3 text-sm"><Fact term="Sources" value={row.provenance.length ? row.provenance.join(", ") : "No source observations"} /><Fact term="Stored range" value={`${row.range.from} to ${row.range.through}`} /><Fact term="Data gaps" value={row.gaps.length ? `${row.gaps.length} recorded gap(s)` : "No recorded gaps"} /><Fact term="Eligible instruments" value={`${rows.length}${family ? ` in ${assetFamilyLabel(family)}` : ""}`} /></dl></Panel>{(row.warnings.length > 0 || row.gaps.length > 0) && <Panel title="Data-quality notes"><ul className="space-y-2 text-sm text-(--fg-secondary)">{row.warnings.map((warning) => <li key={warning}>• {warning}</li>)}{row.gaps.map((gap) => <li key={`${gap.from}-${gap.through}`}>• Missing observations: {gap.from} to {gap.through}</li>)}</ul></Panel>}</div>
    </div>
    <p className="text-xs leading-5 text-(--fg-muted)" role="note">Indicators summarize historical observations and do not constitute investment advice, a forecast, or a buy/sell signal.</p>
  </div>;
}

// formatAnalysisValue is the analysis module's own display formatter (units vary per metric); its digits are display text, so it is a Figure.
function MetricStat({ label, metric }: { label: string; metric: { status: string; value?: number | null; unit?: string; message?: string; reason?: string } | null }) { const text = metric?.status === "AVAILABLE" ? formatAnalysisValue(metric.value, metric.unit) : "—"; const available = /\d/.test(text); return <Kpi label={label} value={available ? text as Figure : unknown(metric?.message || metric?.reason || "Insufficient stored daily bars for this metric")} detail={available ? "Stored daily bars" : undefined} />; }
function Filter({ label, name, defaultValue, options }: { label: string; name: string; defaultValue: string; options: readonly (readonly string[])[] }) { return <label className="space-y-2"><span className="form-label">{label}</span><NativeSelect name={name} defaultValue={defaultValue}>{options.map(([value, text]) => <option key={value} value={value}>{text}</option>)}</NativeSelect></label>; }
function Fact({ term, value }: { term: string; value: string }) { return <div><dt className="text-xs text-(--fg-muted)">{term}</dt><dd className="mt-1 text-(--fg)">{value}</dd></div>; }
function one(value: string | string[] | undefined): string { return Array.isArray(value) ? value[0] ?? "" : value ?? ""; }
function cleanId(value: string): string | null { return /^[a-zA-Z0-9_-]{1,100}$/.test(value) ? value : null; }
function assetFamilyLabel(value: AssetGroup): string { return value === "DIGITAL_METALS" ? "Metals and gold securities" : groupLabel(value); }

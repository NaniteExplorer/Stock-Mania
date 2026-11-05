import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { DatabaseZap } from "lucide-react";
import type { InvestmentTrackerOutput, TrackerFreshness } from "@/app/investment-analysis.usecases";
import { CalendarDate } from "@/core/time";
import { groupLabel } from "@/domain/asset-groups";
import { currentUserId, ensureSeeded, services } from "@/infra/container";
import { StatusBadge } from "@/components/ui/status-badge";
import { count } from "@/core/format";
import { Page as Shell, Kpi, KpiStrip, Masthead, Panel } from "../../../../components/ui/page-shell";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../../../components/ui/table";
import { NativeSelect } from "../../../../components/ui/native-select";
import { Banner } from "../../../../components/ui/banner";

export const metadata: Metadata = { title: "Market tracker" };
type Query = { state?: string | string[]; family?: string | string[] };
const STATES: readonly TrackerFreshness[] = ["LIVE", "CURRENT", "DELAYED", "EOD", "NAV_DAILY", "STALE", "MANUAL", "UNAVAILABLE"];

export default async function TrackerPage({ searchParams }: { searchParams: Promise<Query> }) {
  await connection();
  const query = await searchParams;
  const state = STATES.includes(one(query.state) as TrackerFreshness) ? one(query.state) as TrackerFreshness : null;
  const family = one(query.family);
  const userId = await currentUserId();
  await ensureSeeded(userId);
  const asOf = CalendarDate.parse(new Date().toISOString().slice(0, 10));
  const output = await services().investing.tracker.execute({ userId, asOf });
  const families = [...new Set(output.rows.map((row) => row.assetFamily))];
  const rows = output.rows.filter((row) => (!state || row.freshness === state) && (!family || row.assetFamily === family));
  const available = output.rows.filter((row) => row.availability === "AVAILABLE").length;
  const attention = output.rows.filter((row) => row.dataGap !== "NONE").length;

  return <Shell>
    <Masthead title="Market tracker" side={<StatusBadge tone="accent">As of {output.asOf}</StatusBadge>} />
    <p className="text-sm text-(--fg-muted)">Read-only health and latest stored values for non-digital holdings, with source and timing evidence.</p>
    <KpiStrip><Kpi label="Tracked" value={count(output.rows.length)} detail="Non-digital instruments" /><Kpi label="Values available" value={count(available)} detail="Stored observations only" /><Kpi label="Needs attention" value={count(attention)} detail="Missing, stale, or no comparison" /></KpiStrip>
    <Panel title="Tracker filters"><form method="get" className="flex flex-wrap items-end gap-3"><Select label="Freshness" name="state" defaultValue={state ?? ""} options={[["", "All states"], ...STATES.map((value) => [value, freshnessLabel(value)])]} /><Select label="Asset family" name="family" defaultValue={family} options={[["", "All families"], ...families.map((value) => [value, groupLabel(value)])]} /><button type="submit" className="primary-btn h-10 px-4 text-xs">Apply filters</button><Link href="/investments/tracker" className="ghost-btn h-10 px-4 text-xs">Reset</Link></form></Panel>
    <div className="mb-4 flex gap-3 rounded-lg border border-(--border) bg-(--bg-hover)/30 p-4" role="note"><DatabaseZap className="mt-0.5 size-5 shrink-0 text-brand-400" aria-hidden /><div><p className="text-sm font-semibold text-(--fg)">Stored-data monitor</p><p className="mt-1 text-sm leading-6 text-(--fg-secondary)">Values below are observations already accepted by the server. “Live” appears only for a currently entitled source with recent ingestion; other lanes remain labelled delayed, end-of-day, daily NAV, manual, stale, or unavailable.</p></div></div>
    {rows.length === 0 ? <Banner title="No instruments match"><p>{output.rows.length ? "Change the tracker filters to see another freshness state or asset family." : "Add a supported non-digital investment before using the market tracker."}</p></Banner> : <TrackerTable output={output} rows={rows} />}
    <p className="mt-4 text-xs leading-5 text-(--fg-muted)">Observation date is the provider calendar date, not a guaranteed exchange timestamp or executable price. Availability and licensing depend on the configured account and source.</p>
  </Shell>;
}

function TrackerTable({ output, rows }: { output: InvestmentTrackerOutput; rows: InvestmentTrackerOutput["rows"] }) { return <Panel title="Tracked instruments" description={`Generated ${formatDateTime(output.generatedAt)} · ${rows.length} visible`} flush><Table className="min-w-[1040px]"><caption className="sr-only">Latest stored market observations and data quality</caption><TableHeader><TableRow>{["Instrument", "Asset", "Last value", "Movement", "Freshness", "Observation", "Ingested", "Source", "Data quality"].map((heading) => <TableHead key={heading} className={["Last value", "Movement"].includes(heading) ? "text-right" : "text-left"}>{heading}</TableHead>)}</TableRow></TableHeader><TableBody>{rows.map((row) => <TableRow key={row.instrumentId} className="align-top"><TableHead scope="row" className="text-left"><Link href={`/investments/${row.instrumentId}`} className="font-semibold text-(--fg) hover:text-brand-400">{row.symbol}</Link><p className="mt-1 max-w-48 truncate text-xs font-normal text-(--fg-muted)" title={row.name}>{row.name}</p></TableHead><TableCell className="text-(--fg-secondary)">{groupLabel(row.assetFamily)}<p className="mt-1 text-xs text-(--fg-muted)">{row.kind.replaceAll("_", " ")}</p></TableCell><TableCell className="tnum text-right text-(--fg)">{row.value === null ? "Unavailable" : formatValue(row.value, row.currency)}</TableCell><TableCell className={`tnum text-right ${row.dayChangePercent == null ? "text-(--fg-muted)" : row.dayChangePercent < 0 ? "text-(--loss)" : "text-(--gain)"}`}>{row.dayChangePercent == null ? "-" : `${row.dayChangePercent >= 0 ? "+" : ""}${row.dayChangePercent.toFixed(2)}%`}</TableCell><TableCell><FreshnessPill value={row.freshness} />{row.ageDays != null && <p className="mt-1 text-xs text-(--fg-muted)">{row.ageDays} calendar day{row.ageDays === 1 ? "" : "s"} old</p>}</TableCell><TableCell className="tnum text-(--fg-secondary)">{row.observationTime ?? "Not available"}</TableCell><TableCell className="text-(--fg-secondary)">{row.ingestedAt ? formatDateTime(row.ingestedAt) : "Not available"}</TableCell><TableCell className="text-(--fg-secondary)">{row.providerId ?? "Not available"}<p className="mt-1 text-xs text-(--fg-muted)">{row.sourceType?.replaceAll("_", " ") ?? "No source"}</p></TableCell><TableCell className="max-w-64"><p className={row.dataGap === "NONE" ? "text-(--gain)" : "text-(--warn)"}>{gapLabel(row.dataGap)}</p>{row.reason && <p className="mt-1 text-xs leading-5 text-(--fg-muted)">{row.reason}</p>}{row.correctiveAction && <p className="mt-1 text-xs leading-5 text-(--fg-secondary)">{row.correctiveAction}</p>}</TableCell></TableRow>)}</TableBody></Table></Panel>; }
function FreshnessPill({ value }: { value: TrackerFreshness }) { return <StatusBadge tone={value === "LIVE" || value === "CURRENT" ? "accent" : "neutral"}>{freshnessLabel(value)}</StatusBadge>; }
function Select({ label, name, defaultValue, options }: { label: string; name: string; defaultValue: string; options: readonly (readonly string[])[] }) { return <label className="min-w-44 space-y-2"><span className="form-label">{label}</span><NativeSelect name={name} defaultValue={defaultValue}>{options.map(([value, text]) => <option key={value} value={value}>{text}</option>)}</NativeSelect></label>; }
function freshnessLabel(value: TrackerFreshness): string { return ({ LIVE: "Live", CURRENT: "Current", DELAYED: "Delayed", EOD: "End of day", NAV_DAILY: "Daily NAV", STALE: "Stale", MANUAL: "Manual", UNAVAILABLE: "Unavailable" })[value]; }
function gapLabel(value: InvestmentTrackerOutput["rows"][number]["dataGap"]): string { return ({ NONE: "No gap", NO_OBSERVATION: "No observation", STALE_OBSERVATION: "Stale observation", PREVIOUS_OBSERVATION_UNAVAILABLE: "No prior comparison" })[value]; }
function formatValue(value: string, currency: string): string { return new Intl.NumberFormat("en-IN", { style: "currency", currency, maximumFractionDigits: 4 }).format(Number(value)); }
function formatDateTime(value: string): string { return new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" }).format(new Date(value)); }
function one(value: string | string[] | undefined): string { return Array.isArray(value) ? value[0] ?? "" : value ?? ""; }

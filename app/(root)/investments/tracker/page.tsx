import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { AlertTriangle, DatabaseZap, RadioTower } from "lucide-react";
import type { InvestmentTrackerOutput, TrackerFreshness } from "@/app/investment-analysis.usecases";
import { CalendarDate } from "@/core/time";
import { groupLabel } from "@/domain/asset-groups";
import { currentUserId, ensureSeeded, services } from "@/infra/container";
import { EmptyState, PageHeader, Pill, Stat } from "@/ui/primitives";

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

  return <>
    <PageHeader title="Market tracker" subtitle="Read-only health and latest stored values for non-digital holdings, with source and timing evidence." badge={<Pill tone="brand" icon={RadioTower}>As of {output.asOf}</Pill>} />
    <div className="mb-6 grid gap-3 sm:grid-cols-3"><Stat label="Tracked" value={String(output.rows.length)} hint="Non-digital instruments" icon={RadioTower} /><Stat label="Values available" value={String(available)} hint="Stored observations only" icon={DatabaseZap} /><Stat label="Needs attention" value={String(attention)} hint="Missing, stale, or no comparison" icon={AlertTriangle} /></div>
    <section className="panel mb-6 p-4" aria-label="Tracker filters"><form method="get" className="flex flex-wrap items-end gap-3"><Select label="Freshness" name="state" defaultValue={state ?? ""} options={[["", "All states"], ...STATES.map((value) => [value, freshnessLabel(value)])]} /><Select label="Asset family" name="family" defaultValue={family} options={[["", "All families"], ...families.map((value) => [value, groupLabel(value)])]} /><button type="submit" className="primary-btn h-10 px-4 text-xs">Apply filters</button><Link href="/investments/tracker" className="ghost-btn h-10 px-4 text-xs">Reset</Link></form></section>
    <div className="mb-4 flex gap-3 rounded-lg border border-gray-600 bg-gray-700/30 p-4" role="note"><DatabaseZap className="mt-0.5 size-5 shrink-0 text-brand-400" aria-hidden /><div><p className="text-sm font-semibold text-gray-100">Stored-data monitor</p><p className="mt-1 text-sm leading-6 text-gray-400">Values below are observations already accepted by the server. “Live” appears only for a currently entitled source with recent ingestion; other lanes remain labelled delayed, end-of-day, daily NAV, manual, stale, or unavailable.</p></div></div>
    {rows.length === 0 ? <section className="panel p-0"><EmptyState icon={RadioTower} title="No instruments match" body={output.rows.length ? "Change the tracker filters to see another freshness state or asset family." : "Add a supported non-digital investment before using the market tracker."} /></section> : <TrackerTable output={output} rows={rows} />}
    <p className="mt-4 text-xs leading-5 text-gray-500">Observation date is the provider calendar date, not a guaranteed exchange timestamp or executable price. Availability and licensing depend on the configured account and source.</p>
  </>;
}

function TrackerTable({ output, rows }: { output: InvestmentTrackerOutput; rows: InvestmentTrackerOutput["rows"] }) { return <section className="panel p-0"><div className="border-b border-gray-600 px-5 py-4"><h2 className="text-base font-semibold text-gray-100">Tracked instruments</h2><p className="mt-1 text-sm text-gray-500">Generated {formatDateTime(output.generatedAt)} · {rows.length} visible</p></div><div className="table-scroll"><table className="w-full min-w-[1040px] text-sm"><caption className="sr-only">Latest stored market observations and data quality</caption><thead><tr className="border-b border-gray-600">{["Instrument", "Asset", "Last value", "Movement", "Freshness", "Observation", "Ingested", "Source", "Data quality"].map((heading) => <th key={heading} scope="col" className={`metric-label px-4 py-3 ${["Last value", "Movement"].includes(heading) ? "text-right" : "text-left"}`}>{heading}</th>)}</tr></thead><tbody>{rows.map((row) => <tr key={row.instrumentId} className="border-b border-gray-600/50 align-top last:border-0"><th scope="row" className="px-4 py-3 text-left"><Link href={`/investments/${row.instrumentId}`} className="font-semibold text-gray-100 hover:text-brand-400">{row.symbol}</Link><p className="mt-1 max-w-48 truncate text-xs font-normal text-gray-500" title={row.name}>{row.name}</p></th><td className="px-4 py-3 text-gray-300">{groupLabel(row.assetFamily)}<p className="mt-1 text-xs text-gray-500">{row.kind.replaceAll("_", " ")}</p></td><td className="tnum px-4 py-3 text-right text-gray-100">{row.value === null ? "Unavailable" : formatValue(row.value, row.currency)}</td><td className={`tnum px-4 py-3 text-right ${row.dayChangePercent == null ? "text-gray-500" : row.dayChangePercent < 0 ? "text-red-500" : "text-green-500"}`}>{row.dayChangePercent == null ? "-" : `${row.dayChangePercent >= 0 ? "+" : ""}${row.dayChangePercent.toFixed(2)}%`}</td><td className="px-4 py-3"><FreshnessPill value={row.freshness} />{row.ageDays != null && <p className="mt-1 text-xs text-gray-500">{row.ageDays} calendar day{row.ageDays === 1 ? "" : "s"} old</p>}</td><td className="tnum px-4 py-3 text-gray-300">{row.observationTime ?? "Not available"}</td><td className="px-4 py-3 text-gray-300">{row.ingestedAt ? formatDateTime(row.ingestedAt) : "Not available"}</td><td className="px-4 py-3 text-gray-300">{row.providerId ?? "Not available"}<p className="mt-1 text-xs text-gray-500">{row.sourceType?.replaceAll("_", " ") ?? "No source"}</p></td><td className="max-w-64 px-4 py-3"><p className={row.dataGap === "NONE" ? "text-green-500" : "text-amber-500"}>{gapLabel(row.dataGap)}</p>{row.reason && <p className="mt-1 text-xs leading-5 text-gray-500">{row.reason}</p>}{row.correctiveAction && <p className="mt-1 text-xs leading-5 text-gray-300">{row.correctiveAction}</p>}</td></tr>)}</tbody></table></div></section>; }
function FreshnessPill({ value }: { value: TrackerFreshness }) { return <Pill tone={value === "LIVE" || value === "CURRENT" ? "brand" : "neutral"}>{freshnessLabel(value)}</Pill>; }
function Select({ label, name, defaultValue, options }: { label: string; name: string; defaultValue: string; options: readonly (readonly string[])[] }) { return <label className="min-w-44 space-y-2"><span className="form-label">{label}</span><select className="form-control w-full" name={name} defaultValue={defaultValue}>{options.map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select></label>; }
function freshnessLabel(value: TrackerFreshness): string { return ({ LIVE: "Live", CURRENT: "Current", DELAYED: "Delayed", EOD: "End of day", NAV_DAILY: "Daily NAV", STALE: "Stale", MANUAL: "Manual", UNAVAILABLE: "Unavailable" })[value]; }
function gapLabel(value: InvestmentTrackerOutput["rows"][number]["dataGap"]): string { return ({ NONE: "No gap", NO_OBSERVATION: "No observation", STALE_OBSERVATION: "Stale observation", PREVIOUS_OBSERVATION_UNAVAILABLE: "No prior comparison" })[value]; }
function formatValue(value: string, currency: string): string { return new Intl.NumberFormat("en-IN", { style: "currency", currency, maximumFractionDigits: 4 }).format(Number(value)); }
function formatDateTime(value: string): string { return new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" }).format(new Date(value)); }
function one(value: string | string[] | undefined): string { return Array.isArray(value) ? value[0] ?? "" : value ?? ""; }

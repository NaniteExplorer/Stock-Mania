/**
 * Net worth against age — the view model (DESIGN §8.1, tasks 4.2.s / 4.2.b).
 *
 * Pure: no I/O and no clock — `today` is an input. It decides which state the
 * panel is in and turns month-end net worth into SVG geometry.
 *
 * What it refuses to do, by construction:
 * - **Invent inflation.** Real values come only from a recorded CPI Urban series.
 *   With none, real is unknown, the reason is named, and the chart is nominal.
 * - **Chain across the January 2026 CPI rebase.** MoSPI moved CPI from 2012=100 to
 *   2024=100 and says the two are not comparable. With a recorded official linking
 *   factor the line is spliced through it; without one the real line is two
 *   segments, each in its own base's rupees, with a gap at the break.
 * - **Interpolate.** A month with no figure is a gap in the line, never a guess.
 * - **Draw 25× or an income multiple.** Milestones are `MILESTONES` from the
 *   domain — expense multiples only, 33× cited.
 */
import { compact } from "@/core/format";
import { Money } from "@/core/money";
import { CalendarDate } from "@/core/time";
import { Count } from "@/core/units";
import { ageOn } from "@/app/projection.usecases";
import { INDEPENDENCE_CITATION, MILESTONES, milestoneStanding, type Milestone } from "@/domain/milestones";
import type { NetWorthPoint } from "@/domain/reports";

export const NET_WORTH_AGE_TITLE = "Net worth against age";
/** First month published on the 2024=100 base. Months before it are 2012=100. */
export const CPI_BREAK_MONTH = "2026-01";
/** The newest known month older than this many days makes the chart stale. */
export const STALE_AFTER_DAYS = 45;
/** Months after the latest published CPI month that may be carried at its prices (CPI is published with a lag). */
export const MAX_CPI_LAG_MONTHS = 2;
/** How far back the page asks for month ends. */
export const HISTORY_MONTHS = 120;
/** A milestone rule is drawn on the scale only when it is within this multiple of the highest value. */
export const ON_SCALE_HEADROOM = 1.5;

export const NO_CPI =
  "Real values are unknown: no CPI Urban series is recorded, and the app never assumes an inflation rate. Showing rupees of each month.";
export const EMPTY_REASON = "Two months of history are needed to draw a line.";
export const LATEST_UNKNOWN = "The latest month's net worth could not be computed, so there is no current figure.";
export const DOB_PROMPT = "Add your date of birth to see this against age.";
export const BREAK_SPLICED_PREFIX = "CPI spliced — MoSPI linking factor";
export const BREAK_NOT_JOINED = "CPI rebased — not comparable across this line";
export const SEGMENT_LABELS = Object.freeze(["2012-base rupees", "2024-base rupees"] as const);
/** The citation shown beside the 33× rule, built from the domain's citation. */
export const INDEPENDENCE_NOTE =
  "33× expenses is the independence marker: the reciprocal of a 3.0% safe withdrawal rate on Indian markets (Saraogi 2022).";
export { INDEPENDENCE_CITATION };

export type Basis = "real" | "nominal";

/** One month of CPI Urban, on the base MoSPI published it on. `index` is a decimal string, e.g. "193.4". */
export interface CpiMonth {
  readonly month: string;
  readonly base: "2012" | "2024";
  readonly index: string;
}

/** The official factor that carries a 2012-base index onto the 2024 base: `2024-equivalent = 2012 index × factor`. */
export interface CpiLinkingFactor {
  readonly factor: string;
  readonly source: string;
  readonly recordedOn: string;
}

export interface CpiSeries {
  readonly months: readonly CpiMonth[];
  readonly linking: CpiLinkingFactor | null;
}

/** One month end. `netWorth` is null when that month's figure is not known. */
export interface NetWorthMonth {
  readonly month: string;
  readonly on: CalendarDate;
  readonly netWorth: Money | null;
}

export interface ExpenseMonth {
  readonly month: string;
  readonly expense: Money;
}

export interface NetWorthAgeInputs {
  /** Oldest first. */
  readonly history: readonly NetWorthMonth[];
  /** Oldest first, one row per month, ending at the current month. */
  readonly expenses: readonly ExpenseMonth[];
  readonly bornOn: CalendarDate | null;
  readonly today: CalendarDate;
  readonly cpi: CpiSeries | null;
  /** What the viewer asked for; real is the default (DESIGN §8). */
  readonly requested: Basis;
}

export interface ChartPoint {
  readonly month: string;
  readonly x: number;
  /** Null for a month with no figure: a focus stop with no mark. */
  readonly y: number | null;
  /** The accessible name and the hover/focus text. */
  readonly label: string;
  /** True when neither neighbour is drawn, so the point needs its own dot. */
  readonly isolated: boolean;
}

export interface Rule {
  readonly y: number;
  readonly label: string;
  readonly emphasis: "primary" | "quiet";
}

export interface ChartGeometry {
  readonly width: number;
  readonly height: number;
  readonly plot: { readonly left: number; readonly right: number; readonly top: number; readonly bottom: number };
  /** One SVG path per drawn segment. */
  readonly lines: readonly string[];
  readonly points: readonly ChartPoint[];
  readonly xTicks: readonly { readonly x: number; readonly label: string }[];
  readonly yTicks: readonly { readonly y: number; readonly label: string }[];
  /** Drawn only when some value is negative. */
  readonly zeroY: number | null;
  readonly milestones: readonly Rule[];
  readonly breakMark: { readonly x: number; readonly label: string } | null;
  readonly segmentLabels: readonly { readonly x: number; readonly y: number; readonly text: string }[];
}

export interface TableRow {
  readonly month: string;
  readonly age: string | null;
  readonly value: string;
  readonly nominal: string | null;
}

export type NetWorthAgeView =
  | { readonly kind: "empty"; readonly summary: string; readonly reason: string; readonly realRefusal: string | null }
  | {
      readonly kind: "ready" | "stale" | "unknown";
      readonly summary: string;
      readonly basis: Basis;
      /** "In Sep 2026 rupees (CPI Urban)" or "In rupees of each month". */
      readonly basisLabel: string;
      /** Latest value in the active basis; null when unknown. */
      readonly headline: string | null;
      readonly headlineReason: string | null;
      /** Why real is not available; null when it is. Nominal is still drawn. */
      readonly realRefusal: string | null;
      readonly staleReason: string | null;
      readonly axis: "age" | "calendar";
      readonly dobPrompt: string | null;
      /** Why milestone rules are not drawn, or which are above the chart. */
      readonly milestoneNote: string | null;
      /** The 33× citation, present when the 33× rule is drawn or listed. */
      readonly citation: string | null;
      /** Source of the splice, when one is used. */
      readonly spliceSource: string | null;
      readonly chart: ChartGeometry;
      readonly table: readonly TableRow[];
    };

/* ── Small helpers ─────────────────────────────────────────────────────── */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function monthLabel(month: string): string {
  const [year, m] = month.split("-");
  return `${MONTHS[Number(m) - 1]} ${year}`;
}

const monthIndex = (month: string) => Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1;

/** Decimal string → bigint scaled by 10^6. Refuses anything that is not a positive decimal. */
const SCALE = 1_000_000n;
function scaled(decimal: string): bigint | null {
  const match = /^(\d+)(?:\.(\d{1,6}))?$/.exec(decimal.trim());
  if (!match) return null;
  const value = BigInt(match[1]!) * SCALE + BigInt((match[2] ?? "").padEnd(6, "0"));
  return value > 0n ? value : null;
}

function decimalYear(date: CalendarDate): number {
  return date.year + (date.month - 1) / 12 + (date.day - 1) / (CalendarDate.daysInMonth(date.year, date.month) * 12);
}

/**
 * Month ends from the report series, starting at the first month anything was
 * recorded. Months before the first posting are not history — they are zeros the
 * series fills in, and drawing them would claim a net worth of ₹0 at that age.
 */
export function historyFromSeries(series: readonly NetWorthPoint[]): NetWorthMonth[] {
  const first = series.findIndex((p) => !p.assets.isZero || !p.liabilities.isZero);
  if (first < 0) return [];
  return series.slice(first).map((p) => ({ month: p.on.toMonthKey(), on: p.on, netWorth: p.netWorth }));
}

/* ── CPI ───────────────────────────────────────────────────────────────── */

/** Converts a nominal month to the reference month's rupees: value × num / den. */
interface Deflator {
  readonly num: bigint;
  readonly den: bigint;
  /** 0 before the break, 1 from it; always 0 when spliced. */
  readonly segment: 0 | 1;
}

type Deflation =
  | { readonly ok: true; readonly byMonth: ReadonlyMap<string, Deflator>; readonly refMonths: readonly string[]; readonly spliced: boolean }
  | { readonly ok: false; readonly reason: string };

const refused = (why: string): Deflation => ({ ok: false, reason: `Real values are unknown: ${why} Showing rupees of each month.` });

/** Deflators for every month in `needed`, or the named reason none can be given. */
function deflate(cpi: CpiSeries | null, needed: readonly string[]): Deflation {
  if (cpi === null || cpi.months.length === 0) return { ok: false, reason: NO_CPI };
  const factor = cpi.linking === null ? null : scaled(cpi.linking.factor);
  if (cpi.linking !== null && factor === null) return refused(`the recorded linking factor "${cpi.linking.factor}" is not a positive number.`);
  const spliced = factor !== null;

  const index = new Map<string, bigint>();
  for (const row of cpi.months) {
    const value = scaled(row.index);
    if (value === null) return refused(`the CPI figure for ${monthLabel(row.month)} is not a positive number.`);
    const expected = row.month < CPI_BREAK_MONTH ? "2012" : "2024";
    if (row.base !== expected) return refused(`the CPI figure for ${monthLabel(row.month)} is on the ${row.base} base, but that month belongs to the ${expected} base.`);
    // Carried onto the 2024 base through the official factor only — never estimated.
    index.set(row.month, spliced && row.base === "2012" ? (value * factor!) / SCALE : value);
  }

  const segmentOf = (month: string): 0 | 1 => (spliced || month < CPI_BREAK_MONTH ? 0 : 1);
  const byMonth = new Map<string, Deflator>();
  const refMonths: string[] = [];
  for (const segment of [0, 1] as const) {
    const months = needed.filter((m) => segmentOf(m) === segment).sort();
    if (months.length === 0) continue;
    const last = months[months.length - 1]!;
    const available = [...index.keys()].filter((m) => segmentOf(m) === segment && m <= last).sort();
    const ref = available[available.length - 1];
    if (ref === undefined) return refused(`no CPI Urban figure is recorded for ${monthLabel(months[0]!)}.`);
    if (monthIndex(last) - monthIndex(ref) > MAX_CPI_LAG_MONTHS) {
      return refused(`the CPI Urban series ends at ${monthLabel(ref)}, too far behind ${monthLabel(last)}.`);
    }
    const refIndex = index.get(ref)!;
    for (const month of months) {
      // Months after the latest published CPI are already at its prices.
      const own = month > ref ? refIndex : index.get(month);
      if (own === undefined) return refused(`no CPI Urban figure is recorded for ${monthLabel(month)}.`);
      byMonth.set(month, { num: refIndex, den: own, segment });
    }
    refMonths.push(ref);
  }
  return { ok: true, byMonth, refMonths, spliced };
}

/* ── The view ──────────────────────────────────────────────────────────── */

const W = 640;
const H = 280;
const PAD = { left: 64, right: 16, top: 20, bottom: 28 };
const r1 = (v: number) => Math.round(v * 10) / 10;

export function buildNetWorthAgeView(input: NetWorthAgeInputs): NetWorthAgeView {
  const history = input.history;
  const known = history.filter((m) => m.netWorth !== null);

  const deflation = deflate(input.cpi, [...known.map((m) => m.month), ...input.expenses.slice(-12).map((e) => e.month)]);
  const realRefusal = deflation.ok ? null : deflation.reason;
  const basis: Basis = input.requested === "real" && deflation.ok ? "real" : "nominal";

  if (known.length < 2) {
    return Object.freeze({ kind: "empty", summary: "Not enough net worth history to draw a line yet.", reason: EMPTY_REASON, realRefusal });
  }

  const straddles = history[0]!.month < CPI_BREAK_MONTH && history[history.length - 1]!.month >= CPI_BREAK_MONTH;
  const splitReal = basis === "real" && deflation.ok && !deflation.spliced && deflation.refMonths.length === 2;

  const valueOf = (m: NetWorthMonth): Money | null => {
    if (m.netWorth === null) return null;
    if (basis === "nominal" || !deflation.ok) return m.netWorth;
    const d = deflation.byMonth.get(m.month)!;
    return m.netWorth.timesRatio(d.num, d.den);
  };
  const segmentOf = (m: NetWorthMonth): number => (basis === "real" && deflation.ok ? deflation.byMonth.get(m.month)?.segment ?? 0 : 0);

  /* Axis: age when a date of birth is known, calendar year otherwise. */
  const bornOn = input.bornOn !== null && !input.bornOn.isAfter(input.today) ? input.bornOn : null;
  const axis: "age" | "calendar" = bornOn === null ? "calendar" : "age";
  const pointDate = (m: NetWorthMonth) => (m.on.isAfter(input.today) ? input.today : m.on);
  const xValue = (date: CalendarDate) => decimalYear(date) - (bornOn === null ? 0 : decimalYear(bornOn));
  const ageAt = (m: NetWorthMonth) => (bornOn === null ? null : ageOn(bornOn, pointDate(m)));
  const whereAt = (m: NetWorthMonth) => {
    const age = ageAt(m);
    return age === null ? `in ${monthLabel(m.month)}` : `at age ${age}`;
  };

  const values = history.map(valueOf);
  const numbers = values.filter((v): v is Money => v !== null).map((v) => v.toApproximateNumber());
  const lowest = Math.min(0, ...numbers);
  const highest = Math.max(...numbers);

  /* Milestones: expense multiples, in the same basis as the line. */
  const last = known[known.length - 1]!;
  const lastValue = valueOf(last)!;
  const milestone = milestonesFor(input.expenses, basis, deflation, lastValue);
  const onScale = milestone.rules.filter((r) => r.target.toApproximateNumber() <= Math.max(highest, 1) * ON_SCALE_HEADROOM);
  const offScale = milestone.rules.filter((r) => !onScale.includes(r));

  let top = Math.max(highest, ...onScale.map((r) => r.target.toApproximateNumber()));
  if (top <= lowest) top = lowest + 1;
  top += (top - lowest) * 0.05;

  const xs = history.map((m) => xValue(pointDate(m)));
  const xMin = xs[0]!;
  const xMax = Math.max(xs[xs.length - 1]!, xMin + 1 / 12);
  const plot = { left: PAD.left, right: W - PAD.right, top: PAD.top, bottom: H - PAD.bottom };
  const x = (v: number) => r1(plot.left + ((v - xMin) / (xMax - xMin)) * (plot.right - plot.left));
  const y = (v: number) => r1(plot.top + (1 - (v - lowest) / (top - lowest)) * (plot.bottom - plot.top));

  /* Lines: break on a missing month, and on the CPI break when it is not joined. */
  const lines: string[] = [];
  let current: string[] = [];
  const flush = () => {
    if (current.length > 1) lines.push(`M${current.join("L")}`);
    current = [];
  };
  history.forEach((m, i) => {
    const v = values[i];
    if (v === null) {
      flush();
      return;
    }
    if (i > 0 && values[i - 1] !== null && segmentOf(history[i - 1]!) !== segmentOf(m)) flush();
    current.push(`${x(xs[i]!)},${y(v.toApproximateNumber())}`);
  });
  flush();

  const nominalText = (m: NetWorthMonth) => (m.netWorth === null ? null : compact(m.netWorth));
  const ageText = (m: NetWorthMonth) => (ageAt(m) === null ? null : `age ${ageAt(m)}`);
  const points: ChartPoint[] = history.map((m, i) => {
    const v = values[i];
    const ageLabel = ageText(m);
    const prefix = [monthLabel(m.month), ageLabel].filter(Boolean).join(" · ");
    const label =
      v === null
        ? `No snapshot for ${monthLabel(m.month)}`
        : basis === "real"
          ? `${prefix} · ${compact(v)} (nominal ${nominalText(m)})`
          : `${prefix} · ${compact(v)}`;
    const drawnBefore = i > 0 && values[i - 1] !== null && segmentOf(history[i - 1]!) === segmentOf(m);
    const drawnAfter = i < history.length - 1 && values[i + 1] !== null && segmentOf(history[i + 1]!) === segmentOf(m);
    return { month: m.month, x: x(xs[i]!), y: v === null ? null : y(v.toApproximateNumber()), label, isolated: v !== null && !drawnBefore && !drawnAfter };
  });

  /* Ticks. */
  const span = xMax - xMin;
  const step = span > 16 ? 5 : span > 8 ? 2 : 1;
  const xTicks: { x: number; label: string }[] = [];
  for (let t = Math.ceil(xMin); t <= Math.floor(xMax); t += 1) if (t % step === 0) xTicks.push({ x: x(t), label: String(t) });
  if (xTicks.length < 2) {
    xTicks.length = 0;
    const ends = [history[0]!, history[history.length - 1]!];
    for (const m of ends) xTicks.push({ x: x(xValue(pointDate(m))), label: ageAt(m) === null ? monthLabel(m.month) : String(ageAt(m)) });
  }
  const tickMoney = (v: number) => compact(Money.fromRupees(String(Math.round(v))));
  const yTicks = (lowest < 0 ? [lowest, 0, top] : [0, (top - lowest) / 2 + lowest, top]).map((v) => ({ y: y(v), label: tickMoney(v) }));

  /* The CPI break mark, in both modes, whenever the history spans it. */
  const linking = input.cpi?.linking ?? null;
  const spliced = deflation.ok && deflation.spliced;
  const breakMark = straddles
    ? { x: x(xValue(CalendarDate.parse(`${CPI_BREAK_MONTH}-01`))), label: spliced ? `${BREAK_SPLICED_PREFIX} ${linking!.factor}` : BREAK_NOT_JOINED }
    : null;
  const segmentLabels =
    splitReal && breakMark
      ? [
          { x: plot.left + 4, y: plot.top + 12, text: SEGMENT_LABELS[0] },
          { x: breakMark.x + 4, y: plot.top + 12, text: SEGMENT_LABELS[1] },
        ]
      : [];

  /* Words. */
  const basisLabel =
    basis === "nominal"
      ? "In rupees of each month"
      : splitReal
        ? `In each CPI base's rupees (CPI Urban): 2012 base to ${monthLabel(deflation.ok ? deflation.refMonths[0]! : "")}, 2024 base to ${monthLabel(deflation.ok ? deflation.refMonths[1]! : "")}`
        : `In ${monthLabel(deflation.ok ? deflation.refMonths[deflation.refMonths.length - 1]! : "")} rupees (CPI Urban)`;
  const basisPhrase = basis === "nominal" ? "in rupees of each month" : splitReal ? "in each CPI base's rupees" : basisLabel.replace(/^In /, "in ").replace(/ \(CPI Urban\)$/, "");

  const first = known[0]!;
  const crossings = milestone.rules
    .map((rule) => {
      const at = history.find((m, i) => values[i] !== null && values[i]!.isGreaterThanOrEqual(rule.target));
      return at === undefined ? null : `crossed ${rule.milestone.multiple}× expenses ${ageAt(at) === null ? `in ${monthLabel(at.month)}` : `at ${ageAt(at)}`}`;
    })
    .filter((s): s is string => s !== null);
  const breakSentence =
    basis === "real" && straddles ? (spliced ? " CPI rebased in Jan 2026 and is spliced with MoSPI's linking factor." : " CPI rebased in Jan 2026 and is not joined.") : "";
  const realSentence = realRefusal !== null && input.requested === "real" ? " Real values are unknown." : "";
  const summary =
    `Net worth from ${compact(valueOf(first)!)} ${whereAt(first)} to ${compact(lastValue)} ${whereAt(last)}, ${basisPhrase}` +
    `${crossings.length > 0 ? `; ${crossings.join(", ")}` : ""}.${breakSentence}${realSentence}`;

  /* States. */
  const latest = history[history.length - 1]!;
  const latestUnknown = latest.netWorth === null;
  const age = pointDate(last).daysUntil(input.today);
  const staleReason =
    age > STALE_AFTER_DAYS ? `The newest net worth figure is for ${monthLabel(last.month)}, ${age} days ago. Record or import recent activity to bring it up to date.` : null;
  const kind = latestUnknown ? "unknown" : staleReason !== null ? "stale" : "ready";

  const milestoneNote =
    milestone.refusal !== null
      ? `Milestone rules are not drawn: ${milestone.refusal}`
      : offScale.length > 0
        ? `Above the top of the chart: ${offScale.map((r) => `${r.milestone.multiple}× expenses (${compact(r.target)})`).join(", ")}.`
        : null;
  const citation = milestone.rules.some((r) => r.milestone.citation !== null) ? INDEPENDENCE_NOTE : null;

  const table: TableRow[] = history.map((m, i) => ({
    month: monthLabel(m.month),
    age: ageAt(m) === null ? null : String(ageAt(m)),
    value: values[i] === null ? "—" : compact(values[i]!),
    nominal: basis === "real" ? (nominalText(m) ?? "—") : null,
  }));

  return Object.freeze({
    kind,
    summary,
    basis,
    basisLabel,
    headline: latestUnknown ? null : compact(lastValue),
    headlineReason: latestUnknown ? LATEST_UNKNOWN : null,
    realRefusal,
    staleReason,
    axis,
    dobPrompt: bornOn === null ? DOB_PROMPT : null,
    milestoneNote,
    citation,
    spliceSource: spliced && linking ? `Spliced through MoSPI's linking factor ${linking.factor} (${linking.source}, recorded ${linking.recordedOn}).` : null,
    chart: Object.freeze({
      width: W,
      height: H,
      plot,
      lines: Object.freeze(lines),
      points: Object.freeze(points),
      xTicks: Object.freeze(xTicks),
      yTicks: Object.freeze(yTicks),
      zeroY: lowest < 0 ? y(0) : null,
      milestones: Object.freeze(
        onScale.map((rule) => ({
          y: y(rule.target.toApproximateNumber()),
          label: `${rule.milestone.label} — ${compact(rule.target)}`,
          emphasis: rule.milestone.citation !== null ? ("primary" as const) : ("quiet" as const),
        })),
      ),
      breakMark,
      segmentLabels: Object.freeze(segmentLabels),
    }),
    table: Object.freeze(table),
  });
}

interface MilestoneRule {
  readonly milestone: Milestone;
  readonly target: Money;
}

/** Trailing-twelve-month expenses in the active basis, then the domain's standing. */
function milestonesFor(
  expenses: readonly ExpenseMonth[],
  basis: Basis,
  deflation: Deflation,
  netWorth: Money,
): { readonly rules: readonly MilestoneRule[]; readonly refusal: string | null } {
  const firstSpend = expenses.findIndex((e) => e.expense.isPositive);
  const months = firstSpend < 0 ? 0 : expenses.length - firstSpend;
  const window = expenses.slice(-12);
  let trailing = Money.zero(netWorth.currency);
  if (basis === "real" && deflation.ok) {
    const segments = new Set(window.map((e) => deflation.byMonth.get(e.month)?.segment ?? 0));
    if (segments.size > 1) {
      return { rules: [], refusal: "the last twelve months of expenses straddle the January 2026 CPI rebase, which is not joined, so they cannot be summed in one kind of rupee." };
    }
    for (const e of window) {
      const d = deflation.byMonth.get(e.month)!;
      trailing = trailing.plus(e.expense.timesRatio(d.num, d.den));
    }
  } else {
    for (const e of window) trailing = trailing.plus(e.expense);
  }
  const standing = milestoneStanding(netWorth, { months: Count(months), trailingTwelveMonths: trailing });
  if (standing.state === "refused") return { rules: [], refusal: standing.reason };
  return { rules: MILESTONES.map((milestone) => ({ milestone, target: standing.annualExpenses.times(milestone.multiple) })), refusal: null };
}

/** Every user-visible string in a view, for the copy test. */
export function viewCopy(view: NetWorthAgeView): readonly string[] {
  if (view.kind === "empty") return [view.summary, view.reason, ...(view.realRefusal ? [view.realRefusal] : [])];
  return [
    view.summary,
    view.basisLabel,
    ...[view.headlineReason, view.realRefusal, view.staleReason, view.dobPrompt, view.milestoneNote, view.citation, view.spliceSource].filter((s): s is string => s !== null),
    ...view.chart.milestones.map((m) => m.label),
    ...view.chart.points.map((p) => p.label),
    ...view.chart.segmentLabels.map((s) => s.text),
    ...(view.chart.breakMark ? [view.chart.breakMark.label] : []),
  ];
}

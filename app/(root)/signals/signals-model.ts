/**
 * The /signals view model (DESIGN §8.3): pure, no I/O, no clock. It turns the
 * `ViewSignals` snapshot and the market-context inputs into display strings.
 *
 * Two rules are enforced by the shape of the types, not by review:
 *   - a percentile exists only inside the sentence that carries its dispersion, so
 *     neither can render alone;
 *   - nothing on this page is an action — the copy is checked against
 *     `RECOMMENDATION_WORDS` in `tests/signals-board.spec.ts`.
 */
import { percentage, rupee, unknown, type Figure, type FigureValue, type Unknown } from "@/core/format";
import type { Percentage } from "@/core/numeric";
import type { CalendarDate } from "@/core/time";
import { Count } from "@/core/units";
import type { AlertKind } from "@/domain/alerts";
import {
  EXEMPTION_WINDOW,
  TERM_BOUNDARY_WINDOW,
  type AllocationState,
  type RuleOutcome,
  type SignalsSnapshot,
  type TaxPosition,
} from "@/app/signals.usecases";

/** Verbs and phrasings of advice or forecast. None may appear anywhere in the rendered page. */
export const RECOMMENDATION_WORDS =
  /\b(buy|buying|sell|selling|should|consider|recommend\w*|suggest\w*|switch|exit|harvest\w*|book|accumulate|rebalance|will|expect\w*|opportunit\w*|forecast\w*)\b/i;

/** Words that interpret a level. None may appear on the macro panel. */
export const INTERPRETATION_WORDS =
  /\b(high|higher|low|lower|elevated|depressed|cheap|expensive|overvalued|undervalued|bullish|bearish|risk-on|risk-off|strong|weak)\b/i;

/** Comparable past episodes below which "what followed" is refused (DESIGN §8.3). */
export const MIN_EPISODES = Count(10);

const DAY_MONTH_YEAR = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const DAY_MONTH = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
export const dayMonthYear = (date: CalendarDate): string => DAY_MONTH_YEAR.format(date.toUtcInstant());
const dayMonth = (date: CalendarDate): string => DAY_MONTH.format(date.toUtcInstant());

/** A whole-number count is its own display form. */
export const countFigure = (value: Count): Figure => String(Count(value)) as Figure;

/** Explicit plus for a positive figure; minus is already U+2212. */
export const signedPercent = (value: Percentage, decimals = 1): string => `${value.scaled > 0n ? "+" : ""}${percentage(value, decimals)}`;
const points = (value: Percentage): string => signedPercent(value, 2).replace("%", " pp");
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/* ═══ Alerts ═══════════════════════════════════════════════════════════ */

export const RULE_TITLES: Record<AlertKind, string> = {
  TERM_BOUNDARY: "Short-term to long-term boundary",
  EXEMPTION_UNUSED: "Long-term equity exemption",
  CONCENTRATION: "Concentration",
  RUNWAY_BELOW_TARGET: "Emergency runway",
  SOURCE_FAILURE: "Data sources",
};

const CLEAR_TEXT: Record<AlertKind, string> = {
  TERM_BOUNDARY: `No lot with an unrealised gain turns long-term in the next ${TERM_BOUNDARY_WINDOW} days.`,
  EXEMPTION_UNUSED: `Nothing to state: none of the exemption is unused, or the financial year ends more than ${EXEMPTION_WINDOW} days from today.`,
  CONCENTRATION: "No holding's share of the portfolio is above your threshold.",
  RUNWAY_BELOW_TARGET: "Emergency runway is at or above your target.",
  SOURCE_FAILURE: "Every source that was read returned data within its allowed age.",
};

export type RuleStatus = "stated" | "clear" | "not-evaluated";
export const STATUS_LABELS: Record<RuleStatus, string> = { stated: "Stated", clear: "Nothing to state", "not-evaluated": "Not evaluated" };

export interface RuleView {
  readonly id: string;
  readonly title: string;
  readonly status: RuleStatus;
  readonly lines: readonly string[];
}

export function ruleView(outcome: RuleOutcome): RuleView {
  const base = { id: `rule-${outcome.kind}`, title: RULE_TITLES[outcome.kind] };
  switch (outcome.status) {
    case "FIRED":
      return { ...base, status: "stated", lines: [...outcome.alerts.map((a) => a.text), ...(outcome.note ? [outcome.note] : [])] };
    case "CLEAR":
      return { ...base, status: "clear", lines: [CLEAR_TEXT[outcome.kind], ...(outcome.note ? [outcome.note] : [])] };
    case "NOT_EVALUATED":
      return { ...base, status: "not-evaluated", lines: [outcome.reason] };
  }
}

/* ═══ Allocation against bands ═════════════════════════════════════════ */

export interface SleeveRow {
  readonly id: string;
  readonly name: string;
  readonly actual: Figure;
  readonly target: Figure;
  readonly deviation: string;
  readonly band: string;
  readonly breached: boolean;
  readonly status: string;
}

export type AllocationView =
  | { readonly state: "empty"; readonly text: string }
  | { readonly state: "unknown"; readonly value: Unknown }
  | { readonly state: "refused"; readonly reason: string }
  | { readonly state: "standing" | "stale"; readonly rows: readonly SleeveRow[]; readonly summary: string; readonly route: string | null; readonly staleNote: string | null };

export function allocationView(state: AllocationState): AllocationView {
  switch (state.state) {
    case "EMPTY":
      return { state: "empty", text: "No holdings are recorded, so there is no allocation to measure. Holdings added under Investments appear here." };
    case "UNKNOWN":
      return { state: "unknown", value: unknown(state.reason) };
    case "REFUSED":
      return { state: "refused", reason: `Band standing refused: ${state.reason}` };
    case "STANDING": {
      const { standing } = state;
      const rows = standing.sleeves.map((s): SleeveRow => ({
        id: s.id,
        name: s.name,
        actual: percentage(s.actual, 2),
        target: percentage(s.target, 2),
        deviation: points(s.deviation),
        band: `±${percentage(s.tolerance, 2).replace("%", " pp")}`,
        breached: s.breached,
        status: s.breached ? "Outside band" : "Inside band",
      }));
      const outside = standing.sleeves.filter((s) => s.breached).length;
      const summary = outside === 0
        ? "Every sleeve is inside its band."
        : `${plural(outside, "sleeve")} outside ${outside === 1 ? "its band" : "their bands"}, of ${standing.sleeves.length}.`;
      // The cash-flow route first (PRODUCT §7): arithmetic about new money, never a trade.
      const pick = standing.cashFlowRoute === null ? null : standing.sleeves.find((s) => s.id === standing.cashFlowRoute!.sleeveId) ?? null;
      const route = !standing.breached ? null
        : standing.cashFlowRoute === null || pick === null
          ? "No sleeve is below its target, so there is no new-money route to state."
          : `New money of ${rupee(standing.cashFlowRoute.contribution)} into ${pick.name} brings it to its ${percentage(pick.target, 2)} target without realising any gain. ` +
            (standing.cashFlowRoute.restoresAll ? "That alone puts every sleeve inside its band." : "Other sleeves stay outside their bands after it.");
      const stale = state.stale.length > 0;
      return {
        state: stale ? "stale" : "standing",
        rows,
        summary,
        route,
        staleNote: stale ? `Valued with stale prices for ${state.stale.join(", ")}; each holding's last good price is dated under Investments.` : null,
      };
    }
  }
}

/* ═══ Tax position ═════════════════════════════════════════════════════ */

export type TaxView =
  | { readonly state: "known"; readonly used: Figure; readonly exemption: Figure; readonly headline: string; readonly detail: string }
  | { readonly state: "unknown"; readonly value: Unknown; readonly detail: string };

export function taxView(tax: TaxPosition): TaxView {
  if (tax.state === "UNKNOWN") return { state: "unknown", value: unknown(tax.reason), detail: `Long-term equity exemption, ${tax.financialYear}.` };
  const used = rupee(tax.used, 0);
  const exemption = rupee(tax.exemption, 0);
  return {
    state: "known",
    used,
    exemption,
    headline: `${used} used of ${exemption}`,
    detail: `Realised long-term equity gain set against the ${tax.financialYear} exemption, from the tax report on your recorded disposals and stored settings.`,
  };
}

/* ═══ Drawdown from peak ═══════════════════════════════════════════════ */

/** What a drawdown measurement must carry. Produced upstream (a domain function), never in the UI. */
export interface DrawdownEpisodes {
  readonly index: string;
  readonly source: string;
  readonly asOf: CalendarDate;
  readonly stale: boolean;
  /** Current drawdown from the peak, negative. */
  readonly drawdown: Percentage;
  readonly peakOn: CalendarDate;
  readonly sinceYear: number;
  /** Share of days since `sinceYear` with a shallower drawdown. */
  readonly deeperThan: Percentage;
  /** Comparable past episodes the outcomes below were measured on. */
  readonly episodes: Count;
  /** Next-12-month outcomes after those episodes: extremes and the middle half. */
  readonly outcomes: { readonly min: Percentage; readonly q1: Percentage; readonly q3: Percentage; readonly max: Percentage };
}

export type DrawdownInput =
  | { readonly state: "NO_HOLDINGS" }
  | { readonly state: "UNKNOWN"; readonly reason: string }
  | { readonly state: "MEASURED"; readonly episodes: DrawdownEpisodes };

/** Positions on a 0–100 track; the zero rule is always inside the domain. */
export interface Strip {
  readonly min: number;
  readonly q1: number;
  readonly q3: number;
  readonly max: number;
  readonly zero: number;
  readonly label: string;
}

export type DrawdownView =
  | { readonly state: "empty"; readonly text: string }
  | { readonly state: "unknown"; readonly value: Unknown }
  | { readonly state: "refused"; readonly index: string; readonly headline: string; readonly reason: string }
  | {
      readonly state: "shown" | "stale";
      readonly index: string;
      readonly headline: string;
      /** The percentile and its dispersion, one sentence: neither exists without the other. */
      readonly placement: string;
      readonly strip: Strip;
      readonly sourceLine: string;
    };

const asNumber = (p: Percentage): number => Number(p.scaled) / 1_000_000;

export function drawdownView(input: DrawdownInput): DrawdownView {
  if (input.state === "NO_HOLDINGS") return { state: "empty", text: "No holdings are recorded, so there is no index to measure a drawdown against." };
  if (input.state === "UNKNOWN") return { state: "unknown", value: unknown(input.reason) };
  const e = input.episodes;
  const headline = `${signedPercent(e.drawdown)} from the high of ${dayMonth(e.peakOn)}`;
  if (e.episodes < MIN_EPISODES) {
    return {
      state: "refused",
      index: e.index,
      headline,
      reason: `Too few past drawdowns this deep to show what followed: ${plural(e.episodes, "comparable episode")} since ${e.sinceYear}, ${MIN_EPISODES} needed.`,
    };
  }
  const { min, q1, q3, max } = e.outcomes;
  const lo = Math.min(asNumber(min), 0);
  const hi = Math.max(asNumber(max), 0);
  const at = (p: Percentage | number) => (hi === lo ? 50 : ((typeof p === "number" ? p : asNumber(p)) - lo) / (hi - lo) * 100);
  const range = `ranged from ${signedPercent(min, 0)} to ${signedPercent(max, 0)}; the middle half from ${signedPercent(q1, 0)} to ${signedPercent(q3, 0)}`;
  return {
    state: e.stale ? "stale" : "shown",
    index: e.index,
    headline,
    placement: `Deeper than ${percentage(e.deeperThan, 0)} of days since ${e.sinceYear}. After the ${e.episodes} drawdowns this deep, the next 12 months ${range}.`,
    strip: { min: at(min), q1: at(q1), q3: at(q3), max: at(max), zero: at(0), label: `Next-12-month outcomes after past drawdowns this deep: ${range}.` },
    sourceLine: `${e.source}, as of ${dayMonthYear(e.asOf)}.`,
  };
}

/* ═══ Macro levels ═════════════════════════════════════════════════════ */

export interface MacroObservation {
  readonly level: Figure;
  readonly asOf: CalendarDate;
  readonly stale: boolean;
  readonly sinceYear: number;
  readonly percentile: Percentage;
  /** The series' own range since `sinceYear`: the dispersion the percentile is read against. */
  readonly historyMin: Figure;
  readonly historyMax: Figure;
}

export interface MacroSeriesInput {
  readonly id: string;
  readonly series: string;
  readonly source: string | null;
  readonly observation: MacroObservation | null;
}

/** The panel's series (DESIGN §8.3). None is stored yet, so each reads as unknown. */
export const MACRO_SERIES: readonly MacroSeriesInput[] = Object.freeze([
  { id: "inr-usd", series: "INR per USD", source: "Frankfurter", observation: null },
  { id: "gold-inr", series: "Gold, INR", source: null, observation: null },
  { id: "crude", series: "Crude oil", source: null, observation: null },
  { id: "us-10y", series: "US 10-year yield", source: null, observation: null },
  { id: "fii-dii", series: "FII/DII cumulative flows", source: null, observation: null },
]);

/** Series with no keyless source: listed, never approximated. */
export const DELIBERATELY_MISSING: readonly string[] = Object.freeze([
  "India 10-year G-Sec yield — no keyless source.",
  "Monthly CPI — no keyless source.",
]);

export interface MacroRow {
  readonly id: string;
  readonly series: string;
  readonly level: FigureValue;
  readonly asOf: string | Unknown;
  /** Percentile with the series' own range, in one string: never one without the other. */
  readonly placement: string | Unknown;
  readonly source: string;
  readonly stale: boolean;
}

export function macroRow(input: MacroSeriesInput): MacroRow {
  const source = input.source ?? "No keyless source wired";
  const o = input.observation;
  if (o === null) {
    const reason = input.source === null ? "No source is wired for this series." : "No observations of this series are stored yet.";
    return { id: input.id, series: input.series, level: unknown(reason), asOf: unknown(reason), placement: unknown(reason), source, stale: false };
  }
  return {
    id: input.id,
    series: input.series,
    level: o.level,
    asOf: dayMonthYear(o.asOf),
    placement: `Percentile ${percentage(o.percentile, 0).replace("%", "")} of readings since ${o.sinceYear}; own range ${o.historyMin} to ${o.historyMax}`,
    source,
    stale: o.stale,
  };
}

/* ═══ The page ═════════════════════════════════════════════════════════ */

export interface SignalsView {
  readonly asOf: string;
  readonly empty: boolean;
  readonly holdingsNote: Unknown | null;
  readonly failingSources: FigureValue;
  readonly unreadableSources: string | null;
  readonly rules: readonly RuleView[];
  readonly allocation: AllocationView;
  readonly tax: TaxView;
  readonly drawdown: DrawdownView;
  readonly macro: readonly MacroRow[];
  readonly missing: readonly string[];
  readonly flows: Unknown;
}

export function buildSignalsView(
  snapshot: SignalsSnapshot,
  market: { readonly drawdown: DrawdownInput | null; readonly macro?: readonly MacroSeriesInput[] },
): SignalsView {
  const empty = snapshot.holdings.state === "KNOWN" && snapshot.holdings.count === 0;
  const drawdown: DrawdownInput = empty
    ? { state: "NO_HOLDINGS" }
    : market.drawdown ?? { state: "UNKNOWN", reason: "No index price history is stored, so the drawdown and what followed past drawdowns cannot be computed." };
  return {
    asOf: dayMonthYear(snapshot.asOf),
    empty,
    holdingsNote: snapshot.holdings.state === "UNKNOWN" ? unknown(snapshot.holdings.reason) : null,
    failingSources: snapshot.sources.state === "KNOWN" ? countFigure(snapshot.sources.failing) : unknown(snapshot.sources.reason),
    unreadableSources: snapshot.sources.state === "KNOWN" && snapshot.sources.unreadable.length > 0
      ? `Health unknown for ${snapshot.sources.unreadable.join(", ")}.`
      : null,
    rules: snapshot.rules.map(ruleView),
    allocation: allocationView(snapshot.allocation),
    tax: taxView(snapshot.tax),
    drawdown: drawdownView(drawdown),
    macro: (market.macro ?? MACRO_SERIES).map(macroRow),
    missing: DELIBERATELY_MISSING,
    flows: unknown("No daily FII/DII net series is stored yet, so no flows are shown."),
  };
}

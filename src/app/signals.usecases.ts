/**
 * The Tier 2 board read (tasks 6.3.s / 6.3.b): the Tier 1 alert rules, the owner's tax
 * position and the allocation band standing, composed from existing reads.
 *
 * Nothing here computes a rule of its own. Every alert comes from `src/domain/alerts.ts`
 * and the band standing from `bandStanding` in `src/domain/portfolio.ts`, unchanged.
 *
 * **An absent input is reported, never guessed.** alerts.ts returns no alert for an
 * unknown input; a board that showed only the alerts would let that silence read as
 * "all clear". So each rule reports one of three outcomes — `FIRED`, `CLEAR` (evaluated,
 * nothing to state) or `NOT_EVALUATED` with the missing input named.
 */

import type { AppError, Result, UserId } from "@/core/kernel";
import { Money } from "@/core/money";
import type { Percentage } from "@/core/numeric";
import { FinancialYear, type CalendarDate } from "@/core/time";
import { Count, Days, type Months } from "@/core/units";
import {
  concentrationAlert,
  exemptionUnusedAlert,
  runwayAlert,
  sourceFailureAlert,
  termBoundaryAlert,
  type Alert,
  type AlertKind,
  type LotNearBoundary,
} from "@/domain/alerts";
import { bandStanding, type Band, type BandStanding, type Sleeve, type TargetAllocation } from "@/domain/portfolio";
import { toSourceAlertInput } from "@/domain/source-health";
import { RegimeRegistry, type TaxSettingsRepository } from "@/domain/tax";
import type { ValuePortfolioInput, ValuePortfolioOutput } from "@/app/investing.usecases";
import type { TaxReportInput, TaxReportOutput } from "@/app/reports.usecases";
import type { SourceHealthOutput } from "@/app/source-health.usecases";

/**
 * How far ahead the date-bound rules look. Display windows, not statute, and stated on
 * screen; they match the windows `tests/alerts.spec.ts` exercises.
 */
export const TERM_BOUNDARY_WINDOW = Days(30);
export const EXEMPTION_WINDOW = Days(30);

/** The existing reads this board composes. Narrow ports so a spec can pass fakes. */
export interface SignalsReads {
  readonly valuePortfolio: { execute(input: ValuePortfolioInput): Promise<Result<ValuePortfolioOutput, AppError>> };
  readonly taxReport: { execute(input: TaxReportInput): Promise<Result<TaxReportOutput, AppError>> };
  readonly taxSettings: Pick<TaxSettingsRepository, "findFor">;
  readonly regimes?: RegimeRegistry;
}

/**
 * Owner-state inputs that have no store or reader yet. Each `null` is shown as not
 * evaluated with its reason; the page passes `null` until the input is wired.
 */
export interface SignalsOptionalInputs {
  readonly lotsNearBoundary: readonly LotNearBoundary[] | null;
  readonly concentrationThreshold: Percentage | null;
  readonly runway: { readonly months: Months | null; readonly target: Months } | null;
  readonly allocation: { readonly sleeves: readonly Sleeve[]; readonly band: Band } | null;
  readonly sources: SourceHealthOutput | null;
  /**
   * The owner's stored target allocation (`target_allocations`), used only when
   * `allocation` is null. Sleeve ids are instrument ids. Absent means unchanged
   * behaviour; present without a `band` is reported, never defaulted.
   */
  readonly storedTarget?: TargetAllocation | null;
  readonly band?: Band | null;
}

export const NO_OPTIONAL_INPUTS: SignalsOptionalInputs = Object.freeze({
  lotsNearBoundary: null,
  concentrationThreshold: null,
  runway: null,
  allocation: null,
  sources: null,
});

export type RuleOutcome =
  | { readonly kind: AlertKind; readonly status: "FIRED"; readonly alerts: readonly Alert[]; readonly note: string | null }
  | { readonly kind: AlertKind; readonly status: "CLEAR"; readonly note: string | null }
  | { readonly kind: AlertKind; readonly status: "NOT_EVALUATED"; readonly reason: string };

export type HoldingsState =
  | { readonly state: "KNOWN"; readonly count: Count; readonly stale: readonly string[]; readonly unpriced: readonly string[] }
  | { readonly state: "UNKNOWN"; readonly reason: string };

export type TaxPosition =
  | { readonly state: "KNOWN"; readonly financialYear: string; readonly exemption: Money; readonly used: Money }
  | { readonly state: "UNKNOWN"; readonly financialYear: string; readonly reason: string };

export type AllocationState =
  | { readonly state: "EMPTY" }
  | { readonly state: "UNKNOWN"; readonly reason: string }
  | { readonly state: "REFUSED"; readonly reason: string }
  | { readonly state: "STANDING"; readonly standing: BandStanding; readonly stale: readonly string[] };

export type SourcesState =
  | { readonly state: "KNOWN"; readonly failing: Count; readonly unreadable: readonly string[] }
  | { readonly state: "UNKNOWN"; readonly reason: string };

export interface SignalsSnapshot {
  readonly asOf: CalendarDate;
  readonly holdings: HoldingsState;
  readonly rules: readonly RuleOutcome[];
  readonly tax: TaxPosition;
  readonly allocation: AllocationState;
  readonly sources: SourcesState;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const messageOf = (error: unknown): string =>
  typeof (error as { message?: unknown })?.message === "string" ? (error as { message: string }).message : String(error);

const fired = (kind: AlertKind, alerts: readonly (Alert | null)[], note: string | null = null): RuleOutcome => {
  const present = alerts.filter((a): a is Alert => a !== null);
  return present.length > 0
    ? Object.freeze({ kind, status: "FIRED" as const, alerts: Object.freeze(present), note })
    : Object.freeze({ kind, status: "CLEAR" as const, note });
};
const notEvaluated = (kind: AlertKind, reason: string): RuleOutcome => Object.freeze({ kind, status: "NOT_EVALUATED" as const, reason });

export class ViewSignals {
  constructor(private readonly reads: SignalsReads) {}

  async execute(input: {
    readonly userId: UserId;
    readonly asOf: CalendarDate;
    readonly optional?: SignalsOptionalInputs;
  }): Promise<SignalsSnapshot> {
    const { userId, asOf } = input;
    const optional = input.optional ?? NO_OPTIONAL_INPUTS;
    const year = FinancialYear.containing(asOf);
    const [valuation, tax] = await Promise.all([this.valuation(userId, asOf), this.tax(userId, year, asOf)]);

    const holdings: HoldingsState = valuation.ok
      ? Object.freeze({
          state: "KNOWN" as const,
          count: Count(valuation.value.valued.length),
          stale: valuation.value.stalePositions,
          unpriced: [...valuation.value.unpricedPositions, ...valuation.value.unconvertedPositions],
        })
      : Object.freeze({ state: "UNKNOWN" as const, reason: valuation.reason });

    const rules = Object.freeze([
      this.termBoundary(optional.lotsNearBoundary, asOf),
      tax.state === "KNOWN"
        ? fired("EXEMPTION_UNUSED", [exemptionUnusedAlert(year, tax.exemption, tax.used, asOf, EXEMPTION_WINDOW)])
        : notEvaluated("EXEMPTION_UNUSED", tax.reason),
      this.concentration(optional.concentrationThreshold, valuation, asOf),
      this.runway(optional.runway, asOf),
      this.sourceRule(optional.sources, asOf),
    ]);

    return Object.freeze({
      asOf,
      holdings,
      rules,
      tax,
      allocation: this.allocation(optional.allocation ?? this.fromStoredTarget(optional, valuation), holdings),
      sources: this.sourcesState(rules[4]!, optional.sources),
    });
  }

  private async valuation(userId: UserId, asOf: CalendarDate) {
    try {
      const result = await this.reads.valuePortfolio.execute({ userId, asOf });
      if (!result.ok) return { ok: false as const, reason: `Your holdings could not be valued (${result.error.message}).` };
      return { ok: true as const, value: result.value };
    } catch (error) {
      return { ok: false as const, reason: `Your holdings could not be valued (${messageOf(error)}).` };
    }
  }

  private async tax(userId: UserId, year: FinancialYear, asOf: CalendarDate): Promise<TaxPosition> {
    const fy = `FY ${year.label}`;
    const unknownTax = (reason: string): TaxPosition => Object.freeze({ state: "UNKNOWN" as const, financialYear: fy, reason });
    try {
      const stored = await this.reads.taxSettings.findFor(userId, year);
      // Never an assumed slab: a guessed setting would make the used figure a guess too.
      if (stored === null) return unknownTax(`Tax settings for ${fy} are not stored, so the exemption used is not computed. Add them in Settings.`);
      const exemption = (this.reads.regimes ?? new RegimeRegistry()).forDate(asOf).exemptionLimitFor("LISTED_EQUITY");
      if (exemption === null) return unknownTax(`The tax regime in force on ${asOf.toISO()} has no listed-equity exemption.`);
      const report = await this.reads.taxReport.execute({
        userId,
        financialYear: year,
        settings: { slabRate: stored.marginalSlabRate, totalIncome: stored.totalIncome, residentStatus: stored.residentStatus },
      });
      if (!report.ok) return unknownTax(`The tax report for ${fy} could not be computed (${report.error.message}).`);
      return Object.freeze({ state: "KNOWN" as const, financialYear: fy, exemption, used: report.value.assessment.exemptionUsed });
    } catch (error) {
      return unknownTax(`The tax position for ${fy} could not be read (${messageOf(error)}).`);
    }
  }

  private termBoundary(lots: readonly LotNearBoundary[] | null, asOf: CalendarDate): RuleOutcome {
    if (lots === null) return notEvaluated("TERM_BOUNDARY", "Per-lot unrealised gains are not read yet, so no lot is checked against its long-term date.");
    return fired("TERM_BOUNDARY", lots.map((lot) => termBoundaryAlert(lot, asOf, TERM_BOUNDARY_WINDOW)));
  }

  private concentration(
    threshold: Percentage | null,
    valuation: { ok: true; value: ValuePortfolioOutput } | { ok: false; reason: string },
    asOf: CalendarDate,
  ): RuleOutcome {
    if (threshold === null) return notEvaluated("CONCENTRATION", "No concentration threshold is stored, so no holding is measured against one.");
    if (!valuation.ok) return notEvaluated("CONCENTRATION", valuation.reason);
    const { valued, totalMarketValue, unpricedPositions, unconvertedPositions } = valuation.value;
    if (valued.length === 0) return notEvaluated("CONCENTRATION", "No holdings are recorded.");
    const missing = [...unpricedPositions, ...unconvertedPositions];
    if (totalMarketValue === null) {
      return notEvaluated("CONCENTRATION", `The portfolio total is unknown: ${plural(missing.length, "holding")} (${missing.join(", ")}) cannot be valued.`);
    }
    return fired("CONCENTRATION", valued.map((p) =>
      p.reportingMarketValue === null ? null
        : concentrationAlert({ id: p.instrumentId.value, name: p.label, value: p.reportingMarketValue }, totalMarketValue, threshold, asOf)));
  }

  private runway(runway: SignalsOptionalInputs["runway"], asOf: CalendarDate): RuleOutcome {
    if (runway === null) return notEvaluated("RUNWAY_BELOW_TARGET", "Emergency runway and its target are not measured from the ledger yet.");
    if (runway.months === null) return notEvaluated("RUNWAY_BELOW_TARGET", "Emergency runway is unknown.");
    return fired("RUNWAY_BELOW_TARGET", [runwayAlert(runway.months, runway.target, asOf)]);
  }

  private sourceRule(sources: SourceHealthOutput | null, asOf: CalendarDate): RuleOutcome {
    if (sources === null) return notEvaluated("SOURCE_FAILURE", "The source-health monitor is not connected to a fetch log yet, so no source is checked.");
    const read = sources.sources.flatMap((entry) => (entry.state === "READ" ? [entry.health] : []));
    const unreadable = sources.sources.flatMap((entry) => (entry.state === "UNREADABLE" ? [entry.name] : []));
    if (read.length === 0) {
      return notEvaluated("SOURCE_FAILURE", unreadable.length > 0 ? `No fetch log could be read (${unreadable.join(", ")}).` : "No sources are configured.");
    }
    const note = unreadable.length > 0 ? `Health unknown for ${unreadable.join(", ")}: the fetch log could not be read.` : null;
    return fired("SOURCE_FAILURE", read.map((health) => sourceFailureAlert(toSourceAlertInput(health), health.maxAge, asOf)), note);
  }

  /** Sleeves from the stored target, or a reason it cannot be measured. Null when none is stored. */
  private fromStoredTarget(
    optional: SignalsOptionalInputs,
    valuation: { readonly ok: true; readonly value: ValuePortfolioOutput } | { readonly ok: false; readonly reason: string },
  ): SignalsOptionalInputs["allocation"] | AllocationState {
    const target = optional.storedTarget ?? null;
    if (target === null) return null;
    if (!optional.band) {
      return Object.freeze({ state: "UNKNOWN" as const, reason: "A target allocation is stored, but no rebalancing band is stored, so no sleeve is measured." });
    }
    if (!valuation.ok) return Object.freeze({ state: "UNKNOWN" as const, reason: valuation.reason });
    const sleeves = sleevesFromTarget(
      target,
      valuation.value.valued.map((p) => ({ id: p.instrumentId.value, name: p.label, value: p.reportingMarketValue })),
    );
    return "sleeves" in sleeves ? { sleeves: sleeves.sleeves, band: optional.band } : sleeves;
  }

  private allocation(allocation: SignalsOptionalInputs["allocation"] | AllocationState, holdings: HoldingsState): AllocationState {
    if (allocation !== null && "state" in allocation) return allocation;
    if (allocation === null) {
      if (holdings.state === "KNOWN" && holdings.count === 0) return Object.freeze({ state: "EMPTY" as const });
      return Object.freeze({ state: "UNKNOWN" as const, reason: "No target allocation is stored, so no sleeve is measured against a band." });
    }
    try {
      return Object.freeze({
        state: "STANDING" as const,
        standing: bandStanding(allocation.sleeves, allocation.band),
        stale: holdings.state === "KNOWN" ? holdings.stale : [],
      });
    } catch (error) {
      if (error instanceof RangeError) return Object.freeze({ state: "REFUSED" as const, reason: error.message });
      throw error;
    }
  }

  private sourcesState(rule: RuleOutcome, sources: SourceHealthOutput | null): SourcesState {
    if (sources === null || rule.status === "NOT_EVALUATED") {
      return Object.freeze({ state: "UNKNOWN" as const, reason: rule.status === "NOT_EVALUATED" ? rule.reason : "Source health is unknown." });
    }
    const unreadable = sources.sources.flatMap((entry) => (entry.state === "UNREADABLE" ? [entry.name] : []));
    return Object.freeze({ state: "KNOWN" as const, failing: Count(rule.status === "FIRED" ? rule.alerts.length : 0), unreadable });
  }
}

/**
 * Maps the stored target onto valued holdings, one sleeve per instrument id.
 * Refuses rather than guesses: a holding with no target sleeve, or a holding with no
 * value, cannot be placed. A target sleeve with no holding is a zero-value sleeve.
 */
export function sleevesFromTarget(
  target: TargetAllocation,
  holdings: readonly { readonly id: string; readonly name: string; readonly value: Money | null }[],
): { readonly sleeves: readonly Sleeve[] } | AllocationState {
  const byId = new Map(holdings.map((h) => [h.id, h]));
  const untargeted = holdings.filter((h) => !target.shares.some((s) => s.id === h.id));
  if (untargeted.length > 0) {
    return Object.freeze({ state: "REFUSED" as const, reason: `No target sleeve for ${untargeted.map((h) => h.name).join(", ")}.` });
  }
  const unvalued = holdings.filter((h) => h.value === null);
  if (unvalued.length > 0) {
    return Object.freeze({ state: "UNKNOWN" as const, reason: `Cannot value ${unvalued.map((h) => h.name).join(", ")}, so the allocation is unknown.` });
  }
  const currency = holdings[0]?.value?.currency;
  if (currency === undefined) return Object.freeze({ state: "EMPTY" as const });
  return {
    sleeves: target.shares.map((s) => {
      const holding = byId.get(s.id);
      return { id: s.id, name: holding?.name ?? s.id, value: holding?.value ?? Money.zero(currency), target: s.share };
    }),
  };
}

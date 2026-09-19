import type { Clock, UserId } from "@/core/kernel";
import { Money } from "@/core/money";
import { CalendarDate, DateRange } from "@/core/time";
import type { Bar, BarRepository, Indicator } from "@/domain/analysis";
import { groupOf, type AssetGroup } from "@/domain/asset-groups";
import { InstrumentId, type InstrumentKind, type InstrumentRepository, type MarketInstrument } from "@/domain/instruments";
import { maxDrawdown, type ValuationPoint } from "@/domain/portfolio";
import {
  STALENESS_DAYS,
  type PriceSourceType,
  type Quote,
  type QuoteRepository,
} from "@/domain/pricing";

const DIGITAL_KINDS: ReadonlySet<InstrumentKind> = new Set([
  "DIGITAL_GOLD",
  "DIGITAL_SILVER",
  "DIGITAL_PLATINUM",
]);

export type AnalysisMetric =
  | { readonly status: "AVAILABLE"; readonly value: number; readonly unit: "PRICE" | "PERCENTAGE" }
  | { readonly status: "UNAVAILABLE"; readonly reason: "INSUFFICIENT_DATA"; readonly message: string };

export interface InvestmentAnalysisInput {
  readonly userId: UserId;
  readonly from: CalendarDate;
  readonly through: CalendarDate;
  readonly instrumentId?: string;
}

export interface InvestmentAnalysisRow {
  readonly instrumentId: string;
  readonly symbol: string;
  readonly name: string;
  readonly kind: InstrumentKind;
  readonly assetFamily: AssetGroup;
  readonly currency: string;
  readonly range: { readonly from: string; readonly through: string };
  readonly asOf: string | null;
  readonly barsUsed: number;
  readonly provenance: readonly string[];
  readonly series: readonly {
    readonly on: string;
    readonly open: string;
    readonly high: string;
    readonly low: string;
    readonly close: string;
    readonly volume: string | null;
  }[];
  readonly indicators: readonly {
    readonly name: string;
    readonly window: number;
    readonly status: "AVAILABLE" | "UNAVAILABLE";
    readonly value: number | null;
    readonly reason: string;
  }[];
  readonly periodReturn: AnalysisMetric;
  readonly maximumDrawdown: AnalysisMetric & {
    readonly peakOn?: string | null;
    readonly troughOn?: string | null;
    readonly durationDays?: number;
    readonly recovered?: boolean;
  };
  readonly bollingerPosition: AnalysisMetric;
  readonly warnings: readonly string[];
  readonly gaps: readonly { readonly from: string; readonly through: string }[];
}

export interface InvestmentAnalysisOutput {
  readonly generatedAt: string;
  readonly range: { readonly from: string; readonly through: string };
  readonly selection: "AVAILABLE" | "NOT_FOUND";
  readonly rows: readonly InvestmentAnalysisRow[];
}

/** Server-owned technical and risk analysis over stored, auditable daily bars. */
export class ViewInvestmentAnalysis {
  constructor(
    private readonly instruments: InstrumentRepository,
    private readonly bars: BarRepository,
    private readonly clock: Clock,
  ) {}

  async execute(input: InvestmentAnalysisInput): Promise<InvestmentAnalysisOutput> {
    let instruments: readonly MarketInstrument[];
    if (input.instrumentId) {
      const owned = await this.instruments.findById(input.userId, InstrumentId.from(input.instrumentId));
      if (!owned || owned.isClosed || !isAnalysisEligible(owned)) {
        return {
          generatedAt: this.clock.now().toISOString(),
          range: { from: input.from.toISO(), through: input.through.toISO() },
          selection: "NOT_FOUND",
          rows: [],
        };
      }
      instruments = [owned];
    } else {
      instruments = (await this.instruments.list(input.userId, { includeClosed: false }))
        .filter(isAnalysisEligible);
    }
    const range = DateRange.of(input.from, input.through);
    const rows = await Promise.all(instruments.map(async (instrument) => {
      const [series, gaps] = await Promise.all([
        this.bars.findRange(instrument.id.value, "DAY", range),
        this.bars.gaps(instrument.id.value, "DAY", range),
      ]);
      return toAnalysisRow(instrument, series, gaps, input.from, input.through);
    }));
    return {
      generatedAt: this.clock.now().toISOString(),
      range: { from: input.from.toISO(), through: input.through.toISO() },
      selection: "AVAILABLE",
      rows,
    };
  }
}

export type TrackerFreshness =
  | "LIVE"
  | "CURRENT"
  | "DELAYED"
  | "EOD"
  | "NAV_DAILY"
  | "STALE"
  | "MANUAL"
  | "UNAVAILABLE";

export interface LiveQuoteEntitlements {
  /** Provider IDs for which the user has an active current-quote entitlement. */
  readonly providerIds: readonly string[];
  readonly maxLiveAgeMinutes?: number;
}

export interface InvestmentTrackerOutput {
  readonly generatedAt: string;
  readonly asOf: string;
  readonly rows: readonly {
    readonly instrumentId: string;
    readonly symbol: string;
    readonly name: string;
    readonly kind: InstrumentKind;
    readonly assetFamily: AssetGroup;
    readonly currency: string;
    readonly availability: "AVAILABLE" | "UNAVAILABLE";
    readonly freshness: TrackerFreshness;
    readonly value: string | null;
    readonly observationTime: string | null;
    readonly ingestedAt: string | null;
    readonly providerId: string | null;
    readonly sourceType: PriceSourceType | null;
    readonly ageDays: number | null;
    readonly dayChangePercent: number | null;
    readonly dataGap: "NONE" | "NO_OBSERVATION" | "STALE_OBSERVATION" | "PREVIOUS_OBSERVATION_UNAVAILABLE";
    readonly reason: string | null;
    readonly correctiveAction: string | null;
  }[];
}

/** Latest stored observations with health derived from evidence, never credentials alone. */
export class ViewInvestmentTracker {
  constructor(
    private readonly instruments: InstrumentRepository,
    private readonly quotes: QuoteRepository,
    private readonly clock: Clock,
    private readonly entitlements: LiveQuoteEntitlements = { providerIds: [] },
  ) {}

  async execute(input: { readonly userId: UserId; readonly asOf: CalendarDate }): Promise<InvestmentTrackerOutput> {
    const instruments = (await this.instruments.list(input.userId, { includeClosed: false }))
      .filter((instrument) => !DIGITAL_KINDS.has(instrument.kind));
    const rows = await Promise.all(instruments.map(async (instrument) => {
      const key = instrument.quoteKey();
      const quotes = (await this.quotes.findLatestOnOrBefore(
        instrument.id.value,
        key.quoteType,
        input.asOf,
        50,
      )).filter((quote) => !quote.supersededBy);
      return toTrackerRow(instrument, quotes, input.asOf, this.clock.now(), this.entitlements);
    }));
    return { generatedAt: this.clock.now().toISOString(), asOf: input.asOf.toISO(), rows };
  }
}

function isAnalysisEligible(instrument: MarketInstrument): boolean {
  return !DIGITAL_KINDS.has(instrument.kind) && instrument.quoteKey().assetClass !== "DERIVATIVE";
}

function toAnalysisRow(
  instrument: MarketInstrument,
  series: readonly Bar[],
  gaps: readonly DateRange[],
  from: CalendarDate,
  through: CalendarDate,
): InvestmentAnalysisRow {
  const analysis = instrument.analyse(series);
  const current = series.filter((bar) => !bar.supersededBy).slice().sort((a, b) => a.asOf.compareTo(b.asOf));
  const first = current[0]?.close.toScaledNumber();
  const last = current.at(-1)?.close.toScaledNumber();
  const periodReturn: AnalysisMetric = first === undefined || last === undefined || first === 0 || current.length < 2
    ? unavailable("Period return needs at least two valid closes.")
    : { status: "AVAILABLE", value: ((last / first) - 1) * 100, unit: "PERCENTAGE" };
  const drawdown = current.length < 2 ? null : maxDrawdown(current.map((bar): ValuationPoint => ({
    on: bar.asOf,
    value: Money.fromRupees(bar.close.toDecimalString(), instrument.currency),
  })));
  const maximumDrawdown: InvestmentAnalysisRow["maximumDrawdown"] = drawdown
    ? {
        status: "AVAILABLE",
        value: Number(drawdown.maxDrawdown.toFixed(6)),
        unit: "PERCENTAGE",
        peakOn: drawdown.peakOn?.toISO() ?? null,
        troughOn: drawdown.troughOn?.toISO() ?? null,
        durationDays: drawdown.durationDays,
        recovered: drawdown.recovered,
      }
    : unavailable("Maximum drawdown needs at least two valid closes.");
  const indicators = analysis.indicators.map(toIndicator);
  const middle = indicatorValue(analysis.indicators, "Bollinger(20,2) middle");
  const upper = indicatorValue(analysis.indicators, "Bollinger(20,2) upper");
  const lower = indicatorValue(analysis.indicators, "Bollinger(20,2) lower");
  const bollingerPosition: AnalysisMetric = last === undefined || middle === null || upper === null || lower === null || upper === lower
    ? unavailable("Bollinger position needs 20 valid daily bars and a non-zero band width.")
    : { status: "AVAILABLE", value: ((last - lower) / (upper - lower)) * 100, unit: "PERCENTAGE" };

  return {
    instrumentId: instrument.id.value,
    symbol: instrument.symbol,
    name: instrument.name,
    kind: instrument.kind,
    assetFamily: groupOf(instrument),
    currency: instrument.currency.code,
    range: { from: from.toISO(), through: through.toISO() },
    asOf: current.at(-1)?.asOf.toISO() ?? null,
    barsUsed: analysis.barsUsed,
    provenance: [...new Set(current.map((bar) => bar.providerId))],
    series: current.map((bar) => ({
      on: bar.asOf.toISO(),
      open: bar.open.toDecimalString(),
      high: bar.high.toDecimalString(),
      low: bar.low.toDecimalString(),
      close: bar.close.toDecimalString(),
      volume: bar.volume?.toString() ?? null,
    })),
    indicators,
    periodReturn,
    maximumDrawdown,
    bollingerPosition,
    warnings: analysis.warnings,
    gaps: gaps.map((gap) => ({ from: gap.start.toISO(), through: gap.end.toISO() })),
  };
}

function toIndicator(indicator: Indicator): InvestmentAnalysisRow["indicators"][number] {
  return {
    name: indicator.name,
    window: indicator.window,
    status: indicator.value === null ? "UNAVAILABLE" : "AVAILABLE",
    value: indicator.value,
    reason: indicator.because,
  };
}

function indicatorValue(indicators: readonly Indicator[], name: string): number | null {
  return indicators.find((indicator) => indicator.name === name)?.value ?? null;
}

function unavailable(message: string): AnalysisMetric {
  return { status: "UNAVAILABLE", reason: "INSUFFICIENT_DATA", message };
}

function toTrackerRow(
  instrument: MarketInstrument,
  quotes: readonly Quote[],
  asOf: CalendarDate,
  now: Date,
  entitlements: LiveQuoteEntitlements,
): InvestmentTrackerOutput["rows"][number] {
  const latest = quotes[0];
  if (!latest) {
    return {
      instrumentId: instrument.id.value, symbol: instrument.symbol, name: instrument.name,
      kind: instrument.kind, assetFamily: groupOf(instrument), currency: instrument.currency.code,
      availability: "UNAVAILABLE", freshness: "UNAVAILABLE", value: null, observationTime: null,
      ingestedAt: null, providerId: null, sourceType: null, ageDays: null, dayChangePercent: null,
      dataGap: "NO_OBSERVATION",
      reason: "No stored observation is available on or before the requested date.",
      correctiveAction: "Refresh market data or record a sourced manual value.",
    };
  }
  const previous = quotes.find((quote) => quote.asOf.isBefore(latest.asOf));
  const currentValue = latest.price.toScaledNumber();
  const previousValue = previous?.price.toScaledNumber();
  const ageDays = latest.asOf.daysUntil(asOf);
  const freshness = quoteFreshness(instrument, latest, asOf, now, entitlements);
  return {
    instrumentId: instrument.id.value, symbol: instrument.symbol, name: instrument.name,
    kind: instrument.kind, assetFamily: groupOf(instrument), currency: instrument.currency.code,
    availability: "AVAILABLE", freshness, value: latest.price.toDecimalString(),
    observationTime: latest.asOf.toISO(), ingestedAt: latest.ingestedAt.toISOString(),
    providerId: sanitizedProviderId(latest.providerId), sourceType: latest.sourceType, ageDays,
    dayChangePercent: previousValue && previousValue !== 0 ? ((currentValue / previousValue) - 1) * 100 : null,
    dataGap: freshness === "STALE"
      ? "STALE_OBSERVATION"
      : previousValue === undefined ? "PREVIOUS_OBSERVATION_UNAVAILABLE" : "NONE",
    reason: freshness === "STALE" ? `The latest observation is ${ageDays} days old.` : null,
    correctiveAction: freshness === "STALE" ? "Refresh this instrument before relying on its current value." : null,
  };
}

function sanitizedProviderId(providerId: string): string {
  return /^[a-z0-9._-]{1,64}$/i.test(providerId) ? providerId : "unknown";
}

function quoteFreshness(
  instrument: MarketInstrument,
  quote: Quote,
  asOf: CalendarDate,
  _now: Date,
  _entitlements: LiveQuoteEntitlements,
): TrackerFreshness {
  if (quote.sourceType === "MANUAL") return "MANUAL";
  const ageDays = quote.asOf.daysUntil(asOf);
  if (ageDays > STALENESS_DAYS[instrument.quoteKey().assetClass]) return "STALE";
  // Quote persistence currently records a trading date, not an exchange event
  // timestamp. Recent ingestion and provider entitlement cannot prove realtime
  // semantics, so no stored quote is promoted to LIVE until that evidence exists.
  if (["INDEX_FUND", "MUTUAL_FUND", "LIQUID_FUND", "DEBT_FUND", "ELSS_FUND"].includes(instrument.kind)) return "NAV_DAILY";
  if (["LISTED_EQUITY", "ETF", "REIT"].includes(instrument.kind)) return ageDays === 0 ? "DELAYED" : "EOD";
  return ageDays === 0 ? "CURRENT" : "EOD";
}

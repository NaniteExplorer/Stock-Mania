/**
 * Bars, indicators, and the analysis extension point.
 *
 * Phase 8's purpose is not to build a trading system but to make sure the class
 * design can host one. Three things had to exist for that claim to be testable,
 * and all three are here:
 *
 *   1. **A bar.** Four prices and a volume for a period. Distinct from a `Quote`,
 *      which is the *one* number a holding is valued at — nothing values a
 *      portfolio from a bar, and nothing analyses a shape from a quote.
 *   2. **`analyse(series)`**, hung on `MarketInstrument`, so per-instrument deep
 *      analysis is an override on a leaf rather than a switch in a screen. The
 *      technical indicators below are the first concrete implementation; an
 *      option adds days-to-expiry and moneyness by overriding, and nothing else
 *      in the codebase learns that options exist.
 *   3. **A repository interface** for bar storage, so changing granularity or
 *      moving to a different store later is a constructor argument.
 *
 * **Why `number` here, when money is `bigint` everywhere else.** An indicator is
 * not money. An RSI is a bounded ratio, a standard deviation is a dispersion, a
 * MACD is a difference of two averages — none of them is a sum anybody has to
 * reconcile to a bank statement, and none is stored. Prices enter as `UnitPrice`
 * and are converted **once**, explicitly, at `toScaledNumber()`. What is
 * forbidden is a float that reaches a balance, a tax figure or a posting; a float
 * that reaches a chart of a moving average is the correct representation.
 * `analyse` returns no `Money` at all, which is what keeps that line clean.
 */

import { Currency } from "@/core/money";
import { UnitPrice } from "@/core/numeric";
import { CalendarDate, DateRange } from "@/core/time";
import { TRADING_DAYS, stdDev } from "@/domain/portfolio";

/* ═══ Bars ════════════════════════════════════════════════════════════ */

export type BarGranularity = "DAY" | "WEEK" | "MONTH";

/**
 * One period's shape.
 *
 * Constructed through {@link makeBar}, which refuses an impossible bar. The store
 * enforces the same inequalities as check constraints, so neither layer trusts
 * the other — a bar with a high below its low is not a validation failure, it is
 * a thing that does not exist.
 */
export interface Bar {
  readonly instrumentId: string;
  readonly asOf: CalendarDate;
  readonly granularity: BarGranularity;
  readonly open: UnitPrice;
  readonly high: UnitPrice;
  readonly low: UnitPrice;
  readonly close: UnitPrice;
  /** Units traded. `null` when the source does not publish it — never zero for unknown. */
  readonly volume: bigint | null;
  readonly currency: Currency;
  readonly providerId: string;
  /** The second time axis, as on a quote: when we learned this bar. */
  readonly ingestedAt: Date;
  readonly supersededBy?: string | null;
}

export class ImpossibleBarError extends TypeError {
  constructor(message: string) {
    super(message);
    this.name = "ImpossibleBarError";
  }
}

/** The only way to make a `Bar`. Refuses what the store would refuse. */
export function makeBar(bar: Bar): Bar {
  const inside = (candidate: UnitPrice) =>
    candidate.compareTo(bar.low) >= 0 && candidate.compareTo(bar.high) <= 0;

  if (bar.high.compareTo(bar.low) < 0) {
    throw new ImpossibleBarError(
      `${bar.instrumentId} on ${bar.asOf.toISO()}: the high (${bar.high.toDecimalString()}) is ` +
        `below the low (${bar.low.toDecimalString()}). That is not a bar with a bad field, it is ` +
        `not a bar.`,
    );
  }
  if (!inside(bar.open) || !inside(bar.close)) {
    throw new ImpossibleBarError(
      `${bar.instrumentId} on ${bar.asOf.toISO()}: the open and close must lie between the low ` +
        `and the high.`,
    );
  }
  if (bar.volume !== null && bar.volume < 0n) {
    throw new ImpossibleBarError(
      `${bar.instrumentId} on ${bar.asOf.toISO()}: volume cannot be negative.`,
    );
  }
  return bar;
}

/* ═══ Repository port ═════════════════════════════════════════════════ */

/**
 * Bar storage, behind an interface.
 *
 * Shaped like `QuoteRepository` in `domain/pricing.ts` on purpose, so the two
 * read the same way: append-only, a range query, and a coverage query so a
 * backfill resumes rather than restarting. Nothing above this interface knows
 * whether a day bar and a month bar live in the same table — which is the
 * "granularity change routes to a different store" the plan asks for, and is why
 * `granularity` is an argument on every method rather than a constructor
 * parameter of one implementation.
 */
export interface BarRepository {
  append(bars: readonly Bar[]): Promise<void>;

  findRange(
    instrumentId: string,
    granularity: BarGranularity,
    range: DateRange,
  ): Promise<readonly Bar[]>;

  /** What we already have, so a backfill resumes. `null` when there is nothing. */
  coverage(
    instrumentId: string,
    granularity: BarGranularity,
  ): Promise<{ from: CalendarDate; through: CalendarDate; count: number } | null>;

  /** Marks a bar corrected by a later one, keeping both. */
  supersede(supersededBarId: string, bySupersedingBarId: string): Promise<void>;
}

/* ═══ Indicators ══════════════════════════════════════════════════════ */

/**
 * One indicator value, with the honesty about insufficient data that a price
 * carries about staleness.
 *
 * A 200-day moving average over 40 bars is not a 40-day average, and it is not
 * zero: it is **unanswerable**, and `value: null` with a `because` is the only
 * honest report. Every indicator here fails that way rather than quietly
 * shortening its window — a chart drawn from silently-shortened windows looks
 * exactly like a correct one.
 */
export interface Indicator {
  readonly name: string;
  readonly value: number | null;
  /** Bars the calculation needs. */
  readonly window: number;
  /** How the number was produced, or why there is none. */
  readonly because: string;
}

export interface InstrumentAnalysis {
  readonly instrumentId: string;
  readonly asOf: CalendarDate;
  readonly barsUsed: number;
  readonly indicators: readonly Indicator[];
  /** Facts about the series itself: duplicates, corrections, an empty series. */
  readonly warnings: readonly string[];
  /** Whatever a leaf adds — days to expiry, moneyness. Empty on the base class. */
  readonly extras: Readonly<Record<string, string>>;
}

const priceOf = (bar: Bar, field: "open" | "high" | "low" | "close"): number =>
  bar[field].toScaledNumber();

const closes = (series: readonly Bar[]): number[] => series.map((bar) => priceOf(bar, "close"));

function insufficient(name: string, window: number, have: number): Indicator {
  return {
    name,
    value: null,
    window,
    because:
      `${name} needs ${window} bars and the series has ${have}. Reported as unavailable rather ` +
      `than computed over a shorter window, which would be a different indicator wearing this ` +
      `one's name.`,
  };
}

/** Simple moving average of the closes. */
export function sma(series: readonly Bar[], window: number): Indicator {
  if (series.length < window) return insufficient(`SMA(${window})`, window, series.length);
  const slice = closes(series).slice(-window);
  return {
    name: `SMA(${window})`,
    value: slice.reduce((sum, close) => sum + close, 0) / window,
    window,
    because: `Mean close of the last ${window} bars.`,
  };
}

function emaSeries(values: readonly number[], window: number): number[] {
  const k = 2 / (window + 1);
  const seed = values.slice(0, window).reduce((sum, value) => sum + value, 0) / window;
  const out: number[] = [seed];
  for (const value of values.slice(window)) {
    out.push(value * k + out[out.length - 1] * (1 - k));
  }
  return out;
}

/**
 * Exponential moving average, seeded with the SMA of the first window.
 *
 * The seed matters and is the usual source of disagreement between two
 * implementations: seeding with the first close instead makes the early series
 * wrong for roughly `window` bars, and by then nobody is looking.
 */
export function ema(series: readonly Bar[], window: number): Indicator {
  if (series.length < window) return insufficient(`EMA(${window})`, window, series.length);
  return {
    name: `EMA(${window})`,
    value: emaSeries(closes(series), window).at(-1) ?? null,
    window,
    because: `Smoothing factor 2/(${window}+1), seeded with the SMA of the first ${window} bars.`,
  };
}

/**
 * Wilder's RSI.
 *
 * Wilder smoothing, not a simple mean of gains and losses — the two give visibly
 * different numbers and every published RSI is Wilder's. A window with no down
 * bars has an unbounded relative strength, reported as 100 by convention rather
 * than by dividing by zero.
 */
export function rsi(series: readonly Bar[], window = 14): Indicator {
  const name = `RSI(${window})`;
  if (series.length < window + 1) return insufficient(name, window + 1, series.length);

  const values = closes(series);
  let gains = 0;
  let losses = 0;
  for (let index = 1; index <= window; index += 1) {
    const change = values[index] - values[index - 1];
    if (change >= 0) gains += change;
    else losses -= change;
  }
  let averageGain = gains / window;
  let averageLoss = losses / window;

  for (let index = window + 1; index < values.length; index += 1) {
    const change = values[index] - values[index - 1];
    averageGain = (averageGain * (window - 1) + Math.max(change, 0)) / window;
    averageLoss = (averageLoss * (window - 1) + Math.max(-change, 0)) / window;
  }

  if (averageLoss === 0) {
    return {
      name,
      value: 100,
      window: window + 1,
      because:
        "No down bars in the window, so the relative strength is unbounded — reported as 100 by convention.",
    };
  }
  const rs = averageGain / averageLoss;
  return {
    name,
    value: 100 - 100 / (1 + rs),
    window: window + 1,
    because: `Wilder-smoothed average gain over average loss across ${window} bars.`,
  };
}

/** MACD line, its signal and the histogram, in scaled price units. */
export function macd(
  series: readonly Bar[],
  fast = 12,
  slow = 26,
  signalWindow = 9,
): readonly Indicator[] {
  const name = `MACD(${fast},${slow},${signalWindow})`;
  if (series.length < slow) return [insufficient(name, slow, series.length)];

  const values = closes(series);
  const fastSeries = emaSeries(values, fast);
  const slowSeries = emaSeries(values, slow);
  // The two series start at different bars; align them on their common tail.
  const overlap = Math.min(fastSeries.length, slowSeries.length);
  const line = Array.from(
    { length: overlap },
    (_unused, index) =>
      fastSeries[fastSeries.length - overlap + index] -
      slowSeries[slowSeries.length - overlap + index],
  );

  const macdLine: Indicator = {
    name,
    value: line.at(-1) ?? null,
    window: slow,
    because: `EMA(${fast}) less EMA(${slow}) of the close.`,
  };

  if (line.length < signalWindow) {
    return [macdLine, insufficient(`${name} signal`, slow + signalWindow, series.length)];
  }
  const signal = emaSeries(line, signalWindow).at(-1) ?? null;
  return [
    macdLine,
    {
      name: `${name} signal`,
      value: signal,
      window: slow + signalWindow,
      because: `EMA(${signalWindow}) of the MACD line.`,
    },
    {
      name: `${name} histogram`,
      value: signal === null || macdLine.value === null ? null : macdLine.value - signal,
      window: slow + signalWindow,
      because: "MACD line less its signal. Positive is a widening upward divergence.",
    },
  ];
}

/** Bollinger bands: the SMA and `sigmas` sample standard deviations either side. */
export function bollinger(
  series: readonly Bar[],
  window = 20,
  sigmas = 2,
): readonly Indicator[] {
  const name = `Bollinger(${window},${sigmas})`;
  if (series.length < window) return [insufficient(name, window, series.length)];
  const slice = closes(series).slice(-window);
  const middle = slice.reduce((sum, value) => sum + value, 0) / window;
  const deviation = stdDev(slice);
  return [
    { name: `${name} middle`, value: middle, window, because: `SMA(${window}) of the close.` },
    {
      name: `${name} upper`,
      value: middle + sigmas * deviation,
      window,
      because: `${sigmas} sample standard deviations above the mean.`,
    },
    {
      name: `${name} lower`,
      value: middle - sigmas * deviation,
      window,
      because: `${sigmas} sample standard deviations below the mean.`,
    },
    {
      name: `${name} bandwidth`,
      value: middle === 0 ? null : (2 * sigmas * deviation) / middle,
      window,
      because:
        "Band width relative to the mean — a scale-free measure of how quiet the series is.",
    },
  ];
}

/**
 * Average true range, Wilder-smoothed.
 *
 * True range, not the high-low spread: a gap between yesterday's close and
 * today's range is real movement, and ignoring it understates the range of
 * exactly the days that matter.
 */
export function atr(series: readonly Bar[], window = 14): Indicator {
  const name = `ATR(${window})`;
  if (series.length < window + 1) return insufficient(name, window + 1, series.length);

  const ranges: number[] = [];
  for (let index = 1; index < series.length; index += 1) {
    const previousClose = priceOf(series[index - 1], "close");
    const high = priceOf(series[index], "high");
    const low = priceOf(series[index], "low");
    ranges.push(
      Math.max(high - low, Math.abs(high - previousClose), Math.abs(low - previousClose)),
    );
  }

  let average = ranges.slice(0, window).reduce((sum, value) => sum + value, 0) / window;
  for (const range of ranges.slice(window)) {
    average = (average * (window - 1) + range) / window;
  }
  return {
    name,
    value: average,
    window: window + 1,
    because: `Wilder-smoothed true range over ${window} bars, gaps included.`,
  };
}

/**
 * Annualised realised volatility of the closes, as a percentage.
 *
 * Reuses `stdDev` and `TRADING_DAYS` from `domain/portfolio.ts` rather than
 * recomputing them: the sample-versus-population choice is made once in this
 * codebase, and a second copy of it is a second answer.
 */
export function realisedVolatility(series: readonly Bar[], window = 21): Indicator {
  const name = `Realised volatility(${window}d, annualised)`;
  if (series.length < window + 1) return insufficient(name, window + 1, series.length);
  const values = closes(series).slice(-(window + 1));
  const returns: number[] = [];
  for (let index = 1; index < values.length; index += 1) {
    if (values[index - 1] === 0) continue;
    returns.push(values[index] / values[index - 1] - 1);
  }
  return {
    name,
    value: stdDev(returns) * Math.sqrt(TRADING_DAYS) * 100,
    window: window + 1,
    because: `Sample standard deviation of ${returns.length} daily returns, times the square root of ${TRADING_DAYS}, as a percentage.`,
  };
}

/* ═══ The analyser ════════════════════════════════════════════════════ */

/**
 * The default technical analysis: the indicators above, over one series.
 *
 * `MarketInstrument.analyse` delegates here, so every instrument gets these for
 * free and a leaf overrides only to *add*. Bars are sorted and superseded ones
 * dropped here rather than by every caller: an analysis run over a corrected bar
 * and its correction would count that day twice.
 */
export function analyseSeries(
  instrumentId: string,
  series: readonly Bar[],
  extras: Readonly<Record<string, string>> = {},
): InstrumentAnalysis {
  const current = series
    .filter((bar) => !bar.supersededBy)
    .slice()
    .sort((a, b) => a.asOf.compareTo(b.asOf));

  const warnings: string[] = [];

  if (current.length === 0) {
    return {
      instrumentId,
      asOf: series[0]?.asOf ?? CalendarDate.parse("1970-01-01"),
      barsUsed: 0,
      indicators: [],
      warnings: ["There are no current bars to analyse. No indicator is reported, and none is zero."],
      extras,
    };
  }

  if (current.length < series.length) {
    warnings.push(
      `${series.length - current.length} superseded bar(s) were excluded; a correction and the ` +
        `bar it corrects would otherwise both count.`,
    );
  }

  for (let index = 1; index < current.length; index += 1) {
    if (current[index].asOf.equals(current[index - 1].asOf)) {
      warnings.push(
        `Two current bars share ${current[index].asOf.toISO()}. Both are counted; one of them is ` +
          `a duplicate ingestion that should be superseded.`,
      );
      break;
    }
  }

  const indicators: Indicator[] = [
    sma(current, 20),
    sma(current, 50),
    sma(current, 200),
    ema(current, 20),
    rsi(current, 14),
    ...macd(current),
    ...bollinger(current),
    atr(current),
    realisedVolatility(current),
  ];

  return {
    instrumentId,
    asOf: current[current.length - 1].asOf,
    barsUsed: current.length,
    indicators,
    warnings,
    extras,
  };
}

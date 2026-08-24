/**
 * Indicators, and the rule that an unanswerable one says so.
 *
 * The values here are hand-computed from short deliberate series rather than
 * captured from a run, which is the only way a golden test means anything: a
 * captured value asserts that the code still does what it did, not that it does
 * the right thing.
 *
 * The behaviour under test that is *not* arithmetic: an indicator whose window is
 * longer than the series returns `null` with a reason. A silently-shortened
 * 200-day average looks exactly like a correct one on a chart, and would be
 * traded on.
 */

import { Currency } from "@/core/money";
import { UnitPrice } from "@/core/numeric";
import { CalendarDate } from "@/core/time";
import { UserId } from "@/core/kernel";
import { AccountId } from "@/domain/accounts";
import {
  ImpossibleBarError,
  atr,
  bollinger,
  ema,
  macd,
  makeBar,
  realisedVolatility,
  rsi,
  sma,
  type Bar,
} from "@/domain/analysis";
import { InstrumentId, MarketInstrument, Option } from "@/domain/instruments";
import { check, checkTrue, done, section, throws } from "./harness";

const price = (value: string) => UnitPrice.of(value, Currency.INR);
const day = (index: number) => CalendarDate.parse("2026-01-01").plusDays(index);

/** A bar with a flat range, when only the close matters. */
function closeBar(instrumentId: string, index: number, close: string): Bar {
  return makeBar({
    instrumentId,
    asOf: day(index),
    granularity: "DAY",
    open: price(close),
    high: price(close),
    low: price(close),
    close: price(close),
    volume: 1_000n,
    currency: Currency.INR,
    providerId: "test",
    ingestedAt: new Date("2026-03-01T00:00:00Z"),
  });
}

const series = (closes: readonly string[], instrumentId = "instrument-test"): Bar[] =>
  closes.map((close, index) => closeBar(instrumentId, index, close));

/* ═══ An impossible bar ═══════════════════════════════════════════════ */

section("a bar with a high below its low is not a bar");

throws(
  "the high cannot be below the low",
  () =>
    makeBar({
      instrumentId: "i",
      asOf: day(0),
      granularity: "DAY",
      open: price("100"),
      high: price("99"),
      low: price("101"),
      close: price("100"),
      volume: null,
      currency: Currency.INR,
      providerId: "test",
      ingestedAt: new Date(),
    }),
  "is not a bar",
);
throws(
  "the close must lie inside the range",
  () =>
    makeBar({
      instrumentId: "i",
      asOf: day(0),
      granularity: "DAY",
      open: price("100"),
      high: price("105"),
      low: price("99"),
      close: price("120"),
      volume: null,
      currency: Currency.INR,
      providerId: "test",
      ingestedAt: new Date(),
    }),
  "must lie between",
);
throws(
  "and volume cannot be negative",
  () =>
    makeBar({
      instrumentId: "i",
      asOf: day(0),
      granularity: "DAY",
      open: price("100"),
      high: price("100"),
      low: price("100"),
      close: price("100"),
      volume: -1n,
      currency: Currency.INR,
      providerId: "test",
      ingestedAt: new Date(),
    }),
  "cannot be negative",
);
check(
  "the error names itself, so a caller can distinguish it",
  new ImpossibleBarError("x").name,
  "ImpossibleBarError",
);

/* ═══ Simple moving average ═══════════════════════════════════════════ */

section("SMA");

// (10 + 11 + 12 + 13 + 14) / 5 = 12, in scaled units (1e8).
const fivePoint = series(["10", "11", "12", "13", "14"]);
check("mean of the last five closes", sma(fivePoint, 5).value, 12 * 1e8);
// The last three of the same series: (12 + 13 + 14) / 3 = 13.
check("and it uses only the last `window` bars", sma(fivePoint, 3).value, 13 * 1e8);

const short = sma(fivePoint, 20);
check("a window longer than the series is unanswerable", short.value, null);
checkTrue("and says how many bars it needed", short.because.includes("needs 20 bars and the series has 5"));

/* ═══ EMA ═════════════════════════════════════════════════════════════ */

section("EMA");

/*
 * Seeded with the SMA of the first window, which is the convention every
 * published EMA uses. Three bars, window 2: seed = (10+20)/2 = 15, k = 2/3, so
 * the third bar gives 30 × 2/3 + 15 × 1/3 = 25.
 */
const emaValue = ema(series(["10", "20", "30"]), 2).value;
check("seeded with the SMA, then smoothed", emaValue, 25 * 1e8);

/* ═══ RSI ═════════════════════════════════════════════════════════════ */

section("RSI");

// Fifteen closes rising by 1 each day: no down bars at all.
const rising = series(Array.from({ length: 15 }, (_unused, index) => String(100 + index)));
check("a series with no down bars is 100 by convention, not a division by zero", rsi(rising).value, 100);
checkTrue("and says why", (rsi(rising).because ?? "").includes("unbounded"));

// Fifteen closes falling by 1: no up bars, so RSI is 0.
const falling = series(Array.from({ length: 15 }, (_unused, index) => String(200 - index)));
check("a series with no up bars is 0", falling.length >= 15 ? rsi(falling).value : null, 0);

/*
 * A hand-computable mixed case: alternate +2 and −1 over fourteen changes.
 * Seven gains of 2 and seven losses of 1 over 14 periods give an average gain of
 * 1 and an average loss of 0.5, so RS = 2 and RSI = 100 − 100/3 = 66.67.
 */
const alternating: string[] = ["100"];
for (let index = 0; index < 14; index += 1) {
  const previous = Number(alternating[alternating.length - 1]);
  alternating.push(String(index % 2 === 0 ? previous + 2 : previous - 1));
}
const mixed = rsi(series(alternating));
checkTrue(
  "a mixed series lands where Wilder's formula puts it",
  mixed.value !== null && Math.abs(mixed.value - 200 / 3) < 0.5,
);

check("fewer than window+1 bars is unanswerable", rsi(series(["1", "2"])).value, null);

/* ═══ MACD, Bollinger, ATR ════════════════════════════════════════════ */

section("MACD");

const forty = series(Array.from({ length: 40 }, (_unused, index) => String(100 + index)));
const macdLines = macd(forty);
checkTrue("a rising series has a positive MACD line", (macdLines[0].value ?? 0) > 0);
check("the line, its signal and the histogram", macdLines.length, 3);
/*
 * On a perfectly linear series the MACD line is constant, so its own EMA equals
 * it and the histogram is exactly zero. That is the correct answer, and asserting
 * it is worth more than asserting a non-zero number: it pins the identity
 * histogram = line − signal.
 */
check(
  "the histogram is the line less its signal",
  macdLines[2].value,
  (macdLines[0].value ?? 0) - (macdLines[1].value ?? 0),
);
const accelerating = macd(
  series(Array.from({ length: 40 }, (_unused, index) => String(100 + index * index))),
);
checkTrue("an accelerating series has a positive histogram", (accelerating[2].value ?? 0) > 0);

/*
 * Thirty bars is enough for the MACD line and not for its nine-bar signal: the
 * slow EMA only starts at bar 26, so there are five points to smooth. The line is
 * reported and the signal is reported *as unavailable* — which is the difference
 * between an honest partial answer and a signal computed from five points.
 */
const thirty = macd(series(Array.from({ length: 30 }, (_unused, index) => String(100 + index))));
check("thirty bars gives a line but no signal", thirty.length, 2);
check("and the signal says it is unavailable", thirty[1].value, null);
check("too short a series reports one unavailable line", macd(series(["1", "2", "3"])).length, 1);

section("Bollinger");

const flat = series(Array.from({ length: 20 }, () => "100"));
const bands = bollinger(flat);
check("a flat series has no width", bands[3].value, 0);
check("and its middle band is the price", bands[0].value, 100 * 1e8);
check("upper and lower collapse onto it", bands[1].value, bands[2].value);

section("ATR");

/*
 * True range, not the high-low spread. Two bars: the first closes at 100, the
 * second ranges 101–103. Its high-low is 2, but the gap from the previous close
 * makes the true range 3 — and ignoring the gap understates exactly the days that
 * matter.
 */
const gapped: Bar[] = [
  closeBar("i", 0, "100"),
  makeBar({
    instrumentId: "i",
    asOf: day(1),
    granularity: "DAY",
    open: price("101"),
    high: price("103"),
    low: price("101"),
    close: price("102"),
    volume: null,
    currency: Currency.INR,
    providerId: "test",
    ingestedAt: new Date("2026-03-01T00:00:00Z"),
  }),
];
check("a gap counts as movement", atr(gapped, 1).value, 3 * 1e8);

section("realised volatility");

check("a flat series has zero volatility", realisedVolatility(flat, 19).value, 0);
check("and too short a series has none at all", realisedVolatility(series(["1", "2"])).value, null);

/* ═══ analyse() through an instrument ═════════════════════════════════ */

section("analyse() is reached through the instrument, not around it");

const equity = MarketInstrument.of("LISTED_EQUITY", {
  id: InstrumentId.from("instrument-infy"),
  userId: UserId.from("user-analysis"),
  symbol: "INFY",
  name: "Infosys",
  currency: Currency.INR,
  assetAccountId: AccountId.create(),
});

const oneYear = series(
  Array.from({ length: 220 }, (_unused, index) => String(1500 + (index % 40))),
  equity.id.value,
);
const analysis = equity.analyse(oneYear);
check("the analysis is stamped with the instrument", analysis.instrumentId, equity.id.value);
check("and the last bar's date", analysis.asOf.toISO(), day(219).toISO());
check("220 bars were used", analysis.barsUsed, 220);
checkTrue(
  "the 200-day average is answerable over 220 bars",
  analysis.indicators.find((indicator) => indicator.name === "SMA(200)")?.value !== null,
);
check("the base class adds no extras", Object.keys(analysis.extras).length, 0);

const thin = equity.analyse(series(["100", "101"], equity.id.value));
checkTrue(
  "over two bars every long window is null, and none is zero",
  thin.indicators.filter((indicator) => indicator.window > 3).every((indicator) => indicator.value === null),
);

section("an empty series reports nothing rather than zero");

const empty = equity.analyse([]);
check("no indicators", empty.indicators.length, 0);
checkTrue("and a warning that says so", empty.warnings[0].includes("no current bars"));

section("a superseded bar is excluded, so a correction is not double-counted");

const corrected: Bar[] = [
  { ...closeBar(equity.id.value, 0, "100"), supersededBy: "bar-2" },
  closeBar(equity.id.value, 0, "110"),
  closeBar(equity.id.value, 1, "120"),
];
const withCorrection = equity.analyse(corrected);
check("only current bars count", withCorrection.barsUsed, 2);
checkTrue(
  "and the exclusion is reported",
  withCorrection.warnings.some((warning) => warning.includes("superseded")),
);

section("an option overrides analyse to add what only it knows");

const call = new Option({
  id: InstrumentId.from("instrument-nifty-ce"),
  userId: UserId.from("user-analysis"),
  symbol: "NIFTY26SEP24000CE",
  name: "Nifty 24000 CE",
  currency: Currency.INR,
  assetAccountId: AccountId.create(),
  metadata: {
    underlyingSymbol: "NIFTY",
    right: "CALL",
    strike: "24000",
    expiry: "2026-09-24",
    lotSize: 75,
  },
});

/* The underlying's bars, not the option's premium: a premium series says nothing
 * about whether the option is in the money. */
const underlying = [closeBar("instrument-nifty", 0, "24500")];
const optionAnalysis = call.analyse(underlying);
check("the strike is reported", optionAnalysis.extras.strike, "24000.00");
check("the right", optionAnalysis.extras.right, "CALL");
check("moneyness at the last close", optionAnalysis.extras.moneyness, "ITM");
check("and the intrinsic value", optionAnalysis.extras.intrinsicValue, "500.00");
check("the underlying is named", optionAnalysis.extras.underlying, "NIFTY");
checkTrue("days to expiry is a number", Number.isFinite(Number(optionAnalysis.extras.daysToExpiry)));

const afterExpiry = call.analyse([closeBar("instrument-nifty", 400, "24500")]);
checkTrue(
  "indicators past an expiry carry a warning",
  afterExpiry.warnings.some((warning) => warning.includes("expired on 2026-09-24")),
);

done();

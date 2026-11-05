import { Currency } from "@/core/money";
import { UnitPrice } from "@/core/numeric";
import { CalendarDate } from "@/core/time";
import { Count, IndexPoints, PriceLevel, Ratio } from "@/core/units";
import { atr, bollinger, ema, macd, makeBar, realisedVolatility, rsi, sma, type Indicator } from "@/domain/analysis";
import { check, checkTrue, done } from "./harness";

const bars = (values: readonly string[]) => values.map((value, index) => {
  const price = UnitPrice.of(value, Currency.INR);
  return makeBar({ instrumentId: "units", asOf: CalendarDate.parse("2026-01-01").plusDays(index), granularity: "DAY", open: price, high: price, low: price, close: price, volume: null, currency: Currency.INR, providerId: "test", ingestedAt: new Date("2026-04-01T00:00:00Z") });
});
const simple = bars(["100", "101", "99.99"]);
const volatility: Indicator<Ratio> = realisedVolatility(simple, Count(2));
check("volatility carries runtime fraction metadata", volatility.unit, "RATIO");
check("missing volatility retains its unit", realisedVolatility(simple, Count(21)).unit, "RATIO");
check("RSI carries runtime index metadata", rsi(simple, Count(2)).unit, "INDEX_POINTS");
check("moving averages carry runtime price metadata", sma(simple, Count(2)).unit, "PRICE_LEVEL");
check("Bollinger bandwidth carries fraction metadata", bollinger(simple, Count(2)).at(-1)?.unit, "RATIO");
check("realised volatility is an annual return fraction, not percent points", volatility.value?.toFixed(6), "0.224499");
checkTrue("volatility explanation states its fraction scale", volatility.because.includes("return fraction"));
check("insufficient volatility remains null", realisedVolatility(simple, Count(21)).value, null);
const declining = bars(Array.from({ length: 80 }, (_, index) => String(200 - index)));
checkTrue("MACD price differences retain negative values", macd(declining)[0].value! < 0);
check("declining RSI retains the zero index endpoint", rsi(declining).value, IndexPoints(0));
check("rising RSI retains the hundred index endpoint", rsi(bars(["1", "2", "3"]), Count(2)).value, IndexPoints(100));
check("SMA retains the established scaled price level", sma(simple, Count(2)).value, PriceLevel(100.495 * 1e8));
checkTrue("EMA and ATR remain finite price levels", Number.isFinite(ema(simple, Count(2)).value) && Number.isFinite(atr(simple, Count(2)).value));
checkTrue("Bollinger bandwidth stays a fraction", bollinger(simple, Count(2)).at(-1)!.value! < 1);
if (false) {
  const price: Indicator<PriceLevel> = sma(simple, Count(2));
  const index: Indicator<IndexPoints> = rsi(simple, Count(2));
  const fraction: Indicator<Ratio> = realisedVolatility(simple, Count(2));
  // @ts-expect-error Raw values cannot cross the indicator boundary.
  const raw: Indicator = { name: "Raw", value: 1, window: Count(1), because: "invalid" };
  // @ts-expect-error An RSI index is not a price level.
  const wrongPrice: Indicator<PriceLevel> = index;
  // @ts-expect-error A price level is not a return ratio.
  const wrongRatio: Indicator<Ratio> = price;
  void [fraction, raw, wrongPrice, wrongRatio];
}
done();

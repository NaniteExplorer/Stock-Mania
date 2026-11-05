import { Money } from "@/core/money";
import { Count, Days, IndexPoints, Millis, Months, Ordinal, Polarity, PriceLevel, Ratio, Sign, SortKey, Years } from "@/core/units";
import { check, done, section, throws } from "./harness";

section("a brand is the number it wraps");
check("days are still arithmetic", Days(30) + Days(1), 31);
check("a count of zero is a count", Count(0), 0);
check("an ordinal", Ordinal(3), 3);
check("a return is a fraction, not a percent", Ratio(0.05), 0.05);
check("a negative ratio is a ratio", Ratio(-0.12), -0.12);
check("years may be fractional", Years(2.5), 2.5);
check("milliseconds", Millis(86_400_000), 86_400_000);
check("a price level is fractional", PriceLevel(1523.37), 1523.37);
check("RSI is index points", IndexPoints(70), 70);

section("the constructor is where the invariant is checked");
throws("half a day is not a span of days", () => Days(1.5), "whole number");
throws("a negative count", () => Count(-1), "whole number");
check("a runway may be a fractional number of months", Months(4.5), 4.5);
throws("a negative span of months", () => Months(-1), "non-negative");
throws("NaN is a division that should have been guarded", () => Ratio(Number.NaN), "finite");
throws("infinity likewise", () => Ratio(Number.POSITIVE_INFINITY), "finite");
throws("negative years", () => Years(-1), "non-negative");

section("units do not mix — checked by the compiler, asserted here");
/*
 * Each line below is a type error, and `@ts-expect-error` makes the build fail
 * if it ever stops being one. That is the property this file exists for: the
 * runtime checks above are ordinary; this is what a raw `number` could not do.
 */
const graceDays = (days: Days): Days => days;
const termMonths = (months: Months): Months => months;
const weight = (ratio: Ratio): Ratio => ratio;
const sign = (value: Sign): Sign => value;

// @ts-expect-error months are not days
graceDays(Months(3));
// @ts-expect-error a bare number has no unit
termMonths(3);
// @ts-expect-error a count is not a ratio
weight(Count(4));
// @ts-expect-error a sign is one or minus one
sign(2);
const band = (level: PriceLevel): PriceLevel => level;
// @ts-expect-error RSI 70 is not a price
band(IndexPoints(70));
// @ts-expect-error nor is a return
band(Ratio(0.05));
// @ts-expect-error a unit is not money
const notMoney: Money = Days(30);
void notMoney;

section("a sort key may be negative, an ordinal may not");
check("an owner lifts an account above the defaults", SortKey(-5), -5);
throws("but not by half a place", () => SortKey(1.5), "whole number");
throws("an ordinal is never negative", () => Ordinal(-1), "whole number");
const place = (key: SortKey): SortKey => key;
// @ts-expect-error an ordinal is not a sort key
place(Ordinal(1));
const side = (value: Polarity): Polarity => value;
check("a polarity may be zero", side(0), 0);
// @ts-expect-error but not two
side(2);

check("and the legal calls still compile and run", [graceDays(Days(7)), termMonths(Months(12)), sign(-1)].join(" "), "7 12 -1");

done();

import { CalendarDate, DateRange, MarketCalendar, CalendarCoverageError } from "@/core/time";
import { check, throws, section, done } from "./harness";

/**
 * The market calendar.
 *
 * The point of these tests is that every failure mode here is a *plausible* wrong
 * answer — a day-change comparing against a holiday, a volatility figure divided
 * by calendar days — so none of them would be caught by inspection.
 */

const nse = MarketCalendar.nse();
const d = (iso: string) => CalendarDate.parse(iso);

section("the day-change case: Monday compares against Friday");

// 2026-08-24 is a Monday. Its previous trading day must be Friday the 21st, not
// Sunday the 23rd. This is the whole reason the class exists.
check(
  "previous trading day of Mon 2026-08-24",
  nse.previousTradingDay(d("2026-08-24")).toISO(),
  "2026-08-21",
);
check("Sat 2026-08-22 is not a trading day", nse.isTradingDay(d("2026-08-22")), false);
check("Sun 2026-08-23 is not a trading day", nse.isTradingDay(d("2026-08-23")), false);
check("Fri 2026-08-21 is a trading day", nse.isTradingDay(d("2026-08-21")), true);

section("a published holiday is not a trading day");

// Independence Day 2026 falls on a Saturday, so the interesting case is a
// weekday holiday: 2026-10-02 (Gandhi Jayanti) is a Friday.
check("2026-10-02 (Gandhi Jayanti, a Friday) is closed", nse.isTradingDay(d("2026-10-02")), false);
check(
  "previous trading day after that holiday weekend",
  nse.previousTradingDay(d("2026-10-05")).toISO(),
  "2026-10-01",
);
check("2026-12-25 (Christmas, a Friday) is closed", nse.isTradingDay(d("2026-12-25")), false);

section("a holiday adjacent to a weekend skips the whole run");

// 2026-03-31 and 2026-04-01 are consecutive weekday holidays (Tue/Wed).
check("2026-03-31 is closed", nse.isTradingDay(d("2026-03-31")), false);
check("2026-04-01 is closed", nse.isTradingDay(d("2026-04-01")), false);
check(
  "2026-04-02 looks back past both",
  nse.previousTradingDay(d("2026-04-02")).toISO(),
  "2026-03-30",
);

section("trading-day counts are not calendar-day counts");

// Diwali week 2026: 20 Oct is a holiday (Tuesday).
check("2026-10-02 is a Friday holiday", nse.isTradingDay(d("2026-10-02")), false);
const octoberWeek = nse.tradingDaysBetween(d("2026-10-16"), d("2026-10-23"));
check("trading days in (16 Oct, 23 Oct] 2026", octoberWeek, 4);
check(
  "the same span in calendar days",
  d("2026-10-16").daysUntil(d("2026-10-23")),
  7,
);

// Half-open on purpose: a return series has one observation per transition.
check("range is half-open — same date is zero", nse.tradingDaysBetween(d("2026-08-21"), d("2026-08-21")), 0);
check("a reversed range is zero, not negative", nse.tradingDaysBetween(d("2026-08-24"), d("2026-08-21")), 0);

section("tradingDays over a range");

const week = nse.tradingDays(DateRange.of(d("2026-08-17"), d("2026-08-23")));
check("Mon-Sun week yields five trading days", week.length, 5);
check("first is the Monday", week[0].toISO(), "2026-08-17");
check("last is the Friday", week[week.length - 1].toISO(), "2026-08-21");

section("nextTradingDay");

check("next after Fri 2026-08-21", nse.nextTradingDay(d("2026-08-21")).toISO(), "2026-08-24");
check("next after the 2026-10-02 holiday", nse.nextTradingDay(d("2026-10-01")).toISO(), "2026-10-05");

section("coverage is a hard boundary, not a silent guess");

// Past the transcribed years the only honest answers are "throw" or "flag the
// guess". Returning a weekend-adjusted date would be plausible and wrong.
check("2027-12-31 is within coverage", nse.isWithinCoverage(d("2027-12-31")), true);
check("2028-01-03 is outside coverage", nse.isWithinCoverage(d("2028-01-03")), false);
throws(
  "a date past coverage throws rather than guessing",
  () => nse.previousTradingDay(d("2028-06-15")),
  "No market-calendar data",
);
check(
  "the error is the typed one",
  (() => {
    try {
      nse.isTradingDay(d("2030-01-01"));
      return "no throw";
    } catch (e) {
      return e instanceof CalendarCoverageError ? "CalendarCoverageError" : "wrong type";
    }
  })(),
  "CalendarCoverageError",
);

section("the approximate path never throws, and admits it is approximate");

const inside = nse.previousTradingDayApprox(d("2026-08-24"));
check("inside coverage it is exact", inside.approximate, false);
check("and correct", inside.date.toISO(), "2026-08-21");

const outside = nse.previousTradingDayApprox(d("2030-01-07"));
check("outside coverage it still answers", outside.date.toISO(), "2030-01-04");
check("and flags the guess", outside.approximate, true);

section("coverage extends far enough ahead to notice going stale");

// This is the maintenance alarm: it goes red BEFORE the data does, so the table
// is extended during a normal build rather than after a wrong number ships.
const today = CalendarDate.fromUtcInstant(new Date());
const oneYearOut = today.plusYears(1);
check(
  `coverage reaches at least ${oneYearOut.toISO()}`,
  nse.coverageThrough.isOnOrAfter(oneYearOut),
  true,
);

section("BSE shares the trading calendar");

// Only clearing holidays differ, and settlement calendars are not modelled.
check("BSE and NSE agree on 2026-10-02", MarketCalendar.bse().isTradingDay(d("2026-10-02")), false);
check("the instance is cached", MarketCalendar.nse() === nse, true);

done();

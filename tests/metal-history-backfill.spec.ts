/**
 * `MetalHistoryProvider` — the estimated gram history behind the metal charts.
 *
 * The thing worth testing here is not "does it return numbers". It is that the
 * numbers are anchored to a *published* IBJA rate, that they are labelled as
 * estimates rather than passed off as published rates, and that when the anchor
 * is missing the provider returns nothing instead of a plausible-looking line.
 * A silently wrong gram rate is worse than a blank chart, because the chart is
 * what the owner checks his holding against.
 */

import { Currency } from "@/core/money";
import { CalendarDate, DateRange } from "@/core/time";
import type { InstrumentRef } from "@/domain/pricing";
import { MetalHistoryProvider, parseIbjaRateSheet } from "@/infra/providers";
import { FixtureHttpClient, VirtualRuntime, ibjaBody, yahooBody } from "./doubles";
import { check, checkTrue, done, section } from "./harness";

section("metal history: IBJA-calibrated ETF backfill");

const goldRef = (symbol: string): InstrumentRef => ({
  instrumentId: "instrument-gold",
  symbol,
  assetClass: "COMMODITY",
  currency: Currency.INR,
  identifierType: "METAL",
});

const askFrom = (
  http: FixtureHttpClient,
  ref: InstrumentRef,
  from: string,
  to: string,
) =>
  new MetalHistoryProvider(
    new VirtualRuntime(http, { startMillis: Date.parse("2026-09-20T05:00:00Z") }),
  ).fetchQuotes({
    instruments: [ref],
    range: DateRange.of(CalendarDate.parse(from), CalendarDate.parse(to)),
    quoteType: "CLOSE",
  });

/*
 * The anchor: IBJA published ₹15,372.70/gram for Gold 999 on 2026-09-18, and
 * GOLDBEES closed at 126.48 the same day. Every other day's gram rate is that
 * day's ETF close times 15372.70 / 126.48.
 */
const ibja = ibjaBody([{ date: "2026-09-18", metal: "GOLD", purity: "999", rate: 15372.7 }]);
const etf = yahooBody([
  { date: "2026-02-27", close: 100.0 },
  { date: "2026-03-31", close: 110.25 },
  // A market holiday: Yahoo sends the row with a null close, and it must not
  // become a zero-rupee gram rate.
  { date: "2026-04-01", close: null },
  { date: "2026-09-18", close: 126.48 },
]);

{
  const http = new FixtureHttpClient([
    { match: "ibjarates.com", body: ibja },
    { match: "GOLDBEES", body: etf },
  ]);
  const result = await askFrom(http, goldRef("GOLD999"), "2026-02-01", "2026-09-20");

  checkTrue("a calibrated history comes back", result.ok);
  if (result.ok) {
    const byDate = new Map(result.value.map((quote) => [quote.asOf.toISO(), quote]));

    /*
     * The anchor day is IBJA's own published day, so it is left to IBJA. Emitting
     * it would put a real rate and an estimate on the same date, and the quote
     * repository orders by ingest time, not by source quality — the later write
     * would win regardless of which was the better number.
     */
    checkTrue("a day IBJA published is left to IBJA, not estimated over",
      !byDate.has("2026-09-18"));
    check("an older month is the ETF close scaled by the same factor",
      byDate.get("2026-02-27")?.price.toString(), "12154.25 INR");
    check("...and so is the month after it",
      byDate.get("2026-03-31")?.price.toString(), "13400.06 INR");

    checkTrue("a null close is dropped rather than priced at zero",
      !byDate.has("2026-04-01"));
    check("every point is marked an estimate, never a published rate",
      [...new Set(result.value.map((quote) => quote.sourceType))].join(","), "DERIVED");
    check("attribution names the deriving provider",
      byDate.get("2026-02-27")?.providerId, "metal-history");
  }

  check("the ETF series is fetched with an explicit period pair, never range=max",
    http.requests.some((url) => url.includes("period1=") && url.includes("period2=")) &&
      !http.requests.some((url) => url.includes("range=max")),
    true);
}

{
  // Requirement 5 of the conformance suite, restated for this provider: nothing
  // outside the asked-for window, and no duplicate (instrument, as_of).
  const http = new FixtureHttpClient([
    { match: "ibjarates.com", body: ibja },
    { match: "GOLDBEES", body: etf },
  ]);
  const result = await askFrom(http, goldRef("GOLD999"), "2026-03-01", "2026-03-31");

  checkTrue("a narrow range still resolves", result.ok);
  if (result.ok) {
    check("only the requested window is returned", result.value.length, 1);
    check("...and it is the right day", result.value[0].asOf.toISO(), "2026-03-31");
  }
}

{
  /*
   * The honesty case. IBJA's newest published day is not in the ETF series at
   * all, so there is no day on which both are known and therefore no defensible
   * factor. The provider must fail rather than reach for a nearby close.
   */
  const http = new FixtureHttpClient([
    { match: "ibjarates.com", body: ibja },
    { match: "GOLDBEES", body: yahooBody([{ date: "2026-02-27", close: 100.0 }]) },
  ]);
  const result = await askFrom(http, goldRef("GOLD999"), "2026-02-01", "2026-09-20");

  check("with no overlapping day there is no estimate at all", result.ok, false);
  if (!result.ok) {
    check("...and it is a typed error, not a throw", result.error.kind, "UNKNOWN_SYMBOL");
  }
}

{
  /*
   * A bare "GOLD" code must anchor on the 999 benchmark. Anchoring it on 916 —
   * which is the same metal on the same day, and so looks entirely plausible —
   * would misprice the whole back-history by the purity ratio and never error.
   */
  const http = new FixtureHttpClient([
    {
      match: "ibjarates.com",
      body: ibjaBody([
        { date: "2026-09-18", metal: "GOLD", purity: "916", rate: 14075.1 },
        { date: "2026-09-18", metal: "GOLD", purity: "999", rate: 15372.7 },
      ]),
    },
    { match: "GOLDBEES", body: etf },
  ]);
  const result = await askFrom(http, goldRef("GOLD"), "2026-02-01", "2026-09-20");

  checkTrue("a bare metal code resolves", result.ok);
  if (result.ok) {
    const first = result.value.find((quote) => quote.asOf.toISO() === "2026-02-27");
    check("it is calibrated on 999, not on whichever purity parsed first",
      first?.price.toString(), "12154.25 INR");
  }
}

{
  /*
   * Platinum has a published IBJA rate and no ETF proxy. The trap is that it is
   * "not silver", so a defaulting branch hands it a real platinum anchor scaled
   * onto GOLDBEES' movement — a complete, plausible daily series for a metal
   * nothing here can actually price. No proxy must mean no history.
   */
  const http = new FixtureHttpClient([
    {
      match: "ibjarates.com",
      body: ibjaBody([
        { date: "2026-09-18", metal: "PLATINUM", purity: "999", rate: 3120.5 },
        { date: "2026-09-18", metal: "GOLD", purity: "999", rate: 15372.7 },
      ]),
    },
    { match: "GOLDBEES", body: etf },
  ]);
  const result = await askFrom(
    http,
    { ...goldRef("PLATINUM999"), instrumentId: "instrument-platinum" },
    "2026-02-01",
    "2026-09-20",
  );

  check("a metal with no proxy gets no history at all", result.ok, false);
  if (!result.ok) {
    check("...and says so as a typed error", result.error.kind, "UNKNOWN_SYMBOL");
  }
  checkTrue("...without ever reaching the gold ETF on its behalf",
    !http.requests.some((url) => url.includes("GOLDBEES")));
}

section("IBJA 30-day rate sheet");

{
  /*
   * Real lines from the published sheet, including the three row shapes that are
   * not prices at all. `SAT`, `SUN` and `Market Holiday` sit exactly where twelve
   * numbers otherwise sit, and a parser that coerced them would write ₹0.00 gold
   * into the ledger — silently, since zero is a number.
   */
  const rows = parseIbjaRateSheet([
    "10 Gms 10 Gms 10 Gms 10 Gms 10 Gms 10 Gms 10 Gms 10 Gms 10 Gms 10 Gms 1 Kg 1 Kg",
    "18-Sep-26 153658 153727 153043 153111 140751 140814 115244 115295 89890 89930 236116 236908",
    "17-Sep-26 151233 151849 150627 151241 138529 139094 113425 113887 88471 88832 228475 229642",
    "14-Sep-26 Market",
    "Holiday",
    "13-Sep-26 SUN",
    "12-Sep-26 SAT",
    "06-Sep-26 SUN SUN SUN SUN SUN SUN SUN SUN SUN SUN SUN SUN",
  ]);

  const on = (code: string, iso: string) =>
    rows.find((row) => row.code === code && row.on.toISO() === iso)?.perGram;

  check("gold 999 is the PM close, per gram", on("GOLD999", "2026-09-18"), 15372.7);
  check("...which is the rate the app displays today", String(on("GOLD999", "2026-09-18")), "15372.7");
  check("gold 916 is carried too, at its own purity", on("GOLD916", "2026-09-18"), 14081.4);
  check("silver divides by a kilo, not by ten", on("SILVER999", "2026-09-18"), 236.908);
  check("a second day parses", on("GOLD999", "2026-09-17"), 15184.9);

  checkTrue("the AM column is never emitted as a close",
    rows.every((row) => row.perGram !== 15365.8));
  check("weekends and holidays produce no rows at all",
    rows.filter((row) => ["2026-09-12", "2026-09-13", "2026-09-14", "2026-09-06"]
      .includes(row.on.toISO())).length, 0);
  check("only the two priced days survive", new Set(rows.map((row) => row.on.toISO())).size, 2);
}

done();

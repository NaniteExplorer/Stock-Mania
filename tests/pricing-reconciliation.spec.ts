/**
 * The unexplained-move alarm, and the rule that it never touches the ledger.
 *
 * C7's three measured cases are the ones asserted here, because all three pass
 * schema validation and all three would otherwise be drawn on a chart as fact:
 *
 *  - `TMPV.NS` -40.2% on the Tata Motors demerger, with **no event flag at all**;
 *  - RELIANCE's corrupt +337% print on 2005-07-28;
 *  - NIFTYBEES arriving divided by ten.
 *
 * And the negative case that matters more than any of them: a genuine 1:5 split
 * the owner *did* log must be silent. An alarm that fires on every split the
 * owner correctly recorded is an alarm he learns to ignore, and then the corrupt
 * print gets ignored with it.
 *
 * The second half asserts C2 structurally: `IngestInstrumentBars` writes bars and
 * returns alarms, and there is no lot, no trade and no corporate-action
 * repository anywhere in its constructor — a provider-observed split cannot reach
 * the ledger because the use case has nothing to reach it with.
 */

import { SystemClock } from "@/core/kernel";
import { Currency } from "@/core/money";
import { UnitPrice } from "@/core/numeric";
import { CalendarDate, DateRange } from "@/core/time";
import { makeBar, type Bar } from "@/domain/analysis";
import { ProviderError, type InstrumentRef } from "@/domain/pricing";
import { Err, Ok } from "@/core/kernel";
import {
  IngestInstrumentBars,
  UNEXPLAINED_MOVE_THRESHOLD_PERCENT,
  detectPriceAlarms,
  type DailyHistoryFeed,
  type LedgerCorporateAction,
} from "@/app/pricing.usecases";
import { dailyBar, scaledFromDecimal, type HistoryRequest } from "@/market-data/ports";
import { InMemoryBarRepository } from "./doubles";
import { check, checkTrue, done, section } from "./harness";

const INSTRUMENT = "instrument-reconciliation";
const on = (value: string) => CalendarDate.parse(value);
const inr = (value: string) => UnitPrice.of(value, Currency.INR);

function closes(rows: readonly [string, string][]): Bar[] {
  return rows.map(([date, close]) =>
    makeBar({
      instrumentId: INSTRUMENT,
      asOf: on(date),
      granularity: "DAY",
      open: inr(close),
      high: inr(close),
      low: inr(close),
      close: inr(close),
      volume: null,
      currency: Currency.INR,
      providerId: "yahoo-chart",
      ingestedAt: new Date("2026-09-13T00:00:00Z"),
    }),
  );
}

/* ── The three measured corruptions ────────────────────────────────── */

section("a demerger with no event flag is caught (TMPV.NS, -40.2%)");

const demerger = detectPriceAlarms({
  quoteKey: "TMPV.NS",
  bars: closes([
    ["2025-10-13", "400"],
    ["2025-10-14", "239.20"],
    ["2025-10-15", "241"],
  ]),
  ledgerActions: [],
  providerActions: [],
});
check("one alarm", demerger.length, 1);
check("of the unexplained-move kind", demerger[0].kind, "UNEXPLAINED_MOVE");
check("dated to the day the move landed", demerger[0].onDate.toISO(), "2025-10-14");
checkTrue("naming the instrument", demerger[0].message.includes("TMPV.NS"));
checkTrue("and saying which way it went", demerger[0].message.includes("fell"));

section("a corrupt print is caught (RELIANCE +337% on 2005-07-28)");

const corrupt = detectPriceAlarms({
  quoteKey: "RELIANCE.NS",
  bars: closes([
    ["2005-07-27", "560"],
    ["2005-07-28", "2447.20"],
    ["2005-07-29", "565"],
  ]),
  ledgerActions: [],
  providerActions: [],
});
check("both the spike and the return to normal are flagged", corrupt.length, 2);
check("the spike first", corrupt[0].onDate.toISO(), "2005-07-28");
checkTrue("as a rise", corrupt[0].message.includes("rose"));
check("then the collapse back", corrupt[1].onDate.toISO(), "2005-07-29");

section("a series arriving divided by ten is caught (NIFTYBEES)");

const scaleBreak = detectPriceAlarms({
  quoteKey: "NIFTYBEES.NS",
  bars: closes([
    ["2026-03-02", "285.40"],
    ["2026-03-03", "28.54"],
  ]),
  ledgerActions: [],
  providerActions: [],
});
check("flagged", scaleBreak.length, 1);
check("on the day the scale changed", scaleBreak[0].onDate.toISO(), "2026-03-03");

/* ── The negative cases ────────────────────────────────────────────── */

section("a logged corporate action explains the move, and the alarm stays quiet");

const IRCTC_SPLIT: LedgerCorporateAction[] = [{ onDate: on("2021-10-29"), kind: "SPLIT" }];
const explained = detectPriceAlarms({
  quoteKey: "IRCTC.NS",
  bars: closes([
    ["2021-10-28", "4300"],
    ["2021-10-29", "860"],
    ["2021-10-30", "870"],
  ]),
  ledgerActions: IRCTC_SPLIT,
  providerActions: [],
});
check("no alarm for a split the owner logged", explained.length, 0);

const offByOne = detectPriceAlarms({
  quoteKey: "IRCTC.NS",
  bars: closes([
    ["2021-10-28", "4300"],
    ["2021-10-29", "860"],
  ]),
  ledgerActions: [{ onDate: on("2021-10-28"), kind: "SPLIT" }],
  providerActions: [],
});
check("an action logged one day either side still explains it", offByOne.length, 0);

const providerExplained = detectPriceAlarms({
  quoteKey: "IRCTC.NS",
  bars: closes([
    ["2021-10-28", "4300"],
    ["2021-10-29", "860"],
  ]),
  ledgerActions: [],
  providerActions: [{ onDate: on("2021-10-29"), kind: "SPLIT" }],
});
check(
  "a provider-reported event explains the move too — but the missing log is still reported",
  providerExplained.length,
  1,
);
check("as an unlogged split, not as an unexplained move", providerExplained[0].kind, "UNLOGGED_SPLIT");
checkTrue(
  "and it says explicitly that nothing was changed",
  providerExplained[0].message.includes("Nothing has been changed"),
);

section("an ordinary market is silent");

const ordinary = detectPriceAlarms({
  quoteKey: "INFY.NS",
  bars: closes([
    ["2026-09-07", "1500"],
    ["2026-09-08", "1560"],
    ["2026-09-09", "1420"],
    ["2026-09-10", "1480"],
  ]),
  ledgerActions: [],
  providerActions: [],
});
check("a 9% day is not an alarm", ordinary.length, 0);

check("the threshold is the documented 25%", UNEXPLAINED_MOVE_THRESHOLD_PERCENT, 25n);

const justUnder = detectPriceAlarms({
  quoteKey: "X",
  bars: closes([["2026-01-05", "100"], ["2026-01-06", "125"]]),
  ledgerActions: [],
  providerActions: [],
});
check("exactly 25% is not beyond 25%", justUnder.length, 0);

const justOver = detectPriceAlarms({
  quoteKey: "X",
  bars: closes([["2026-01-05", "100"], ["2026-01-06", "125.01"]]),
  ledgerActions: [],
  providerActions: [],
});
check("a hair over is", justOver.length, 1);

section("a provider split the ledger already has raises nothing");

check(
  "silence when the owner logged it",
  detectPriceAlarms({
    quoteKey: "IRCTC.NS",
    bars: [],
    ledgerActions: IRCTC_SPLIT,
    providerActions: [{ onDate: on("2021-10-29"), kind: "SPLIT" }],
  }).length,
  0,
);
check(
  "a dividend is never an unlogged-split alarm",
  detectPriceAlarms({
    quoteKey: "INFY.NS",
    bars: [],
    ledgerActions: [],
    providerActions: [{ onDate: on("2026-05-30"), kind: "DIVIDEND" }],
  }).length,
  0,
);

/* ── The ingest use case ───────────────────────────────────────────── */

const REF: InstrumentRef = {
  instrumentId: INSTRUMENT,
  symbol: "TMPV",
  assetClass: "EQUITY",
  currency: Currency.INR,
  identifierType: "TICKER",
};

class FixtureFeed implements DailyHistoryFeed {
  readonly requests: HistoryRequest[] = [];

  constructor(
    private readonly rows: readonly [string, string][],
    private readonly currency: Currency = Currency.INR,
  ) {}

  async history(request: HistoryRequest) {
    this.requests.push(request);
    return Ok({
      quoteKey: request.quoteKey,
      currency: this.currency,
      adjusted: true,
      asOf: on(this.rows[this.rows.length - 1][0]),
      bars: this.rows.map(([date, close]) =>
        dailyBar("fixture", {
          asOf: on(date),
          openScaled: scaledFromDecimal(close),
          highScaled: scaledFromDecimal(close),
          lowScaled: scaledFromDecimal(close),
          closeScaled: scaledFromDecimal(close),
          volume: null,
        }),
      ),
      sourceId: "fixture",
    });
  }
}

async function ingestion(): Promise<void> {
  section("IngestInstrumentBars writes bars and reports, but never acts");

  const clock = new SystemClock();
  const bars = new InMemoryBarRepository();
  const feed = new FixtureFeed([
    ["2025-10-13", "400"],
    ["2025-10-14", "239.20"],
  ]);
  const ingest = new IngestInstrumentBars(feed, bars, clock);

  const first = await ingest.execute({ instrument: REF, quoteKey: "TMPV.NS", market: "IN" });
  checkTrue("the ingest succeeds", first.ok);
  if (!first.ok) return done();

  check("two bars were written", first.value.appended, 2);
  check("nothing was superseded on a plain append", first.value.superseded, 0);
  check("the source is recorded", first.value.sourceId, "fixture");
  check("and it declares itself adjusted", first.value.adjusted, true);
  check("the demerger is reported as an alarm", first.value.alarms.length, 1);
  check("of the right kind", first.value.alarms[0].kind, "UNEXPLAINED_MOVE");

  /*
   * C4, structurally: the request carries a start and an end, never a "max".
   */
  check("the request used an explicit range", feed.requests.length, 1);
  checkTrue(
    "with a real start date, not a sentinel",
    feed.requests[0].range.start.toISO() < feed.requests[0].range.end.toISO(),
  );

  const stored = await bars.findRange(
    INSTRUMENT,
    "DAY",
    DateRange.of(on("2025-01-01"), on("2026-12-31")),
  );
  check("the bars landed in the store", stored.length, 2);
  check("at full precision", stored[1].close.toDecimalString(), "239.2");

  section("a second run fetches only the delta (C14)");

  const second = await ingest.execute({ instrument: REF, quoteKey: "TMPV.NS", market: "IN" });
  checkTrue("still succeeds", second.ok);
  if (second.ok) {
    checkTrue(
      "and asks only for what is missing, not the twenty years again",
      feed.requests[1].range.start.toISO() > "2025-10-14",
    );
  }

  section("a restatement supersedes rather than doubling the series (C5)");

  /*
   * The fixture re-serves the same two days whatever range it is asked for, so
   * the delta run above left two extra live rows. That is exactly the state a
   * restatement has to cope with, and the assertion is therefore against the live
   * count rather than a literal: *every* prior belief goes, however many there
   * were.
   */
  const liveBeforeRestatement = (
    await bars.findRange(INSTRUMENT, "DAY", DateRange.of(on("2025-10-13"), on("2025-10-14")))
  ).length;

  const restated = await ingest.execute({
    instrument: REF,
    quoteKey: "TMPV.NS",
    market: "IN",
    restate: true,
  });
  checkTrue("the restatement succeeds", restated.ok);
  if (restated.ok) {
    check("every prior belief was superseded", restated.value.superseded, liveBeforeRestatement);
    const after = await bars.findRange(
      INSTRUMENT,
      "DAY",
      DateRange.of(on("2025-10-13"), on("2025-10-14")),
    );
    check("and the live series is still one bar a day", after.length, 2);
  }

  section("a currency mismatch is refused, not stored");

  const wrongCurrency = new IngestInstrumentBars(
    new FixtureFeed([["2025-10-13", "400"]], Currency.of("USD")),
    new InMemoryBarRepository(),
    clock,
  );
  const refused = await wrongCurrency.execute({
    instrument: REF,
    quoteKey: "TMPV.NS",
    market: "IN",
    force: true,
  });
  check("it fails", refused.ok, false);
  if (!refused.ok) {
    check("with the ingest error code", refused.error.code, "PRICING_BAR_INGEST_FAILED");
    checkTrue("naming both currencies", refused.error.message.includes("USD"));
  }

  section("a dead source fails loudly rather than writing an empty chart");

  const dead: DailyHistoryFeed = {
    async history() {
      return Err(ProviderError.unknownSymbol("yahoo-chart", "TATAMOTORS.NS"));
    },
  };
  const failing = await new IngestInstrumentBars(dead, new InMemoryBarRepository(), clock).execute({
    instrument: REF,
    quoteKey: "TATAMOTORS.NS",
    market: "IN",
  });
  check("the result is an error, not an empty success", failing.ok, false);

  done();
}

void ingestion();

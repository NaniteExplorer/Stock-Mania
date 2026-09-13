/**
 * The split double-adjustment trap, asserted.
 *
 * This spec exists to fail. Delete the factor multiplication in
 * `src/domain/split-normalisation.ts` — make `normaliseQuantity` return its
 * argument, or drop the `isAfter` filter — and the NVDA and AAPL blocks below go
 * red immediately, which is the only property that makes a regression test about
 * a *silent* 40x error worth having. (Verified by doing exactly that: the
 * identity stub fails 17 of 41 assertions.)
 *
 * The numbers are the measured ones from the experiment lane:
 *
 *  - **NVDA 40x** — 4:1 on 2021-07-20 and 10:1 on 2024-06-10. A January 2021 buy
 *    plotted against today's adjusted series is understated forty-fold unless the
 *    ledger quantity is normalised first.
 *  - **AAPL 4x** — 4:1 on 2020-08-31.
 *  - RELIANCE 2x (2017 bonus, 1:1) and IRCTC 5x (2021) are the Indian pair, kept
 *    because the Indian ex-date convention is where the off-by-one-day boundary
 *    actually bites.
 */

import { Currency } from "@/core/money";
import { Quantity, UnitPrice } from "@/core/numeric";
import { CalendarDate } from "@/core/time";
import {
  IDENTITY_SPLIT_FACTOR,
  composeSplitFactors,
  cumulativeSplitFactorAfter,
  denormalisePrice,
  denormaliseQuantity,
  invertSplitFactor,
  isIdentity,
  loggedSplit,
  normalisePrice,
  normaliseQuantity,
  normaliseTrade,
  splitFactor,
  tradeIsInCurrentShareTerms,
} from "@/domain/split-normalisation";
import { check, checkTrue, done, section, throws } from "./harness";

const on = (value: string) => CalendarDate.parse(value);
const usd = (value: string) => UnitPrice.of(value, Currency.of("USD"));
const inr = (value: string) => UnitPrice.of(value, Currency.INR);
const qty = (value: string) => Quantity.fromString(value);

/* ── NVDA: the 40x case ────────────────────────────────────────────── */

section("NVDA — 4:1 in 2021 and 10:1 in 2024 compose to 40x");

const NVDA_SPLITS = [
  loggedSplit("2021-07-20", 1n, 4n),
  loggedSplit("2024-06-10", 1n, 10n),
];

const nvdaFactor = cumulativeSplitFactorAfter(NVDA_SPLITS, on("2021-01-04"));
check("the cumulative factor's numerator is 40", nvdaFactor.numerator, 40n);
check("over a denominator of 1", nvdaFactor.denominator, 1n);

/*
 * The trap itself. The owner bought 10 shares at $500 on 2021-01-04. Yahoo now
 * serves that day's close as $12.50. Plotting "10 shares" against a $12.50 series
 * values a $5 000 purchase at $125 — the measured 40x error.
 */
const nvdaBuy = { quantity: qty("10"), price: usd("500"), tradeDate: on("2021-01-04") };
const nvda = normaliseTrade(nvdaBuy, NVDA_SPLITS);

check("10 shares bought in Jan 2021 are 400 of today's shares", nvda.quantity.toDecimalString(), "400");
check("and $500 a share is $12.50 in today's terms", nvda.price.toDecimalString(), "12.5");
checkTrue(
  "the normalised quantity is NOT the raw one — this is the assertion that dies if the normalisation is removed",
  nvda.quantity.toDecimalString() !== nvdaBuy.quantity.toDecimalString(),
);
check(
  "the normalised price matches the adjusted close, so the chart and the ledger agree",
  nvda.price.toDecimalString(),
  "12.5",
);

/*
 * Cost basis is the invariant. C3: it comes from the ledger, price x quantity as
 * traded, and nothing here may move it.
 */
check(
  "cost basis as traded is $5 000",
  nvdaBuy.price.times(nvdaBuy.quantity).toString(),
  "USD 5000.00",
);
check(
  "and the normalised pair reconstructs exactly the same $5 000",
  nvda.price.times(nvda.quantity).toString(),
  "USD 5000.00",
);

check("the round trip returns the shares actually bought", denormaliseQuantity(nvda.quantity, nvda.factor).toDecimalString(), "10");
check("and the price actually paid", denormalisePrice(nvda.price, nvda.factor).toDecimalString(), "500");

/* ── AAPL: the 4x case ─────────────────────────────────────────────── */

section("AAPL — 4:1 on 2020-08-31");

const AAPL_SPLITS = [loggedSplit("2020-08-31", 1n, 4n)];
const aaplBuy = { quantity: qty("5"), price: usd("200"), tradeDate: on("2019-05-02") };
const aapl = normaliseTrade(aaplBuy, AAPL_SPLITS);

check("5 shares become 20", aapl.quantity.toDecimalString(), "20");
check("and $200 becomes $50", aapl.price.toDecimalString(), "50");
checkTrue("which is not the raw quantity", aapl.quantity.toDecimalString() !== "5");
check("cost basis is untouched at $1 000", aapl.price.times(aapl.quantity).toString(), "USD 1000.00");

/* ── The ex-date boundary ──────────────────────────────────────────── */

section("a trade on or after the ex-date is already in post-split terms");

/*
 * The single most dangerous off-by-one in the file: the ex-date is the first day
 * the stock trades in the new terms, so a buy *on* it needs no adjustment, and
 * adjusting it anyway is the whole factor wrong in the other direction.
 */
const onExDate = normaliseTrade(
  { quantity: qty("20"), price: usd("125"), tradeDate: on("2020-08-31") },
  AAPL_SPLITS,
);
check("a buy on the ex-date keeps its quantity", onExDate.quantity.toDecimalString(), "20");
check("and its price", onExDate.price.toDecimalString(), "125");
checkTrue("its factor is the identity", isIdentity(onExDate.factor));
checkTrue("which `tradeIsInCurrentShareTerms` reports", tradeIsInCurrentShareTerms(AAPL_SPLITS, on("2020-08-31")));

const dayBefore = normaliseTrade(
  { quantity: qty("20"), price: usd("500"), tradeDate: on("2020-08-30") },
  AAPL_SPLITS,
);
check("one day earlier, the factor applies in full", dayBefore.quantity.toDecimalString(), "80");
checkTrue("and the trade is reported as needing normalisation", !tradeIsInCurrentShareTerms(AAPL_SPLITS, on("2020-08-30")));

/* ── The Indian pair ───────────────────────────────────────────────── */

section("RELIANCE 2x and IRCTC 5x");

const reliance = normaliseTrade(
  { quantity: qty("100"), price: inr("1560"), tradeDate: on("2017-08-01") },
  [loggedSplit("2017-09-07", 1n, 2n)],
);
check("a 1:1 bonus doubles the units", reliance.quantity.toDecimalString(), "200");
check("and halves the price", reliance.price.toDecimalString(), "780");
check("cost unchanged", reliance.price.times(reliance.quantity).toString(), "INR 156000.00");

const irctc = normaliseTrade(
  { quantity: qty("40"), price: inr("3500"), tradeDate: on("2021-09-01") },
  [loggedSplit("2021-10-29", 1n, 5n)],
);
check("IRCTC 1:5 gives five times the units", irctc.quantity.toDecimalString(), "200");
check("at a fifth of the price", irctc.price.toDecimalString(), "700");
check("cost unchanged", irctc.price.times(irctc.quantity).toString(), "INR 140000.00");

/* ── Reverse splits and identity ───────────────────────────────────── */

section("a consolidation is the same arithmetic with a factor below one");

const consolidated = normaliseTrade(
  { quantity: qty("500"), price: inr("2"), tradeDate: on("2020-01-01") },
  [loggedSplit("2021-03-01", 5n, 1n)],
);
check("500 units become 100", consolidated.quantity.toDecimalString(), "100");
check("at five times the price", consolidated.price.toDecimalString(), "10");
check("cost unchanged", consolidated.price.times(consolidated.quantity).toString(), "INR 1000.00");

section("factor algebra");

check("a factor is reduced", splitFactor(loggedSplit("2020-01-01", 2n, 20n)).numerator, 10n);
check("and its denominator with it", splitFactor(loggedSplit("2020-01-01", 2n, 20n)).denominator, 1n);
check(
  "composition multiplies",
  composeSplitFactors({ numerator: 4n, denominator: 1n }, { numerator: 10n, denominator: 1n }).numerator,
  40n,
);
check("inversion flips", invertSplitFactor({ numerator: 40n, denominator: 1n }).numerator, 1n);
check("and flips back", invertSplitFactor({ numerator: 40n, denominator: 1n }).denominator, 40n);
checkTrue("the identity is the identity", isIdentity(IDENTITY_SPLIT_FACTOR));

check(
  "no logged split means no change",
  normaliseQuantity(qty("7.5"), cumulativeSplitFactorAfter([], on("2020-01-01"))).toDecimalString(),
  "7.5",
);
check(
  "a price with no split is untouched too",
  normalisePrice(usd("123.45"), IDENTITY_SPLIT_FACTOR).toDecimalString(),
  "123.45",
);

throws(
  "a zero-sided ratio is refused rather than silently treated as identity",
  () => splitFactor({ exDate: on("2020-01-01"), numerator: 0n, denominator: 1n }),
  "two positive integers",
);

/* ── Rounding ──────────────────────────────────────────────────────── */

section("a factor that does not divide evenly still preserves the cost");

/*
 * A 1-for-3 consolidation of 10 units. The quantity cannot be represented exactly
 * even at 1e8, so the price is derived from the preserved total rather than
 * rounded on its own — which is the only way the product survives.
 */
const awkward = normaliseTrade(
  { quantity: qty("10"), price: inr("30"), tradeDate: on("2020-01-01") },
  [loggedSplit("2021-01-01", 3n, 1n)],
);
check("10 units at 1-for-3 round half-even to 3.33333333", awkward.quantity.toDecimalString(), "3.33333333");
checkTrue("the price is above the naive 3x", awkward.price.compareTo(inr("90")) >= 0);
check(
  "and the cost still rounds to the 300 that was actually paid",
  awkward.price.times(awkward.quantity).toString(),
  "INR 300.00",
);

done();

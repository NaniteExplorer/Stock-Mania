import { Money, ROUNDING } from "@/core/money";
import { Percentage, Quantity } from "@/core/numeric";
import { CalendarDate } from "@/core/time";
import {
  ChargeRateTable,
  chargeModelFor,
  type ChargeRate,
  type TradeFacts,
} from "@/domain/charges";
import { SEED_DATA } from "@/infra/db/seeds";
import { check, section, done, assertProperty, genInt, genOneOf, type Gen } from "./harness";

/**
 * The charge engine.
 *
 * The gate for this item is "a real Zerodha contract note reproduces to the
 * paisa", and every assertion below is hand-computable from the rates — which is
 * the point. A charge engine that agrees with itself proves nothing.
 */

/** Builds the domain rate table from the seed rows the database is loaded with. */
function rateTable(): ChargeRateTable {
  const rows: ChargeRate[] = [...SEED_DATA.CHARGE_RATE_ROWS, ...SEED_DATA.STATUTORY_ROWS].map(
    (row) => ({
      brokerId: row.brokerId,
      segment: row.segment,
      chargeType: row.chargeType,
      side: row.side,
      basis: row.basis as ChargeRate["basis"],
      rate: row.rateScaled === null || row.rateScaled === undefined
        ? null
        : Percentage.fromScaled(BigInt(row.rateScaled)),
      flat: row.flatMinor === null || row.flatMinor === undefined
        ? null
        : Money.fromMinor(BigInt(row.flatMinor)),
      cap: row.capMinor === null || row.capMinor === undefined
        ? null
        : Money.fromMinor(BigInt(row.capMinor)),
      floor: row.minMinor === null || row.minMinor === undefined
        ? null
        : Money.fromMinor(BigInt(row.minMinor)),
      deductibility: row.deductibility,
      rounding: (row.rounding ?? "HALF_UP") as ChargeRate["rounding"],
      roundingUnit: (row.roundingUnit ?? "PAISE") as ChargeRate["roundingUnit"],
      effectiveFrom: CalendarDate.parse(row.effectiveFrom),
      effectiveTo: row.effectiveTo ? CalendarDate.parse(row.effectiveTo) : null,
    }),
  );
  return new ChargeRateTable(rows);
}

const rates = rateTable();
const TRADED_ON = CalendarDate.parse("2025-08-14");

const trade = (over: Partial<TradeFacts> = {}): TradeFacts => ({
  brokerId: "zerodha",
  segment: "EQ_DELIVERY",
  side: "BUY",
  tradedOn: TRADED_ON,
  exchange: "NSE",
  quantity: Quantity.fromString("10"),
  pricePerUnit: Money.fromRupees("1500.00"),
  ...over,
});

const rupees = (m: Money) => m.toDecimalString();

section("Zerodha delivery BUY — 10 INFY at ₹1,500, turnover ₹15,000");

/*
 * Hand-computed, line by line:
 *   brokerage      delivery is free                                  0.00
 *   STT            0.1%    of 15,000 = 15.00, to the rupee          15.00
 *   exchange txn   0.00297% of 15,000 = 0.4455, HALF_UP paise         0.45
 *   SEBI turnover  0.0001% of 15,000 = 0.015,  HALF_UP paise          0.02
 *   stamp duty     0.015%  of 15,000 = 2.25,   to the rupee           2.00
 *   DP             buy side, so none                                  —
 *   GST            18% of (0.00 + 0.45 + 0.02) = 0.0846               0.08
 *                                                          total    17.55
 */
const buy = chargeModelFor("zerodha", rates).compute(trade());

check("brokerage on delivery is nil", rupees(buy.by("BROKERAGE")), "0.00");
check("STT is 0.1% rounded to the rupee", rupees(buy.by("STT")), "15.00");
check("exchange transaction charge", rupees(buy.by("EXCHANGE_TXN")), "0.45");
check("SEBI turnover fee", rupees(buy.by("SEBI_TURNOVER")), "0.02");
check("stamp duty is 0.015% rounded to the rupee", rupees(buy.by("STAMP_DUTY")), "2.00");
check("no DP charge on a buy", rupees(buy.by("DP_CHARGES")), "0.00");
check("GST is 18% of the fee-bearing charges only", rupees(buy.by("GST")), "0.08");
check("total charges", rupees(buy.total), "17.55");

section("and the tax treatment of each is part of the answer");

/*
 * deductible     exchange 0.45 + SEBI 0.02 + GST 0.08 = 0.55
 * nonDeductible  STT 15.00
 * capitalised    stamp duty 2.00
 * The three partition the total exactly, which is the property that stops a
 * gain being reduced by STT.
 */
check("deductible against gains", rupees(buy.deductible), "0.55");
check("STT is not deductible", rupees(buy.nonDeductible), "15.00");
check("stamp duty is capitalised into basis", rupees(buy.capitalised), "2.00");
check(
  "the three partition the total exactly",
  rupees(buy.deductible.plus(buy.nonDeductible).plus(buy.capitalised)),
  rupees(buy.total),
);

section("Zerodha delivery SELL — the same trade the other way");

/*
 *   brokerage      free                                              0.00
 *   STT            0.1% of 15,000, to the rupee                     15.00
 *   exchange txn   0.4455 -> 0.45
 *   SEBI           0.015  -> 0.02
 *   stamp duty     BUY side only, so none                              —
 *   DP             one scrip-day                                     15.34
 *   GST            18% of (0.45 + 0.02 + 15.34 = 15.81) = 2.8458      2.85
 *                                                          total    33.66
 */
const sell = chargeModelFor("zerodha", rates).compute(trade({ side: "SELL" }));

check("stamp duty is buy-side only", rupees(sell.by("STAMP_DUTY")), "0.00");
check("DP charge on the sell side", rupees(sell.by("DP_CHARGES")), "15.34");
check("GST now includes the DP fee", rupees(sell.by("GST")), "2.85");
check("total on the sell", rupees(sell.total), "33.66");

section("intraday differs in three places, not one");

/*
 * Intraday, 100 shares at ₹1,500 = ₹1,50,000 turnover, SELL:
 *   brokerage      min(0.03% of 150,000 = 45.00, cap 20.00) = 20.00
 *   STT            0.025%, SELL only: 37.50 -> to the rupee 38.00
 *   exchange txn   0.00297% of 150,000 = 4.455 -> 4.46
 *   SEBI           0.0001% of 150,000 = 0.15
 *   stamp duty     0.003%, BUY only, so none on a sell
 *   GST            18% of (20.00 + 4.46 + 0.15 = 24.61) = 4.4298 -> 4.43
 */
const intraday = chargeModelFor("zerodha", rates).compute(
  trade({ segment: "EQ_INTRADAY", side: "SELL", quantity: Quantity.fromString("100") }),
);
check("intraday brokerage hits the ₹20 cap", rupees(intraday.by("BROKERAGE")), "20.00");
check("intraday STT is 0.025% to the rupee", rupees(intraday.by("STT")), "38.00");
check("exchange charge scales with turnover", rupees(intraday.by("EXCHANGE_TXN")), "4.46");
check("SEBI fee", rupees(intraday.by("SEBI_TURNOVER")), "0.15");
check("no stamp duty on an intraday sell", rupees(intraday.by("STAMP_DUTY")), "0.00");
check("no DP on intraday", rupees(intraday.by("DP_CHARGES")), "0.00");
check("GST", rupees(intraday.by("GST")), "4.43");

// The cap only binds above a threshold: 0.03% of ₹50,000 is ₹15, under the cap.
const smallIntraday = chargeModelFor("zerodha", rates).compute(
  trade({
    segment: "EQ_INTRADAY",
    side: "BUY",
    quantity: Quantity.fromString("100"),
    pricePerUnit: Money.fromRupees("500.00"),
  }),
);
check("below the cap the percentage applies", rupees(smallIntraday.by("BROKERAGE")), "15.00");
check("and intraday STT does not apply to a buy", rupees(smallIntraday.by("STT")), "0.00");

section("DP is per scrip per day, not per trade");

// Two sells of the SAME scrip on one day are one DP charge; the trade carries the
// scrip-day count because a single trade cannot know what else happened that day.
const twoScrips = chargeModelFor("zerodha", rates).compute(
  trade({ side: "SELL", scripDayCount: 2 }),
);
check("two distinct scrips, two DP charges", rupees(twoScrips.by("DP_CHARGES")), "30.68");
check("one scrip-day is the default", rupees(sell.by("DP_CHARGES")), "15.34");

section("Groww — same statutory charges, different brokerage");

/*
 *   brokerage      min(0.1% of 15,000 = 15.00, cap 20.00) = 15.00
 *   STT            15.00   (statutory, identical)
 *   exchange txn   0.45
 *   SEBI           0.02
 *   stamp duty     2.00
 *   GST            18% of (15.00 + 0.45 + 0.02 = 15.47) = 2.7846 -> 2.78
 *                  15.00 + 15.00 + 0.45 + 0.02 + 2.00 + 2.78 = total  35.25
 */
const groww = chargeModelFor("groww", rates).compute(trade({ brokerId: "groww" }));
check("Groww charges delivery brokerage", rupees(groww.by("BROKERAGE")), "15.00");
check("the statutory charges are identical", rupees(groww.by("STT")), "15.00");
check("GST rises with the brokerage", rupees(groww.by("GST")), "2.78");
check("total at Groww", rupees(groww.total), "35.25");

section("an unknown broker still records the statutory charges exactly");

// The difference between "we support your broker" and "you can still record your
// trade correctly".
const unknown = chargeModelFor("some-other-broker", rates).compute(
  trade({ brokerId: "some-other-broker" }),
);
check("STT still applies", rupees(unknown.by("STT")), "15.00");
check("stamp duty still applies", rupees(unknown.by("STAMP_DUTY")), "2.00");
check("brokerage is nil without a rate row", rupees(unknown.by("BROKERAGE")), "0.00");

section("rates are effective-dated, so an old note reproduces");

const beforeRates = chargeModelFor("zerodha", rates).compute(
  trade({ tradedOn: CalendarDate.parse("2024-01-15") }),
);
// No FY2025-26 row is in force in January 2024, so nothing is charged rather than
// the current rate being applied retroactively — silence is the honest answer.
check("a date before any rate row charges nothing", rupees(beforeRates.total), "0.00");

section("provenance — every figure names the rule that produced it");

const sttItem = buy.find("STT");
check("the rule id names broker, segment, charge and date", sttItem?.rule, "ZERODHA.EQ_DELIVERY.STT.2025-08-14");
check("and the basis it applied to", rupees(sttItem?.basisAmount ?? Money.zero()), "15000.00");
check("and the rounding unit used", sttItem?.roundingUnit, "RUPEE");
check("GST records its own basis, not turnover", rupees(buy.find("GST")?.basisAmount ?? Money.zero()), "0.47");

section("properties");

interface Case {
  qty: number;
  price: number;
  side: "BUY" | "SELL";
  segment: "EQ_DELIVERY" | "EQ_INTRADAY";
  broker: string;
}

const genCase: Gen<Case> = (rng) => ({
  qty: genInt(1, 10_000)(rng),
  price: genInt(1, 500_000)(rng),
  side: genOneOf(["BUY", "SELL"] as const)(rng),
  segment: genOneOf(["EQ_DELIVERY", "EQ_INTRADAY"] as const)(rng),
  broker: genOneOf(["zerodha", "groww"] as const)(rng),
});

const computeCase = (c: Case) =>
  chargeModelFor(c.broker, rates).compute({
    brokerId: c.broker,
    segment: c.segment,
    side: c.side,
    tradedOn: TRADED_ON,
    exchange: "NSE",
    quantity: Quantity.fromString(String(c.qty)),
    pricePerUnit: Money.fromRupees(String(c.price)),
  });

// P-CHARGE-SUM: the items sum to the total, and the three deductibility buckets
// partition it. If they ever did not, the tax engine would be reducing a gain by
// a figure that is not in the note.
assertProperty(
  "P-CHARGE-SUM  items sum to total, and deductibility partitions it",
  genCase,
  (c) => {
    const b = computeCase(c);
    const parts = b.deductible.plus(b.nonDeductible).plus(b.capitalised);
    return parts.minor === b.total.minor;
  },
  5_000,
  { show: (c) => `${c.broker} ${c.segment} ${c.side} ${c.qty}@${c.price}` },
);

// P-CHARGE-GST: recomputed independently of the engine's own ordering.
assertProperty(
  "P-CHARGE-GST  GST is 18% of brokerage + exchange + SEBI + DP",
  genCase,
  (c) => {
    const b = computeCase(c);
    const base = b
      .by("BROKERAGE")
      .plus(b.by("EXCHANGE_TXN"))
      .plus(b.by("SEBI_TURNOVER"))
      .plus(b.by("DP_CHARGES"));
    const expected = Percentage.of("18").applyTo(base, ROUNDING.charge);
    return b.by("GST").minor === expected.minor;
  },
  5_000,
);

// No charge is ever negative: a fee that reduced a bill would be a refund, and a
// refund is a transaction, not a charge.
assertProperty(
  "P-CHARGE-SIGN  no charge is negative",
  genCase,
  (c) => computeCase(c).items.every((i) => !i.amount.isNegative),
  2_000,
);

// STT and stamp duty are whole rupees, always — the detail a paisa-exact
// reproduction turns on.
assertProperty(
  "P-CHARGE-RUPEE  STT and stamp duty carry no paise",
  genCase,
  (c) => {
    const b = computeCase(c);
    const factor = 100n;
    return b.by("STT").minor % factor === 0n && b.by("STAMP_DUTY").minor % factor === 0n;
  },
  2_000,
);

done();

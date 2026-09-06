/**
 * "Was digital gold the right vehicle?" — answered by replaying the user's own
 * money into every alternative they could have bought instead.
 *
 * **The comparison is a shadow portfolio, not a price chart.** Comparing the gold
 * price against the Nifty over the same window answers a question nobody asked:
 * the user did not buy on one day, they bought on thirty, and *when* the money
 * went in is most of the answer. So this use case takes the actual dated rupee
 * outflows — the same trades the holding page shows — and hands the identical
 * rupees, on the identical dates, to each alternative. Every line then differs
 * only in what the money bought.
 *
 * Three things separate this from the promotional version of the same table:
 *
 *   1. **Entry cost is charged.** Gold does not cost the gram rate: it costs the
 *      gram rate plus 3% GST, plus a coin premium or a making charge. An index
 *      does not cost the index. Each vehicle's real entry load is applied at each
 *      dated purchase, and the row says in words what was charged.
 *   2. **Tax is charged, per dated purchase.** A parcel bought fourteen months ago
 *      and a parcel bought thirty months ago are taxed differently, and the
 *      threshold that separates them comes from the tax regime — never from a
 *      literal in this file. A statute change must move this table.
 *   3. **What cannot be sourced is named, not guessed.** Sovereign gold bonds have
 *      no keyless price feed that works (NSE returns an Akamai 403 for every
 *      symbol including `INFY`; Yahoo carries no SGB series at all), so SGB
 *      appears in {@link GoldBenchmarkComparison.unavailable} with that reason
 *      rather than as an empty column or an invented number.
 *
 * **What the replay deliberately ignores, and why it must be said on screen.**
 * Sales and lease credits are excluded from every line, the actual holding
 * included. The question is "what would this money have become in each vehicle",
 * and a sale in the real account has no counterpart in the shadow ones. That makes
 * the ACTUAL row's XIRR here a *different figure* from the holding page's XIRR —
 * deliberately, because the two answer different questions — and
 * {@link GoldBenchmarkComparison.basis} says so in words the screen can render.
 *
 * **Known omissions, stated rather than hidden.** No ongoing expense ratio is
 * charged to the ETF or the index line, and no exit brokerage. Both flatter those
 * two rows slightly, and both are named in `basis`. Modelling a daily TER exactly
 * would need a fractional-exponent power, which is a float, and a float here would
 * be the only one in the file outside `xirr()`.
 */

import { AppError, Err, NotFoundError, Ok, Result, UseCase, UserId } from "@/core/kernel";
import { Currency, Money } from "@/core/money";
import { Percentage, Quantity, UnitPrice } from "@/core/numeric";
import { CalendarDate, DateRange } from "@/core/time";
import { InstitutionRepository } from "@/domain/institutions";
import { InstrumentId, InstrumentRepository } from "@/domain/instruments";
import { LotRepository, TradeRecord } from "@/domain/lots";
import { Cashflow, Xirr, xirr } from "@/domain/portfolio";
import { QuoteRepository } from "@/domain/pricing";
import { RegimeRegistry, TaxCategory, TaxRegime } from "@/domain/tax";

/* ═══ The vehicles ════════════════════════════════════════════════════ */

export type BenchmarkKey =
  /** The user's own holding, replayed on the same terms as everything else. */
  | "ACTUAL"
  | "GOLD_ETF"
  | "PHYSICAL_COIN"
  | "PHYSICAL_JEWELLERY"
  | "NIFTY_50"
  | "BANK_FD"
  | "SGB";

/** The two vehicles that need a series this app does not already store. */
export type BenchmarkSeriesKey = "GOLD_ETF" | "NIFTY_50";

export interface BenchmarkPricePoint {
  readonly on: CalendarDate;
  readonly price: UnitPrice;
}

/**
 * A daily series for one benchmark, ascending, with every gap already dropped.
 *
 * `points` never contains a null price. Yahoo's `close` array does — the last
 * element can be `null` on a non-trading day — and a series that carried it would
 * silently value a portfolio at nothing. Dropping the gap and carrying the last
 * real observation forward is the reader's job, not the screen's.
 */
export interface BenchmarkSeries {
  readonly key: BenchmarkSeriesKey;
  readonly symbol: string;
  /** Which provider actually answered, for the provenance line. */
  readonly sourceId: string;
  readonly points: readonly BenchmarkPricePoint[];
}

export type BenchmarkSeriesOutcome =
  | { readonly ok: true; readonly series: BenchmarkSeries }
  /** Plain English. It is rendered verbatim as the row's absence. */
  | { readonly ok: false; readonly because: string };

/**
 * Where the two external series come from.
 *
 * A port rather than a provider handle, for the reason the whole `infra/providers`
 * layer exists: the test suite supplies fixtures and **never touches the network**,
 * and a page render must survive a dead upstream as a missing row rather than an
 * exception. A failure here is a value, not a throw.
 */
export interface BenchmarkSeriesFeed {
  load(request: {
    readonly keys: readonly BenchmarkSeriesKey[];
    readonly range: DateRange;
    readonly currency: Currency;
  }): Promise<ReadonlyMap<BenchmarkSeriesKey, BenchmarkSeriesOutcome>>;
}

/* ═══ Assumptions ═════════════════════════════════════════════════════ */

/**
 * The figures no free feed can supply, so the user supplies them.
 *
 * There is **no keyless authoritative retail-jeweller rate** — a shop's price is
 * IBJA plus that shop's own premium — and no feed for the fixed-deposit rate the
 * user was actually offered. Each of these is therefore an input with a documented
 * default, and the row's `entryCostNote` renders the number that was used so a
 * reader can see what the comparison assumed rather than trusting it.
 */
export interface BenchmarkAssumptions {
  /** GST on the metal. 3% since the GST Council's 3 Sep 2025 decision. */
  readonly metalGstPercent: Percentage;
  /** GST on the making charge, billed separately from the metal. 5%. */
  readonly makingGstPercent: Percentage;
  /** Dealer premium over the bullion rate on a BIS-hallmarked coin. */
  readonly coinPremiumPercent: Percentage;
  /** Making charge on jewellery, as a percentage of the metal value. */
  readonly makingChargePercent: Percentage;
  /** What a jeweller knocks off the bullion rate when buying an ornament back. */
  readonly resalePurityDiscountPercent: Percentage;
  /** Dealer buy-back discount on a coin. Smaller than jewellery's — no making to lose. */
  readonly coinResaleDiscountPercent: Percentage;
  /** One-off cost of buying an ETF unit: brokerage, STT, spread, tracking error. */
  readonly etfEntryCostPercent: Percentage;
  /** The same for an index fund or an index ETF. */
  readonly equityEntryCostPercent: Percentage;
  /** The rate the user's bank was actually offering. Quarterly compounding. */
  readonly fdAnnualRatePercent: Percentage;
  /**
   * The user's marginal slab rate, used wherever the regime says "slab".
   *
   * The regime records a `null` short-term rate for gold and has no category at
   * all for deposit interest, because the statute taxes both at the holder's slab
   * — which the regime cannot know. Defaulting to the top slab is the
   * conservative direction: it understates the alternatives rather than
   * flattering them.
   */
  readonly slabRatePercent: Percentage;
}

/** Defaults, each with a reason. Every one of them is overridable. */
export const DEFAULT_BENCHMARK_ASSUMPTIONS: BenchmarkAssumptions = {
  metalGstPercent: Percentage.of("3"),
  makingGstPercent: Percentage.of("5"),
  coinPremiumPercent: Percentage.of("4"),
  makingChargePercent: Percentage.of("12"),
  resalePurityDiscountPercent: Percentage.of("8"),
  coinResaleDiscountPercent: Percentage.of("2"),
  etfEntryCostPercent: Percentage.of("0.35"),
  equityEntryCostPercent: Percentage.of("0.2"),
  fdAnnualRatePercent: Percentage.of("7"),
  slabRatePercent: Percentage.of("30"),
};

/* ═══ Output ══════════════════════════════════════════════════════════ */

/** How a vehicle's gain was taxed, exposed so the figure can be audited. */
export interface BenchmarkTaxTreatment {
  /** The regime that priced it — the one in force on `asOf`. */
  readonly regime: string;
  /** Days beyond which the gain is long-term, from the regime. `null` means never. */
  readonly longTermDays: number | null;
  readonly longTermRate: Percentage;
  readonly shortTermRate: Percentage;
  /** True when the short-term rate came from the user's slab, not the regime. */
  readonly shortTermIsSlab: boolean;
  readonly exemption: Money | null;
  readonly longTermGain: Money;
  readonly shortTermGain: Money;
  /** In words, for the tooltip that has to justify the number. */
  readonly note: string;
}

export interface BenchmarkRow {
  readonly key: BenchmarkKey;
  readonly label: string;
  /** What this vehicle charged to get in, in words and with the numbers used. */
  readonly entryCostNote: string;
  /** Total invested — identical on every row, by construction. */
  readonly invested: Money;
  /** Units or grams accumulated. `null` for the fixed deposit, which has none. */
  readonly unitsHeld: Quantity | null;
  readonly terminalValue: Money | null;
  readonly taxDue: Money | null;
  readonly postTaxTerminalValue: Money | null;
  readonly postTaxXirr: Xirr;
  /** Post-tax terminal wealth less the actual holding's. Zero on the ACTUAL row. */
  readonly versusHolding: Money | null;
  readonly tax: BenchmarkTaxTreatment | null;
}

export interface UnavailableBenchmark {
  readonly key: BenchmarkKey;
  readonly label: string;
  /** The real reason, rendered verbatim. Never "no data". */
  readonly because: string;
}

export interface GoldBenchmarkComparison {
  readonly asOf: CalendarDate;
  /** The user's actual dated outflows, replayed into every row. */
  readonly outflows: readonly { readonly on: CalendarDate; readonly amount: Money }[];
  /** ACTUAL is always first, so the table compares like with like. */
  readonly rows: readonly BenchmarkRow[];
  readonly unavailable: readonly UnavailableBenchmark[];
  /** What this table does and does not model. Rendered under it. */
  readonly basis: string;
  readonly assumptions: BenchmarkAssumptions;
}

export interface GoldBenchmarkInput {
  userId: UserId;
  instrumentId: InstrumentId;
  asOf: CalendarDate;
  assumptions?: Partial<BenchmarkAssumptions>;
}

/* ═══ Exact arithmetic helpers ════════════════════════════════════════ */

/** `Percentage`'s own denominator, read from it rather than restated. */
const PERCENT_DENOMINATOR = Percentage.of("100").scaled;
/** `Quantity`'s scale factor, likewise. */
const QUANTITY_FACTOR = Quantity.fromString("1").scaled;

/** A price loaded or discounted by an exact percentage. No float involved. */
function scalePrice(price: UnitPrice, by: Percentage, direction: 1n | -1n): UnitPrice {
  const factor = PERCENT_DENOMINATOR + direction * by.scaled;
  if (factor <= 0n) {
    // A 100%-plus discount is not a price. Refusing beats returning zero, which
    // would read as "worthless" rather than "your input is impossible".
    throw new RangeError(`A ${by.toFixed(2)}% adjustment leaves no price to work with.`);
  }
  return UnitPrice.fromScaled((price.scaled * factor) / PERCENT_DENOMINATOR, price.currency);
}

/**
 * How many units `amount` buys at `price`, exactly.
 *
 * `Money ÷ UnitPrice` has no method because it is the one division in the money
 * types that produces neither, and doing it in a single integer expression keeps
 * the eight decimals a gram count needs.
 */
function unitsFor(amount: Money, price: UnitPrice): Quantity {
  if (!price.isPositive) return Quantity.ZERO;
  return Quantity.fromScaled(
    (amount.minor * QUANTITY_FACTOR * QUANTITY_FACTOR) /
      (price.scaled * amount.currency.minorUnitsPerMajor),
  );
}

/** The last observation on or before `on`, or `null` before the series starts. */
function priceOn(points: readonly BenchmarkPricePoint[], on: CalendarDate): UnitPrice | null {
  let found: UnitPrice | null = null;
  for (const point of points) {
    if (point.on.isAfter(on)) break;
    found = point.price;
  }
  return found;
}

/**
 * A fixed deposit's value after `days`, compounded quarterly, in exact integers.
 *
 * Quarterly because that is how an Indian bank actually compounds a term deposit,
 * and in integers because `(1 + r/4)^n` with an integer `n` is an exact rational —
 * unlike `(1 + r)^(days/365)`, which is a fractional power and therefore a float.
 * The part-quarter tail earns simple interest, which is both the conservative
 * direction and what a bank pays on a broken period.
 */
const DAYS_PER_QUARTER = 91;

function fixedDepositValue(principal: Money, annualRate: Percentage, days: number): Money {
  if (days <= 0) return principal;
  const rate = annualRate.scaled;
  const numerator = 4n * PERCENT_DENOMINATOR + rate;
  const denominator = 4n * PERCENT_DENOMINATOR;
  const quarters = BigInt(Math.floor(days / DAYS_PER_QUARTER));
  const compounded = principal.timesRatio(numerator ** quarters, denominator ** quarters, "HALF_EVEN");
  const stubDays = days - Number(quarters) * DAYS_PER_QUARTER;
  if (stubDays === 0) return compounded;
  return compounded.plus(
    compounded.timesRatio(BigInt(stubDays) * rate, 365n * PERCENT_DENOMINATOR, "HALF_EVEN"),
  );
}

/* ═══ Tax, from the regime ════════════════════════════════════════════ */

/**
 * Which regime category supplies which half of a vehicle's treatment.
 *
 * They are separate on purpose, and the gold ETF is why. A listed gold ETF is
 * taxed at **gold's rate** (12.5% long-term, slab short-term — it is not an equity
 * fund and gets neither the 20% short-term rate nor the ₹1.25L exemption) over the
 * **listed-securities holding period** of twelve months, not the twenty-four
 * months that apply to unlisted physical and digital gold. Neither category alone
 * encodes that, and inventing a new one would put a rate in this file. Composing
 * two regime lookups keeps every number the regime's, and
 * {@link BenchmarkTaxTreatment} publishes both so the composition is auditable.
 */
interface CategoryPair {
  readonly rate: TaxCategory;
  readonly term: TaxCategory;
}

interface ParcelGain {
  readonly on: CalendarDate;
  readonly gain: Money;
  readonly holdingDays: number;
}

function assessCapitalGain(
  regime: TaxRegime,
  categories: CategoryPair,
  parcels: readonly ParcelGain[],
  slabRate: Percentage,
  currency: Currency,
): { taxDue: Money; treatment: BenchmarkTaxTreatment } {
  const longTermDays = regime.longTermDaysFor(categories.term);
  const regimeLtcg = regime.ltcgRateFor(categories.rate);
  const regimeStcg = regime.stcgRateFor(categories.rate);
  const longTermRate = regimeLtcg ?? slabRate;
  const shortTermRate = regimeStcg ?? slabRate;
  const exemption = regime.exemptionLimitFor(categories.rate);

  const zero = Money.zero(currency);
  let longTermGain = zero;
  let shortTermGain = zero;
  for (const parcel of parcels) {
    const isLongTerm = longTermDays !== null && parcel.holdingDays > longTermDays;
    if (isLongTerm) longTermGain = longTermGain.plus(parcel.gain);
    else shortTermGain = shortTermGain.plus(parcel.gain);
  }

  /*
   * Losses net within a term and stop there. Carrying a long-term loss against a
   * short-term gain, or forward into another year, is real relief the statute
   * gives — and modelling it would need the user's whole return, which this table
   * does not have. Floor at zero and say so, rather than claim a refund.
   */
  const taxableLong = longTermGain.isPositive ? longTermGain : zero;
  const taxableShort = shortTermGain.isPositive ? shortTermGain : zero;
  const afterExemption = exemption
    ? taxableLong.isGreaterThan(exemption)
      ? taxableLong.minus(exemption)
      : zero
    : taxableLong;

  const taxDue = longTermRate
    .applyTo(afterExemption, "HALF_UP")
    .plus(shortTermRate.applyTo(taxableShort, "HALF_UP"));

  const termNote =
    longTermDays === null
      ? "No long-term treatment applies at any holding period, so every parcel is taxed at the short-term rate."
      : `Parcels held more than ${longTermDays} days are long-term at ${longTermRate.toFixed(2)}%; ` +
        `the rest at ${shortTermRate.toFixed(2)}%${regimeStcg ? "" : " (your slab)"}.`;

  return {
    taxDue,
    treatment: {
      regime: regime.name,
      longTermDays,
      longTermRate,
      shortTermRate,
      shortTermIsSlab: regimeStcg === null,
      exemption,
      longTermGain,
      shortTermGain,
      note:
        termNote +
        (exemption ? ` The first ${exemption.toDecimalString()} of long-term gain is exempt.` : "") +
        " Losses net within a term and are not carried forward.",
    },
  };
}

/* ═══ The use case ════════════════════════════════════════════════════ */

const SGB_UNAVAILABLE =
  "Sovereign gold bonds are left out because no keyless price feed for them works: " +
  "NSE's quote API answers every request with an Akamai 403 — for Infosys as much as for " +
  "any SGB series — and Yahoo Finance carries no SGB symbols at all. Fresh SGB issuance " +
  "has also been discontinued, so the only available comparison would be a secondary-market " +
  "one. An empty column would look like a zero; this is the reason instead.";

export class GoldBenchmarkReplay implements UseCase<GoldBenchmarkInput, GoldBenchmarkComparison> {
  constructor(
    private readonly instruments: InstrumentRepository,
    private readonly lots: LotRepository,
    private readonly quotes: QuoteRepository,
    private readonly platforms: InstitutionRepository,
    private readonly feed: BenchmarkSeriesFeed,
    private readonly regimes: RegimeRegistry = new RegimeRegistry(),
  ) {}

  async execute(input: GoldBenchmarkInput): Promise<Result<GoldBenchmarkComparison, AppError>> {
    const instrument = await this.instruments.findById(input.userId, input.instrumentId);
    if (!instrument) return Err(new NotFoundError("Instrument", input.instrumentId.value));

    const currency = instrument.currency;
    const assumptions = { ...DEFAULT_BENCHMARK_ASSUMPTIONS, ...input.assumptions };
    const regime = this.regimes.forDate(input.asOf);
    const goldCategory = instrument.taxProfile().category;

    const trades = await this.lots.tradesFor(input.userId, input.instrumentId);
    /*
     * Cash purchases only. A lease accrual books a BUY with no settlement account
     * because no cash moved, and handing a shadow portfolio rupees the user never
     * paid would credit every alternative with gold that arrived free.
     */
    const purchases = [...trades]
      .filter(
        (trade: TradeRecord) =>
          trade.side === "BUY" &&
          trade.settlementAccountId !== null &&
          trade.tradedOn.isOnOrBefore(input.asOf),
      )
      .sort((a, b) => a.tradedOn.compareTo(b.tradedOn));

    const outflows = purchases.map((trade) => ({
      on: trade.tradedOn,
      amount: trade.quantity.valueAt(trade.pricePerUnit, "HALF_EVEN").plus(trade.charges),
    }));
    const invested = Money.total(
      outflows.map((flow) => flow.amount),
      currency,
    );

    const unavailable: UnavailableBenchmark[] = [
      { key: "SGB", label: "Sovereign gold bond", because: SGB_UNAVAILABLE },
    ];

    /* ── The actual holding, always the first row ──────────────────── */

    const platform = instrument.institutionId
      ? await this.platforms.findById(input.userId, instrument.institutionId)
      : null;
    const latest = await this.quotes.findLatestOnOrBefore(
      input.instrumentId.value,
      "CLOSE",
      input.asOf,
      1,
    );
    const benchmarkGramRate = latest[0]?.price ?? null;
    const realisableGramRate =
      benchmarkGramRate && platform
        ? platform.realisablePrice(benchmarkGramRate)
        : benchmarkGramRate;

    const actualRow = this.buildRow({
      key: "ACTUAL",
      label: `${instrument.props.name} (what you actually hold)`,
      entryCostNote:
        "No extra load applied — the outflows already carry what you paid: the platform's " +
        "buying rate, GST and any charge recorded on the trade. Valued at the platform's " +
        (platform && platform.hasSellSpread
          ? `buy-back rate, ${platform.props.sellSpread.toFixed(2)}% under the benchmark.`
          : "published rate; no buy-back spread has been recorded for this platform, so this " +
            "row is valued at the benchmark and is flattered by whatever the real spread is."),
      currency,
      invested,
      parcels: purchases.map((trade) => ({
        on: trade.tradedOn,
        cost: trade.quantity.valueAt(trade.pricePerUnit, "HALF_EVEN").plus(trade.charges),
        units: trade.quantity,
      })),
      exitPrice: realisableGramRate,
      asOf: input.asOf,
      regime,
      categories: { rate: goldCategory, term: goldCategory },
      slabRate: assumptions.slabRatePercent,
    });

    const rows: BenchmarkRow[] = [actualRow];

    /* ── Physical gold, off the gram series this app already stores ── */

    /*
     * No feed is added for the bullion series, because the app already has one:
     * the instrument's own recorded benchmark gram rate — IBJA, before the
     * platform's spread — is exactly the number a jeweller prices off. Fetching a
     * second bullion source would introduce a divergence to reconcile for no gain,
     * and IBJA's public page carries only a thirty-day window anyway.
     */
    const gramPoints = (
      await this.quotes.findRange(
        input.instrumentId.value,
        "CLOSE",
        DateRange.of(outflows.length > 0 ? outflows[0].on : input.asOf, input.asOf),
      )
    )
      .filter((quote) => !quote.supersededBy)
      .map((quote) => ({ on: quote.asOf, price: quote.price }))
      .sort((a, b) => a.on.compareTo(b.on));

    const physicalVehicles = [
      {
        key: "PHYSICAL_COIN" as const,
        label: "Physical gold coin (BIS hallmarked)",
        premium: assumptions.coinPremiumPercent,
        making: Percentage.ZERO,
        resale: assumptions.coinResaleDiscountPercent,
      },
      {
        key: "PHYSICAL_JEWELLERY" as const,
        label: "Physical gold jewellery",
        premium: Percentage.ZERO,
        making: assumptions.makingChargePercent,
        resale: assumptions.resalePurityDiscountPercent,
      },
    ];

    for (const physical of physicalVehicles) {
      /*
       * The all-in rupees per gram at the counter: metal, then the dealer premium
       * or the making charge, then GST at two different rates — 3% on the metal
       * (premium included, since the dealer bills it as metal) and 5% on the
       * making, because the GST Council prices them separately and a single
       * blended rate would be wrong for both.
       */
      const entryLoad = Percentage.fromScaled(
        physical.premium.scaled +
          physical.making.scaled +
          (assumptions.metalGstPercent.scaled * (PERCENT_DENOMINATOR + physical.premium.scaled)) /
            PERCENT_DENOMINATOR +
          (assumptions.makingGstPercent.scaled * physical.making.scaled) / PERCENT_DENOMINATOR,
      );

      const built = this.replay({
        label: physical.label,
        points: gramPoints,
        outflows,
        entryLoad,
        exitDiscount: physical.resale,
        asOf: input.asOf,
        seriesDescription: `the ${instrument.props.symbol} benchmark gram rate this app records`,
      });
      if (!built.ok) {
        unavailable.push({ key: physical.key, label: physical.label, because: built.because });
        continue;
      }
      rows.push(
        this.buildRow({
          key: physical.key,
          label: physical.label,
          entryCostNote:
            `${entryLoad.toFixed(2)}% all-in at the counter: ` +
            (physical.making.isZero
              ? `${physical.premium.toFixed(2)}% dealer premium`
              : `${physical.making.toFixed(2)}% making charge`) +
            `, ${assumptions.metalGstPercent.toFixed(2)}% GST on the metal` +
            (physical.making.isZero
              ? ""
              : ` and ${assumptions.makingGstPercent.toFixed(2)}% on the making`) +
            `. Sold back at ${physical.resale.toFixed(2)}% under the bullion rate` +
            (physical.making.isZero ? "." : " — the making charge is not recoverable."),
          currency,
          invested,
          parcels: built.parcels,
          exitPrice: built.exitPrice,
          asOf: input.asOf,
          regime,
          categories: { rate: goldCategory, term: goldCategory },
          slabRate: assumptions.slabRatePercent,
        }),
      );
    }

    /* ── The two fetched series ────────────────────────────────────── */

    const seriesKeys: readonly BenchmarkSeriesKey[] = ["GOLD_ETF", "NIFTY_50"];
    const fetched =
      outflows.length > 0
        ? await this.feed.load({
            keys: seriesKeys,
            range: DateRange.of(outflows[0].on, input.asOf),
            currency,
          })
        : new Map<BenchmarkSeriesKey, BenchmarkSeriesOutcome>();

    const fetchedSpec: Record<
      BenchmarkSeriesKey,
      { label: string; entryLoad: Percentage; categories: CategoryPair; note: string }
    > = {
      GOLD_ETF: {
        label: "Gold ETF",
        entryLoad: assumptions.etfEntryCostPercent,
        categories: { rate: goldCategory, term: "LISTED_EQUITY" },
        note:
          `${assumptions.etfEntryCostPercent.toFixed(2)}% one-off, covering brokerage, STT and ` +
          "the spread. No ongoing expense ratio is charged, which flatters this row.",
      },
      NIFTY_50: {
        label: "Nifty 50",
        entryLoad: assumptions.equityEntryCostPercent,
        categories: { rate: "LISTED_EQUITY", term: "LISTED_EQUITY" },
        note:
          `${assumptions.equityEntryCostPercent.toFixed(2)}% one-off, covering brokerage and STT. ` +
          "No index-fund expense ratio is charged, which flatters this row.",
      },
    };

    for (const key of seriesKeys) {
      const spec = fetchedSpec[key];
      const outcome = fetched.get(key);
      if (!outcome) {
        unavailable.push({
          key,
          label: spec.label,
          because:
            outflows.length === 0
              ? "No cash purchases have been recorded, so there is nothing to replay."
              : `No price series for ${spec.label} was returned, so this row is left out ` +
                "rather than shown as zero.",
        });
        continue;
      }
      if (!outcome.ok) {
        unavailable.push({ key, label: spec.label, because: outcome.because });
        continue;
      }
      const built = this.replay({
        label: spec.label,
        points: outcome.series.points,
        outflows,
        entryLoad: spec.entryLoad,
        exitDiscount: Percentage.ZERO,
        asOf: input.asOf,
        seriesDescription: `${outcome.series.symbol} from ${outcome.series.sourceId}`,
      });
      if (!built.ok) {
        unavailable.push({ key, label: spec.label, because: built.because });
        continue;
      }
      rows.push(
        this.buildRow({
          key,
          label: spec.label,
          entryCostNote: spec.note,
          currency,
          invested,
          parcels: built.parcels,
          exitPrice: built.exitPrice,
          asOf: input.asOf,
          regime,
          categories: spec.categories,
          slabRate: assumptions.slabRatePercent,
        }),
      );
    }

    /* ── The fixed deposit, which needs no feed at all ─────────────── */

    rows.push(
      this.fixedDepositRow({
        outflows,
        invested,
        currency,
        asOf: input.asOf,
        rate: assumptions.fdAnnualRatePercent,
        slabRate: assumptions.slabRatePercent,
        regime,
      }),
    );

    /* ── Difference against the holding ────────────────────────────── */

    const holdingPostTax = actualRow.postTaxTerminalValue;
    const withDifference = rows.map((row) => ({
      ...row,
      versusHolding:
        holdingPostTax && row.postTaxTerminalValue
          ? row.postTaxTerminalValue.minus(holdingPostTax)
          : null,
    }));

    return Ok({
      asOf: input.asOf,
      outflows,
      rows: withDifference,
      unavailable,
      assumptions,
      basis:
        `Each row receives the same ${invested.toDecimalString()} on the same ${outflows.length} ` +
        `dates you actually paid it, and holds to ${input.asOf.toISO()}. Sales and lease credits ` +
        "are excluded from every row — including your own — so the lines answer one question: " +
        "what would this money have become in each vehicle? That makes the return here a " +
        "different figure from the one on your holding, which does account for sales and lease " +
        `grams. Tax is charged per dated purchase at ${regime.name} rates, at the holding period ` +
        "each purchase implies. No ongoing expense ratio or exit brokerage is charged to the ETF " +
        "and index rows, which flatters them slightly. Everything the app could not source is " +
        "listed below the table with the reason.",
    });
  }

  /* ── Replay: rupees in, units out ──────────────────────────────── */

  private replay(props: {
    label: string;
    points: readonly BenchmarkPricePoint[];
    outflows: readonly { on: CalendarDate; amount: Money }[];
    entryLoad: Percentage;
    exitDiscount: Percentage;
    asOf: CalendarDate;
    seriesDescription: string;
  }):
    | {
        ok: true;
        parcels: readonly { on: CalendarDate; cost: Money; units: Quantity }[];
        exitPrice: UnitPrice;
      }
    | { ok: false; because: string } {
    if (props.outflows.length === 0) {
      return {
        ok: false,
        because: "No cash purchases have been recorded, so there is nothing to replay.",
      };
    }
    if (props.points.length === 0) {
      return {
        ok: false,
        because:
          `No price history is available for ${props.label} (${props.seriesDescription}), so ` +
          "this row is left out rather than shown as zero.",
      };
    }

    const first = props.outflows[0].on;
    const seriesStart = props.points[0].on;
    if (seriesStart.isAfter(first)) {
      return {
        ok: false,
        because:
          `The ${props.label} series (${props.seriesDescription}) only reaches back to ` +
          `${seriesStart.toISO()}, and your first purchase was on ${first.toISO()}. Replaying it ` +
          "would need a price that does not exist, so the row is left out rather than invented.",
      };
    }

    const closing = priceOn(props.points, props.asOf);
    if (!closing) {
      return {
        ok: false,
        because:
          `No ${props.label} price was published on or before ${props.asOf.toISO()}, so there is ` +
          "nothing to value the shadow holding at.",
      };
    }

    const parcels: { on: CalendarDate; cost: Money; units: Quantity }[] = [];
    for (const flow of props.outflows) {
      const observed = priceOn(props.points, flow.on);
      if (!observed) {
        return {
          ok: false,
          because:
            `No ${props.label} price was published on or before ${flow.on.toISO()}, so that ` +
            "purchase cannot be replayed.",
        };
      }
      const paid = props.entryLoad.isZero ? observed : scalePrice(observed, props.entryLoad, 1n);
      parcels.push({ on: flow.on, cost: flow.amount, units: unitsFor(flow.amount, paid) });
    }

    return {
      ok: true,
      parcels,
      exitPrice: props.exitDiscount.isZero ? closing : scalePrice(closing, props.exitDiscount, -1n),
    };
  }

  /* ── One row, valued and taxed ─────────────────────────────────── */

  private buildRow(props: {
    key: BenchmarkKey;
    label: string;
    entryCostNote: string;
    currency: Currency;
    invested: Money;
    parcels: readonly { on: CalendarDate; cost: Money; units: Quantity }[];
    exitPrice: UnitPrice | null;
    asOf: CalendarDate;
    regime: TaxRegime;
    categories: CategoryPair;
    slabRate: Percentage;
  }): BenchmarkRow {
    const unitsHeld = Quantity.sum(props.parcels.map((parcel) => parcel.units));
    const exitPrice = props.exitPrice;

    if (!exitPrice || props.parcels.length === 0) {
      /*
       * A missing price and an empty replay are both blanks, never zeros. A row
       * showing ₹0 terminal value reads as "this vehicle lost everything", which
       * is the opposite of both "we do not know what it is worth today" and "no
       * money was ever put in" — and the second case is reachable the moment a
       * user opens the page before recording a purchase.
       */
      return {
        key: props.key,
        label: props.label,
        entryCostNote: props.entryCostNote,
        invested: props.invested,
        unitsHeld: props.parcels.length > 0 ? unitsHeld : null,
        terminalValue: null,
        taxDue: null,
        postTaxTerminalValue: null,
        postTaxXirr: xirr(
          props.parcels.map((parcel) => ({ on: parcel.on, amount: parcel.cost.negated() })),
        ),
        versusHolding: null,
        tax: null,
      };
    }

    const valued = props.parcels.map((parcel) => {
      const value = exitPrice.times(parcel.units);
      return {
        on: parcel.on,
        value,
        gain: value.minus(parcel.cost),
        holdingDays: parcel.on.daysUntil(props.asOf),
      };
    });
    const terminalValue = Money.total(
      valued.map((parcel) => parcel.value),
      props.currency,
    );
    const { taxDue, treatment } = assessCapitalGain(
      props.regime,
      props.categories,
      valued,
      props.slabRate,
      props.currency,
    );
    const postTax = terminalValue.minus(taxDue);

    const flows: Cashflow[] = props.parcels.map((parcel) => ({
      on: parcel.on,
      amount: parcel.cost.negated(),
      note: `${props.label} purchase replayed`,
    }));
    flows.push({ on: props.asOf, amount: postTax, note: `${props.label} post-tax terminal value` });

    return {
      key: props.key,
      label: props.label,
      entryCostNote: props.entryCostNote,
      invested: props.invested,
      unitsHeld,
      terminalValue,
      taxDue,
      postTaxTerminalValue: postTax,
      postTaxXirr: xirr(flows),
      versusHolding: null,
      tax: treatment,
    };
  }

  /* ── The deposit ───────────────────────────────────────────────── */

  private fixedDepositRow(props: {
    outflows: readonly { on: CalendarDate; amount: Money }[];
    invested: Money;
    currency: Currency;
    asOf: CalendarDate;
    rate: Percentage;
    slabRate: Percentage;
    regime: TaxRegime;
  }): BenchmarkRow {
    const label = "Bank fixed deposit";
    const note =
      `${props.rate.toFixed(2)}% a year, compounded quarterly, with the part-quarter tail at ` +
      "simple interest. No entry cost, because a deposit has none.";

    if (props.outflows.length === 0) {
      return {
        key: "BANK_FD",
        label,
        entryCostNote: note,
        invested: props.invested,
        unitsHeld: null,
        terminalValue: null,
        taxDue: null,
        postTaxTerminalValue: null,
        postTaxXirr: xirr([]),
        versusHolding: null,
        tax: null,
      };
    }

    const zero = Money.zero(props.currency);
    let terminalValue = zero;
    let interest = zero;
    for (const flow of props.outflows) {
      const matured = fixedDepositValue(flow.amount, props.rate, flow.on.daysUntil(props.asOf));
      terminalValue = terminalValue.plus(matured);
      interest = interest.plus(matured.minus(flow.amount));
    }

    /*
     * Deposit interest is Income from Other Sources at the holder's slab — there
     * is no capital gain and therefore no holding-period benefit, whatever the
     * term. That is why this row does not go through the capital-gain assessment
     * at all, rather than being given a category that would imply one.
     */
    const taxable = interest.isPositive ? interest : zero;
    const taxDue = props.slabRate.applyTo(taxable, "HALF_UP");
    const postTax = terminalValue.minus(taxDue);

    const flows: Cashflow[] = props.outflows.map((flow) => ({
      on: flow.on,
      amount: flow.amount.negated(),
      note: "deposit placed",
    }));
    flows.push({ on: props.asOf, amount: postTax, note: "post-tax maturity value" });

    return {
      key: "BANK_FD",
      label,
      entryCostNote: note,
      invested: props.invested,
      unitsHeld: null,
      terminalValue,
      taxDue,
      postTaxTerminalValue: postTax,
      postTaxXirr: xirr(flows),
      versusHolding: null,
      tax: {
        regime: props.regime.name,
        longTermDays: null,
        longTermRate: props.slabRate,
        shortTermRate: props.slabRate,
        shortTermIsSlab: true,
        exemption: null,
        longTermGain: zero,
        shortTermGain: interest,
        note:
          "Deposit interest is Income from Other Sources, taxed at your slab however long the " +
          `deposit ran — ${props.slabRate.toFixed(2)}% here. Section 194A TDS would be a credit ` +
          "against that, not an extra cost, so it is not modelled.",
      },
    };
  }
}

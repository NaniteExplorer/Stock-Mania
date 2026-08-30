/**
 * What the gold holding is actually worth, and *where* the profit came from.
 *
 * The portfolio screen can already say "you hold 12.4g worth ₹X". It could not
 * say the two things an investor in leased gold actually asks:
 *
 *   1. **How much of my gold did the lease pay for?** Interest credited in grams
 *      arrives as a lot like any purchase, so by the time it reaches the holding
 *      it is indistinguishable from bought gold. The grams are right and the
 *      story is lost.
 *   2. **How much of my profit is the gold price, and how much is the rent?**
 *      Two completely different reasons to keep holding, and a single "unrealised
 *      gain" number answers neither.
 *
 * The split this file draws is over **cash actually paid**, and it is exact
 * rather than apportioned:
 *
 *     current value = price × (purchased grams + lease grams)
 *     cash paid     = cost + charges of the purchased lots      ← tax-inclusive
 *     lease profit  = price × lease grams                       ← no cash was paid
 *     price profit  = price × purchased grams − cash paid
 *     total profit  = lease profit + price profit               ← by construction
 *
 * Lease grams cost the user nothing out of pocket, so their entire market value
 * is profit against cash. That is not the same figure as the *accounting*
 * unrealised gain, which nets off the basis those grams were booked at when the
 * income was recognised — so both are reported, named, and never added together.
 *
 * **Sales and finished tenures need no special case.** Everything here reads the
 * open lots, and a sale consumes lots. Sell half the holding and the grams, the
 * cost and both halves of the profit fall out of the same arithmetic on what is
 * left; realised gain is `RealisedGainsHistory`'s subject and is deliberately not
 * mixed in. A matured lease stops accruing in `domain/leasing.ts`, and the grams
 * it already credited stay in the holding because that is where they are.
 *
 * **How a lease-origin lot is recognised.** The accrual books its trade with
 * `settlementAccountId: null` — no cash account settled it, because no cash moved.
 * Every ordinary purchase names the account it was paid from. That is the
 * discriminator, and {@link GoldAnalytics.leaseGramsReconcile} reports whether it
 * agrees with what the leases themselves say they have credited, rather than
 * trusting it silently.
 */

import { AppError, Err, NotFoundError, Ok, Result, UseCase, UserId } from "@/core/kernel";
import { Money } from "@/core/money";
import { Percentage, Quantity, UnitPrice } from "@/core/numeric";
import { CalendarDate, DateRange } from "@/core/time";
import { InstitutionRepository } from "@/domain/institutions";
import { InstrumentId, InstrumentRepository } from "@/domain/instruments";
import { GoldLeaseRepository } from "@/domain/leasing";
import { Lot, LotRepository, TradeRecord } from "@/domain/lots";
import { QuoteRepository } from "@/domain/pricing";

/* ═══ Output ══════════════════════════════════════════════════════════ */

/** One month of the holding's life, priced. */
export interface GoldHistoryPoint {
  /** `YYYY-MM`, the key the chart plots on. */
  readonly month: string;
  readonly on: CalendarDate;
  /** Grams held at month end, lease credits included. */
  readonly grams: Quantity;
  /** Grams that arrived as lease interest, cumulative. */
  readonly leaseGrams: Quantity;
  /** Cash paid for the grams still held — tax and charges included. */
  readonly investedCost: Money;
  /** The gram price that closed the month, or `null` if none was published. */
  readonly pricePerGram: UnitPrice | null;
  readonly marketValue: Money | null;
  /** Market value less cash paid. `null` without a price — never zero. */
  readonly totalProfit: Money | null;
  /** The part of it the lease paid for: price × lease grams. */
  readonly leaseProfit: Money | null;
  /** The part the gold price moved: total less lease. */
  readonly priceProfit: Money | null;
}

export interface GoldAnalytics {
  readonly asOf: CalendarDate;
  /**
   * The price every figure below is computed at — the platform's buy-back rate
   * when a spread is recorded, and the benchmark when none is.
   */
  readonly pricePerGram: UnitPrice | null;
  /** The published benchmark, before the platform's spread. */
  readonly benchmarkPricePerGram: UnitPrice | null;
  /** What this platform discounts the benchmark by. Zero means "not told". */
  readonly sellSpread: Percentage;
  /** Benchmark value, for the line that shows what the spread costs. */
  readonly benchmarkValue: Money | null;
  /** What the spread alone takes off the holding. */
  readonly spreadCost: Money | null;
  readonly pricedOn: CalendarDate | null;

  /** Everything in the holding right now. */
  readonly totalGrams: Quantity;
  /** Of which bought with money. */
  readonly purchasedGrams: Quantity;
  /** Of which credited by a lease and still held. */
  readonly leaseGrams: Quantity;

  /** Cash paid for the grams still held, charges and taxes included. */
  readonly investedCost: Money;
  /** `investedCost ÷ purchasedGrams` — what a bought gram really cost. */
  readonly effectiveCostPerGram: UnitPrice | null;
  /** `investedCost ÷ totalGrams` — the same money spread over the free grams too. */
  readonly blendedCostPerGram: UnitPrice | null;

  readonly marketValue: Money | null;
  /** Market value less cash paid. The number the user means by "my profit". */
  readonly totalProfit: Money | null;
  readonly totalProfitPercent: Percentage | null;
  /** Market value of the grams the lease paid for. */
  readonly leaseProfit: Money | null;
  /** What the price move alone made on the bought grams. */
  readonly priceProfit: Money | null;
  /** Lease profit as a share of total profit, when there is a profit to share. */
  readonly leaseShareOfProfit: Percentage | null;
  /**
   * Market value less the *book* cost of every lot, lease lots included.
   *
   * The accounting figure, kept separate from {@link totalProfit} because the
   * lease income was already recognised when it was credited. Adding the two
   * would count the same grams twice.
   */
  readonly unrealisedAgainstBook: Money | null;

  /* Lease state, for the "is anything owed to me" line. */
  readonly leasedGrams: Quantity;
  readonly unleasedGrams: Quantity;
  readonly overLeased: boolean;
  /** Earned, not yet booked into the holding. */
  readonly dueGrams: Quantity;
  readonly dueValue: Money | null;
  /** Grams credited over the life of every lease, before any sale. */
  readonly creditedGramsEver: Quantity;
  /** Withheld as TDS, in grams. A tax credit, not a cost. */
  readonly tdsGrams: Quantity;
  /**
   * Lease grams sold since they were credited, as a count and a caveat.
   *
   * FIFO means a sale eats the oldest lots first, so "how many of the sold grams
   * were lease grams" has no single answer; this is the difference between what
   * was credited and what survives in open lease lots, which is exactly how many
   * lease grams have left the holding one way or another.
   */
  readonly leaseGramsDisposed: Quantity;
  /**
   * Set when the lease-origin lots and the leases' own credited totals disagree.
   *
   * Reported rather than reconciled: a mismatch means an accrual posted outside
   * this app's path, and quietly picking one of the two numbers is how a screen
   * starts lying.
   */
  readonly leaseGramsReconcile: string | null;

  readonly history: readonly GoldHistoryPoint[];
  /** Why a value is missing, when one is. */
  readonly unpricedReason: string | null;
}

export interface GoldAnalyticsInput {
  userId: UserId;
  instrumentId: InstrumentId;
  asOf: CalendarDate;
  /** How far back the chart runs. Five years by default. */
  months?: number;
}

/* ═══ The use case ════════════════════════════════════════════════════ */

export class GoldHoldingAnalytics implements UseCase<GoldAnalyticsInput, GoldAnalytics> {
  constructor(
    private readonly instruments: InstrumentRepository,
    private readonly lots: LotRepository,
    private readonly leases: GoldLeaseRepository,
    private readonly quotes: QuoteRepository,
    private readonly platforms: InstitutionRepository,
  ) {}

  async execute(input: GoldAnalyticsInput): Promise<Result<GoldAnalytics, AppError>> {
    const instrument = await this.instruments.findById(input.userId, input.instrumentId);
    if (!instrument) return Err(new NotFoundError("Instrument", input.instrumentId.value));
    const currency = instrument.currency;
    const zero = Money.zero(currency);

    const [allLots, trades, leases] = await Promise.all([
      this.lots.allLots(input.userId, input.instrumentId),
      this.lots.tradesFor(input.userId, input.instrumentId),
      this.leases.list(input.userId, { instrumentId: input.instrumentId }),
    ]);

    /*
     * Trades that credited grams without settling cash — the accruals. Held as
     * transaction ids because that is what a lot points back at.
     */
    const leaseTxnIds = new Set(
      trades
        .filter((trade) => trade.side === "BUY" && trade.settlementAccountId === null)
        .map((trade) => trade.transactionId),
    );
    const isLeaseLot = (lot: Lot): boolean => leaseTxnIds.has(lot.props.openedByTransactionId);

    const openLots = allLots.filter((lot) => !lot.isExhausted);
    const openLeaseLots = openLots.filter(isLeaseLot);
    const openPurchasedLots = openLots.filter((lot) => !isLeaseLot(lot));

    const leaseGrams = Quantity.sum(openLeaseLots.map((lot) => lot.remaining));
    const purchasedGrams = Quantity.sum(openPurchasedLots.map((lot) => lot.remaining));
    const totalGrams = leaseGrams.plus(purchasedGrams);

    /*
     * Cash paid, and it is the *remaining* cost rather than the original: gold
     * that has been sold was paid for out of proceeds the realised report already
     * accounts for, and charging it against what is still held would show a loss
     * that belongs to a closed position.
     */
    const investedCost = Money.total(
      openPurchasedLots.flatMap((lot) => [lot.remainingCost, lot.remainingCharges]),
      currency,
    );
    const bookCost = Money.total(
      openLots.flatMap((lot) => [lot.remainingCost, lot.remainingCharges]),
      currency,
    );

    /* ── Price ─────────────────────────────────────────────────────── */

    const latest = await this.quotes.findLatestOnOrBefore(
      input.instrumentId.value,
      "CLOSE",
      input.asOf,
      1,
    );
    const benchmarkPricePerGram = latest[0]?.price ?? null;
    const pricedOn = latest[0]?.asOf ?? null;

    /*
     * The platform's buy-back rate, not the benchmark.
     *
     * Digital gold has two prices: you buy at the vault's rate plus GST, and you
     * sell at its own rate a few percent below IBJA. Valuing at the benchmark
     * shows a gain the morning after a purchase that selling could not realise,
     * so the spread is applied once, here, and every figure downstream — the
     * profit split, the chart, the due-lease valuation — is realisable by
     * construction rather than by each caller remembering to discount.
     *
     * With no spread recorded the two prices are the same number and the screen
     * says it is showing a benchmark. Assuming a plausible 4% would be inventing
     * a figure the user never gave us.
     */
    const platform = instrument.institutionId
      ? await this.platforms.findById(input.userId, instrument.institutionId)
      : null;
    const sellSpread = platform?.sellSpread ?? Percentage.ZERO;
    const pricePerGram =
      benchmarkPricePerGram && platform
        ? platform.realisablePrice(benchmarkPricePerGram)
        : benchmarkPricePerGram;

    const unpricedReason = pricePerGram
      ? null
      : `No gram price has been recorded for ${instrument.symbol} on or before ` +
        `${input.asOf.toISO()}, so every value here is left blank rather than shown as zero. ` +
        `Refresh prices to fill it in.`;

    const marketValue = pricePerGram ? pricePerGram.times(totalGrams) : null;
    const benchmarkValue = benchmarkPricePerGram
      ? benchmarkPricePerGram.times(totalGrams)
      : null;
    // The lease grams cost nothing, so all of what they are worth is profit.
    const leaseProfit = pricePerGram ? pricePerGram.times(leaseGrams) : null;
    const priceProfit = pricePerGram
      ? pricePerGram.times(purchasedGrams).minus(investedCost)
      : null;
    const totalProfit = leaseProfit && priceProfit ? leaseProfit.plus(priceProfit) : null;

    /* ── Lease state ───────────────────────────────────────────────── */

    const activeLeases = leases.filter((lease) => lease.status === "ACTIVE");
    const leasedGrams = Quantity.sum(activeLeases.map((lease) => lease.quantity));
    const walletGrams = totalGrams.minus(leasedGrams);
    const dueGrams = Quantity.sum(leases.map((lease) => lease.unpostedOn(input.asOf)));
    const tdsGrams = Quantity.sum(leases.map((lease) => lease.accrualOn(input.asOf).tds));
    const creditedGramsEver = Quantity.sum(leases.map((lease) => lease.credited));

    const leaseLotGramsEver = Quantity.sum(
      allLots.filter(isLeaseLot).map((lot) => lot.props.originalQuantity),
    );
    const disposedLeaseGrams = leaseLotGramsEver.minus(leaseGrams);

    return Ok({
      asOf: input.asOf,
      pricePerGram,
      benchmarkPricePerGram,
      sellSpread,
      benchmarkValue,
      spreadCost: benchmarkValue && marketValue ? benchmarkValue.minus(marketValue) : null,
      pricedOn,

      totalGrams,
      purchasedGrams,
      leaseGrams,

      investedCost,
      effectiveCostPerGram: purchasedGrams.isPositive
        ? UnitPrice.fromMoney(purchasedGrams.perUnit(investedCost))
        : null,
      blendedCostPerGram: totalGrams.isPositive
        ? UnitPrice.fromMoney(totalGrams.perUnit(investedCost))
        : null,

      marketValue,
      totalProfit,
      totalProfitPercent:
        totalProfit && investedCost.isPositive
          ? Percentage.ratio(totalProfit, investedCost)
          : null,
      leaseProfit,
      priceProfit,
      leaseShareOfProfit:
        leaseProfit && totalProfit && totalProfit.isPositive
          ? Percentage.ratio(leaseProfit, totalProfit)
          : null,
      unrealisedAgainstBook: marketValue ? marketValue.minus(bookCost) : null,

      leasedGrams,
      unleasedGrams: walletGrams.isNegative ? Quantity.ZERO : walletGrams,
      overLeased: walletGrams.isNegative,
      dueGrams,
      dueValue: pricePerGram ? pricePerGram.times(dueGrams) : null,
      creditedGramsEver,
      tdsGrams,
      leaseGramsDisposed: disposedLeaseGrams.isNegative ? Quantity.ZERO : disposedLeaseGrams,
      leaseGramsReconcile:
        leaseLotGramsEver.compareTo(creditedGramsEver) === 0
          ? null
          : `The holding shows ${leaseLotGramsEver.toDecimalString()}g arriving from lease ` +
            `interest, but the leases themselves record ${creditedGramsEver.toDecimalString()}g ` +
            `credited. One of the two was written outside the accrual, and the split between ` +
            `lease profit and price profit below is only as good as this reconciliation.`,

      history: await this.buildHistory(input, trades, leaseTxnIds, zero, (price) =>
        platform ? platform.realisablePrice(price) : price,
      ),
      unpricedReason,
    });
  }

  /**
   * The month-end series behind the chart.
   *
   * Reconstructed from the trades rather than the lots, because a lot carries
   * only what is left of it today and the question here is what was held *then*.
   * Cost is tracked as a running average — a sale removes grams at the average
   * cost of the moment — which is not the FIFO basis the tax report uses and is
   * not trying to be: this line is "what did I have in, month by month", and a
   * FIFO replay would move the same total around between months for no visible
   * difference in the shape of the curve.
   */
  private async buildHistory(
    input: GoldAnalyticsInput,
    trades: readonly TradeRecord[],
    leaseTxnIds: ReadonlySet<string>,
    zero: Money,
    discount: (benchmark: UnitPrice) => UnitPrice,
  ): Promise<readonly GoldHistoryPoint[]> {
    if (trades.length === 0) return [];

    const months = input.months ?? 60;
    const firstTrade = trades.reduce(
      (earliest, trade) => (trade.tradedOn.isBefore(earliest) ? trade.tradedOn : earliest),
      trades[0].tradedOn,
    );
    // Never earlier than the first trade: months of flat zero teach nothing.
    const windowStart = CalendarDate.max(
      firstTrade.startOfMonth(),
      input.asOf.plusMonths(-(months - 1)).startOfMonth(),
    );

    const quotes = await this.quotes.findRange(
      input.instrumentId.value,
      "CLOSE",
      DateRange.of(windowStart, input.asOf),
    );
    /*
     * The last published price in each month. A month with no quote inherits the
     * previous month's, because gold did not stop existing — but a month before
     * the very first quote stays `null`, which is the honest "we do not know".
     */
    const monthEndPrice = new Map<string, UnitPrice>();
    for (const quote of [...quotes].sort((a, b) => a.asOf.compareTo(b.asOf))) {
      if (quote.supersededBy) continue;
      monthEndPrice.set(quote.asOf.toMonthKey(), discount(quote.price));
    }

    const ordered = [...trades].sort((a, b) => a.tradedOn.compareTo(b.tradedOn));
    const points: GoldHistoryPoint[] = [];

    let cursor = 0;
    let grams = Quantity.ZERO;
    let leaseGrams = Quantity.ZERO;
    let cost = zero;
    let carriedPrice: UnitPrice | null = null;

    const monthCount = windowStart.monthsUntil(input.asOf) + 1;
    for (let index = 0; index < monthCount; index += 1) {
      const monthEnd = CalendarDate.min(
        windowStart.plusMonths(index).endOfMonth(),
        input.asOf,
      );

      while (cursor < ordered.length && ordered[cursor].tradedOn.isOnOrBefore(monthEnd)) {
        const trade = ordered[cursor];
        cursor += 1;
        if (trade.side === "BUY") {
          const paid = trade.quantity.valueAt(trade.pricePerUnit, "HALF_EVEN").plus(trade.charges);
          grams = grams.plus(trade.quantity);
          cost = cost.plus(paid);
          if (leaseTxnIds.has(trade.transactionId)) {
            leaseGrams = leaseGrams.plus(trade.quantity);
          }
        } else {
          // Sold grams leave at the average cost of the moment, and the lease
          // share shrinks with them rather than surviving a sale it did not.
          const sold = Quantity.min(trade.quantity, grams);
          if (grams.isPositive) {
            cost = cost.minus(sold.shareOf(cost, grams));
            leaseGrams = leaseGrams.minus(leaseGrams.timesRatio(sold.scaled, grams.scaled, "DOWN"));
          }
          grams = grams.minus(sold);
          if (grams.isNegative) grams = Quantity.ZERO;
          if (leaseGrams.isNegative) leaseGrams = Quantity.ZERO;
        }
      }

      const key = monthEnd.toMonthKey();
      const price: UnitPrice | null = monthEndPrice.get(key) ?? carriedPrice;
      if (price) carriedPrice = price;

      const purchasedGrams = grams.minus(leaseGrams);
      const marketValue = price ? price.times(grams) : null;
      const leaseProfit = price ? price.times(leaseGrams) : null;
      const priceProfit = price ? price.times(purchasedGrams).minus(cost) : null;

      points.push({
        month: key,
        on: monthEnd,
        grams,
        leaseGrams,
        investedCost: cost,
        pricePerGram: price,
        marketValue,
        totalProfit: leaseProfit && priceProfit ? leaseProfit.plus(priceProfit) : null,
        leaseProfit,
        priceProfit,
      });
    }

    return points;
  }
}

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
import { CalendarDate, DateRange, FinancialYear } from "@/core/time";
import { InstitutionRepository } from "@/domain/institutions";
import { InstrumentId, InstrumentRepository } from "@/domain/instruments";
import { GoldLeaseRepository } from "@/domain/leasing";
import { Lot, LotRepository, TradeRecord } from "@/domain/lots";
import { QuoteRepository } from "@/domain/pricing";
import { Cashflow, Xirr, xirr } from "@/domain/portfolio";
import { RegimeRegistry, TaxCategory } from "@/domain/tax";

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

/**
 * One open lot, as the ladder shows it.
 *
 * A holding is not a single position with a single age. It is a stack of
 * purchases, each of which crosses the long-term line on its own day, and the
 * question "can I sell this without paying short-term rates" has one answer per
 * lot rather than one answer per holding. The ladder is what turns that from a
 * spreadsheet exercise into a date on a screen.
 *
 * **The threshold is never a literal here.** It comes from the tax regime in
 * force on the as-of date, looked up by the instrument's own tax category, so a
 * budget that moves gold off 730 days moves this ladder with it. A category the
 * regime gives no `longTermDays` — post-2023 debt, VDA — is not "not yet
 * eligible": long-term treatment does not exist for it at any holding period,
 * and every row then reports `longTermOn: null` and `isLongTerm: false` so a
 * screen can say so rather than counting down to a day that never arrives.
 */
export interface GoldLotRow {
  readonly lotId: string;
  readonly acquiredOn: CalendarDate;
  /** What is left of the lot, after any sale that has eaten into it. */
  readonly grams: Quantity;
  /**
   * Cash paid per remaining gram, or `null` for a lease-origin lot.
   *
   * `null` rather than zero, and the distinction is the whole point: zero would
   * be a price, and a lease credit had no price. It arrived as income already
   * recognised, and dividing nothing by grams is not a cost basis.
   */
  readonly costPerGram: UnitPrice | null;
  /** Cash paid for what is left. Zero for a lease credit — no money moved. */
  readonly investedCost: Money;
  readonly marketValue: Money | null;
  /**
   * Market value less cash paid — the same *cash* basis the headline uses, not
   * the book basis. A lease lot's whole value is therefore unrealised profit,
   * which is why these rows sum to {@link GoldAnalytics.totalProfit} and not to
   * {@link GoldAnalytics.unrealisedAgainstBook}.
   */
  readonly unrealised: Money | null;
  readonly origin: "PURCHASE" | "LEASE_CREDIT";
  readonly holdingDays: number;
  /**
   * The first day this lot can be sold at the long-term rate, or `null` when the
   * category has no long-term treatment.
   *
   * `acquiredOn + threshold + 1`, because the regime classifies on
   * `holdingDays > longTermDays` — strictly greater. A lot held exactly the
   * threshold is still short-term, and rounding that in the user's favour would
   * show a rate they cannot claim.
   */
  readonly longTermOn: CalendarDate | null;
  /** Days until {@link longTermOn}. Zero once eligible; `null` when it cannot be. */
  readonly daysToLongTerm: number | null;
  readonly isLongTerm: boolean;
}

/**
 * A financial year of lease credits, valued in rupees.
 *
 * Grams credited by a lease are income when they are credited, and the return
 * itself never sees them as a cashflow — treating them as a synthetic dividend
 * plus an immediate repurchase was measured to produce a bit-identical XIRR, so
 * the rate is computed the cheap way and this ledger is the *other* half of the
 * same convention: the rupee figure a rate cannot show and a return filing
 * needs.
 *
 * Valued at the **buy-back rate on the credit date**, not today's rate and not
 * the benchmark: what a credit was worth is what the platform would have paid
 * for it on the day it landed.
 */
export interface GoldLeaseIncomeRow {
  /** `"2025-26"` — the label a filing uses. */
  readonly financialYear: string;
  readonly grams: Quantity;
  /** Zero when `pricedFrom` is `UNPRICED`, which is a gap rather than a valuation. */
  readonly value: Money;
  /**
   * How the credit date was priced.
   *
   * `QUOTE` — a price was published that day. `CARRIED` — the most recent
   * earlier price was used, which is what a weekend or a holiday credit gets.
   * `UNPRICED` — no price existed on or before that day, so the rupee figure is
   * missing rather than estimated, and the screen must say so before anyone
   * files it.
   */
  readonly pricedFrom: "QUOTE" | "CARRIED" | "UNPRICED";
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

  /**
   * The money-weighted return on cash actually paid, at the buy-back rate.
   *
   * A lease credit settles no cash account, so it is **not** a cashflow — it
   * shows up where it belongs, inside the terminal value, as grams that cost
   * nothing. Purchases are negative (`quantity × price + charges`, tax-inclusive),
   * sales positive net of charges, and {@link marketValue} closes the series on
   * {@link asOf}.
   *
   * Returned as the solver's own typed result, never flattened to a number: an
   * undefined rate carries the reason it is undefined, because the alternative —
   * rendering it as 0% — is a claim that the holding broke even.
   */
  readonly xirr: Xirr;
  /**
   * The same series, closed at the value of the **bought grams only**.
   *
   * What the gold price alone earned, with the lease stripped out. It sits below
   * {@link xirr} whenever a lease has credited anything, and the gap between the
   * two is the rent — the annualised twin of the {@link leaseProfit} /
   * {@link priceProfit} split.
   */
  readonly priceXirr: Xirr;
  /**
   * GST paid on purchases, or `null` when it cannot be separated.
   *
   * Today it is always `null`, and that is a statement about the data rather
   * than a missing feature: a trade carries one fused, tax-inclusive `charges`
   * figure, and the mapper that reads it sums every charge column — GST included
   * — back into that single number. Back-solving 3% out of it would invent a
   * split the user never entered, and it would be wrong for anyone whose
   * platform bundles a delivery or storage fee into the same figure.
   * {@link gstPaidReason} says this on the screen instead of showing a
   * confident wrong number.
   */
  readonly gstPaid: Money | null;
  /** Why {@link gstPaid} is blank, when it is. */
  readonly gstPaidReason: string | null;
  /**
   * The buy-back rate at which the holding breaks even on cash paid.
   *
   * `investedCost ÷ totalGrams` — arithmetically the same figure as
   * {@link blendedCostPerGram}, and deliberately a separate field: they answer
   * different questions, and they stop being equal the moment either definition
   * moves. This one is a *target*, the rate a screen draws a line at.
   */
  readonly breakEvenPricePerGram: UnitPrice | null;
  /**
   * The **benchmark** rate that has to print before the buy-back rate reaches
   * break-even.
   *
   * `breakEven ÷ (1 − sellSpread)`. The spread is a cost paid on the way out, so
   * the published rate must clear break-even by that much before a sale actually
   * does. With no spread recorded the two coincide, and the screen is then
   * comparing against a benchmark it already says it is using.
   */
  readonly benchmarkBreakEvenPricePerGram: UnitPrice | null;

  /** Every open lot, oldest first, with its long-term countdown. */
  readonly lotLadder: readonly GoldLotRow[];
  /** Lease credits bucketed by financial year, valued on their credit dates. */
  readonly leaseIncomeByFinancialYear: readonly GoldLeaseIncomeRow[];
  /**
   * The regime's long-term threshold for this instrument's category, in days, or
   * `null` when the category has no long-term treatment at all.
   *
   * Reported so a screen can explain the rule it is applying — "730 days for
   * gold, FY2025-26" — rather than asserting an eligibility date the user has to
   * take on faith.
   */
  readonly taxThresholdDays: number | null;
  /** The category the threshold was looked up under, e.g. `"GOLD"`. */
  readonly taxCategory: string;

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
    /*
     * The long-term threshold is a *statute*, not a constant, and it is looked
     * up rather than written down. Defaulted rather than wired so that the
     * container keeps working unchanged: nothing about this registry is
     * per-user, and the alternative — a literal 730 in a gold file — is a figure
     * that would silently survive the budget that changes it.
     */
    private readonly regimes: RegimeRegistry = new RegimeRegistry(),
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

    /*
     * Every dated price this use case needs, in one query.
     *
     * The chart wants a month-end series and the lease ledger wants the rate on
     * each credit date — both are "what did a gram fetch on day X", and asking
     * that per credit would be an N+1 against a table the history already reads
     * a range of. Discounted once, here, so nothing downstream can forget to.
     */
    const discount = (benchmark: UnitPrice): UnitPrice =>
      platform ? platform.realisablePrice(benchmark) : benchmark;

    const firstTradeOn = trades.reduce(
      (earliest, trade) => (trade.tradedOn.isBefore(earliest) ? trade.tradedOn : earliest),
      trades[0]?.tradedOn ?? input.asOf,
    );
    const quoteSeries =
      trades.length === 0
        ? []
        : (
            await this.quotes.findRange(
              input.instrumentId.value,
              "CLOSE",
              DateRange.of(CalendarDate.min(firstTradeOn, input.asOf), input.asOf),
            )
          )
            .filter((quote) => !quote.supersededBy)
            .map((quote) => ({ on: quote.asOf, price: discount(quote.price) }))
            .sort((a, b) => a.on.compareTo(b.on));

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

    /* ── Money-weighted return ─────────────────────────────────────── */

    /*
     * The flow series, derived from trades rather than from postings.
     *
     * Postings cannot express the buy-back discount — they record what the
     * ledger booked, at the benchmark — and a trade already carries the three
     * things a flow needs: a date, a tax-inclusive amount, and the
     * `settlementAccountId` that says whether cash actually moved. A lease
     * accrual settles nothing and therefore contributes nothing here; its grams
     * arrive in the terminal value, which is where a return that was paid in
     * kind honestly belongs.
     */
    const orderedTrades = [...trades].sort((a, b) => a.tradedOn.compareTo(b.tradedOn));
    const flows: Cashflow[] = [];
    for (const trade of orderedTrades) {
      const gross = trade.quantity.valueAt(trade.pricePerUnit, "HALF_EVEN");
      if (trade.side === "BUY") {
        if (trade.settlementAccountId === null) continue;
        flows.push({
          on: trade.tradedOn,
          amount: gross.plus(trade.charges).negated(),
          note: `Bought ${trade.quantity.toDecimalString()}g`,
        });
      } else {
        flows.push({
          on: trade.tradedOn,
          amount: gross.minus(trade.charges),
          note: `Sold ${trade.quantity.toDecimalString()}g`,
        });
      }
    }

    /*
     * The closing flow is a *synthetic* inflow: nothing was sold, and this is
     * what selling would have paid. Left off entirely when there is no price —
     * the solver then says why it cannot answer, which is better than closing
     * the series at a zero the holding is not worth.
     */
    const closedAt = (terminal: Money | null, note: string): Xirr =>
      xirr(terminal ? [...flows, { on: input.asOf, amount: terminal, note }] : flows);

    const priceOnlyValue = pricePerGram ? pricePerGram.times(purchasedGrams) : null;

    /* ── Lot ladder ────────────────────────────────────────────────── */

    /*
     * `taxThresholdDays` of `null` covers two cases that a screen must not
     * conflate with "not yet eligible": a category with no long-term treatment
     * at any holding period, and — via the throw below — a date no shipped
     * regime covers. Both mean "we cannot state an eligibility date", and both
     * render as a blank rather than a countdown.
     */
    const taxCategory: TaxCategory = instrument.taxProfile().category;
    let taxThresholdDays: number | null = null;
    try {
      taxThresholdDays = this.regimes.forDate(input.asOf).longTermDaysFor(taxCategory);
    } catch {
      taxThresholdDays = null;
    }

    const lotLadder: GoldLotRow[] = [...openLots]
      .sort(
        (a, b) => a.acquiredOn.compareTo(b.acquiredOn) || a.id.value.localeCompare(b.id.value),
      )
      .map((lot) => {
        const fromLease = isLeaseLot(lot);
        // Cash, not book: a lease lot was booked at a basis but bought with none.
        const cash = fromLease ? zero : lot.remainingCost.plus(lot.remainingCharges);
        const value = pricePerGram ? pricePerGram.times(lot.remaining) : null;
        const holdingDays = lot.acquiredOn.daysUntil(input.asOf);
        /*
         * `+ 1` because the regime classifies on `holdingDays > longTermDays`,
         * strictly greater — day 730 is still short-term for gold, and the first
         * long-term day is 731.
         */
        const longTermOn =
          taxThresholdDays === null ? null : lot.acquiredOn.plusDays(taxThresholdDays + 1);
        return {
          lotId: lot.id.value,
          acquiredOn: lot.acquiredOn,
          grams: lot.remaining,
          costPerGram:
            fromLease || !lot.remaining.isPositive
              ? null
              : UnitPrice.fromMoney(lot.remaining.perUnit(cash, "HALF_EVEN")),
          investedCost: cash,
          marketValue: value,
          unrealised: value ? value.minus(cash) : null,
          origin: fromLease ? ("LEASE_CREDIT" as const) : ("PURCHASE" as const),
          holdingDays,
          longTermOn,
          daysToLongTerm:
            longTermOn === null ? null : Math.max(0, input.asOf.daysUntil(longTermOn)),
          isLongTerm: taxThresholdDays !== null && holdingDays > taxThresholdDays,
        };
      });

    /* ── Lease income, by financial year ───────────────────────────── */

    /*
     * The rupee ledger the rate deliberately does not contain. Each credit is
     * valued at the buy-back rate published on or before its own date, then
     * bucketed by the financial year that date falls in — so a credit on 31
     * March and one on 1 April land in different years, which is the whole
     * reason this is bucketed by `FinancialYear` and not by calendar year.
     */
    const priceAsOf = (on: CalendarDate): { price: UnitPrice | null; exact: boolean } => {
      let found: { on: CalendarDate; price: UnitPrice } | null = null;
      for (const quote of quoteSeries) {
        if (!quote.on.isOnOrBefore(on)) break;
        found = quote;
      }
      return { price: found?.price ?? null, exact: found !== null && found.on.compareTo(on) === 0 };
    };

    const byYear = new Map<
      string,
      { grams: Quantity; value: Money; pricedFrom: GoldLeaseIncomeRow["pricedFrom"] }
    >();
    for (const trade of orderedTrades) {
      if (trade.side !== "BUY" || trade.settlementAccountId !== null) continue;
      const label = FinancialYear.containing(trade.tradedOn).label;
      const { price, exact } = priceAsOf(trade.tradedOn);
      const priced: GoldLeaseIncomeRow["pricedFrom"] =
        price === null ? "UNPRICED" : exact ? "QUOTE" : "CARRIED";
      const existing = byYear.get(label) ?? { grams: Quantity.ZERO, value: zero, pricedFrom: "QUOTE" as const };
      byYear.set(label, {
        grams: existing.grams.plus(trade.quantity),
        value: existing.value.plus(price ? price.times(trade.quantity) : zero),
        /*
         * The worst provenance in the year wins. A year whose total is missing
         * one credit is not a "quoted" year, and a filing figure that hides a
         * gap inside a confident total is the failure this flag exists for.
         */
        pricedFrom:
          existing.pricedFrom === "UNPRICED" || priced === "UNPRICED"
            ? "UNPRICED"
            : existing.pricedFrom === "CARRIED" || priced === "CARRIED"
              ? "CARRIED"
              : "QUOTE",
      });
    }
    const leaseIncomeByFinancialYear: GoldLeaseIncomeRow[] = [...byYear.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([financialYear, row]) => ({ financialYear, ...row }));

    /* ── Break-even ────────────────────────────────────────────────── */

    // Rounded `UP`: a break-even that rounded down would name a rate at which
    // the sale is a paisa short, which is the one direction this must not err.
    const breakEvenPricePerGram = totalGrams.isPositive
      ? UnitPrice.fromMoney(totalGrams.perUnit(investedCost, "UP"))
      : null;
    /*
     * Grossed back up through the spread: the platform pays `(1 − spread)` of
     * whatever the benchmark prints, so the benchmark has to reach
     * `breakEven ÷ (1 − spread)` before a sale clears cash paid. A 100% spread
     * would be a platform that pays nothing, and no benchmark clears that — the
     * constructor of `Institution` rejects more than 100%, and this guards the
     * boundary rather than dividing by zero.
     */
    const hundredPercent = BigInt(Percentage.of("100").toScaledNumber());
    const remainingShare = hundredPercent - BigInt(sellSpread.toScaledNumber());
    /*
     * Rounded **up**, and it has to be: `realisablePrice` truncates on the way
     * back down, so a benchmark rounded down would discount to a paisa *below*
     * break-even — a target that misses by construction. Ceiling here means
     * discounting this figure by the spread always lands on or above break-even,
     * which is the only property this number has to have.
     */
    const benchmarkBreakEvenPricePerGram =
      breakEvenPricePerGram && remainingShare > 0n
        ? UnitPrice.fromScaled(
            (breakEvenPricePerGram.scaled * hundredPercent + remainingShare - 1n) / remainingShare,
            currency,
          )
        : null;

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

      xirr: closedAt(marketValue, "Holding valued at the buy-back rate"),
      priceXirr: closedAt(priceOnlyValue, "Bought grams valued at the buy-back rate"),

      gstPaid: null,
      gstPaidReason:
        `A trade records one tax-inclusive charges figure, so the GST inside it cannot be ` +
        `separated from brokerage, delivery or storage fees. Rather than back-solving a 3% ` +
        `share that would be wrong for anyone whose platform bundles other costs into the ` +
        `same line, it is left blank — the tax is inside ${investedCost.toDecimalString()} ` +
        `of cash paid, and every figure here is already net of it.`,

      breakEvenPricePerGram,
      benchmarkBreakEvenPricePerGram,
      lotLadder,
      leaseIncomeByFinancialYear,
      taxThresholdDays,
      taxCategory,

      history: await this.buildHistory(input, trades, leaseTxnIds, zero, quoteSeries),
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
    /** Already discounted to the buy-back rate, ascending, by `execute`. */
    quoteSeries: readonly { on: CalendarDate; price: UnitPrice }[],
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

    /*
     * The last published price in each month. A month with no quote inherits the
     * previous month's, because gold did not stop existing — but a month before
     * the very first quote stays `null`, which is the honest "we do not know".
     */
    const monthEndPrice = new Map<string, UnitPrice>();
    for (const quote of quoteSeries) {
      monthEndPrice.set(quote.on.toMonthKey(), quote.price);
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

/**
 * Investing use cases: trades, lots, corporate actions, valuation, returns.
 *
 * The slice the class design exists for, and the one place where every hierarchy
 * meets: a `Sell` asks a `LotBook` for disposals, the disposals become
 * `TaxableEvent`s the tax engine reads without knowing what an instrument is, the
 * position is valued through the `PriceBook`, and the same postings feed XIRR.
 *
 * Two rules hold throughout:
 *
 *   - **A trade is a ledger transaction first.** Lots are derived from it, not the
 *     other way round, so a portfolio can always be rebuilt from the journal — and
 *     a lot table that drifts is detectable rather than authoritative.
 *   - **A missing price is never zero.** A position with no quote reports no
 *     value, the holding is named, and the portfolio total is `null` rather than
 *     quietly light.
 */

import { AppError, Clock, Err, NotFoundError, Ok, Result, UseCase, UserId, ValidationError, newUuid } from "@/core/kernel";
import { Currency, Money } from "@/core/money";
import { Percentage, Quantity, Rate, UnitPrice } from "@/core/numeric";
import { CalendarDate, DateRange, FinancialYear } from "@/core/time";
import { Account, AccountCode, AccountId, AccountRepository, SystemAccountCodes } from "@/domain/accounts";
import {
  InstrumentId,
  InstrumentKind,
  InstrumentRepository,
  MarketInstrument,
  PriceLookup,
} from "@/domain/instruments";
import {
  Disposal,
  Lot,
  LotBook,
  LotId,
  LotRepository,
  LotSelectionMethod,
  strategyFor,
} from "@/domain/lots";
import {
  CorporateAction,
  CorporateActionRepository,
  applyAction,
} from "@/domain/corporate";
import {
  Cashflow,
  PortfolioSummary,
  PositionSummary,
  Xirr,
  summarise,
  xirr,
} from "@/domain/portfolio";
import {
  Decision,
  ExecutionVenue,
  OrderIntent,
  RiskContext,
  RiskGate,
  VenueAck,
} from "@/domain/risk";
import { Buy, Sell, Transaction, TransactionRepository, accountRef } from "@/domain/transactions";
import { OpenAccount } from "@/app/ledger.usecases";

/* ═══ Adding an instrument ════════════════════════════════════════════ */

export interface AddInstrumentInput {
  userId: UserId;
  symbol: string;
  name: string;
  kind: InstrumentKind;
  isin?: string | null;
  exchange?: string | null;
  quoteRef?: string | null;
  currency?: Currency;
  /**
   * The leaf's own facts — an option's strike and expiry, an ETF's underlying.
   *
   * Passed straight through to the constructor, which validates it against that
   * leaf's Zod schema. A bad blob fails here, at registration, rather than on the
   * first screen that reads a strike.
   */
  metadata?: unknown;
}

/**
 * Registers an instrument and its holding account.
 *
 * Every instrument gets its **own asset account** under `Assets:Investments`, which
 * is what keeps the portfolio and the ledger from being two systems: a holding's
 * value is an account balance, so net worth cannot disagree with the portfolio
 * screen. v1 kept holdings in one collection and the ledger in another, and the
 * two drifted within a month.
 */
export class AddInstrument
  implements UseCase<AddInstrumentInput, { instrumentId: InstrumentId; accountId: AccountId }>
{
  constructor(
    private readonly accounts: AccountRepository,
    private readonly instruments: InstrumentRepository,
    private readonly openAccount: OpenAccount,
  ) {}

  async execute(
    input: AddInstrumentInput,
  ): Promise<Result<{ instrumentId: InstrumentId; accountId: AccountId }, AppError>> {
    const existing = await this.instruments.findBySymbol(input.userId, input.symbol);
    if (existing) {
      return Ok({ instrumentId: existing.id, accountId: existing.assetAccountId });
    }

    const parent = await this.accounts.findByCode(
      input.userId,
      AccountCode.parse(SystemAccountCodes.investments),
    );
    if (!parent) {
      return Err(
        new NotFoundError(`System account "${SystemAccountCodes.investments}" — seed the chart first`),
      );
    }

    const opened = await this.openAccount.execute({
      userId: input.userId,
      name: input.name,
      type: "ASSET",
      subtype: "BROKERAGE",
      parentId: parent.id,
      currency: input.currency,
    });
    if (!opened.ok) return opened;

    const instrumentId = InstrumentId.from(newUuid());
    await this.instruments.save(input.userId, input.kind, {
      id: instrumentId,
      userId: input.userId,
      symbol: input.symbol,
      name: input.name,
      currency: input.currency ?? Currency.reporting,
      isin: input.isin ?? null,
      exchange: input.exchange ?? null,
      quoteRef: input.quoteRef ?? null,
      assetAccountId: opened.value.accountId,
      metadata: input.metadata,
    });

    return Ok({ instrumentId, accountId: opened.value.accountId });
  }
}

/* ═══ Placing an order ════════════════════════════════════════════════ */

export interface PlaceOrderInput {
  userId: UserId;
  intent: OrderIntent;
  context: RiskContext;
}

export interface PlaceOrderOutput {
  readonly decision: Decision;
  /** `null` when the gate refused; the ack otherwise. */
  readonly ack: VenueAck | null;
}

/**
 * The order path: the gate, then the venue, and nothing in between.
 *
 * The use case cannot skip the gate — not by discipline but by types. `place`
 * takes an `ApprovedOrder`, and the only way to hold one is the value
 * `RiskGate.approve` returns. Deleting the gate call here does not compile.
 *
 * The venue is injected, which is the whole of the "backtest seam": a simulated
 * venue in a test and in a backtest, a broker adapter in production, and this
 * file unchanged between them. No broker adapter exists in the tree yet, and
 * adding one changes the container, not this class.
 *
 * It records nothing in the ledger on purpose. A *fill* is what becomes a `Buy`
 * or a `Sell`, and a fill is confirmed asynchronously by the venue — writing a
 * trade at placement time is how a rejected order becomes a phantom holding.
 */
export class PlaceOrder implements UseCase<PlaceOrderInput, PlaceOrderOutput> {
  constructor(
    private readonly gate: RiskGate,
    private readonly venue: ExecutionVenue,
  ) {}

  async execute(input: PlaceOrderInput): Promise<Result<PlaceOrderOutput, AppError>> {
    const approval = this.gate.approve(input.intent, input.context);
    if (!approval.ok) {
      // A refusal is a result, not an error: the user asked a reasonable question
      // and the answer is "no, because ..." — with every check's reason attached.
      return Ok({ decision: approval.decision, ack: null });
    }

    const ack = await this.venue.place(approval.order);
    return Ok({ decision: approval.order.decision, ack });
  }
}

/* ═══ Buying ══════════════════════════════════════════════════════════ */

export interface RecordBuyInput {
  userId: UserId;
  instrumentId: InstrumentId;
  /** Where the cash came from. */
  fromAccountId: AccountId;
  quantity: Quantity;
  pricePerUnit: Money;
  tradedOn: CalendarDate;
  charges?: Money;
  /** Charges are capitalised into the basis by default — §5.3. */
  chargeTreatment?: "CAPITALISE" | "EXPENSE";
  narration?: string;
}

export interface RecordBuyOutput {
  transactionId: string;
  lotId: string;
  costBasis: Money;
  cashPaid: Money;
}

/**
 * Records a purchase: a `Buy` transaction and the lot it opens.
 *
 * The lot's cost is the transaction's own `costBasis`, read off the aggregate
 * rather than recomputed — two places computing "what did this cost" is two places
 * that can disagree, and the aggregate is the one whose postings have to balance.
 */
export class RecordBuy implements UseCase<RecordBuyInput, RecordBuyOutput> {
  constructor(
    private readonly accounts: AccountRepository,
    private readonly instruments: InstrumentRepository,
    private readonly journal: TransactionRepository,
    private readonly lots: LotRepository,
  ) {}

  async execute(input: RecordBuyInput): Promise<Result<RecordBuyOutput, AppError>> {
    if (!input.quantity.isPositive) {
      return Err(new ValidationError("A purchase needs a positive quantity."));
    }

    const instrument = await this.instruments.findById(input.userId, input.instrumentId);
    if (!instrument) return Err(new NotFoundError("Instrument", input.instrumentId.value));

    const [holding, funding, chargeAccount] = await Promise.all([
      this.accounts.findById(input.userId, instrument.assetAccountId),
      this.accounts.findById(input.userId, input.fromAccountId),
      this.accounts.findByCode(input.userId, AccountCode.parse(SystemAccountCodes.investingCharges)),
    ]);
    if (!holding) return Err(new NotFoundError("Holding account", instrument.assetAccountId.value));
    if (!funding) return Err(new NotFoundError("Funding account", input.fromAccountId.value));

    const consideration = input.quantity.valueAt(input.pricePerUnit, "HALF_UP");
    const charges = input.charges ?? Money.zero(instrument.currency);

    const buy = Buy.record(
      {
        userId: input.userId,
        txnDate: input.tradedOn,
        description:
          input.narration ??
          `Bought ${instrument.formatQuantity(input.quantity)} of ${instrument.symbol}`,
        source: accountRef(funding),
        destination: accountRef(holding),
      },
      {
        instrumentId: instrument.id.value,
        quantity: input.quantity,
        consideration,
        charges,
        chargeTreatment: input.chargeTreatment ?? "CAPITALISE",
        chargeAccount: chargeAccount ? accountRef(chargeAccount) : null,
        holding: accountRef(holding),
      },
    );

    await this.journal.save(buy);

    // The broker-level record first: the lot references it, and a lot whose trade
    // row is missing is a lot that cannot be traced to what the broker did.
    await this.lots.recordTrade(input.userId, {
      id: buy.id.value,
      instrumentId: instrument.id,
      side: "BUY",
      tradedOn: input.tradedOn,
      quantity: input.quantity,
      pricePerUnit: input.pricePerUnit,
      charges,
      transactionId: buy.id.value,
      settlementAccountId: funding.id.value,
    });

    const lot = Lot.open({
      instrumentId: instrument.id,
      acquiredOn: input.tradedOn,
      originalQuantity: input.quantity,
      // The basis the transaction computed, not a second calculation of it.
      cost: buy.costBasis.minus(input.chargeTreatment === "EXPENSE" ? Money.zero(instrument.currency) : charges),
      buyCharges: input.chargeTreatment === "EXPENSE" ? Money.zero(instrument.currency) : charges,
      openedByTransactionId: buy.id.value,
    });
    await this.lots.saveLots(input.userId, [lot]);

    return Ok({
      transactionId: buy.id.value,
      lotId: lot.id.value,
      costBasis: buy.costBasis,
      cashPaid: buy.cashPaid,
    });
  }
}

/* ═══ Selling ═════════════════════════════════════════════════════════ */

export interface RecordSellInput {
  userId: UserId;
  instrumentId: InstrumentId;
  /** Where the proceeds land. */
  toAccountId: AccountId;
  quantity: Quantity;
  pricePerUnit: Money;
  tradedOn: CalendarDate;
  charges?: Money;
  /** Only the part deductible against the gain — STT is not. */
  deductibleCharges?: Money;
  /** Overrides the account's default method for this disposal. */
  method?: LotSelectionMethod;
  nominatedLotIds?: readonly string[];
  narration?: string;
}

export interface RecordSellOutput {
  transactionId: string;
  disposals: readonly Disposal[];
  proceeds: Money;
  realisedGain: Money;
  /** Units the position could not cover — a short, which most accounts forbid. */
  unmatchedQuantity: Quantity;
}

/**
 * Records a sale: consumes lots, books the transaction, writes the disposals.
 *
 * The order matters and is deliberate. Lots are selected **before** the
 * transaction is built, because `Sell` needs the disposals to compute the gain leg
 * that makes it balance — a gain that is derived from the postings cannot disagree
 * with them, which was the whole argument for double entry here.
 *
 * A lock-in is checked first and refuses the sale outright: an ELSS redemption
 * inside three years is not a tax question, it is an instruction the registrar
 * will not carry out.
 */
export class RecordSell implements UseCase<RecordSellInput, RecordSellOutput> {
  constructor(
    private readonly accounts: AccountRepository,
    private readonly instruments: InstrumentRepository,
    private readonly journal: TransactionRepository,
    private readonly lots: LotRepository,
    private readonly defaultMethod: LotSelectionMethod = "FIFO",
  ) {}

  async execute(input: RecordSellInput): Promise<Result<RecordSellOutput, AppError>> {
    if (!input.quantity.isPositive) {
      return Err(new ValidationError("A sale needs a positive quantity."));
    }

    const instrument = await this.instruments.findById(input.userId, input.instrumentId);
    if (!instrument) return Err(new NotFoundError("Instrument", input.instrumentId.value));

    const [holding, destination, chargeAccount, gainAccount] = await Promise.all([
      this.accounts.findById(input.userId, instrument.assetAccountId),
      this.accounts.findById(input.userId, input.toAccountId),
      this.accounts.findByCode(input.userId, AccountCode.parse(SystemAccountCodes.investingCharges)),
      this.accounts.findByCode(input.userId, AccountCode.parse("Income:Investing")),
    ]);
    if (!holding) return Err(new NotFoundError("Holding account", instrument.assetAccountId.value));
    if (!destination) return Err(new NotFoundError("Destination account", input.toAccountId.value));
    if (!gainAccount) return Err(new NotFoundError('System account "Income:Investing"'));

    const openLots = await this.lots.openLots(input.userId, instrument.id);
    if (openLots.length === 0) {
      return Err(
        new ValidationError(`There are no units of ${instrument.symbol} to sell.`),
      );
    }

    // The lock-in check, before anything is booked.
    for (const lot of openLots) {
      const blocked = instrument.disposalBlockedOn(lot.acquiredOn, input.tradedOn);
      if (blocked && lot.remaining.isGreaterThan(Quantity.ZERO)) {
        const unlocked = openLots.filter(
          (candidate) => instrument.disposalBlockedOn(candidate.acquiredOn, input.tradedOn) === null,
        );
        const available = Quantity.sum(unlocked.map((candidate) => candidate.remaining));
        if (input.quantity.isGreaterThan(available)) {
          return Err(new ValidationError(blocked, { quantity: ["Locked in"] }));
        }
      }
    }

    const proceeds = input.quantity.valueAt(input.pricePerUnit, "HALF_UP");
    const charges = input.charges ?? Money.zero(instrument.currency);
    const deductible = input.deductibleCharges ?? charges;

    const book = new LotBook(strategyFor(input.method ?? this.defaultMethod), instrument.currency);
    const result = book.apply(openLots, {
      instrumentId: instrument.id,
      quantity: input.quantity,
      disposedOn: input.tradedOn,
      proceeds,
      sellCharges: charges,
      deductibleSellCharges: deductible,
      nominatedLotIds: input.nominatedLotIds?.map((id) => LotId.from(id)),
    });

    if (result.unmatchedQuantity.isPositive) {
      return Err(
        new ValidationError(
          `Only ${input.quantity.minus(result.unmatchedQuantity).toDecimalString()} units of ` +
            `${instrument.symbol} are held; the sale asks for ${input.quantity.toDecimalString()}. ` +
            `Short selling is not supported (P04).`,
        ),
      );
    }

    const sell = Sell.record(
      {
        userId: input.userId,
        txnDate: input.tradedOn,
        description:
          input.narration ??
          `Sold ${instrument.formatQuantity(input.quantity)} of ${instrument.symbol}`,
        source: accountRef(holding),
        destination: accountRef(destination),
      },
      {
        instrumentId: instrument.id.value,
        disposals: result.disposals.map((disposal) => ({
          lotId: disposal.lotId?.value ?? "average-cost",
          quantity: disposal.quantity,
          /*
           * Cost **plus the buy charges attributed to these units**.
           *
           * The lot keeps the two apart because they are reported differently, but
           * the holding account was debited with both when the charge was
           * capitalised — so crediting only the price on the way out would leave
           * the charges stranded in the account forever, and a fully liquidated
           * position would never return to zero.
           */
          costBasis: disposal.costBasis.plus(disposal.buyCharges),
          acquiredOn: disposal.acquiredOn,
        })),
        proceeds,
        charges,
        deductibleCharges: deductible,
        chargeAccount: chargeAccount ? accountRef(chargeAccount) : null,
        holding: accountRef(holding),
        gainAccount: accountRef(gainAccount),
        taxCategory: instrument.taxProfile().category,
      },
    );

    await this.journal.save(sell);
    await this.lots.recordTrade(input.userId, {
      id: sell.id.value,
      instrumentId: instrument.id,
      side: "SELL",
      tradedOn: input.tradedOn,
      quantity: input.quantity,
      pricePerUnit: input.pricePerUnit,
      charges,
      transactionId: sell.id.value,
      settlementAccountId: destination.id.value,
    });
    await this.lots.saveLots(input.userId, result.lots);
    await this.lots.saveDisposals(input.userId, sell.id.value, result.disposals);

    return Ok({
      transactionId: sell.id.value,
      disposals: result.disposals,
      proceeds,
      realisedGain: result.totalGain,
      unmatchedQuantity: result.unmatchedQuantity,
    });
  }
}

/** What each method would realise, so a seller can choose with the numbers in view. */
export class CompareDisposalMethods
  implements UseCase<
    { userId: UserId; instrumentId: InstrumentId; quantity: Quantity; pricePerUnit: Money; tradedOn: CalendarDate },
    { comparison: readonly { method: LotSelectionMethod; gain: Money; costBasis: Money }[] }
  >
{
  constructor(
    private readonly instruments: InstrumentRepository,
    private readonly lots: LotRepository,
  ) {}

  async execute(input: {
    userId: UserId;
    instrumentId: InstrumentId;
    quantity: Quantity;
    pricePerUnit: Money;
    tradedOn: CalendarDate;
  }) {
    const instrument = await this.instruments.findById(input.userId, input.instrumentId);
    if (!instrument) return Err(new NotFoundError("Instrument", input.instrumentId.value));
    const openLots = await this.lots.openLots(input.userId, instrument.id);

    return Ok({
      comparison: LotBook.compare(
        openLots,
        {
          instrumentId: instrument.id,
          quantity: input.quantity,
          disposedOn: input.tradedOn,
          proceeds: input.quantity.valueAt(input.pricePerUnit, "HALF_UP"),
          sellCharges: Money.zero(instrument.currency),
        },
        instrument.currency,
      ),
    });
  }
}

/* ═══ Valuation ═══════════════════════════════════════════════════════ */

export interface ValuePortfolioInput {
  userId: UserId;
  asOf: CalendarDate;
}

export interface ValuedPosition extends PositionSummary {
  readonly instrument: MarketInstrument;
  readonly instrumentId: InstrumentId;
  readonly averageCostPerUnit: Money | null;
  readonly pricedOn: CalendarDate | null;
  readonly unpricedReason: string | null;
}

export interface ValuePortfolioOutput extends PortfolioSummary {
  readonly valued: readonly ValuedPosition[];
}

/**
 * Values every position through the price ladder.
 *
 * Staleness is carried all the way to the caller rather than being resolved here,
 * because "this price is four days old" is a fact the user must see: a portfolio
 * that silently uses last Tuesday's close during a market holiday is right, and
 * one that does it during an outage is not, and only the user knows which.
 */
export class ValuePortfolio implements UseCase<ValuePortfolioInput, ValuePortfolioOutput> {
  constructor(
    private readonly instruments: InstrumentRepository,
    private readonly lots: LotRepository,
    private readonly prices: PriceLookup,
  ) {}

  async execute(input: ValuePortfolioInput): Promise<Result<ValuePortfolioOutput, AppError>> {
    const held = await this.instruments.list(input.userId, { includeClosed: false });

    const valued = await Promise.all(
      held.map(async (instrument): Promise<ValuedPosition> => {
        const all = await this.lots.allLots(input.userId, instrument.id);
        const open = all.filter((lot) => !lot.isExhausted);
        const position = LotBook.openPosition(open, instrument.currency);
        const valuation = await instrument.valueOn(position.quantity, input.asOf, this.prices);

        const realised = await this.lots.disposalsWithin(
          input.userId,
          CalendarDate.parse("1900-01-01"),
          input.asOf,
        );
        const realisedForThis = realised.filter((disposal) =>
          disposal.instrumentId.equals(instrument.id),
        );

        return {
          instrument,
          instrumentId: instrument.id,
          label: instrument.symbol,
          quantity: position.quantity,
          costBasis: position.cost.plus(position.charges),
          marketValue: valuation.value,
          realisedGain: Money.total(
            realisedForThis.map((disposal) => disposal.gain),
            instrument.currency,
          ),
          income: Money.zero(instrument.currency),
          isStale: valuation.isStale,
          averageCostPerUnit: position.averageCostPerUnit,
          pricedOn: valuation.pricedOn,
          unpricedReason: valuation.unpricedReason,
        };
      }),
    );

    const withHoldings = valued.filter((position) => !position.quantity.isZero);
    return Ok({ ...summarise(withHoldings), valued: withHoldings });
  }
}

/* ═══ Returns ═════════════════════════════════════════════════════════ */

export interface PortfolioReturnsInput {
  userId: UserId;
  asOf: CalendarDate;
  /** Restrict to one instrument, for a drill-down. */
  instrumentId?: InstrumentId;
}

export interface PortfolioReturnsOutput {
  readonly xirr: Xirr;
  /** Every rupee that went in, gross. */
  readonly invested: Money;
  /** Every rupee that came back out — sale proceeds, dividends, coupons. */
  readonly withdrawn: Money;
  readonly currentValue: Money | null;
  /**
   * `(market value + withdrawn − invested) / invested`, per §4.3.
   *
   * `withdrawn` is in the numerator deliberately: a portfolio that sold half its
   * holdings at a profit has less market value than money invested, and a return
   * that ignored the proceeds would report that profit as a loss.
   */
  readonly absoluteReturn: Percentage | null;
  readonly flows: readonly Cashflow[];
}

/**
 * Money-weighted return over the actual cashflows the ledger holds.
 *
 * The flows come from the transactions' own `cashflows()` hook — the fourth of the
 * four polymorphic questions — so a new transaction type contributes to returns
 * without this use case being told about it. The closing market value is appended
 * as a synthetic inflow, which is what makes an open position's XIRR meaningful.
 */
export class PortfolioReturns implements UseCase<PortfolioReturnsInput, PortfolioReturnsOutput> {
  constructor(
    private readonly accounts: AccountRepository,
    private readonly instruments: InstrumentRepository,
    private readonly journal: TransactionRepository,
    private readonly valuePortfolio: ValuePortfolio,
  ) {}

  async execute(input: PortfolioReturnsInput): Promise<Result<PortfolioReturnsOutput, AppError>> {
    const held = await this.instruments.list(input.userId, { includeClosed: true });
    const wanted = input.instrumentId
      ? held.filter((instrument) => instrument.id.equals(input.instrumentId!))
      : held;
    if (wanted.length === 0) {
      return Err(new ValidationError("There are no instruments to compute a return for."));
    }

    const accountIds = wanted.map((instrument) => instrument.assetAccountId);
    const page = await this.journal.find(input.userId, {
      accountIds,
      range: DateRange.of(CalendarDate.parse("1900-01-01"), input.asOf),
      limit: 20_000,
    });

    /*
     * The flows come from the **postings**, not from `Transaction.cashflows()`.
     *
     * That is a concession to a Phase 1 decision and worth naming rather than
     * working around silently: a transaction read back from the database rehydrates
     * as `StoredTransaction`, which deliberately does not pretend to be the
     * subclass that wrote it — a `Sell` needs the lots it consumed, and inventing
     * them would invent a cost basis. The consequence is that the fourth
     * polymorphic hook, `cashflows()`, is unavailable after a round trip.
     *
     * The postings can answer the same question without guessing. For a trade, the
     * cash leg is the posting on an account *outside* the holding set: a credit to
     * a bank account is money leaving the investor (negative), a debit is money
     * arriving. That is the sign convention `Cashflow` documents, derived from the
     * ledger rather than from a lost type.
     */
    const holdingIds = new Set(accountIds.map((id) => id.value));
    const allAccounts = await this.accounts.list(input.userId, { includeClosed: true });
    const typeById = new Map(allAccounts.map((account) => [account.id.value, account.type]));

    const flows: Cashflow[] = [];
    let invested = Money.zero(Currency.reporting);
    let withdrawn = Money.zero(Currency.reporting);
    for (const txn of page.transactions) {
      if (txn.txnDate.isAfter(input.asOf)) continue;
      for (const posting of txn.postings()) {
        if (holdingIds.has(posting.accountId.value)) continue;
        const type = typeById.get(posting.accountId.value);
        if (!type?.isBalanceSheet) continue;

        const amount = posting.isDebit ? posting.amount : posting.amount.negated();
        flows.push({ on: txn.txnDate, amount, note: txn.description });
        if (amount.isNegative) invested = invested.plus(amount.negated());
        else withdrawn = withdrawn.plus(amount);
      }
    }

    const valuation = await this.valuePortfolio.execute({ userId: input.userId, asOf: input.asOf });
    if (!valuation.ok) return valuation;

    const relevant = input.instrumentId
      ? valuation.value.valued.filter((position) => position.instrumentId.equals(input.instrumentId!))
      : valuation.value.valued;
    const anyUnpriced = relevant.some((position) => position.marketValue === null);
    const currentValue = anyUnpriced
      ? null
      : Money.total(relevant.map((position) => position.marketValue!));

    if (currentValue && currentValue.isPositive) {
      flows.push({ on: input.asOf, amount: currentValue, note: "Closing market value" });
    }

    return Ok({
      xirr: xirr(flows),
      invested,
      withdrawn,
      currentValue,
      absoluteReturn:
        currentValue && !invested.isZero
          ? Percentage.ratio(currentValue.plus(withdrawn).minus(invested), invested)
          : null,
      flows,
    });
  }
}

/* ═══ Corporate actions ═══════════════════════════════════════════════ */

export interface ApplyCorporateActionInput {
  userId: UserId;
  action: CorporateAction;
  /** Where cash lands or comes from, when the action moves any. */
  cashAccountId?: AccountId;
}

export interface ApplyCorporateActionOutput {
  lotsAfter: number;
  quantityAfter: Quantity;
  cashMoved: Money;
  transactionIds: readonly string[];
}

/**
 * Applies a corporate action to a position.
 *
 * The lots are rewritten from the action's own effects, and any cash is booked as
 * an ordinary transaction — so a dividend appears in the register beside every
 * other receipt, and a wrongly-applied split can be undone by applying its
 * inverse. Nothing here edits a lot in place without a record of why.
 */
export class ApplyCorporateAction
  implements UseCase<ApplyCorporateActionInput, ApplyCorporateActionOutput>
{
  constructor(
    private readonly accounts: AccountRepository,
    private readonly instruments: InstrumentRepository,
    private readonly lots: LotRepository,
    private readonly actions: CorporateActionRepository,
    private readonly clock: Clock,
  ) {}

  async execute(
    input: ApplyCorporateActionInput,
  ): Promise<Result<ApplyCorporateActionOutput, AppError>> {
    const instrumentId = input.action.context.instrumentId;
    const instrument = await this.instruments.findById(input.userId, instrumentId);
    if (!instrument) return Err(new NotFoundError("Instrument", instrumentId.value));

    const openLots = await this.lots.openLots(input.userId, instrumentId);
    const application = applyAction(input.action, openLots);
    await this.lots.saveLots(input.userId, application.lotsAfter);

    const cashMoved = Money.total(
      application.cashEffects.map((effect) =>
        effect.direction === "IN" ? effect.amount : effect.amount.negated(),
      ),
      instrument.currency,
    );

    await this.actions.save({
      id: newUuid(),
      kind: input.action.kind,
      instrumentId,
      exDate: input.action.context.exDate,
      recordDate: input.action.context.recordDate ?? null,
      terms: {
        source: input.action.context.source ?? "MANUAL",
        ratioFrom: "",
        ratioTo: "",
        cash: cashMoved.isZero ? "" : cashMoved.abs().toDecimalString(),
        targetInstrumentId: "",
      },
      transactionId: null,
      appliedAt: this.clock.now(),
    });

    return Ok({
      lotsAfter: application.lotsAfter.filter((lot) => !lot.isExhausted).length,
      quantityAfter: LotBook.openQuantity(application.lotsAfter),
      cashMoved,
      transactionIds: [],
    });
  }
}

/* ═══ Realised gains, for tax ═════════════════════════════════════════ */

export interface RealisedGainsInput {
  userId: UserId;
  financialYear: FinancialYear;
}

export interface RealisedGainsOutput {
  readonly disposals: readonly Disposal[];
  readonly shortTerm: Money;
  readonly longTerm: Money;
  readonly total: Money;
}

/**
 * Realised gains for a financial year, split by holding period.
 *
 * The split uses each disposal's **stored** holding days rather than recomputing
 * from today's rules: a change to the long-term threshold must not rewrite last
 * year's tax return, which is the same reason `lot_matches` stores the tier.
 */
export class RealisedGains implements UseCase<RealisedGainsInput, RealisedGainsOutput> {
  constructor(private readonly lots: LotRepository) {}

  async execute(input: RealisedGainsInput): Promise<Result<RealisedGainsOutput, AppError>> {
    const disposals = await this.lots.disposalsWithin(
      input.userId,
      input.financialYear.start,
      input.financialYear.end,
    );

    const shortTerm = Money.total(
      disposals.filter((disposal) => disposal.holdingDays < 365).map((disposal) => disposal.gain),
    );
    const longTerm = Money.total(
      disposals.filter((disposal) => disposal.holdingDays >= 365).map((disposal) => disposal.gain),
    );

    return Ok({ disposals, shortTerm, longTerm, total: shortTerm.plus(longTerm) });
  }
}

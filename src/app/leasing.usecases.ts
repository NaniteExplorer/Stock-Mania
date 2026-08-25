/**
 * Gold-lease use cases: open a lease, book what it has earned, settle it.
 *
 * The interesting one is {@link AccrueLeaseInterest}, and what makes it
 * interesting is that it books **grams into the ledger**. Three things happen at
 * once and all three have to be true together, or the portfolio and the ledger
 * part company:
 *
 *   1. Income is recognised on the **gross** grams, valued at the price on the
 *      accrual date — that is what the platform reports and what the return
 *      declares.
 *   2. The holding gains only the **net** grams; the withheld gold never arrives.
 *   3. Those net grams open a **lot at the value they were taxed at**, so a later
 *      sale computes a real gain instead of taxing the same gold twice.
 *
 * It is idempotent by construction. The lease records how many grams have already
 * been credited, so a second run on the same day books nothing and a run a month
 * later books one month. That matters more here than almost anywhere else in the
 * app: an accrual is the kind of thing a person clicks twice.
 *
 * Nothing is stored that can be computed. The lease row holds terms plus the one
 * fact that is not derivable — grams already posted — and every figure on screen
 * comes from `domain/leasing.ts` recomputing from those terms.
 */

import {
  AppError,
  Err,
  NotFoundError,
  Ok,
  Result,
  UseCase,
  UserId,
  ValidationError,
  newUuid,
} from "@/core/kernel";
import { Money } from "@/core/money";
import { Percentage, Quantity, UnitPrice } from "@/core/numeric";
import { CalendarDate } from "@/core/time";
import { AccountCode, AccountRepository, SystemAccountCodes } from "@/domain/accounts";
import { InstrumentId, InstrumentRepository, MarketInstrument, PriceLookup } from "@/domain/instruments";
import {
  GoldLease,
  GoldLeaseRepository,
  LeaseAccrual,
  LeaseId,
  LeasePortfolio,
  LeaseStatus,
  leasePortfolio,
  leaseReturn,
  unleasedGrams,
} from "@/domain/leasing";
import { Lot, LotRepository } from "@/domain/lots";
import { InKindInterest, TransactionRepository, accountRef } from "@/domain/transactions";

/* ═══ Opening a lease ═════════════════════════════════════════════════ */

export interface OpenGoldLeaseInput {
  userId: UserId;
  /** Which digital-gold holding the grams come out of. */
  instrumentId: InstrumentId;
  reference?: string;
  platform: string;
  quantity: Quantity;
  startOn: CalendarDate;
  closesOn: CalendarDate;
  annualRate: Percentage;
  tdsRate?: Percentage;
  sourceReference?: string | null;
  notes?: string | null;
}

export interface OpenGoldLeaseOutput {
  readonly leaseId: LeaseId;
  readonly reference: string;
  /** Grams left in the wallet after this lease, and whether it over-leased. */
  readonly unleased: Quantity;
  readonly warnings: readonly string[];
}

/**
 * Records gold put out on lease.
 *
 * **No posting.** Leasing does not change what the user owns — the gold is still
 * theirs, still in the same holding account, and its value has not moved. A
 * transfer to a "leased" account would double the reporting work and make net
 * worth depend on a distinction the balance sheet does not recognise. What a lease
 * changes is *liquidity*, and that is a fact about the lease, not about the ledger.
 *
 * It does warn when the lease exceeds the units actually held, because that means
 * either a lease against gold never bought or gold sold while still on lease.
 */
export class OpenGoldLease implements UseCase<OpenGoldLeaseInput, OpenGoldLeaseOutput> {
  constructor(
    private readonly instruments: InstrumentRepository,
    private readonly leases: GoldLeaseRepository,
    private readonly lots: LotRepository,
  ) {}

  async execute(input: OpenGoldLeaseInput): Promise<Result<OpenGoldLeaseOutput, AppError>> {
    const instrument = await this.instruments.findById(input.userId, input.instrumentId);
    if (!instrument) return Err(new NotFoundError("Instrument", input.instrumentId.value));
    if (instrument.unit !== "GRAM") {
      return Err(
        new ValidationError(
          `${instrument.symbol} is measured in ${instrument.unit.toLowerCase()}s, not grams. ` +
            `Leasing is a gold arrangement; leasing shares is a different product with different tax.`,
        ),
      );
    }

    const reference = input.reference?.trim() || (await this.nextReference(input.userId));
    const existing = await this.leases.findByReference(input.userId, reference);
    if (existing) {
      return Err(new ValidationError(`A lease called ${reference} already exists.`));
    }

    let lease: GoldLease;
    try {
      lease = new GoldLease({
        id: LeaseId.from(newUuid()),
        userId: input.userId,
        reference,
        instrumentId: instrument.id,
        holdingAccountId: instrument.assetAccountId,
        platform: input.platform,
        quantity: input.quantity,
        startOn: input.startOn,
        closesOn: input.closesOn,
        annualRate: input.annualRate,
        tdsRate: input.tdsRate,
        sourceReference: input.sourceReference ?? null,
        notes: input.notes ?? null,
      });
    } catch (error) {
      // The domain refuses an impossible lease; that refusal is the user's answer.
      return Err(new ValidationError((error as Error).message));
    }

    await this.leases.save(lease);

    const held = await this.heldGrams(input.userId, instrument.id);
    const active = await this.leases.list(input.userId, {
      instrumentId: instrument.id,
      status: "ACTIVE",
    });
    const wallet = unleasedGrams(held, active);

    return Ok({
      leaseId: lease.id,
      reference,
      unleased: wallet.grams,
      warnings: wallet.overLeased
        ? [
            `${active.length} active lease(s) put ${Quantity.sum(active.map((one) => one.quantity)).toDecimalString()}g ` +
              `out against ${held.toDecimalString()}g held. Either a lease was entered for gold that ` +
              `was never bought, or gold was sold while still on lease — both are worth resolving ` +
              `before the next accrual.`,
          ]
        : [],
    });
  }

  /** Units held, from the open lots — the same source the portfolio screen uses. */
  private async heldGrams(userId: UserId, instrumentId: InstrumentId): Promise<Quantity> {
    const open = await this.lots.openLots(userId, instrumentId);
    return Quantity.sum(open.map((lot) => lot.remaining));
  }

  /** `LEASE-0001`, `LEASE-0002`, … so a user need not invent one. */
  private async nextReference(userId: UserId): Promise<string> {
    const all = await this.leases.list(userId);
    const highest = all
      .map((lease) => /^LEASE-(\d+)$/.exec(lease.reference)?.[1])
      .filter((digits): digits is string => digits !== undefined)
      .reduce((max, digits) => Math.max(max, Number(digits)), 0);
    return `LEASE-${String(highest + 1).padStart(4, "0")}`;
  }
}

/* ═══ Booking the accrual ═════════════════════════════════════════════ */

export interface AccrueLeaseInterestInput {
  userId: UserId;
  leaseId: LeaseId;
  asOf: CalendarDate;
  /**
   * The gram price to value the interest at. Resolved from the price book when
   * absent — and the accrual is refused rather than guessed if neither is available.
   */
  pricePerGram?: UnitPrice;
  narration?: string;
}

export interface AccrueLeaseInterestOutput {
  readonly transactionId: string | null;
  readonly accrual: LeaseAccrual;
  /** Grams actually booked by this run — zero when there was nothing new. */
  readonly postedGrams: Quantity;
  readonly grossValue: Money;
  readonly tdsValue: Money;
  readonly netValue: Money;
  readonly because: string;
}

export class AccrueLeaseInterest
  implements UseCase<AccrueLeaseInterestInput, AccrueLeaseInterestOutput>
{
  constructor(
    private readonly accounts: AccountRepository,
    private readonly instruments: InstrumentRepository,
    private readonly leases: GoldLeaseRepository,
    private readonly journal: TransactionRepository,
    private readonly lots: LotRepository,
    private readonly prices: PriceLookup,
  ) {}

  async execute(
    input: AccrueLeaseInterestInput,
  ): Promise<Result<AccrueLeaseInterestOutput, AppError>> {
    const lease = await this.leases.findById(input.userId, input.leaseId);
    if (!lease) return Err(new NotFoundError("Lease", input.leaseId.value));

    const accrual = lease.accrualOn(input.asOf);
    const unposted = lease.unpostedOn(input.asOf);

    const instrument = await this.instruments.findById(input.userId, lease.props.instrumentId);
    if (!instrument) {
      return Err(new NotFoundError("Instrument", lease.props.instrumentId.value));
    }
    const currency = instrument.currency;

    if (!unposted.isPositive) {
      // Not an error: running the accrual twice in a day is a reasonable thing to
      // do, and "nothing new to book" is the honest answer to it.
      return Ok({
        transactionId: null,
        accrual,
        postedGrams: Quantity.ZERO,
        grossValue: Money.zero(currency),
        tdsValue: Money.zero(currency),
        netValue: Money.zero(currency),
        because:
          accrual.monthsCompleted === 0
            ? accrual.because
            : `All ${accrual.net.toDecimalString()}g of net interest earned to ${input.asOf.toISO()} ` +
              `has already been booked, so this run posts nothing.`,
      });
    }

    const price = input.pricePerGram ?? (await this.resolvePrice(instrument, input.asOf));
    if (!price) {
      return Err(
        new ValidationError(
          `No gram price could be resolved for ${instrument.symbol} on ${input.asOf.toISO()}, so ` +
            `the interest cannot be valued. It is not booked at zero: the grams are real and ` +
            `booking them at nothing would understate both the income and the holding.`,
        ),
      );
    }

    /*
     * The gross for *this* run, derived from the grams being posted rather than
     * from the accrual total — a run that books one month's net must recognise one
     * month's gross, not the whole lease's.
     *
     * Gross is reconstructed as `net / (1 − tdsRate)` in exact integers, and the
     * TDS is the difference, so the three legs always balance.
     */
    const grossGrams = grossFromNet(unposted, lease.tdsRate);
    const tdsGrams = grossGrams.minus(unposted);

    const grossValue = price.times(grossGrams);
    const netValue = price.times(unposted);
    // Subtraction, so debits equal credits even when both products round.
    const tdsValue = grossValue.minus(netValue);

    const [holding, incomeAccount, tdsAccount] = await Promise.all([
      this.accounts.findById(input.userId, lease.props.holdingAccountId),
      this.accounts.findByCode(input.userId, AccountCode.parse(SystemAccountCodes.interestIncome)),
      this.accounts.findByCode(input.userId, AccountCode.parse(TDS_ASSET_CODE)),
    ]);
    if (!holding) {
      return Err(new NotFoundError("Holding account", lease.props.holdingAccountId.value));
    }
    if (!incomeAccount) {
      return Err(new NotFoundError("Account", SystemAccountCodes.interestIncome));
    }
    if (tdsValue.isPositive && !tdsAccount) {
      return Err(
        new NotFoundError(
          "Account",
          `${TDS_ASSET_CODE} — tax withheld in gold is recoverable in the return and needs an asset account`,
        ),
      );
    }

    const posting = InKindInterest.record(
      {
        userId: input.userId,
        txnDate: input.asOf,
        description:
          input.narration ??
          `${lease.reference}: ${unposted.toDecimalString()}g interest from ${lease.props.platform}`,
        source: accountRef(incomeAccount),
        destination: accountRef(holding),
      },
      {
        gross: grossValue,
        taxDeductedAtSource: tdsValue.isPositive ? tdsValue : null,
        tdsAccount: tdsValue.isPositive && tdsAccount ? accountRef(tdsAccount) : null,
        instrumentId: instrument.id.value,
        taxCategory: instrument.taxProfile().category,
        unitsReceived: unposted,
      },
    );

    await this.journal.save(posting);

    /*
     * The broker-level record first, as a purchase would: a lot references the
     * trade row that created it, and a lot whose trade is missing is a lot that
     * cannot be traced to an event. An interest credit *is* an acquisition — grams
     * arriving at a known per-gram value — so it belongs in the same table as
     * every other acquisition rather than in a parallel one.
     */
    await this.lots.recordTrade(input.userId, {
      id: posting.id.value,
      instrumentId: instrument.id,
      side: "BUY",
      tradedOn: input.asOf,
      quantity: unposted,
      pricePerUnit: unposted.perUnit(netValue),
      charges: Money.zero(currency),
      transactionId: posting.id.value,
      // No cash moved and no account settled it: the gold arrived as interest.
      settlementAccountId: null,
    });

    // The lot the transaction itself computed, so the basis on the lot and the
    // basis in the ledger are one number rather than two.
    const [effect] = posting.lotEffects();
    if (effect?.kind === "OPEN") {
      await this.lots.saveLots(input.userId, [
        Lot.open({
          instrumentId: instrument.id,
          acquiredOn: effect.acquiredOn,
          originalQuantity: effect.quantity,
          cost: effect.costBasis,
          buyCharges: Money.zero(currency),
          openedByTransactionId: posting.id.value,
        }),
      ]);
    }

    await this.leases.recordCredit(
      input.userId,
      lease.id,
      lease.credited.plus(unposted),
      posting.id.value,
    );

    return Ok({
      transactionId: posting.id.value,
      accrual,
      postedGrams: unposted,
      grossValue,
      tdsValue,
      netValue,
      because:
        `${grossGrams.toDecimalString()}g gross at ${price.toDecimalString()}/g is ` +
        `${grossValue.toDecimalString()}, less ${tdsGrams.toDecimalString()}g withheld ` +
        `(${tdsValue.toDecimalString()}); ${unposted.toDecimalString()}g reached the holding at a ` +
        `cost basis of ${netValue.toDecimalString()}.`,
    });
  }

  private async resolvePrice(
    instrument: MarketInstrument,
    asOf: CalendarDate,
  ): Promise<UnitPrice | null> {
    const key = instrument.quoteKey();
    const resolved = await this.prices.priceOn(
      {
        instrumentId: instrument.id.value,
        symbol: key.ref ?? instrument.symbol,
        assetClass: key.assetClass,
        currency: instrument.currency,
        identifierType: key.identifierType,
      },
      asOf,
      key.quoteType,
    );
    return resolved.price;
  }
}

/**
 * The gross grams behind a net credit: `net / (1 − tdsRate)`.
 *
 * Reconstructed rather than re-derived from the lease, because a run books
 * whatever is *unposted* — one month, or seven if nobody ran it — and the gross
 * has to match those grams exactly or the three postings will not balance. Rounded
 * up, so the withheld portion is never understated.
 */
function grossFromNet(net: Quantity, tdsRate: Percentage): Quantity {
  const hundredPercent = 100_000_000n;
  if (tdsRate.scaled === 0n) return net;
  return net.timesRatio(hundredPercent, hundredPercent - tdsRate.scaled, "UP");
}

/** Where tax withheld at source goes. An asset: the return reclaims it. */
export const TDS_ASSET_CODE = SystemAccountCodes.taxDeductedAtSource;

/* ═══ Settling a lease ════════════════════════════════════════════════ */

export interface SettleGoldLeaseInput {
  userId: UserId;
  leaseId: LeaseId;
  /** `MATURED` when it ran its term, `CANCELLED` when it ended early. */
  outcome: Extract<LeaseStatus, "MATURED" | "CANCELLED">;
  endedOn: CalendarDate;
}

/**
 * Closes a lease.
 *
 * It does **not** book the outstanding interest: that is
 * {@link AccrueLeaseInterest}'s job, and doing both here would mean two paths
 * writing the same posting. It reports what is still unbooked so the caller can
 * see it, which is the honest division — closing a lease and paying for it are two
 * events, and a screen that hid the second would leave grams stranded.
 */
export class SettleGoldLease
  implements UseCase<SettleGoldLeaseInput, { unpostedGrams: Quantity; status: LeaseStatus }>
{
  constructor(private readonly leases: GoldLeaseRepository) {}

  async execute(
    input: SettleGoldLeaseInput,
  ): Promise<Result<{ unpostedGrams: Quantity; status: LeaseStatus }, AppError>> {
    const lease = await this.leases.findById(input.userId, input.leaseId);
    if (!lease) return Err(new NotFoundError("Lease", input.leaseId.value));
    if (lease.status !== "ACTIVE") {
      return Err(
        new ValidationError(
          `${lease.reference} is already ${lease.status.toLowerCase()}. Reopening a settled lease ` +
            `would rewrite history; enter a new lease instead.`,
        ),
      );
    }

    let settled: GoldLease;
    try {
      settled = lease.with({ status: input.outcome, endedOn: input.endedOn });
    } catch (error) {
      return Err(new ValidationError((error as Error).message));
    }
    await this.leases.save(settled);

    return Ok({
      unpostedGrams: settled.unpostedOn(input.endedOn),
      status: settled.status,
    });
  }
}

/* ═══ The lease screen ════════════════════════════════════════════════ */

export interface ListGoldLeasesInput {
  userId: UserId;
  asOf: CalendarDate;
  instrumentId?: InstrumentId;
}

export interface LeaseRow {
  readonly lease: GoldLease;
  readonly accrual: LeaseAccrual;
  readonly unpostedGrams: Quantity;
  readonly totalGrams: Quantity;
  readonly value: Money | null;
  readonly isMatured: boolean;
}

export interface ListGoldLeasesOutput {
  readonly rows: readonly LeaseRow[];
  readonly portfolio: LeasePortfolio;
  /** Grams held but not out on lease — the wallet balance. */
  readonly unleasedGrams: Quantity;
  readonly overLeased: boolean;
  /** Profit over what the gold cost, when both are knowable. */
  readonly returnOnCost: { profit: Money; percent: Percentage } | null;
  /** Why there is no value, when there is none. */
  readonly unpricedReason: string | null;
}

export class ListGoldLeases implements UseCase<ListGoldLeasesInput, ListGoldLeasesOutput> {
  constructor(
    private readonly instruments: InstrumentRepository,
    private readonly leases: GoldLeaseRepository,
    private readonly lots: LotRepository,
    private readonly prices: PriceLookup,
  ) {}

  async execute(input: ListGoldLeasesInput): Promise<Result<ListGoldLeasesOutput, AppError>> {
    const leases = await this.leases.list(input.userId, { instrumentId: input.instrumentId });
    if (leases.length === 0) {
      return Ok({
        rows: [],
        portfolio: leasePortfolio([], input.asOf, null),
        unleasedGrams: Quantity.ZERO,
        overLeased: false,
        returnOnCost: null,
        unpricedReason: null,
      });
    }

    /*
     * One price per instrument, not per lease: every lease on one instrument is
     * priced identically, and asking the ladder once per row would multiply the
     * provider calls by the number of leases for no different answer.
     */
    const instrumentIds = [...new Set(leases.map((lease) => lease.props.instrumentId.value))];
    const prices = new Map<string, UnitPrice | null>();
    let unpricedReason: string | null = null;

    for (const id of instrumentIds) {
      const instrument = await this.instruments.findById(input.userId, InstrumentId.from(id));
      if (!instrument) {
        prices.set(id, null);
        continue;
      }
      const key = instrument.quoteKey();
      const resolved = await this.prices.priceOn(
        {
          instrumentId: instrument.id.value,
          symbol: key.ref ?? instrument.symbol,
          assetClass: key.assetClass,
          currency: instrument.currency,
          identifierType: key.identifierType,
        },
        input.asOf,
        key.quoteType,
      );
      prices.set(id, resolved.price);
      if (!resolved.price && !unpricedReason) {
        unpricedReason = `No gram price for ${instrument.symbol} on ${input.asOf.toISO()}, so the leases are shown in grams only.`;
      }
    }

    const rows: LeaseRow[] = leases.map((lease) => {
      const price = prices.get(lease.props.instrumentId.value) ?? null;
      return {
        lease,
        accrual: lease.accrualOn(input.asOf),
        unpostedGrams: lease.unpostedOn(input.asOf),
        totalGrams: lease.totalGramsOn(input.asOf),
        value: lease.valueOn(input.asOf, price),
        isMatured: lease.isMaturedOn(input.asOf),
      };
    });

    // The portfolio total needs one price, so it is only computed when every
    // lease is on one instrument — which is the normal case, and the alternative
    // would be summing rupees across two metals.
    const singlePrice = instrumentIds.length === 1 ? (prices.get(instrumentIds[0]) ?? null) : null;
    const portfolio = leasePortfolio(leases, input.asOf, singlePrice);

    const held = Quantity.sum(
      (
        await Promise.all(
          instrumentIds.map((id) => this.lots.openLots(input.userId, InstrumentId.from(id))),
        )
      )
        .flat()
        .map((lot) => lot.remaining),
    );
    const wallet = unleasedGrams(held, leases);

    // Cost is the lots' cost: what the leased gold was actually paid for.
    const cost = Money.total(
      (
        await Promise.all(
          instrumentIds.map((id) => this.lots.allLots(input.userId, InstrumentId.from(id))),
        )
      )
        .flat()
        .map((lot) => lot.props.cost),
    );

    return Ok({
      rows,
      portfolio,
      unleasedGrams: wallet.grams,
      overLeased: wallet.overLeased,
      returnOnCost: leaseReturn(portfolio, cost),
      unpricedReason,
    });
  }
}

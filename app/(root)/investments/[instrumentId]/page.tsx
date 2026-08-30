import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Money } from "@/core/money";
import { Percentage, Quantity } from "@/core/numeric";
import { CalendarDate } from "@/core/time";
import { InstrumentId } from "@/domain/instruments";
import { LotBook } from "@/domain/lots";
import { CashAsset } from "@/domain/assets";
import { Card, MoneyText, PageHeader, Pill, Stat } from "@/ui/primitives";
import { formatPercent } from "@/ui/format";
import { currentUserId, services } from "@/infra/container";
import TradeForms from "./trade-forms";
import TradeRowActions from "./trade-row-actions";
import InstrumentAdmin from "./instrument-admin";
import MetalHoldingForm from "./metal-holding-form";
import RefreshPricesButton from "../refresh-prices-button";
import MetalTransactionActions from "./metal-transaction-actions";
import DigitalGoldLeaseForm from "./digital-gold-lease-form";
import GoldProfitChart, { type GoldProfitPoint } from "./gold-profit-chart";
import { LeaseRowActions } from "../lease-forms";
import { DEFAULT_TDS_RATE } from "@/domain/leasing";

export const metadata: Metadata = { title: "Holding" };

const formatSyncedAt = (date: Date): string =>
  new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Kolkata",
  }).format(date);

const formatQuantityPercent = (value: Quantity): string =>
  `${value.toApproximateNumber().toFixed(2)}%`;

function GramBar({
  label,
  value,
  total,
  tone = "green",
}: {
  label: string;
  value: Quantity;
  total: Quantity;
  tone?: "green" | "amber";
}) {
  const width = total.isPositive
    ? Math.min(100, Math.max(0, (value.toApproximateNumber() / total.toApproximateNumber()) * 100))
    : 0;

  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-3 text-xs">
        <span className="text-gray-400">{label}</span>
        <span className="tnum text-gray-200">{value.toDecimalString()}g</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-gray-700">
        <div
          className={tone === "green" ? "h-full rounded-full bg-green-500" : "h-full rounded-full bg-amber-500"}
          style={{ width: `${width}%` }}
        />
      </div>
    </div>
  );
}

/**
 * One holding: its lots, its history, and what a sale would realise.
 *
 * The **holding-period clock** is the column that matters. Tax on a disposal turns
 * on the days each lot has been held, so a lot 340 days old is a different
 * decision from one 370 days old — and a screen that showed only "units and
 * average cost" hides the single most actionable number a holder has.
 *
 * The method comparison is here for the same reason: FIFO and HIFO on the same
 * sale realise different gains, and the difference is money the user can choose to
 * keep.
 */
export default async function Page({ params }: { params: Promise<{ instrumentId: string }> }) {
  await connection();

  const { instrumentId } = await params;
  const userId = await currentUserId();
  const today = CalendarDate.parse(new Date().toISOString().slice(0, 10));
  const id = InstrumentId.from(instrumentId);

  const { investing, repositories, leasing } = services();
  const instrument = await repositories.instruments.findById(userId, id);
  if (!instrument) notFound();
  const isDigitalMetal = instrument.kind === "DIGITAL_GOLD" || instrument.kind === "DIGITAL_SILVER" || instrument.kind === "DIGITAL_PLATINUM";

  const [lots, portfolio, actions, accounts, trades, platformRows] = await Promise.all([
    repositories.lots.allLots(userId, id),
    investing.valuePortfolio.execute({ userId, asOf: today }),
    investing.corporateActions(userId).listFor(id),
    repositories.accounts.list(userId),
    repositories.lots.tradesFor(userId, id),
    repositories.platforms.list(userId),
  ]);
  if (!portfolio.ok) throw new Error(portfolio.error.message);

  const position = portfolio.value.valued.find((row) => row.instrumentId.equals(id));
  const openLots = lots.filter((lot) => !lot.isExhausted);
  const open = LotBook.openPosition(openLots, instrument.currency);
  const currentQuotes = isDigitalMetal
    ? await repositories.quotes.findLatestOnOrBefore(id.value, "CLOSE", today, 1)
    : [];
  const currentRate = currentQuotes[0]?.price.toMoney() ?? null;
  const currentValue = currentQuotes[0]?.price.times(open.quantity) ?? null;
  const investedValue = open.cost.plus(open.charges);
  const averageBuyRate = open.quantity.isPositive ? open.quantity.perUnit(investedValue) : null;
  const unrealisedValue = currentValue ? currentValue.minus(investedValue) : null;
  const absoluteReturn = unrealisedValue && investedValue.isPositive
    ? Percentage.ratio(unrealisedValue, investedValue)
    : null;
  const rateSpread = currentRate && averageBuyRate ? currentRate.minus(averageBuyRate) : null;
  const rateSpreadPercent = rateSpread && averageBuyRate && averageBuyRate.isPositive
    ? Percentage.ratio(rateSpread, averageBuyRate)
    : null;

  const settlementAccounts = accounts
    .filter((account) => CashAsset.classify(account) !== null)
    .map((account) => ({ id: account.id.value, label: account.displayName }));

  const comparison = open.quantity.isPositive
    ? await investing.compareMethods.execute({
        userId,
        instrumentId: id,
        quantity: open.quantity,
        pricePerUnit: position?.marketValue
          ? open.quantity.perUnit(position.marketValue, "HALF_EVEN")
          : Money.zero(instrument.currency),
        tradedOn: today,
      })
    : null;

  const profile = instrument.taxProfile();
  const platforms = platformRows.map((platform) => ({
    id: platform.id.value,
    name: platform.name,
    kind: platform.kind,
  }));
  const leaseResult = instrument.kind === "DIGITAL_GOLD"
    ? await leasing.list.execute({ userId, asOf: today, instrumentId: id })
    : null;
  if (leaseResult && !leaseResult.ok) throw new Error(leaseResult.error.message);
  const leaseRows = leaseResult?.ok ? leaseResult.value.rows : [];
  const leasePlatform = platformRows.find((platform) => platform.id.equals(instrument.institutionId))?.name ?? instrument.name;
  const activeLeaseRows = leaseRows.filter((row) => row.lease.status === "ACTIVE");
  const leasePortfolio = leaseResult?.ok ? leaseResult.value.portfolio : null;
  const leasedGrams = leasePortfolio?.leasedGrams ?? Quantity.ZERO;
  const unleasedGramsValue = leaseResult?.ok ? leaseResult.value.unleasedGrams : Quantity.ZERO;
  const leaseDeployment = open.quantity.isPositive
    ? Quantity.fromRatio(leasedGrams.scaled * 100n, open.quantity.scaled)
    : Quantity.ZERO;
  const weightedLeaseRate = activeLeaseRows.length > 0 && leasedGrams.isPositive
    ? Percentage.fromScaled(
        activeLeaseRows.reduce(
          (total, row) => total + row.lease.quantity.scaled * row.lease.props.annualRate.scaled,
          0n,
        ) / leasedGrams.scaled,
      )
    : null;
  /*
   * Where the profit came from, and the month-by-month series behind the chart.
   * Digital metal only: the split is meaningless for a holding that cannot be
   * leased, and the query would be a wasted scan of the quote table.
   */
  const analyticsResult = isDigitalMetal
    ? await investing.goldAnalytics.execute({ userId, instrumentId: id, asOf: today })
    : null;
  if (analyticsResult && !analyticsResult.ok) throw new Error(analyticsResult.error.message);
  const analytics = analyticsResult?.ok ? analyticsResult.value : null;
  const profitPoints: GoldProfitPoint[] = (analytics?.history ?? []).map((point) => ({
    month: point.month,
    totalProfitMinor: point.totalProfit?.toMinorNumber() ?? null,
    priceProfitMinor: point.priceProfit?.toMinorNumber() ?? null,
    leaseProfitMinor: point.leaseProfit?.toMinorNumber() ?? null,
    investedMinor: point.investedCost.toMinorNumber(),
    marketValueMinor: point.marketValue?.toMinorNumber() ?? null,
    rateMinor: point.pricePerGram?.toMoney().toMinorNumber() ?? null,
    grams: point.grams.toDecimalString(),
    leaseGrams: point.leaseGrams.toDecimalString(),
  }));

  /*
   * The headline stats read from the analytics when it has an opinion, so the
   * top of the page and the profit panel below it cannot quote two different
   * values for the same gold. Where a platform has a buy-back spread that means
   * the realisable figure, which is the one a holder can act on.
   */
  const hasSpread = analytics ? !analytics.sellSpread.isZero : false;
  const metalRate = analytics?.pricePerGram?.toMoney() ?? currentRate;
  const metalValue = analytics?.marketValue ?? currentValue;
  const metalUnrealised = metalValue ? metalValue.minus(investedValue) : unrealisedValue;
  const metalReturn = metalUnrealised && investedValue.isPositive
    ? Percentage.ratio(metalUnrealised, investedValue)
    : absoluteReturn;

  /*
   * Two different facts, and conflating them is what makes a working feed look
   * broken. `asOf` is the day the rate belongs to — IBJA publishes on business
   * days, so over a weekend the newest rate is Friday's and stays Friday's however
   * often it is fetched. `ingestedAt` is when we last went and looked. A user
   * watching only the first concludes nothing is updating; a user shown only the
   * second cannot tell that the price is three days old.
   */
  const latestQuote = currentQuotes[0] ?? null;
  const lastSyncedAt = latestQuote?.ingestedAt ?? null;
  const marketDateAgeDays = latestQuote ? latestQuote.asOf.daysUntil(today) : null;
  const priceUpdatedHint = latestQuote
    ? `Rate for ${latestQuote.asOf.toISO()}` +
      (marketDateAgeDays && marketDateAgeDays > 0
        ? ` (${marketDateAgeDays} day${marketDateAgeDays === 1 ? "" : "s"} old — the last one published)`
        : "") +
      ` · checked ${formatSyncedAt(latestQuote.ingestedAt)}`
    : "Refresh prices to load the latest rate";

  return (
    <>
      <PageHeader
        title={`${instrument.symbol} — ${instrument.name}`}
        subtitle={`${instrument.kind.replace(/_/g, " ").toLowerCase()} · taxed as ${profile.category
          .replace(/_/g, " ")
          .toLowerCase()}${profile.slabTaxedAlways ? ", at slab whatever the holding period" : ""}`}
        badge={
          profile.lockInMonths ? (
            <Pill tone="brand">{profile.lockInMonths / 12}-year lock-in</Pill>
          ) : (
            <Pill tone="neutral">{instrument.unit.toLowerCase()}</Pill>
          )
        }
        action={
          <div className="flex items-center gap-2">
            <Link href="/investments" className="ghost-btn h-10 px-4 text-xs">All holdings</Link>
            <RefreshPricesButton instrumentId={instrumentId} auto={isDigitalMetal} lastSyncedAt={lastSyncedAt?.toISOString() ?? null} />
          </div>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label={isDigitalMetal ? "Grams held" : "Units held"}
          value={<span className="tnum">{open.quantity.toDecimalString()}</span>}
          hint={isDigitalMetal ? "Current recorded platform balance" : `${openLots.length} open lot(s)`}
        />
        <Stat label="Invested" value={open.cost.plus(open.charges)} hint="Price plus charges" />
        <Stat
          label="Market value"
          value={position?.marketValue ?? null}
          hint={
            position?.pricedOn
              ? `Priced ${position.pricedOn.toISO()}${position.isStale ? " · stale" : ""}`
              : (position?.unpricedReason ?? "No price")
          }
        />
        <Stat label="Realised" value={position?.realisedGain ?? Money.zero()} hint="Gains already taken" />
      </div>

      {isDigitalMetal && (
        <>
          <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Average buy rate / gram" value={averageBuyRate} hint="Total invested ÷ grams held" />
            <Stat
              label={hasSpread ? "Buy-back rate / gram" : "Current gold price / gram"}
              value={metalRate}
              hint={hasSpread ? `${analytics!.sellSpread.toFixed(2)}% under the ${analytics!.benchmarkPricePerGram?.toDecimalString()} benchmark · ${priceUpdatedHint}` : priceUpdatedHint}
            />
            <Stat
              label={hasSpread ? "Realisable value" : "Current value"}
              value={metalValue}
              hint={hasSpread ? "What selling on the platform would produce today" : "Grams × current 1g price"}
            />
            <Stat
              label="Unrealised gain / loss"
              value={metalUnrealised}
              hint={metalReturn ? `${formatPercent(metalReturn)} absolute; tax applies only on sale` : "Current value less invested amount; tax applies only on sale"}
            />
          </div>
          <section className="panel mb-6 p-5">
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-gray-100">Investor analysis</h2>
                <p className="mt-1 text-xs text-gray-500">Position quality, lease deployment and pricing freshness in one view.</p>
              </div>
              <Pill tone="neutral">{latestQuote ? `Checked ${formatSyncedAt(latestQuote.ingestedAt)}` : "No live price"}</Pill>
            </div>
            <div className="grid gap-4 lg:grid-cols-[1.1fr_1fr]">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg border border-gray-600 p-4">
                  <p className="metric-label">Price spread / gram</p>
                  <p className="mt-2 text-xl font-semibold text-gray-100"><MoneyText value={rateSpread} /></p>
                  <p className="mt-1 text-xs text-gray-500">{rateSpreadPercent ? `${formatPercent(rateSpreadPercent)} versus average buy rate` : "Needs current price and buy history"}</p>
                </div>
                <div className="rounded-lg border border-gray-600 p-4">
                  <p className="metric-label">Lease deployment</p>
                  <p className="mt-2 text-xl font-semibold text-gray-100">{formatQuantityPercent(leaseDeployment)}</p>
                  <p className="mt-1 text-xs text-gray-500">{leasedGrams.toDecimalString()}g leased, {unleasedGramsValue.toDecimalString()}g idle</p>
                </div>
                <div className="rounded-lg border border-gray-600 p-4">
                  <p className="metric-label">Weighted lease rate</p>
                  <p className="mt-2 text-xl font-semibold text-gray-100">{weightedLeaseRate ? `${weightedLeaseRate.toFixed(2)}% p.a.` : "-"}</p>
                  <p className="mt-1 text-xs text-gray-500">{activeLeaseRows.length} active lease{activeLeaseRows.length === 1 ? "" : "s"}</p>
                </div>
                <div className="rounded-lg border border-gray-600 p-4">
                  <p className="metric-label">Due to add</p>
                  <p className="mt-2 text-xl font-semibold text-amber-500">{leasePortfolio?.unpostedGrams.toDecimalString() ?? "0"}g</p>
                  <p className="mt-1 text-xs text-gray-500">Gold interest earned but not yet added to holding lots</p>
                </div>
              </div>
              <div className="rounded-lg border border-gray-600 p-4">
                <p className="metric-label">Gold deployment</p>
                <div className="mt-4 space-y-4">
                  <GramBar label="Leased and earning" value={leasedGrams} total={open.quantity} />
                  <GramBar label="Unleased wallet balance" value={unleasedGramsValue} total={open.quantity} tone="amber" />
                </div>
                <div className="mt-4 grid grid-cols-2 gap-3 border-t border-gray-600 pt-4 text-xs">
                  <div>
                    <p className="metric-label">Earned to date</p>
                    <p className="tnum mt-1 text-green-500">{leasePortfolio?.netInterestGrams.toDecimalString() ?? "0"}g net</p>
                  </div>
                  <div>
                    <p className="metric-label">Withheld as TDS</p>
                    <p className="tnum mt-1 text-gray-200">{leasePortfolio?.tdsGrams.toDecimalString() ?? "0"}g</p>
                  </div>
                </div>
              </div>
            </div>
          </section>
          {analytics && (
            <>
              <section className="panel mb-6 p-5">
                <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-semibold text-gray-100">Where the profit came from</h2>
                    <p className="mt-1 text-xs text-gray-500">
                      Measured against cash actually paid, charges and taxes included. Grams credited by a
                      lease cost nothing out of pocket, so everything they are worth is profit — the two
                      halves below add to the total exactly.
                    </p>
                  </div>
                  <Pill tone="neutral">
                    {analytics.pricedOn ? `Priced ${analytics.pricedOn.toISO()}` : "No price"}
                  </Pill>
                </div>

                {analytics.benchmarkValue && (
                  <div className="mb-4 rounded-lg border border-gray-600 p-4">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2 text-sm">
                      <span className="text-gray-400">
                        Benchmark value
                        <span className="ml-2 text-xs text-gray-500">
                          IBJA, {analytics.benchmarkPricePerGram?.toDecimalString()}/g
                        </span>
                      </span>
                      <span className="tnum text-gray-200">
                        {analytics.benchmarkValue.toDecimalString()}
                      </span>
                    </div>
                    {analytics.sellSpread.isZero ? (
                      <p className="mt-2 text-xs text-gray-500">
                        Valued at the bullion benchmark, because no buy-back spread is recorded for
                        this platform. Digital gold normally sells back 3-6% under it, and the 3%
                        GST paid on the way in never comes back — so this figure is optimistic by
                        that much. Set the spread on the platform and every number here becomes what
                        you could actually realise.
                      </p>
                    ) : (
                      <>
                        <div className="mt-2 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2 text-sm">
                          <span className="text-gray-400">
                            Buy-back spread
                            <span className="ml-2 text-xs text-gray-500">
                              {analytics.sellSpread.toFixed(2)}% under benchmark
                            </span>
                          </span>
                          <span className="tnum text-amber-500">
                            −{analytics.spreadCost?.toDecimalString()}
                          </span>
                        </div>
                        <div className="mt-2 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2 border-t border-gray-600 pt-2 text-sm">
                          <span className="font-medium text-gray-200">
                            Realisable today
                            <span className="ml-2 text-xs text-gray-500">
                              at {analytics.pricePerGram?.toDecimalString()}/g
                            </span>
                          </span>
                          <span className="tnum font-semibold text-gray-100">
                            {analytics.marketValue?.toDecimalString()}
                          </span>
                        </div>
                        <p className="mt-2 text-xs text-gray-500">
                          Every figure below — the profit split and the chart — is computed at the
                          buy-back rate, not the benchmark, so it is what selling would actually
                          produce.
                        </p>
                      </>
                    )}
                  </div>
                )}

                {analytics.unpricedReason && (
                  <p className="mb-4 rounded-lg border border-amber-600/40 bg-amber-500/5 px-3 py-2 text-xs text-amber-500">
                    {analytics.unpricedReason}
                  </p>
                )}
                {analytics.leaseGramsReconcile && (
                  <p className="mb-4 rounded-lg border border-amber-600/40 bg-amber-500/5 px-3 py-2 text-xs text-amber-500">
                    {analytics.leaseGramsReconcile}
                  </p>
                )}

                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <div className="rounded-lg border border-gray-600 p-4">
                    <p className="metric-label">Total profit</p>
                    <p className="mt-2 text-xl font-semibold"><MoneyText value={analytics.totalProfit} /></p>
                    <p className="mt-1 text-xs text-gray-500">
                      {analytics.totalProfitPercent
                        ? `${formatPercent(analytics.totalProfitPercent)} on cash paid`
                        : "Over what was actually paid"}
                    </p>
                  </div>
                  <div className="rounded-lg border border-gray-600 p-4">
                    <p className="metric-label">From gold price</p>
                    <p className="mt-2 text-xl font-semibold"><MoneyText value={analytics.priceProfit} /></p>
                    <p className="mt-1 text-xs text-gray-500">
                      {analytics.purchasedGrams.toDecimalString()}g bought, now worth more or less than they cost
                    </p>
                  </div>
                  <div className="rounded-lg border border-gray-600 p-4">
                    <p className="metric-label">From lease interest</p>
                    <p className="mt-2 text-xl font-semibold text-green-500"><MoneyText value={analytics.leaseProfit} /></p>
                    <p className="mt-1 text-xs text-gray-500">
                      {analytics.leaseGrams.toDecimalString()}g the lease paid for
                      {analytics.leaseShareOfProfit ? ` · ${formatPercent(analytics.leaseShareOfProfit)} of the profit` : ""}
                    </p>
                  </div>
                  <div className="rounded-lg border border-gray-600 p-4">
                    <p className="metric-label">Effective cost / gram</p>
                    <p className="mt-2 text-xl font-semibold text-gray-100">
                      <MoneyText value={analytics.effectiveCostPerGram?.toMoney() ?? null} tone="neutral" />
                    </p>
                    <p className="mt-1 text-xs text-gray-500">
                      {analytics.blendedCostPerGram
                        ? `${analytics.blendedCostPerGram.toMoney().toDecimalString()} once the free lease grams are counted in`
                        : "Cash paid ÷ grams bought, taxes and charges included"}
                    </p>
                  </div>
                </div>

                <div className="mt-4 grid gap-4 lg:grid-cols-[1.1fr_1fr]">
                  <div className="rounded-lg border border-gray-600 p-4">
                    <p className="metric-label">Grams in the holding, by where they came from</p>
                    <div className="mt-4 space-y-4">
                      <GramBar label="Bought with money" value={analytics.purchasedGrams} total={analytics.totalGrams} />
                      <GramBar label="Credited by a lease" value={analytics.leaseGrams} total={analytics.totalGrams} tone="amber" />
                    </div>
                    <p className="mt-4 border-t border-gray-600 pt-3 text-xs text-gray-500">
                      Total {analytics.totalGrams.toDecimalString()}g. A sale consumes lots, so selling gold
                      lowers both bars and the profit split above without any separate adjustment.
                    </p>
                  </div>
                  <div className="rounded-lg border border-gray-600 p-4">
                    <p className="metric-label">Lease gram flow</p>
                    <dl className="mt-3 space-y-2 text-xs">
                      <div className="flex items-baseline justify-between gap-3">
                        <dt className="text-gray-400">Credited over every lease</dt>
                        <dd className="tnum text-gray-200">{analytics.creditedGramsEver.toDecimalString()}g</dd>
                      </div>
                      <div className="flex items-baseline justify-between gap-3">
                        <dt className="text-gray-400">Still held</dt>
                        <dd className="tnum text-green-500">{analytics.leaseGrams.toDecimalString()}g</dd>
                      </div>
                      <div className="flex items-baseline justify-between gap-3">
                        <dt className="text-gray-400">Sold or otherwise gone</dt>
                        <dd className="tnum text-gray-200">{analytics.leaseGramsDisposed.toDecimalString()}g</dd>
                      </div>
                      <div className="flex items-baseline justify-between gap-3">
                        <dt className="text-gray-400">Earned, not yet added</dt>
                        <dd className="tnum text-amber-500">
                          {analytics.dueGrams.toDecimalString()}g
                          {analytics.dueValue ? ` · ${analytics.dueValue.toDecimalString()}` : ""}
                        </dd>
                      </div>
                      <div className="flex items-baseline justify-between gap-3">
                        <dt className="text-gray-400">Withheld as TDS</dt>
                        <dd className="tnum text-gray-200">{analytics.tdsGrams.toDecimalString()}g</dd>
                      </div>
                      <div className="flex items-baseline justify-between gap-3 border-t border-gray-600 pt-2">
                        <dt className="text-gray-400">Unrealised against book cost</dt>
                        <dd className="tnum text-gray-200"><MoneyText value={analytics.unrealisedAgainstBook} /></dd>
                      </div>
                    </dl>
                    <p className="mt-3 text-xs text-gray-500">
                      The book figure nets off the value the lease grams were taxed at when they were
                      credited. It is the accounting answer; the profit above is the cash one. They are
                      never added together.
                    </p>
                  </div>
                </div>
              </section>

              <GoldProfitChart points={profitPoints} currency={instrument.currency.code} />
            </>
          )}

          <section className="panel mb-6 p-0">
            <div className="flex items-center justify-between border-b border-gray-600 px-5 py-4">
              <div><h2 className="text-sm font-semibold text-gray-100">Investment transactions</h2><p className="mt-1 text-xs text-gray-500">Every monthly investment is retained separately and drives the holding totals above.</p></div>
              <Pill tone="neutral">{trades.length} entries</Pill>
            </div>
            {trades.length === 0 ? <p className="px-5 py-6 text-sm text-gray-500">No investments recorded yet.</p> : <div className="table-scroll"><table className="w-full text-sm">
              <caption className="sr-only">Digital-metal investment transactions</caption>
              <thead><tr className="border-b border-gray-600"><th className="metric-label px-4 py-3 text-left">Date</th><th className="metric-label px-4 py-3 text-right">Grams</th><th className="metric-label px-4 py-3 text-right">Invested</th><th className="metric-label px-4 py-3 text-right">Buy rate / gram</th><th className="metric-label px-4 py-3 text-right">Actions</th></tr></thead>
              <tbody>{trades.map((trade) => {
                const invested = trade.quantity.valueAt(trade.pricePerUnit, "HALF_EVEN").plus(trade.charges);
                return <tr key={trade.id} className="border-b border-gray-600/50 align-top last:border-0">
                  <td className="tnum px-4 py-3 text-gray-400">{trade.tradedOn.toISO()}</td>
                  <td className="tnum px-4 py-3 text-right text-gray-200">{trade.quantity.toDecimalString()}g</td>
                  <td className="px-4 py-3 text-right"><MoneyText value={invested} tone="neutral" /></td>
                  <td className="px-4 py-3 text-right"><MoneyText value={trade.pricePerUnit} tone="neutral" /></td>
                  <td className="px-4 py-3"><MetalTransactionActions instrumentId={instrumentId} tradeId={trade.id} grams={trade.quantity.toDecimalString()} invested={invested.toDecimalString()} charges={trade.charges.toDecimalString()} recordedOn={trade.tradedOn.toISO()} accounts={settlementAccounts} fundingAccountId={trade.settlementAccountId} /></td>
                </tr>;
              })}</tbody>
            </table></div>}
          </section>
          <Card title="Add investment transaction" subtitle="Record each monthly investment separately with its grams, invested amount and acquisition date. The average buy rate and all portfolio totals are recalculated automatically." className="mb-6">
            <MetalHoldingForm instrumentId={instrumentId} defaultDate={today.toISO()} accounts={settlementAccounts} />
          </Card>
          {instrument.kind === "DIGITAL_GOLD" && (
            <section className="panel mb-6 p-0">
              <div className="flex items-center justify-between border-b border-gray-600 px-5 py-4">
                <div>
                  <h2 className="text-sm font-semibold text-gray-100">Gold leases</h2>
                  <p className="mt-1 text-xs text-gray-500">Leasing is separate from buying. Allocate any currently unleased grams and manage monthly gold interest here.</p>
                </div>
                <Pill tone="neutral">{leaseRows.length} leases</Pill>
              </div>
              {leaseRows.length === 0 ? (
                <p className="px-5 py-6 text-sm text-gray-500">No gold is on lease yet.</p>
              ) : (
                <div className="table-scroll"><table className="w-full text-sm">
                  <caption className="sr-only">Digital-gold leases and monthly gram contributions</caption>
                  <thead><tr className="border-b border-gray-600">
                    <th className="metric-label px-4 py-3 text-left">Lease</th><th className="metric-label px-4 py-3 text-right">Principal</th><th className="metric-label px-4 py-3 text-right">Tenure</th><th className="metric-label px-4 py-3 text-right">Rate</th><th className="metric-label px-4 py-3 text-right">Monthly grams</th><th className="metric-label px-4 py-3 text-right">Earned to date</th><th className="metric-label px-4 py-3 text-right">Ready to add</th><th className="metric-label px-4 py-3 text-left">Actions</th>
                  </tr></thead>
                  <tbody>{leaseRows.map((row) => (
                    <tr key={row.lease.id.value} className="border-b border-gray-600/50 align-top last:border-0">
                      <td className="px-4 py-3"><span className="font-medium text-gray-100">{row.lease.reference}</span><p className="text-xs text-gray-500">{row.lease.props.platform} · {row.lease.props.startOn.toISO()} → {row.lease.props.closesOn.toISO()}</p></td>
                      <td className="tnum px-4 py-3 text-right text-gray-200">{row.lease.quantity.toDecimalString()}g</td>
                      <td className="tnum px-4 py-3 text-right text-gray-400">{row.lease.props.startOn.daysUntil(row.lease.props.closesOn)} days</td>
                      <td className="tnum px-4 py-3 text-right text-gray-400">{row.lease.props.annualRate.toFixed(2)}% p.a.</td>
                      <td className="tnum px-4 py-3 text-right text-green-500">{row.lease.schedule()[0]?.netInMonth.toDecimalString() ?? "0"}g<p className="text-xs text-gray-500">after TDS</p></td>
                      <td className="tnum px-4 py-3 text-right text-green-500">{row.accrual.net.toDecimalString()}g<p className="text-xs text-gray-500">gross {row.accrual.gross.toDecimalString()}g</p></td>
                      <td className="tnum px-4 py-3 text-right text-amber-500">{row.unpostedGrams.toDecimalString()}g</td>
                      <td className="px-4 py-3"><LeaseRowActions leaseId={row.lease.id.value} reference={row.lease.reference} defaultDate={today.toISO()} isActive={row.lease.status === "ACTIVE"} platform={row.lease.props.platform} quantity={row.lease.quantity.toDecimalString()} startOn={row.lease.props.startOn.toISO()} closesOn={row.lease.props.closesOn.toISO()} annualRate={row.lease.props.annualRate.toFixed(2)} tdsRate={(row.lease.props.tdsRate ?? DEFAULT_TDS_RATE).toFixed(2)} hasBookedInterest={!row.lease.credited.isZero} autoAccrue /></td>
                    </tr>
                  ))}</tbody>
                </table></div>
              )}
              <div className="border-t border-gray-600 px-5 py-5">
                <h3 className="text-sm font-semibold text-gray-100">Open a new lease</h3>
                <p className="mb-4 mt-1 text-xs text-gray-500">This does not record a purchase or change invested money. It allocates only gold already held and currently unleased.</p>
                <DigitalGoldLeaseForm instrumentId={instrumentId} platform={leasePlatform} availableGrams={leaseResult?.ok ? leaseResult.value.unleasedGrams.toDecimalString() : "0"} defaultDate={today.toISO()} />
              </div>
            </section>
          )}
        </>
      )}

      {!isDigitalMetal && <section className="panel mb-6 p-0">
        <div className="flex items-center justify-between border-b border-gray-600 px-5 py-4">
          <h2 className="text-sm font-semibold text-gray-100">Lots</h2>
          <p className="text-xs text-gray-500">
            The holding-period clock decides the tax on a sale, so it is per lot.
          </p>
        </div>
        <div className="table-scroll">
          <table className="w-full text-sm">
            <caption className="sr-only">
              Lots with acquisition date, units, cost per unit and days held
            </caption>
            <thead>
              <tr className="border-b border-gray-600">
                <th scope="col" className="metric-label px-4 py-3 text-left">Acquired</th>
                <th scope="col" className="metric-label px-4 py-3 text-right">Units</th>
                <th scope="col" className="metric-label px-4 py-3 text-right">Remaining</th>
                <th scope="col" className="metric-label px-4 py-3 text-right">Cost / unit</th>
                <th scope="col" className="metric-label px-4 py-3 text-right">Invested</th>
                <th scope="col" className="metric-label px-4 py-3 text-right">Days held</th>
                <th scope="col" className="metric-label px-4 py-3 text-left">Status</th>
              </tr>
            </thead>
            <tbody>
              {lots.map((lot) => {
                const days = lot.acquiredOn.daysUntil(today);
                const locked = instrument.disposalBlockedOn(lot.acquiredOn, today);
                return (
                  <tr key={lot.id.value} className="border-b border-gray-600/50 last:border-0">
                    <td className="tnum px-4 py-3 text-gray-400">{lot.acquiredOn.toISO()}</td>
                    <td className="tnum px-4 py-3 text-right text-gray-400">
                      {lot.props.originalQuantity.toDecimalString()}
                    </td>
                    <td className="tnum px-4 py-3 text-right text-gray-300">
                      {lot.remaining.toDecimalString()}
                    </td>
                    <td className="px-4 py-3 text-right"><MoneyText value={lot.costPerUnit} tone="neutral" /></td>
                    <td className="px-4 py-3 text-right"><MoneyText value={lot.totalInvested} tone="neutral" /></td>
                    <td className="tnum px-4 py-3 text-right">
                      <span className={days >= 365 ? "text-green-500" : "text-gray-400"}>{days}</span>
                    </td>
                    <td className="px-4 py-3 text-xs">
                      {lot.isExhausted ? (
                        <span className="text-gray-500">Sold</span>
                      ) : locked ? (
                        <span className="text-amber-500">Locked in</span>
                      ) : days >= 365 ? (
                        <span className="text-green-500">Long term</span>
                      ) : (
                        <span className="text-gray-400">Short term · {365 - days}d to go</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>}

      {!isDigitalMetal && <section className="panel mb-6 p-0">
        <div className="flex items-center justify-between border-b border-gray-600 px-5 py-4">
          <h2 className="text-sm font-semibold text-gray-100">Trades</h2>
          <p className="max-w-md text-xs text-gray-500">
            What was actually entered. Correcting one reverses it and books the fix, so the
            statement keeps both — the lots above are derived from this list.
          </p>
        </div>
        {trades.length === 0 ? (
          <p className="px-5 py-6 text-sm text-gray-500">
            Nothing recorded yet. The first purchase below creates the position.
          </p>
        ) : (
          <div className="table-scroll">
            <table className="w-full text-sm">
              <caption className="sr-only">
                Trades with side, date, units, price and charges, each editable
              </caption>
              <thead>
                <tr className="border-b border-gray-600">
                  <th scope="col" className="metric-label px-4 py-3 text-left">Side</th>
                  <th scope="col" className="metric-label px-4 py-3 text-left">Date</th>
                  <th scope="col" className="metric-label px-4 py-3 text-right">Units</th>
                  <th scope="col" className="metric-label px-4 py-3 text-right">Price</th>
                  <th scope="col" className="metric-label px-4 py-3 text-right">Charges</th>
                  <th scope="col" className="metric-label px-4 py-3 text-right">Consideration</th>
                  <th scope="col" className="metric-label px-4 py-3 text-left">Do</th>
                </tr>
              </thead>
              <tbody>
                {trades.map((trade) => (
                  <tr key={trade.id} className="border-b border-gray-600/50 align-top last:border-0">
                    <td className="px-4 py-3">
                      <span
                        className={
                          trade.side === "BUY"
                            ? "rounded-full border border-green-600/50 px-2 py-1 text-xs text-green-500"
                            : "rounded-full border border-amber-600/50 px-2 py-1 text-xs text-amber-500"
                        }
                      >
                        {trade.side === "BUY" ? "Bought" : "Sold"}
                      </span>
                    </td>
                    <td className="tnum px-4 py-3 text-gray-400">{trade.tradedOn.toISO()}</td>
                    <td className="tnum px-4 py-3 text-right text-gray-300">
                      {trade.quantity.toDecimalString()}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <MoneyText value={trade.pricePerUnit} tone="neutral" />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <MoneyText value={trade.charges} tone="neutral" />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <MoneyText
                        value={trade.quantity.valueAt(trade.pricePerUnit, "HALF_EVEN")}
                        tone="neutral"
                      />
                    </td>
                    <td className="px-4 py-3">
                      <TradeRowActions
                        instrumentId={instrumentId}
                        tradeId={trade.id}
                        side={trade.side}
                        quantity={trade.quantity.toDecimalString()}
                        pricePerUnit={trade.pricePerUnit.toDecimalString()}
                        charges={trade.charges.toDecimalString()}
                        tradedOn={trade.tradedOn.toISO()}
                        accounts={settlementAccounts}
                        settlementAccountId={trade.settlementAccountId}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>}

      {!isDigitalMetal && comparison?.ok && open.quantity.isPositive && (
        <Card
          title="What selling everything today would realise"
          subtitle="The same sale under each method. The difference is the tax you can choose."
          className="mb-6"
        >
          <div className="table-scroll">
            <table className="w-full text-sm">
              <caption className="sr-only">Realised gain by lot-selection method</caption>
              <thead>
                <tr className="border-b border-gray-600">
                  <th scope="col" className="metric-label px-3 py-2 text-left">Method</th>
                  <th scope="col" className="metric-label px-3 py-2 text-right">Cost basis</th>
                  <th scope="col" className="metric-label px-3 py-2 text-right">Gain</th>
                </tr>
              </thead>
              <tbody>
                {comparison.value.comparison.map((row) => (
                  <tr key={row.method} className="border-b border-gray-600/50 last:border-0">
                    <td className="px-3 py-2 text-gray-300">{row.method.replace(/_/g, " ")}</td>
                    <td className="px-3 py-2 text-right"><MoneyText value={row.costBasis} tone="neutral" /></td>
                    <td className="px-3 py-2 text-right"><MoneyText value={row.gain} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-gray-500">
            Specific-id behaves as FIFO here because no lots have been nominated — the honest
            answer rather than an omission.
          </p>
        </Card>
      )}

      {!isDigitalMetal && actions.length > 0 && (
        <Card title="Corporate actions" subtitle="Applied as events, so each one can be undone." className="mb-6">
          <ul className="space-y-2 text-sm">
            {actions.map((action) => (
              <li key={action.id} className="flex items-baseline justify-between gap-3">
                <span className="text-gray-300">{action.kind.replace(/_/g, " ")}</span>
                <span className="tnum text-xs text-gray-500">
                  ex {action.exDate.toISO()}
                  {action.appliedAt ? " · applied" : " · pending"}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {!isDigitalMetal && <Card
        title="Record a trade"
        subtitle="A trade is a ledger transaction first; the lot is derived from it, so the portfolio can always be rebuilt from the journal."
      >
        <TradeForms
          instrumentId={instrumentId}
          accounts={settlementAccounts}
          defaultDate={today.toISO()}
          heldUnits={open.quantity.toDecimalString()}
        />
      </Card>}

      <Card
        className="mt-6"
        title="This holding's details"
        subtitle="Correct the name, the platform, or the code the price feed knows it by — a holding that will not price is almost always a wrong code here."
      >
        <InstrumentAdmin
          instrumentId={instrumentId}
          kind={instrument.kind}
          name={instrument.name}
          isin={instrument.props.isin ?? null}
          exchange={instrument.props.exchange ?? null}
          quoteRef={instrument.props.quoteRef ?? null}
          currency={instrument.currency.code}
          institutionId={instrument.institutionId?.value ?? null}
          platforms={platforms}
          isClosed={instrument.isClosed}
          canDelete={trades.length === 0}
        />
      </Card>
    </>
  );
}

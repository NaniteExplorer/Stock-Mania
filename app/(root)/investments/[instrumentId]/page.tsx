import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Money } from "@/core/money";
import { Count } from "@/core/units";
import { Percentage, Quantity, UnitPrice } from "@/core/numeric";
import { CalendarDate } from "@/core/time";
import { DateRange } from "@/core/time";
import { Bond, InstrumentId, SovereignGoldBond } from "@/domain/instruments";
import { kindLabel } from "@/domain/asset-groups";
import type { StoredCorporateAction } from "@/domain/corporate";
import {
  cumulativeSplitFactorAfter,
  isIdentity,
  loggedSplit,
  normaliseTrade,
  type LoggedSplit,
} from "@/domain/split-normalisation";
import { LotBook } from "@/domain/lots";
import { CashAsset } from "@/domain/assets";
import { ChartPanel, Kpi, KpiStrip, Masthead, Page as PageShell, Panel } from "../../../../components/ui/page-shell";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "../../../../components/ui/table";
import { ActionCell, BadgeCell, FigureCell, FigureText, TextCell } from "../../../../components/ui/data-cell";
import { Banner } from "../../../../components/ui/banner";
import { rupee, signed, unknown, type FigureValue } from "@/core/format";
import { formatPercent } from "@/ui/format";
import { InstitutionMark } from "@/ui/provider-picker";
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
import GoldAdvisoryNote from "./gold-advisory-note";
import GoldReturnsPanel from "./gold-returns-panel";
import GoldLotLadder from "./gold-lot-ladder";
import GoldBenchmarkTable from "./gold-benchmark-table";
import GoldTaxStatement from "./gold-tax-statement";
import InvestmentActivity from "./investment-activity";
import HoldingNav, { normalizeHoldingView, type HoldingViewSearchParams } from "./holding-nav";
import PriceHistoryChart, { type PriceHistoryGap, type PriceHistoryPoint } from "./price-history-chart";
import ReturnsPanel, { type HoldingReturns } from "./returns-panel";
import NonDigitalHoldingProfile, { type NonDigitalHoldingFamily } from "./non-digital-holding-profile";

export const metadata: Metadata = { title: "Holding" };

const formatSyncedAt = (date: Date): string =>
  new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Kolkata",
  }).format(date);

/** A money figure, or the reason there is none — never a formatted zero. */
const moneyFigure = (value: Money | null, reason: string): FigureValue =>
  value ? rupee(value) : unknown(reason);
const gainFigure = (value: Money | null, reason: string): FigureValue =>
  value ? signed(value) : unknown(reason);

const formatQuantityPercent = (value: Quantity): string =>
  `${value.toApproximateNumber().toFixed(2)}%`;

/**
 * The owner's own logged splits, in the shape `split-normalisation.ts` wants.
 *
 * C2: a provider-observed split is never one of these. Only what the user
 * recorded as a corporate action counts, because only that has already moved his
 * lots.
 *
 * Bonuses count too: they enlarge the share count without a RESCALE effect, but a
 * price series is restated for them exactly as it is for a split, so omitting them
 * reproduces the same C3 error.
 *
 * A row missing either ratio side is skipped rather than guessed — inventing a 2:1
 * because most splits are 2:1 is exactly the class of silent wrongness C3 is about.
 * `ApplyCorporateAction` now persists both sides, but actions logged *before* that
 * fix stored empty strings and stay skipped until re-logged: visibly absent, never
 * quietly wrong.
 */
function loggedSplitsFrom(actions: readonly StoredCorporateAction[]): readonly LoggedSplit[] {
  const splits: LoggedSplit[] = [];
  for (const action of actions) {
    if (action.kind !== "SPLIT" && action.kind !== "REVERSE_SPLIT" && action.kind !== "BONUS") continue;
    const from = action.terms.ratioFrom?.trim();
    const to = action.terms.ratioTo?.trim();
    if (!from || !to) continue;
    splits.push(
      loggedSplit(action.exDate.toISO(), Quantity.fromString(from).scaled, Quantity.fromString(to).scaled),
    );
  }
  return splits;
}

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
        <span className="text-(--fg-secondary)">{label}</span>
        <span className="tnum text-(--fg)">{value.toDecimalString()}g</span>
      </div>
      <svg aria-hidden className="block h-2 w-full overflow-hidden rounded-full" preserveAspectRatio="none" viewBox="0 0 100 2">
        <rect width="100" height="2" fill="var(--bg-hover)" />
        <rect width={width} height="2" fill={tone === "green" ? "var(--gain)" : "var(--warn)"} />
      </svg>
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
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ instrumentId: string }>;
  searchParams: Promise<HoldingViewSearchParams>;
}) {
  await connection();

  const { instrumentId } = await params;
  const activeView = normalizeHoldingView((await searchParams).view);
  const userId = await currentUserId();
  const today = CalendarDate.parse(new Date().toISOString().slice(0, 10));
  const id = InstrumentId.from(instrumentId);

  const { investing, repositories, leasing, instrumentCatalog } = services();
  const instrument = await repositories.instruments.findById(userId, id);
  if (!instrument) notFound();
  const isDigitalMetal = instrument.kind === "DIGITAL_GOLD" || instrument.kind === "DIGITAL_SILVER" || instrument.kind === "DIGITAL_PLATINUM";

  const [lots, portfolio, actions, accounts, trades, platformRows, ledgerEvents] =
    await Promise.all([
      repositories.lots.allLots(userId, id),
      investing.valuePortfolio.execute({ userId, asOf: today }),
      investing.corporateActions(userId).listFor(id),
      repositories.accounts.list(userId),
      repositories.lots.tradesFor(userId, id),
      repositories.platforms.list(userId),
      // Every kind of holding gets the same read: it is keyed on the instrument's
      // own account, so it needs no per-kind branch here.
      repositories.investmentActivity.forInstrument(userId, id),
    ]);
  if (!portfolio.ok) throw new Error(portfolio.error.message);

  const position = portfolio.value.valued.find((row) => row.instrumentId.equals(id));
  const openLots = lots.filter((lot) => !lot.isExhausted);
  const open = LotBook.openPosition(openLots, instrument.currency);
  const currentQuotes = isDigitalMetal
    ? await repositories.quotes.findLatestOnOrBefore(id.value, "CLOSE", today, Count(1))
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

  /*
   * The benchmark replay is gold-only and deliberately non-fatal: it reaches a
   * price feed, and a comparison table that cannot be built is a missing panel,
   * never a 500 on the holding the user came to see. A failure is reported in
   * place of the table rather than swallowed.
   */
  const benchmarkResult = instrument.kind === "DIGITAL_GOLD"
    ? await investing.goldBenchmark.execute({ userId, instrumentId: id, asOf: today })
    : null;
  const benchmark = benchmarkResult?.ok ? benchmarkResult.value : null;
  const benchmarkError = benchmarkResult && !benchmarkResult.ok ? benchmarkResult.error.message : null;
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
  const cashInvestedValue = isDigitalMetal ? (analytics?.investedCost ?? investedValue) : investedValue;
  const cashAverageBuyRate = isDigitalMetal
    ? (analytics?.effectiveCostPerGram?.toMoney() ?? null)
    : averageBuyRate;
  const metalUnrealised = metalValue ? metalValue.minus(cashInvestedValue) : unrealisedValue;
  const metalReturn = metalUnrealised && cashInvestedValue.isPositive
    ? Percentage.ratio(metalUnrealised, cashInvestedValue)
    : absoluteReturn;
  const holdingMarketValue = isDigitalMetal ? metalValue : (position?.marketValue ?? null);
  const holdingUnrealised = holdingMarketValue ? holdingMarketValue.minus(cashInvestedValue) : null;
  const holdingReturn = holdingUnrealised && cashInvestedValue.isPositive
    ? Percentage.ratio(holdingUnrealised, cashInvestedValue)
    : null;
  const nonDigitalFamily: NonDigitalHoldingFamily = [
    "INDEX_FUND",
    "MUTUAL_FUND",
    "LIQUID_FUND",
    "DEBT_FUND",
    "ELSS_FUND",
  ].includes(instrument.kind)
    ? "FUND"
    : ["BOND", "GOVT_SECURITY", "SOVEREIGN_GOLD_BOND"].includes(instrument.kind)
      ? "FIXED_INCOME"
      : "EQUITY";
  const holdingPlatform = platformRows.find((platform) => platform.id.equals(instrument.institutionId))?.name ?? null;
  const cashSettledTrades = trades.filter((trade) => trade.settlementAccountId !== null);
  const lifecycleFacts = instrument instanceof Bond && instrument.terms
    ? [
        { label: "Face value", value: instrument.terms.faceValue.toDecimalString() },
        { label: "Coupon rate", value: `${instrument.terms.couponRate.toFixed(2)}% p.a.` },
        { label: "Maturity", value: instrument.terms.maturesOn.toISO() },
      ]
    : instrument instanceof SovereignGoldBond && instrument.terms
      ? [
          { label: "Issued", value: instrument.terms.issuedOn.toISO() },
          { label: "Maturity", value: instrument.terms.maturesOn.toISO() },
          { label: "Interest", value: "2.50% p.a.; taxable as recorded income" },
          { label: "Maturity treatment", value: "Capital-gain exemption applies to eligible maturity redemption" },
        ]
      : [];

  /*
   * Two different facts, and conflating them is what makes a working feed look
   * broken. `asOf` is the day the rate belongs to — IBJA publishes on business
   * days, so over a weekend the newest rate is Friday's and stays Friday's however
   * often it is fetched. `ingestedAt` is when we last went and looked. A user
   * watching only the first concludes nothing is updating; a user shown only the
   * second cannot tell that the price is three days old.
   */
  /*
   * The price chart and the returns panel, for everything that is not digital
   * metal (which has its own gram-priced pair above).
   *
   * Loaded here rather than inside the components so the components stay
   * presentational: the page is the only place that touches a repository, which
   * is the layering the rest of this route already follows.
   */
  const showMarketPanels = !isDigitalMetal && activeView === "performance";

  const barCoverage = showMarketPanels ? await repositories.bars.coverage(instrumentId, "DAY") : null;
  const historyRange = barCoverage
    ? DateRange.of(barCoverage.from, today.isAfter(barCoverage.through) ? today : barCoverage.through)
    : null;
  const [storedBars, barGaps] = historyRange
    ? await Promise.all([
        repositories.bars.findRange(instrumentId, "DAY", historyRange),
        repositories.bars.gaps(instrumentId, "DAY", historyRange),
      ])
    : [[], []];

  const historyPoints: PriceHistoryPoint[] = storedBars.map((bar) => ({
    on: bar.asOf.toISO(),
    /*
     * `toMoney()` rounds the 1e8-scaled close to the currency's minor units once,
     * here at the edge, and the number that crosses to the client is a count of
     * paise. No float touches the money path (C8) — recharts only ever scales
     * pixels from it.
     */
    closeMinor: bar.close.toMoney().toMinorNumber(),
  }));
  const historyGaps: PriceHistoryGap[] = barGaps.map((gap) => ({
    from: gap.start.toISO(),
    to: gap.end.toISO(),
    weekdays: gap.days,
  }));

  /* The live last price, appended past the last stored bar. */
  const marketQuotes = showMarketPanels
    ? await repositories.quotes.findLatestOnOrBefore(id.value, "CLOSE", today, Count(1))
    : [];
  const liveQuote = marketQuotes[0] ?? null;
  const livePoint = liveQuote
    ? { on: liveQuote.asOf.toISO(), closeMinor: liveQuote.price.toMoney().toMinorNumber() }
    : null;

  /*
   * The catalogue's verdict on the quote key, for the staleness badge (C6).
   *
   * Read through the existing search use case and matched on the key the
   * instrument actually carries: there is no repository method that maps a
   * portfolio instrument straight back to its catalogue listing, and adding one
   * belongs to the backend's file scope, not this route's. A miss simply means no
   * badge rather than a wrong one.
   */
  const instrumentQuoteRef = instrument.quoteKey().ref;
  const catalogueMatch = showMarketPanels
    ? (await instrumentCatalog.search.execute({ query: instrument.symbol, limit: 12 })).candidates.find(
        (candidate) =>
          candidate.quoteKey === instrumentQuoteRef ||
          candidate.listing.symbol.toUpperCase() === instrument.symbol.toUpperCase(),
      ) ?? null
    : null;

  /*
   * The split pair (C3). Both averages come from the **trade record**, which a
   * corporate action never rewrites, so "as traded" really is as traded; the
   * lots above it are the ones `ApplyCorporateAction` rescales, and mixing the
   * two is how the factor lands twice.
   */
  const splits = loggedSplitsFrom(actions);
  const buys = trades.filter((trade) => trade.side === "BUY");
  const boughtQuantity = buys.reduce((total, trade) => total.plus(trade.quantity), Quantity.ZERO);
  const boughtCost = Money.total(
    buys.map((trade) => UnitPrice.fromMoney(trade.pricePerUnit).times(trade.quantity)),
    instrument.currency,
  );
  const normalisedBuys = buys.map((trade) =>
    normaliseTrade(
      {
        quantity: trade.quantity,
        price: UnitPrice.fromMoney(trade.pricePerUnit),
        tradeDate: trade.tradedOn,
      },
      splits,
    ),
  );
  const normalisedQuantity = normalisedBuys.reduce(
    (total, normalised) => total.plus(normalised.quantity),
    Quantity.ZERO,
  );
  const anySplitApplies = buys.some(
    (trade) => !isIdentity(cumulativeSplitFactorAfter(splits, trade.tradedOn)),
  );

  const returnsResult = showMarketPanels
    ? await investing.returns.execute({ userId, asOf: today, instrumentId: id })
    : null;

  const holdingReturns: HoldingReturns | null = returnsResult?.ok
    ? {
        currency: instrument.currency.code,
        quantity: open.quantity,
        costBasis: investedValue,
        averageBuyPriceAsTraded: boughtQuantity.isPositive
          ? boughtQuantity.perUnit(boughtCost, "HALF_EVEN")
          : null,
        boughtQuantityAsTraded: boughtQuantity,
        averageBuyPricePerCurrentShare:
          anySplitApplies && normalisedQuantity.isPositive
            ? normalisedQuantity.perUnit(boughtCost, "HALF_EVEN")
            : null,
        boughtQuantityInCurrentShares: anySplitApplies ? normalisedQuantity : null,
        splitFactorLabel: anySplitApplies
          ? `${splits.length} split${splits.length === 1 ? "" : "s"}`
          : null,
        marketValue: position?.marketValue ?? null,
        unrealisedGain: holdingUnrealised,
        absoluteReturn: holdingReturn,
        xirr: returnsResult.value.xirr,
        pricedOn: position?.pricedOn?.toISO() ?? null,
        isStale: position?.isStale ?? false,
        unpricedReason: position?.unpricedReason ?? null,
        unconverted: position?.reportingCostBasis === null,
        asOf: today.toISO(),
      }
    : null;
  const returnsError = returnsResult && !returnsResult.ok ? returnsResult.error.message : null;

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
    <PageShell>
      <Masthead
        title={`${instrument.symbol} — ${instrument.name}`}
        side={
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-(--fg-muted)">
              {profile.lockInMonths ? `${profile.lockInMonths / 12}-year lock-in` : instrument.unit.toLowerCase()}
            </span>
            <Link href="/investments" className="ghost-btn h-10 px-4 text-xs">All holdings</Link>
            <RefreshPricesButton instrumentId={instrumentId} auto={isDigitalMetal} lastSyncedAt={lastSyncedAt?.toISOString() ?? null} />
          </div>
        }
      />
      <p className="max-w-2xl text-sm text-(--fg-muted)">
        {`${instrument.kind.replace(/_/g, " ").toLowerCase()} · taxed as ${profile.category
          .replace(/_/g, " ")
          .toLowerCase()}${profile.slabTaxedAlways ? ", at slab whatever the holding period" : ""}`}
      </p>

      <HoldingNav instrumentId={instrumentId} activeView={activeView} />

      {activeView === "summary" && <>
        {/* A quantity is not a FigureValue (src/core/format.ts formats money and percentages only), so it stays outside the strip. */}
        <p className="text-sm text-(--fg-muted)">
          {isDigitalMetal ? "Grams held" : "Units held"}{" "}
          <span className="tnum font-semibold text-(--fg)">{open.quantity.toDecimalString()}</span>
          {" · "}
          {isDigitalMetal ? "Current recorded platform balance" : `${openLots.length} open lot(s)`}
        </p>
        <KpiStrip>
          <Kpi label="Invested" value={rupee(cashInvestedValue)} detail={isDigitalMetal ? "Cash paid; lease credits excluded" : "Price plus charges"} />
          <Kpi
            label="Market value"
            value={moneyFigure(position?.marketValue ?? null, position?.unpricedReason ?? "No price")}
            detail={position?.pricedOn ? `Priced ${position.pricedOn.toISO()}${position.isStale ? " · stale" : ""}` : undefined}
          />
          {isDigitalMetal ? (
            <Kpi label="Realised" value={signed(position?.realisedGain ?? Money.zero())} detail="Gains already taken" />
          ) : (
            <Kpi
              label="Unrealised gain / loss"
              value={gainFigure(holdingUnrealised, "Needs a priced open position")}
              detail={holdingReturn ? `${formatPercent(holdingReturn)} on open cost` : undefined}
            />
          )}
        </KpiStrip>
      </>}

      {!isDigitalMetal && activeView === "summary" && (
        <NonDigitalHoldingProfile
          family={nonDigitalFamily}
          kindLabel={kindLabel(instrument.kind, instrument.currency.code)}
          currency={instrument.currency.code}
          exchange={instrument.props.exchange ?? null}
          isin={instrument.props.isin ?? null}
          quoteRef={instrument.quoteKey().ref ?? null}
          platform={holdingPlatform}
          openLots={openLots.length}
          tradeCount={trades.length}
          corporateActionCount={actions.length}
          pricedOn={position?.pricedOn?.toISO() ?? null}
          isStale={position?.isStale ?? false}
          unpricedReason={position?.unpricedReason ?? null}
          lifecycle={lifecycleFacts}
          view="summary"
       />
      )}

      {isDigitalMetal && (
        <>
          {activeView === "summary" && <KpiStrip>
            <Kpi label="Average buy rate / gram" value={moneyFigure(cashAverageBuyRate, "No purchases recorded")} detail="Cash paid ÷ bought grams" />
            <Kpi
              label={hasSpread ? "Buy-back rate / gram" : "Current gold price / gram"}
              value={moneyFigure(metalRate, priceUpdatedHint)}
              detail={hasSpread ? `${analytics!.sellSpread.toFixed(2)}% under the ${analytics!.benchmarkPricePerGram?.toDecimalString()} benchmark · ${priceUpdatedHint}` : priceUpdatedHint}
            />
            <Kpi
              label={hasSpread ? "Realisable value" : "Current value"}
              value={moneyFigure(metalValue, "No current price")}
              detail={hasSpread ? "What selling on the platform would produce today" : "Grams × current 1g price"}
            />
            <Kpi
              label="Unrealised gain / loss"
              value={gainFigure(metalUnrealised, "Current value less invested amount; tax applies only on sale")}
              detail={metalReturn ? `${formatPercent(metalReturn)} absolute; tax applies only on sale` : "Current value less invested amount; tax applies only on sale"}
            />
          </KpiStrip>}
          {activeView === "summary" && instrument.kind === "DIGITAL_GOLD" && <GoldAdvisoryNote isLeased={leasedGrams.isPositive} />}
          {activeView === "income-leases" && <Panel
            title="Investor analysis"
            description="Position quality, lease deployment and pricing freshness in one view."
            actions={<span className="text-xs text-(--fg-muted)">{latestQuote ? `Checked ${formatSyncedAt(latestQuote.ingestedAt)}` : "No live price"}</span>}
          >
            <div className="grid gap-4 lg:grid-cols-[1.1fr_1fr]">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg border border-(--border) p-4">
                  <p className="text-xs font-medium text-(--fg-muted)">Price spread / gram</p>
                  <p className="mt-2 text-xl font-semibold text-(--fg)">{rateSpread ? <FigureText value={rateSpread} tone="change" /> : "—"}</p>
                  <p className="mt-1 text-xs text-(--fg-muted)">{rateSpreadPercent ? `${formatPercent(rateSpreadPercent)} versus average buy rate` : "Needs current price and buy history"}</p>
                </div>
                <div className="rounded-lg border border-(--border) p-4">
                  <p className="text-xs font-medium text-(--fg-muted)">Lease deployment</p>
                  <p className="mt-2 text-xl font-semibold text-(--fg)">{formatQuantityPercent(leaseDeployment)}</p>
                  <p className="mt-1 text-xs text-(--fg-muted)">{leasedGrams.toDecimalString()}g leased, {unleasedGramsValue.toDecimalString()}g idle</p>
                </div>
                <div className="rounded-lg border border-(--border) p-4">
                  <p className="text-xs font-medium text-(--fg-muted)">Weighted lease rate</p>
                  <p className="mt-2 text-xl font-semibold text-(--fg)">{weightedLeaseRate ? `${weightedLeaseRate.toFixed(2)}% p.a.` : "-"}</p>
                  <p className="mt-1 text-xs text-(--fg-muted)">{activeLeaseRows.length} active lease{activeLeaseRows.length === 1 ? "" : "s"}</p>
                </div>
                <div className="rounded-lg border border-(--border) p-4">
                  <p className="text-xs font-medium text-(--fg-muted)">Due to add</p>
                  <p className="mt-2 text-xl font-semibold text-(--warn)">{leasePortfolio?.unpostedGrams.toDecimalString() ?? "0"}g</p>
                  <p className="mt-1 text-xs text-(--fg-muted)">Gold interest earned but not yet added to holding lots</p>
                </div>
              </div>
              <div className="rounded-lg border border-(--border) p-4">
                <p className="text-xs font-medium text-(--fg-muted)">Gold deployment</p>
                <div className="mt-4 space-y-4">
                  <GramBar label="Leased and earning" value={leasedGrams} total={open.quantity} />
                  <GramBar label="Unleased wallet balance" value={unleasedGramsValue} total={open.quantity} tone="amber" />
                </div>
                <div className="mt-4 grid grid-cols-2 gap-3 border-t border-(--border) pt-4 text-xs">
                  <div>
                    <p className="text-xs font-medium text-(--fg-muted)">Earned to date</p>
                    <p className="tnum mt-1 text-(--gain)">{leasePortfolio?.netInterestGrams.toDecimalString() ?? "0"}g net</p>
                  </div>
                  <div>
                    <p className="text-xs font-medium text-(--fg-muted)">Withheld as TDS</p>
                    <p className="tnum mt-1 text-(--fg)">{leasePortfolio?.tdsGrams.toDecimalString() ?? "0"}g</p>
                  </div>
                </div>
              </div>
            </div>
          </Panel>}
          {analytics && (
            <>
              {activeView === "performance" && <Panel
                title="Where the profit came from"
                description="Measured against cash actually paid, charges and taxes included. Grams credited by a lease cost nothing out of pocket, so everything they are worth is profit — the two halves below add to the total exactly."
                actions={
                  <span className="text-xs text-(--fg-muted)">
                    {analytics.pricedOn ? `Priced ${analytics.pricedOn.toISO()}` : "No price"}
                  </span>
                }
              >

                {analytics.benchmarkValue && (
                  <div className="mb-4 rounded-lg border border-(--border) p-4">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2 text-sm">
                      <span className="text-(--fg-secondary)">
                        Benchmark value
                        <span className="ml-2 text-xs text-(--fg-muted)">
                          IBJA, {analytics.benchmarkPricePerGram?.toDecimalString()}/g
                        </span>
                      </span>
                      <span className="tnum text-(--fg)">
                        {analytics.benchmarkValue.toDecimalString()}
                      </span>
                    </div>
                    {analytics.sellSpread.isZero ? (
                      <p className="mt-2 text-xs text-(--fg-muted)">
                        Valued at the bullion benchmark, because no buy-back spread is recorded for
                        this platform. Digital gold normally sells back 3-6% under it, and the 3%
                        GST paid on the way in never comes back — so this figure is optimistic by
                        that much. Set the spread on the platform and every number here becomes what
                        you could actually realise.
                      </p>
                    ) : (
                      <>
                        <div className="mt-2 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2 text-sm">
                          <span className="text-(--fg-secondary)">
                            Buy-back spread
                            <span className="ml-2 text-xs text-(--fg-muted)">
                              {analytics.sellSpread.toFixed(2)}% under benchmark
                            </span>
                          </span>
                          <span className="tnum text-(--warn)">
                            −{analytics.spreadCost?.toDecimalString()}
                          </span>
                        </div>
                        <div className="mt-2 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2 border-t border-(--border) pt-2 text-sm">
                          <span className="font-medium text-(--fg)">
                            Realisable today
                            <span className="ml-2 text-xs text-(--fg-muted)">
                              at {analytics.pricePerGram?.toDecimalString()}/g
                            </span>
                          </span>
                          <span className="tnum font-semibold text-(--fg)">
                            {analytics.marketValue?.toDecimalString()}
                          </span>
                        </div>
                        <p className="mt-2 text-xs text-(--fg-muted)">
                          Every figure below — the profit split and the chart — is computed at the
                          buy-back rate, not the benchmark, so it is what selling would actually
                          produce.
                        </p>
                      </>
                    )}
                  </div>
                )}

                {analytics.unpricedReason && (
                  <p className="mb-4 rounded-lg border border-(--warn)/40 bg-(--warn)/5 px-3 py-2 text-xs text-(--warn)">
                    {analytics.unpricedReason}
                  </p>
                )}
                {analytics.leaseGramsReconcile && (
                  <p className="mb-4 rounded-lg border border-(--warn)/40 bg-(--warn)/5 px-3 py-2 text-xs text-(--warn)">
                    {analytics.leaseGramsReconcile}
                  </p>
                )}

                <KpiStrip>
                  <Kpi
                    label="Total profit"
                    value={gainFigure(analytics.totalProfit, analytics.unpricedReason ?? "No price")}
                    detail={analytics.totalProfitPercent ? `${formatPercent(analytics.totalProfitPercent)} on cash paid` : "Over what was actually paid"}
                  />
                  <Kpi
                    label="From gold price"
                    value={gainFigure(analytics.priceProfit, analytics.unpricedReason ?? "No price")}
                    detail={`${analytics.purchasedGrams.toDecimalString()}g bought, now worth more or less than they cost`}
                  />
                  <Kpi
                    label="From lease interest"
                    value={gainFigure(analytics.leaseProfit, analytics.unpricedReason ?? "No price")}
                    detail={`${analytics.leaseGrams.toDecimalString()}g the lease paid for${analytics.leaseShareOfProfit ? ` · ${formatPercent(analytics.leaseShareOfProfit)} of the profit` : ""}`}
                  />
                  <Kpi
                    label="Effective cost / gram"
                    value={moneyFigure(analytics.effectiveCostPerGram?.toMoney() ?? null, "Cash paid ÷ grams bought, taxes and charges included")}
                    detail={
                      analytics.blendedCostPerGram
                        ? `${analytics.blendedCostPerGram.toMoney().toDecimalString()} once the free lease grams are counted in`
                        : "Cash paid ÷ grams bought, taxes and charges included"
                    }
                  />
                </KpiStrip>

                <div className="mt-4 grid gap-4 lg:grid-cols-[1.1fr_1fr]">
                  <div className="rounded-lg border border-(--border) p-4">
                    <p className="text-xs font-medium text-(--fg-muted)">Grams in the holding, by where they came from</p>
                    <div className="mt-4 space-y-4">
                      <GramBar label="Bought with money" value={analytics.purchasedGrams} total={analytics.totalGrams} />
                      <GramBar label="Credited by a lease" value={analytics.leaseGrams} total={analytics.totalGrams} tone="amber" />
                    </div>
                    <p className="mt-4 border-t border-(--border) pt-3 text-xs text-(--fg-muted)">
                      Total {analytics.totalGrams.toDecimalString()}g. A sale consumes lots, so selling gold
                      lowers both bars and the profit split above without any separate adjustment.
                    </p>
                  </div>
                  <div className="rounded-lg border border-(--border) p-4">
                    <p className="text-xs font-medium text-(--fg-muted)">Lease gram flow</p>
                    <dl className="mt-3 space-y-2 text-xs">
                      <div className="flex items-baseline justify-between gap-3">
                        <dt className="text-(--fg-secondary)">Credited over every lease</dt>
                        <dd className="tnum text-(--fg)">{analytics.creditedGramsEver.toDecimalString()}g</dd>
                      </div>
                      <div className="flex items-baseline justify-between gap-3">
                        <dt className="text-(--fg-secondary)">Still held</dt>
                        <dd className="tnum text-(--gain)">{analytics.leaseGrams.toDecimalString()}g</dd>
                      </div>
                      <div className="flex items-baseline justify-between gap-3">
                        <dt className="text-(--fg-secondary)">Sold or otherwise gone</dt>
                        <dd className="tnum text-(--fg)">{analytics.leaseGramsDisposed.toDecimalString()}g</dd>
                      </div>
                      <div className="flex items-baseline justify-between gap-3">
                        <dt className="text-(--fg-secondary)">Earned, not yet added</dt>
                        <dd className="tnum text-(--warn)">
                          {analytics.dueGrams.toDecimalString()}g
                          {analytics.dueValue ? ` · ${analytics.dueValue.toDecimalString()}` : ""}
                        </dd>
                      </div>
                      <div className="flex items-baseline justify-between gap-3">
                        <dt className="text-(--fg-secondary)">Withheld as TDS</dt>
                        <dd className="tnum text-(--fg)">{analytics.tdsGrams.toDecimalString()}g</dd>
                      </div>
                      <div className="flex items-baseline justify-between gap-3 border-t border-(--border) pt-2">
                        <dt className="text-(--fg-secondary)">Unrealised against book cost</dt>
                        <dd className="tnum text-(--fg)">{analytics.unrealisedAgainstBook ? <FigureText value={analytics.unrealisedAgainstBook} tone="change" /> : "—"}</dd>
                      </div>
                    </dl>
                    <p className="mt-3 text-xs text-(--fg-muted)">
                      The book figure nets off the value the lease grams were taxed at when they were
                      credited. It is the accounting answer; the profit above is the cash one. They are
                      never added together.
                    </p>
                  </div>
                </div>
              </Panel>}

              {activeView === "performance" && <GoldReturnsPanel analytics={analytics} />}

              {activeView === "performance" && <GoldProfitChart points={profitPoints} currency={instrument.currency.code} instrumentId={instrumentId} />}

              {activeView === "lots-tax" && <GoldLotLadder analytics={analytics} unit={isDigitalMetal ? "Grams" : "Units"} />}

              {activeView === "performance" && instrument.kind === "DIGITAL_GOLD" && (
                <>
                  {benchmark ? (
                    <GoldBenchmarkTable comparison={benchmark} />
                  ) : (
                    <Panel title="Was digital gold the right vehicle?">
                      <p className="text-xs text-(--warn)">
                        {benchmarkError ??
                          "The benchmark comparison could not be built for this holding."}
                      </p>
                    </Panel>
                  )}
                </>
              )}
              {activeView === "lots-tax" && instrument.kind === "DIGITAL_GOLD" && (
                <GoldTaxStatement
                  analytics={analytics}
                  tdsWithheldGrams={analytics.tdsGrams.toDecimalString()}
               />
              )}
            </>
          )}

          {activeView === "activity" && <Panel
            title="Investment transactions"
            description="Every monthly investment is retained separately and drives the holding totals above."
            actions={<span className="text-xs text-(--fg-muted)">{cashSettledTrades.length} entries</span>}
          >
            {cashSettledTrades.length === 0 ? <p className="text-sm text-(--fg-muted)">No cash investments recorded yet.</p> : <Table>
              <TableCaption className="sr-only">Digital-metal investment transactions</TableCaption>
              <TableHeader><TableRow><TableHead>Date</TableHead><TableHead className="text-right">Grams</TableHead><TableHead className="text-right">Invested</TableHead><TableHead className="text-right">Buy rate / gram</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
              <TableBody>{cashSettledTrades.map((trade) => {
                const invested = trade.quantity.valueAt(trade.pricePerUnit, "HALF_EVEN").plus(trade.charges);
                return <TableRow key={trade.id}>
                  <TextCell className="tnum">{trade.tradedOn.toISO()}</TextCell>
                  <TableCell className="tnum text-right text-(--fg)">{trade.quantity.toDecimalString()}g</TableCell>
                  <FigureCell value={invested} />
                  <FigureCell value={trade.pricePerUnit} />
                  <ActionCell><MetalTransactionActions instrumentId={instrumentId} tradeId={trade.id} grams={trade.quantity.toDecimalString()} invested={invested.toDecimalString()} charges={trade.charges.toDecimalString()} recordedOn={trade.tradedOn.toISO()} accounts={settlementAccounts} fundingAccountId={trade.settlementAccountId} /></ActionCell>
                </TableRow>;
              })}</TableBody>
            </Table>}
          </Panel>}
          {activeView === "activity" && (
            <InvestmentActivity events={ledgerEvents} unit="g" />
          )}
          {activeView === "activity" && <Panel title="Add investment transaction" description="Record each monthly investment separately with its grams, invested amount and acquisition date. The average buy rate and all portfolio totals are recalculated automatically.">
            <MetalHoldingForm instrumentId={instrumentId} defaultDate={today.toISO()} accounts={settlementAccounts} />
          </Panel>}
          {activeView === "income-leases" && instrument.kind === "DIGITAL_GOLD" && (
            <Panel
              title="Gold leases"
              description="Leasing is separate from buying. Allocate any currently unleased grams and manage monthly gold interest here."
              actions={<span className="text-xs text-(--fg-muted)">{leaseRows.length} leases</span>}
            >
              {leaseRows.length === 0 ? (
                <p className="text-sm text-(--fg-muted)">No gold is on lease yet.</p>
              ) : (
                <Table>
                  <TableCaption className="sr-only">Digital-gold leases and monthly gram contributions</TableCaption>
                  <TableHeader><TableRow>
                    <TableHead>Lease</TableHead><TableHead className="text-right">Principal</TableHead><TableHead className="text-right">Tenure</TableHead><TableHead className="text-right">Rate</TableHead><TableHead className="text-right">Monthly grams</TableHead><TableHead className="text-right">Earned to date</TableHead><TableHead className="text-right">Ready to add</TableHead><TableHead>Actions</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>{leaseRows.map((row) => (
                    <TableRow key={row.lease.id.value} className="border-b border-(--border)/50 align-top last:border-0">
                      <TableCell><span className="font-medium text-(--fg)">{row.lease.reference}</span><p className="flex items-center gap-2 text-xs text-(--fg-muted)"><InstitutionMark institution={row.lease.props.platform} /><span>{row.lease.props.platform} · {row.lease.props.startOn.toISO()} → {row.lease.props.closesOn.toISO()}</span></p></TableCell>
                      <TableCell className="tnum text-right text-(--fg)">{row.lease.quantity.toDecimalString()}g</TableCell>
                      <TableCell className="tnum text-right text-(--fg-secondary)">{row.lease.props.startOn.daysUntil(row.lease.props.closesOn)} days</TableCell>
                      <TableCell className="tnum text-right text-(--fg-secondary)">{row.lease.props.annualRate.toFixed(2)}% p.a.</TableCell>
                      <TableCell className="tnum text-right text-(--gain)">{row.lease.schedule()[0]?.netInMonth.toDecimalString() ?? "0"}g<p className="text-xs text-(--fg-muted)">{row.lease.tdsRate.isZero ? "no TDS withheld" : "after TDS"}</p></TableCell>
                      <TableCell className="tnum text-right text-(--gain)">{row.accrual.net.toDecimalString()}g<p className="text-xs text-(--fg-muted)">gross {row.accrual.gross.toDecimalString()}g</p></TableCell>
                      <TableCell className="tnum text-right text-(--warn)">{row.unpostedGrams.toDecimalString()}g</TableCell>
                      <ActionCell><LeaseRowActions leaseId={row.lease.id.value} reference={row.lease.reference} defaultDate={today.toISO()} isActive={row.lease.status === "ACTIVE"} platform={row.lease.props.platform} quantity={row.lease.quantity.toDecimalString()} startOn={row.lease.props.startOn.toISO()} closesOn={row.lease.props.closesOn.toISO()} annualRate={row.lease.props.annualRate.toFixed(2)} tdsRate={row.lease.tdsRate.toFixed(2)} hasBookedInterest={!row.lease.credited.isZero} autoAccrue /></ActionCell>
                    </TableRow>
                  ))}</TableBody>
                </Table>
              )}
              <div className="mt-5">
                <h3 className="text-sm font-semibold text-(--fg)">Open a new lease</h3>
                <p className="mb-4 mt-1 text-xs text-(--fg-muted)">This does not record a purchase or change invested money. It allocates only gold already held and currently unleased.</p>
                <DigitalGoldLeaseForm instrumentId={instrumentId} platform={leasePlatform} availableGrams={leaseResult?.ok ? leaseResult.value.unleasedGrams.toDecimalString() : "0"} defaultDate={today.toISO()} />
              </div>
            </Panel>
          )}
        </>
      )}

      {showMarketPanels && (
        <ChartPanel
          title="Price history"
          summary={`Recorded price history for ${instrument.symbol}, with the latest quote when available.`}
          state={{ kind: "ready", children: (
          <PriceHistoryChart
            symbol={instrument.symbol}
            instrumentId={instrumentId}
            currency={instrument.currency.code}
            points={historyPoints}
            live={livePoint}
            gaps={historyGaps}
            quoteKey={catalogueMatch?.quoteKey ?? instrumentQuoteRef ?? null}
            quoteStale={catalogueMatch?.quoteStale ?? false}
            firstTradeDate={catalogueMatch?.firstTradeDate ?? null}
         />
          ) }}
        />
      )}

      {showMarketPanels && holdingReturns && <ReturnsPanel returns={holdingReturns} />}
      {showMarketPanels && returnsError && (
        <Banner tone="error" role="alert" title="Returns could not be computed for this holding">
          <p>{returnsError}</p>
        </Banner>
      )}

      {!isDigitalMetal && activeView === "performance" && (
        <NonDigitalHoldingProfile
          family={nonDigitalFamily}
          kindLabel={kindLabel(instrument.kind, instrument.currency.code)}
          currency={instrument.currency.code}
          exchange={instrument.props.exchange ?? null}
          isin={instrument.props.isin ?? null}
          quoteRef={instrument.quoteKey().ref ?? null}
          platform={holdingPlatform}
          openLots={openLots.length}
          tradeCount={trades.length}
          corporateActionCount={actions.length}
          pricedOn={position?.pricedOn?.toISO() ?? null}
          isStale={position?.isStale ?? false}
          unpricedReason={position?.unpricedReason ?? null}
          lifecycle={lifecycleFacts}
          view="performance"
       />
      )}

      {!isDigitalMetal && activeView === "income-leases" && (
        <NonDigitalHoldingProfile
          family={nonDigitalFamily}
          kindLabel={kindLabel(instrument.kind, instrument.currency.code)}
          currency={instrument.currency.code}
          exchange={instrument.props.exchange ?? null}
          isin={instrument.props.isin ?? null}
          quoteRef={instrument.quoteKey().ref ?? null}
          platform={holdingPlatform}
          openLots={openLots.length}
          tradeCount={trades.length}
          corporateActionCount={actions.length}
          pricedOn={position?.pricedOn?.toISO() ?? null}
          isStale={position?.isStale ?? false}
          unpricedReason={position?.unpricedReason ?? null}
          lifecycle={lifecycleFacts}
          view="income-leases"
       />
      )}

      {activeView === "income-leases" && instrument.kind !== "DIGITAL_GOLD" && isDigitalMetal && (
        <Panel
          title="Income & leases"
          description="Lease features are only defined for digital gold in the current contract. This holding keeps income and ownership in its trade and lot records, with no lease controls to show."
          actions={<span className="text-xs text-(--fg-muted)">Not applicable</span>}
        >
          {null}
        </Panel>
      )}

      {!isDigitalMetal && activeView === "lots-tax" && <Panel
        flush
        title="Lots"
        description="The holding-period clock decides the tax on a sale, so it is per lot."
      >
          <Table>
            <TableCaption className="sr-only">
              Lots with acquisition date, units, cost per unit and days held
            </TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead>Acquired</TableHead>
                <TableHead className="text-right">Units</TableHead>
                <TableHead className="text-right">Remaining</TableHead>
                <TableHead className="text-right">Cost / unit</TableHead>
                <TableHead className="text-right">Invested</TableHead>
                <TableHead className="text-right">Days held</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lots.map((lot) => {
                const days = lot.acquiredOn.daysUntil(today);
                const locked = instrument.disposalBlockedOn(lot.acquiredOn, today);
                return (
                  <TableRow key={lot.id.value} className="border-b border-(--border)/50 last:border-0">
                    <TableCell className="tnum text-(--fg-secondary)">{lot.acquiredOn.toISO()}</TableCell>
                    <TableCell className="tnum text-right text-(--fg-secondary)">
                      {lot.props.originalQuantity.toDecimalString()}
                    </TableCell>
                    <TableCell className="tnum text-right text-(--fg-secondary)">
                      {lot.remaining.toDecimalString()}
                    </TableCell>
                    <FigureCell value={lot.costPerUnit} />
                    <FigureCell value={lot.totalInvested} />
                    <TableCell className="tnum text-right">
                      <span className={days >= 365 ? "text-(--gain)" : "text-(--fg-secondary)"}>{days}</span>
                    </TableCell>
                    <TableCell className="text-xs">
                      {lot.isExhausted ? (
                        <span className="text-(--fg-muted)">Sold</span>
                      ) : locked ? (
                        <span className="text-(--warn)">Locked in</span>
                      ) : days >= 365 ? (
                        <span className="text-(--gain)">Long term</span>
                      ) : (
                        <span className="text-(--fg-secondary)">Short term · {365 - days}d to go</span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
      </Panel>}

      {!isDigitalMetal && activeView === "activity" && <Panel
        title="Trades"
        description="What was actually entered. Correcting one reverses it and books the fix, so the statement keeps both — the lots above are derived from this list."
      >
        {trades.length === 0 ? (
          <p className="text-sm text-(--fg-muted)">
            Nothing recorded yet. The first purchase below creates the position.
          </p>
        ) : (
            <Table>
              <TableCaption className="sr-only">
                Trades with side, date, units, price and charges, each editable
              </TableCaption>
              <TableHeader>
                <TableRow>
                  <TableHead>Side</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead className="text-right">Units</TableHead>
                  <TableHead className="text-right">Price</TableHead>
                  <TableHead className="text-right">Charges</TableHead>
                  <TableHead className="text-right">Consideration</TableHead>
                  <TableHead>Do</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {trades.map((trade) => (
                  <TableRow key={trade.id} className="border-b border-(--border)/50 align-top last:border-0">
                    <BadgeCell tone={trade.side === "BUY" ? "gain" : "warning"}>
                      {trade.side === "BUY" ? "Bought" : "Sold"}
                    </BadgeCell>
                    <TableCell className="tnum text-(--fg-secondary)">{trade.tradedOn.toISO()}</TableCell>
                    <TableCell className="tnum text-right text-(--fg-secondary)">
                      {trade.quantity.toDecimalString()}
                    </TableCell>
                    <FigureCell value={trade.pricePerUnit} />
                    <FigureCell value={trade.charges} />
                    <FigureCell value={trade.quantity.valueAt(trade.pricePerUnit, "HALF_EVEN")} />
                    <ActionCell>
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
                    </ActionCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
        )}
      </Panel>}

      {!isDigitalMetal && activeView === "lots-tax" && comparison?.ok && open.quantity.isPositive && (
        <Panel
          title="What selling everything today would realise"
          description="The same sale under each method. The difference is the tax you can choose."
        >
            <Table>
              <TableCaption className="sr-only">Realised gain by lot-selection method</TableCaption>
              <TableHeader>
                <TableRow>
                  <TableHead>Method</TableHead>
                  <TableHead className="text-right">Cost basis</TableHead>
                  <TableHead className="text-right">Gain</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {comparison.value.comparison.map((row) => (
                  <TableRow key={row.method} className="border-b border-(--border)/50 last:border-0">
                    <TableCell className="text-(--fg-secondary)">{row.method.replace(/_/g, " ")}</TableCell>
                    <FigureCell value={row.costBasis} />
                    <FigureCell value={row.gain} tone="change" />
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          <p className="mt-3 text-xs text-(--fg-muted)">
            Specific-id behaves as FIFO here because no lots have been nominated — the honest
            answer rather than an omission.
          </p>
        </Panel>
      )}

      {!isDigitalMetal && activeView === "activity" && <InvestmentActivity events={ledgerEvents} />}

      {!isDigitalMetal && activeView === "activity" && actions.length > 0 && (
        <Panel title="Corporate actions" description="Applied as events, so each one can be undone.">
          <ul className="space-y-2 text-sm">
            {actions.map((action) => (
              <li key={action.id} className="flex items-baseline justify-between gap-3">
                <span className="text-(--fg-secondary)">{action.kind.replace(/_/g, " ")}</span>
                <span className="tnum text-xs text-(--fg-muted)">
                  ex {action.exDate.toISO()}
                  {action.appliedAt ? " · applied" : " · pending"}
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {!isDigitalMetal && activeView === "activity" && <Panel
        title="Record a trade"
        description="A trade is a ledger transaction first; the lot is derived from it, so the portfolio can always be rebuilt from the journal."
      >
        <TradeForms
          instrumentId={instrumentId}
          accounts={settlementAccounts}
          defaultDate={today.toISO()}
          heldUnits={open.quantity.toDecimalString()}
       />
      </Panel>}

      {activeView === "settings" && <Panel
        title="This holding's details"
        description="Correct the name, the platform, or the code the price feed knows it by — a holding that will not price is almost always a wrong code here."
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
      </Panel>}
    </PageShell>
  );
}

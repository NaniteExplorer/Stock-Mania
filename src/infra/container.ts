import "server-only";

import { cache } from "react";
import { SystemClock, UserId } from "@/core/kernel";
import { Currency } from "@/core/money";
import { CalendarDate } from "@/core/time";
import { config } from "@/core/config";
import type { IdentifierType, PricedAssetClass, QuoteType } from "@/domain/pricing";
import { db } from "@/infra/db/client";
import {
  DrizzleAccountRepository,
  DrizzleBalanceQuery,
  DrizzleBudgetRepository,
  DrizzleCardTermsRepository,
  DrizzleCategoryRuleRepository,
  DrizzleDepositRepository,
  DrizzleImportRepository,
  DrizzleInstrumentRepository,
  DrizzleInstrumentCatalogRepository,
  DrizzleInvestmentActivityQuery,
  DrizzleLotRepository,
  DrizzleCorporateActionRepository,
  DrizzleBarRepository,
  DrizzleGoldLeaseRepository,
  DrizzleInstitutionRepository,
  DrizzleFxRateRepository,
  DrizzleQuoteRepository,
  DrizzleSelfPayeeQuery,
  DrizzleTaxSettingsRepository,
  DrizzleTransactionRepository,
} from "@/infra/repositories";
import { OpenAccount, RecordTransaction, ReverseTransaction, SeedChartOfAccounts } from "@/app/ledger.usecases";
import { CreateCommitment, CreateIncomeStream, CreateInsurancePolicy } from "@/app/manual-finance.usecases";
import { DrizzleCommitmentRepository, DrizzleIncomeRepository, DrizzleInsuranceRepository } from "@/infra/manual-finance";
import { DrizzleCommitmentWriter, DrizzleIncomeWriter, DrizzleInsuranceWriter } from "@/infra/manual-finance-writes";
import { newRequestContext } from "@/infra/unit-of-work";
import { LoadProjectionAssumptions, SaveProjectionAssumptions, SetDateOfBirth } from "@/app/projection.usecases";
import { DrizzleOwnerProfileStore, DrizzleProjectionAssumptionStore } from "@/infra/projection-store";
import { AcquisitionCandidates, AssetAcquisitionFor, LinkAssetAcquisition, RestoreAssetAcquisition, UnlinkAssetAcquisition } from "@/app/asset-acquisition.usecases";
import { DrizzleAssetAcquisitionRepository, DrizzleAssetAcquisitionWriter } from "@/infra/asset-acquisition-store";
import { AssertPhysicalValuation, CreatePhysicalAsset, ListPhysicalAssets, RemovePhysicalAsset, ReplacePhysicalModel } from "@/app/physical-asset.usecases";
import { DrizzlePhysicalAssetRepository, DrizzlePhysicalAssetWriter } from "@/infra/physical-asset-store";
import { StandingMeasurements, standingSourcesFrom } from "@/app/standing.usecases";
import { RecordStandingTier } from "@/app/standing-tier.usecases";
import { DrizzleTierHistoryReader, DrizzleTierHistoryWriter } from "@/infra/tier-history-store";
import { LoadCpiSeries, RecordCpiPoint, RemoveCpiPoint } from "@/app/cpi-series.usecases";
import { LoadRebalancingBand, LoadTargetAllocation, RecordRebalancingBand, RecordTargetAllocation, RemoveRebalancingBand, RemoveTargetAllocation } from "@/app/target-allocation.usecases";
import { LoadCardMinimumDues, RecordCardMinimumDue, RemoveCardMinimumDue } from "@/app/card-minimum-due.usecases";
import { DrizzleCardMinimumDueReader, DrizzleCardMinimumDueWriter } from "@/infra/card-minimum-due-store";
import { DrizzleRebalancingBandReader, DrizzleRebalancingBandWriter, DrizzleTargetAllocationReader, DrizzleTargetAllocationWriter } from "@/infra/target-allocation-store";
import { DrizzleCpiSeriesReader, DrizzleCpiSeriesWriter } from "@/infra/cpi-series-store";
import {
  AccountCoverageGaps,
  AccrueCardCharges,
  ConfirmUnmatchedRows,
  ListCards,
  OpenCreditCard,
  PayCard,
  UpdateCardTerms,
  ViewCard,
  ListCashPositions,
  OpenCashAccount,
  PlanBudgets,
  PostImportBatch,
  ReconcileAccount,
  RecordAccountTransfer,
  RecordReceipt,
  RecordSpend,
  ReviewImportRow,
  SeedCategoryRules,
  SmartReviewImport,
  StageStatementImport,
  UndoImport,
} from "@/app/banking.usecases";
import {
  BookAccruedInterest,
  ComparePayoff,
  ListDeposits,
  ListLoans,
  OpenDeposit,
  OpenLoan,
  RecordLoanInstalment,
  RecordPrepayment,
  RecordSchemeContribution,
  SetNpsUnits,
  SetSchemeRate,
  ValueNps,
} from "@/app/lending.usecases";
import { CorrectTrade, VoidTrade } from "@/app/trade-corrections.usecases";
import { RealisedGainsHistory } from "@/app/realised-history.usecases";
import { GoldHoldingAnalytics } from "@/app/gold-analytics.usecases";
import { GoldBenchmarkReplay } from "@/app/gold-benchmark.usecases";
import {
  CloseInstrument,
  DeleteInstrument,
  UpdateInstrument,
} from "@/app/instrument-admin.usecases";
import {
  ArchiveInstitution,
  DeleteInstitution,
  ListInstitutions,
  RegisterInstitution,
  UpdateInstitution,
} from "@/app/institutions.usecases";
import { InstitutionKind } from "@/domain/institutions";
import { FINANCIAL_PROVIDERS, type ProviderKind } from "@/ui/providers";
import {
  AddInstrument,
  ApplyCorporateAction,
  CompareDisposalMethods,
  InvestmentWorkspace,
  PortfolioReturns,
  RealisedGains,
  RecordBuy,
  RecordSell,
  ValuePortfolio,
} from "@/app/investing.usecases";
import {
  BuildStatements,
  NetWorthSeries,
  PersonalReport,
  SuggestHarvest,
  TaxReport,
} from "@/app/reports.usecases";
import {
  AccrueLeaseInterest,
  ListGoldLeases,
  OpenGoldLease,
  SettleGoldLease,
  UpdateGoldLease,
  DeleteGoldLease,
} from "@/app/leasing.usecases";
import { FxBook, PriceBook } from "@/domain/pricing";
import { BackfillInstrumentHistory, IngestInstrumentBars, RefreshPrices } from "@/app/pricing.usecases";
import {
  EngineFxProvider,
  EngineHistoryFeed,
  YahooQuoteKeyProber,
  buildMarketDataEngine,
} from "@/infra/market-data";
import {
  FetchHttpClient,
  ProviderBenchmarkFeed,
  shippedFxProviders,
  shippedQuoteProviders,
  systemRuntime,
} from "@/infra/providers";
import { getCurrentSession } from "@/infra/auth/session";
import { DrizzleActivityLog } from "@/infra/activity-log";
import { ListActivity, activityRedoCursors } from "@/app/activity.usecases";
import {
  LinkPortfolioInstrumentCatalog,
  RefreshInstrumentCatalog,
  SearchInstrumentCatalog,
} from "@/app/instrument-catalog.usecases";
import { ViewLiveDataCenter } from "@/app/live-data.usecases";
import { ViewSourceHealth } from "@/app/source-health.usecases";
import { FetchAttemptWriter, processFetchAttempts, withFetchRecording } from "@/infra/market-data/fetch-attempts";
import { ViewInvestmentAnalysis, ViewInvestmentTracker } from "@/app/investment-analysis.usecases";
import {
  AmfiMutualFundMaster,
  InstrumentQuoteKeyReconciler,
  MoneycontrolScIdHarvester,
  SecCompanyTickerMaster,
  UpstoxBsePublicInstrumentMaster,
  UpstoxPublicInstrumentMaster,
  ZerodhaInstrumentCsvMapping,
} from "@/infra/instrument-catalog";

/**
 * How an instrument's own identifier vocabulary maps to a provider's.
 *
 * A `MarketInstrument` says `SYMBOL` and `SLUG`; the price ladder says `TICKER`,
 * `METAL` and `COIN`. Neither vocabulary is wrong for its side, so the translation
 * lives at the boundary rather than one side adopting the other's words.
 */
const IDENTIFIER_TYPES: Readonly<Record<string, IdentifierType>> = {
  SYMBOL: "TICKER",
  ISIN: "ISIN",
  SCHEME_CODE: "SCHEME_CODE",
  SLUG: "METAL",
};

/**
 * The composition root.
 *
 * Somebody has to know both the repositories and the use cases, and it cannot be
 * `src/app/`: a use case may not import infra, which `tests/layout.spec.ts`
 * enforces. So the wiring lives here, on the infra side of that arrow, and a
 * route imports this instead of constructing eight repositories itself.
 *
 * Built per request and memoised with React's `cache`, so a page and the server
 * actions it renders share one set of objects. There is no state to share — the
 * repositories hold only the `db` handle — but constructing them once keeps the
 * request cheap and makes it obvious where they come from.
 */
export const services = cache(() => {
  const clock = new SystemClock();

  const accounts = new DrizzleAccountRepository(db);
  const income = new DrizzleIncomeRepository(db);
  const insurance = new DrizzleInsuranceRepository(db);
  const commitments = new DrizzleCommitmentRepository(db);
  // Read-only: the previous tier for /standing hysteresis. Writes go through `standing.recordTier`.
  const tierHistory = new DrizzleTierHistoryReader(db);
  const assetAcquisitions = new DrizzleAssetAcquisitionRepository(db);
  const journal = new DrizzleTransactionRepository(db);
  const imports = new DrizzleImportRepository(db);
  const rules = new DrizzleCategoryRuleRepository(db);
  const selfPayees = new DrizzleSelfPayeeQuery(db);
  const budgets = new DrizzleBudgetRepository(db);
  const cardTerms = new DrizzleCardTermsRepository(db);
  const lending = new DrizzleDepositRepository(db);
  const instruments = new DrizzleInstrumentRepository(db);
  const lots = new DrizzleLotRepository(db);
  // A read model, not a repository: it only ever answers the holding screen.
  const investmentActivity = new DrizzleInvestmentActivityQuery(db);
  const quotes = new DrizzleQuoteRepository(db);
  const bars = new DrizzleBarRepository(db);
  const leases = new DrizzleGoldLeaseRepository(db);
  const platforms = new DrizzleInstitutionRepository(db);
  const taxSettings = new DrizzleTaxSettingsRepository(db);
  const fxRates = new DrizzleFxRateRepository(db);
  const instrumentCatalog = new DrizzleInstrumentCatalogRepository(db);
  // Read-only, owner-scoped view of `audit_events` for the Activity screen (2.7.b).
  const activityLog = new DrizzleActivityLog(db);

  /*
   * The price ladder, adapted to the one method an instrument needs.
   *
   * `PriceBook` takes an `InstrumentRef` with a provider-facing identifier type
   * (`TICKER`, `SCHEME_CODE`, `METAL`, …) while `MarketInstrument.quoteKey()`
   * speaks in its own terms (`SYMBOL`, `SLUG`). The mapping lives here, at the
   * boundary, so neither side has to know the other's vocabulary.
   */
  const http = new FetchHttpClient();
  const providerRuntime = systemRuntime(http);
  // 6.4: every provider call is timed and recorded for source health; recording never fails a fetch.
  const fetchAttempts = new FetchAttemptWriter(processFetchAttempts, () => clock.now());
  const marketDataConfig = config.marketData();
  const zerodhaAuthorization = marketDataConfig.zerodhaApiKey && marketDataConfig.zerodhaAccessToken
    ? `token ${marketDataConfig.zerodhaApiKey}:${marketDataConfig.zerodhaAccessToken}`
    : undefined;
  const priceBook = new PriceBook(
    shippedQuoteProviders(providerRuntime, new Map(), undefined, {
      finnhubToken: marketDataConfig.finnhubToken,
      zerodhaAuthorization,
      // D-4: a paid feed is opt-in, not "we happen to have a key".
      allowPaidQuoteProviders: marketDataConfig.allowPaidQuoteProviders,
    }).map((provider) => fetchAttempts.wrap(provider)),
    quotes,
  );

  /*
   * The market-data engine.
   *
   * Built once per request beside the price ladder, not instead of it: the ladder
   * still answers "what is this holding worth", and the engine answers the three
   * questions it never could — a full daily series for a chart, an FX rate that
   * says which date and which *kind* of rate it is, and whether a quote key
   * resolves at all.
   */
  const marketData = withFetchRecording(buildMarketDataEngine(providerRuntime), fetchAttempts);

  /*
   * Frankfurter first, then Exchangerate.dev and currency-api through the engine's
   * own chain, and `EcbFxProvider` last (D-5). The ECB file is ninety days and
   * EUR-only, which cannot value a 2019 purchase; it is kept as the final line
   * because it is the same *kind* of number as Frankfurter's, so falling back to
   * it never violates the no-mixed-rate-kinds rule.
   */
  const fxBook = new FxBook(
    shippedFxProviders(providerRuntime, [
      new EngineFxProvider(marketData.chain, marketData.registry, () => clock.now().getTime()),
    ]).map((provider) => fetchAttempts.wrap(provider)),
    fxRates,
    clock,
  );
  const balances = new DrizzleBalanceQuery(db, Currency.reporting, fxBook);
  const prices = {
    async priceOn(
      ref: {
        instrumentId: string;
        symbol: string;
        assetClass: PricedAssetClass;
        currency: Currency;
        identifierType: string;
        exchange?: string | null;
      },
      asOf: CalendarDate,
      quoteType?: QuoteType,
    ) {
      const resolution = await priceBook.priceOn(
        {
          instrumentId: ref.instrumentId,
          symbol: ref.symbol,
          assetClass: ref.assetClass,
          currency: ref.currency,
          identifierType: IDENTIFIER_TYPES[ref.identifierType] ?? "TICKER",
          exchange: ref.exchange ?? null,
        },
        asOf,
        quoteType,
      );
      return {
        price: resolution.price,
        pricedOn: resolution.pricedOn,
        isStale: resolution.isStale,
        rung: resolution.rung,
      };
    },
  };

  const record = new RecordTransaction(accounts, journal);
  const openAccount = new OpenAccount(accounts, journal, clock);
  const reverseTransaction = new ReverseTransaction(journal, clock);

  /*
   * Named rather than inlined because three things now share them: the investing
   * namespace, `CorrectTrade` (which composes the record use cases rather than
   * reimplementing them), and `VoidTrade` (which composes the reversal). Two
   * `RecordSell` instances would be two default lot-selection methods waiting to
   * diverge.
   */
  const recordBuy = new RecordBuy(accounts, instruments, journal, lots);
  const recordSell = new RecordSell(accounts, instruments, journal, lots);
  const valuePortfolio = new ValuePortfolio(instruments, lots, prices, fxBook);
  const portfolioReturns = new PortfolioReturns(accounts, instruments, journal, valuePortfolio);
  const entitledQuoteProviders = [
    ...(zerodhaAuthorization && marketDataConfig.allowPaidQuoteProviders ? ["zerodha"] : []),
    ...(marketDataConfig.finnhubToken ? ["finnhub"] : []),
  ];
  const voidTrade = new VoidTrade(
    journal,
    lots,
    (userId: UserId) => new DrizzleCorporateActionRepository(db, userId),
    reverseTransaction,
  );
  const transfer = new RecordAccountTransfer(accounts, record);
  const zerodhaCatalog = zerodhaAuthorization
    ? new ZerodhaInstrumentCsvMapping(http, () => clock.now(), {
        authorization: zerodhaAuthorization,
      })
    : null;

  return {
    clock,
    repositories: { accounts, journal, balances, imports, rules, selfPayees, budgets, cardTerms, lending, instruments, instrumentCatalog, investmentActivity, lots, quotes, bars, taxSettings, leases, platforms, income, insurance, commitments, activityLog, tierHistory, assetAcquisitions },
    /** Resolve the owner from the session, never from action/form input. */
    /** Projection assumptions and the date of birth; the owner comes from the session. */
    projection: async () => {
      const userId = await currentUserId();
      const store = new DrizzleProjectionAssumptionStore(db);
      const profiles = new DrizzleOwnerProfileStore(db);
      return {
        userId,
        load: new LoadProjectionAssumptions(store, profiles, clock),
        save: new SaveProjectionAssumptions(store, profiles, clock),
        setDateOfBirth: new SetDateOfBirth(profiles, clock),
      };
    },
    /** Physical assets (1.4): reads, and audited writes bound to the session owner. */
    physicalAssets: {
      list: new ListPhysicalAssets(new DrizzlePhysicalAssetRepository(db)),
      writes: async () => {
        const userId = await currentUserId();
        const writer = new DrizzlePhysicalAssetWriter(db, newRequestContext(userId.value, clock));
        return {
          userId,
          create: new CreatePhysicalAsset(openAccount, writer),
          assertValuation: new AssertPhysicalValuation(writer),
          replaceModel: new ReplacePhysicalModel(writer),
          remove: new RemovePhysicalAsset(writer),
        };
      },
    },
    /** Expense-to-asset-acquisition links (1.8); the owner comes from the session. */
    assetAcquisitions: async () => {
      const userId = await currentUserId();
      const writer = new DrizzleAssetAcquisitionWriter(db, newRequestContext(userId.value, clock));
      return {
        userId,
        link: new LinkAssetAcquisition(writer),
        unlink: new UnlinkAssetAcquisition(writer),
        restore: new RestoreAssetAcquisition(writer),
        forAsset: new AssetAcquisitionFor(assetAcquisitions),
        candidates: new AcquisitionCandidates(assetAcquisitions),
      };
    },
    /**
     * Tier history writes. Server-action-free: the caller names the owner, so a
     * system caller (the cron route's per-user loop) can record without a session.
     * Not called anywhere yet; see standing-screen.md § "Tier history".
     */
    standing: {
      recordTier: (userId: UserId) =>
        new RecordStandingTier(
          new StandingMeasurements(standingSourcesFrom({ accounts, balances, cardTerms, lending, insurance, commitments, tierHistory })),
          new DrizzleTierHistoryWriter(db, newRequestContext(userId.value, clock)),
        ),
    },
    /**
     * Owner-entered CPI Urban (net-worth-age-chart.md § "CPI series"). `load` takes
     * the owner id (the dashboard loader already has it); writes resolve the owner
     * from the session. Entry screen: `/settings/cpi`.
     */
    cpiSeries: {
      load: new LoadCpiSeries(new DrizzleCpiSeriesReader(db)),
      writes: async () => {
        const userId = await currentUserId();
        const writer = new DrizzleCpiSeriesWriter(db, newRequestContext(userId.value, clock));
        return { userId, record: new RecordCpiPoint(writer), remove: new RemoveCpiPoint(writer) };
      },
    },
    /**
     * The owner's stored target allocation (financial-health-scoring.md § 3.6
     * persistence). Replaced as a whole; read by the signals board.
     */
    targetAllocation: {
      load: new LoadTargetAllocation(new DrizzleTargetAllocationReader(db)),
      writes: async () => {
        const userId = await currentUserId();
        const writer = new DrizzleTargetAllocationWriter(db, newRequestContext(userId.value, clock));
        return { userId, record: new RecordTargetAllocation(writer), remove: new RemoveTargetAllocation(writer) };
      },
    },
    /** The owner's rebalancing band (one per user, no default). Entry screen: `/settings/allocation`. */
    rebalancingBand: {
      load: new LoadRebalancingBand(new DrizzleRebalancingBandReader(db)),
      writes: async () => {
        const userId = await currentUserId();
        const writer = new DrizzleRebalancingBandWriter(db, newRequestContext(userId.value, clock));
        return { userId, record: new RecordRebalancingBand(writer), remove: new RemoveRebalancingBand(writer) };
      },
    },
    manualFinance: async () => {
      const userId = await currentUserId();
      const context = newRequestContext(userId.value, clock);
      return {
        userId,
        createIncomeStream: new CreateIncomeStream(new DrizzleIncomeWriter(db, context)),
        createInsurancePolicy: new CreateInsurancePolicy(new DrizzleInsuranceWriter(db, context)),
        createCommitment: new CreateCommitment(new DrizzleCommitmentWriter(db, context)),
      };
    },
    /** The Activity screen: audited changes in the D2 window, with Undo/Redo state. */
    activity: {
      list: new ListActivity(activityLog, journal, activityRedoCursors(), clock),
    },
    ledger: {
      seedChart: new SeedChartOfAccounts(accounts),
      openAccount,
      record,
      reverse: reverseTransaction,
    },
    banking: {
      openCashAccount: new OpenCashAccount(accounts, openAccount),
      listCashPositions: new ListCashPositions(accounts, balances),
      recordSpend: new RecordSpend(accounts, record),
      recordReceipt: new RecordReceipt(accounts, record),
      recordTransfer: transfer,
      stageImport: new StageStatementImport(
        accounts,
        journal,
        imports,
        rules,
        selfPayees,
        undefined,
        undefined,
        balances,
      ),
      confirmUnmatched: new ConfirmUnmatchedRows(imports),
      smartReview: new SmartReviewImport(imports, accounts, rules, selfPayees),
      reviewRow: new ReviewImportRow(imports, accounts),
      postBatch: new PostImportBatch(imports, accounts, record, clock, balances),
      undoImport: new UndoImport(imports, journal, clock),
      reconcile: new ReconcileAccount(accounts, balances, imports),
      /** The account page's coverage gap notice and first-statement line (DESIGN.md §9a). */
      coverageGaps: new AccountCoverageGaps(accounts, imports, journal, balances),
      planBudgets: new PlanBudgets(budgets, balances),
      seedRules: new SeedCategoryRules(accounts, rules),
    },
    cards: {
      open: new OpenCreditCard(openAccount, cardTerms),
      updateTerms: new UpdateCardTerms(accounts, cardTerms),
      list: new ListCards(accounts, journal, balances, cardTerms),
      view: new ViewCard(accounts, journal, balances, cardTerms),
      pay: new PayCard(accounts, transfer),
      accrueCharges: new AccrueCardCharges(accounts, journal, balances, cardTerms, record),
      /** Owner-typed minimum dues per statement (card-minimum-due.md); the card's rule applies otherwise. */
      minimumDues: {
        load: new LoadCardMinimumDues(new DrizzleCardMinimumDueReader(db)),
        writes: async () => {
          const userId = await currentUserId();
          const writer = new DrizzleCardMinimumDueWriter(db, newRequestContext(userId.value, clock));
          return {
            userId,
            record: new RecordCardMinimumDue(new ViewCard(accounts, journal, balances, cardTerms), writer),
            remove: new RemoveCardMinimumDue(writer),
          };
        },
      },
    },
    investing: {
      addInstrument: new AddInstrument(accounts, instruments, openAccount, platforms),
      recordBuy,
      recordSell,
      compareMethods: new CompareDisposalMethods(instruments, lots),
      valuePortfolio,
      workspace: new InvestmentWorkspace(valuePortfolio, portfolioReturns, platforms),
      analysis: new ViewInvestmentAnalysis(instruments, bars, clock),
      tracker: new ViewInvestmentTracker(instruments, quotes, clock, {
        providerIds: entitledQuoteProviders,
      }),
      realisedGains: new RealisedGains(lots),
      realisedHistory: new RealisedGainsHistory(lots, instruments, platforms),
      goldAnalytics: new GoldHoldingAnalytics(instruments, lots, leases, quotes, platforms),
      /*
       * The benchmark replay gets its own feed rather than the price ladder: the
       * ladder writes what it fetches into `quotes`, and a benchmark series is not
       * a price for anything the user holds. Storing GOLDBEES closes against a
       * digital-gold instrument would corrupt the very valuation this table is
       * comparing against.
       */
      goldBenchmark: new GoldBenchmarkReplay(
        instruments,
        lots,
        quotes,
        platforms,
        new ProviderBenchmarkFeed(providerRuntime),
      ),
      applyCorporateAction: (userId: UserId) =>
        new ApplyCorporateAction(
          accounts,
          instruments,
          lots,
          new DrizzleCorporateActionRepository(db, userId),
          clock,
        ),
      corporateActions: (userId: UserId) => new DrizzleCorporateActionRepository(db, userId),
      voidTrade,
      correctTrade: new CorrectTrade(lots, instruments, voidTrade, recordBuy, recordSell),
      updateInstrument: new UpdateInstrument(instruments),
      closeInstrument: new CloseInstrument(instruments, lots),
      deleteInstrument: new DeleteInstrument(instruments, lots),
      returns: portfolioReturns,
    },
    platforms: {
      register: new RegisterInstitution(platforms),
      update: new UpdateInstitution(platforms),
      archive: new ArchiveInstitution(platforms),
      remove: new DeleteInstitution(platforms, instruments),
      list: new ListInstitutions(platforms),
    },
    pricing: {
      refresh: new RefreshPrices(priceBook, clock),
      /*
       * Written in Phase 8 and never constructed until now. Without it every
       * return figure silently starts at signup: a holding owned since 2019 would
       * report an XIRR computed from the day the app was installed, which is not
       * a smaller answer but a wrong one.
       */
      backfill: new BackfillInstrumentHistory(priceBook, quotes, clock),
      /*
       * The other half of a backfill, and a different table: `backfill` fills
       * `price_quotes` (the number a holding is valued at) through the price
       * ladder, this fills `price_bars` (the OHLC series a chart is drawn from)
       * through the engine's history chain. Each resumes from its own coverage.
       */
      ingestBars: new IngestInstrumentBars(new EngineHistoryFeed(marketData.chain), bars, clock),
      fx: fxBook,
    },
    marketData: {
      registry: marketData.registry,
      chain: marketData.chain,
      /** The documented fallback chain, rendered, for the operations surface. */
      describeChains: () => marketData.registry.describe(),
      /**
       * The priceability gate's offline sweep (C10). Resolves a first quote key,
       * re-confirms an existing one, and marks a dead one `quoteStale` without
       * ever deleting a row (C6). Never called under a user's cursor.
       */
      reconcileQuoteKeys: new InstrumentQuoteKeyReconciler(
        instrumentCatalog,
        new YahooQuoteKeyProber(marketData.yahoo),
        () => clock.now(),
      ),
      /** Offline `sc_id` harvesting for the Moneycontrol quote failover (C11). */
      moneycontrolScIds: new MoneycontrolScIdHarvester(http),
    },
    instrumentCatalog: {
      search: new SearchInstrumentCatalog(instrumentCatalog, clock),
      refresh: new RefreshInstrumentCatalog(
        instrumentCatalog,
        new UpstoxPublicInstrumentMaster(http, () => clock.now()),
        [
          // D-6: the BSE master, which was missing entirely. BSE-only scrips are
          // a full tier at 96% priceable, and 2 510 ISINs were unfindable without
          // it. Its row filter is on the BSE *group code*, never on "EQ" (C9).
          new UpstoxBsePublicInstrumentMaster(http, () => clock.now()),
          new AmfiMutualFundMaster(http, () => clock.now()),
          new SecCompanyTickerMaster(http, () => clock.now()),
          ...(zerodhaCatalog ? [zerodhaCatalog] : []),
        ],
        clock,
      ),
      link: new LinkPortfolioInstrumentCatalog(instrumentCatalog, clock),
    },
    sourceHealth: { view: new ViewSourceHealth(processFetchAttempts) },
    liveData: {
      view: new ViewLiveDataCenter(instruments, instrumentCatalog, clock, {
        finnhubConfigured: Boolean(marketDataConfig.finnhubToken),
        zerodhaConfigured: Boolean(zerodhaAuthorization),
      }),
    },
    leasing: {
      open: new OpenGoldLease(instruments, leases, lots),
      accrue: new AccrueLeaseInterest(accounts, instruments, leases, journal, lots, prices),
      settle: new SettleGoldLease(leases),
      update: new UpdateGoldLease(leases),
      remove: new DeleteGoldLease(leases),
      list: new ListGoldLeases(instruments, leases, lots, prices),
    },
    reports: {
      statements: new BuildStatements(balances),
      netWorthSeries: new NetWorthSeries(balances),
      personal: new PersonalReport(accounts, balances, cardTerms, lending),
      tax: new TaxReport(lots, instruments),
      harvest: new SuggestHarvest(instruments, lots, prices),
    },
    lending: {
      openDeposit: new OpenDeposit(openAccount, lending, record),
      listDeposits: new ListDeposits(accounts, lending, balances),
      valueNps: new ValueNps(accounts, lending),
      bookAccruedInterest: new BookAccruedInterest(accounts, lending, balances, record),
      recordContribution: new RecordSchemeContribution(accounts, lending, record),
      setSchemeRate: new SetSchemeRate(lending),
      setNpsUnits: new SetNpsUnits(lending),
      openLoan: new OpenLoan(accounts, openAccount, lending, record),
      listLoans: new ListLoans(accounts, lending, balances),
      recordInstalment: new RecordLoanInstalment(accounts, lending, record),
      recordPrepayment: new RecordPrepayment(accounts, lending, record),
      comparePayoff: new ComparePayoff(accounts, lending, balances),
    },
  };
});

/**
 * The signed-in user, as a `UserId`.
 *
 * Every route and action needs this and none of them should reach for the raw
 * session shape: a repository takes `UserId`, so converting once here is what
 * keeps a bare string out of every query. Throws rather than returning null —
 * the `(root)` layout has already redirected an unauthenticated visitor, so a
 * missing session here is a bug, not a state to render.
 */
export async function currentUserId(): Promise<UserId> {
  const session = await getCurrentSession();
  const id = session?.user?.id;
  if (!id) throw new Error("No signed-in user; the route should have redirected.");
  return UserId.from(id);
}

/**
 * Makes sure a signed-in user has a chart of accounts and keyword rules.
 *
 * Both seeders are idempotent, so this is safe to call from any page that needs
 * the chart to exist. It runs here rather than at sign-up because a user created
 * before this code shipped would otherwise never get one, and "the accounts
 * screen is empty and every import fails" is not a state worth supporting.
 */
export async function ensureSeeded(userId: UserId): Promise<void> {
  const { ledger, banking } = services();
  await ledger.seedChart.execute({ userId });
  await banking.seedRules.execute({ userId });
  await seedPlatforms(userId);
}

/**
 * Gives a new user the platforms an Indian portfolio is actually spread across.
 *
 * Seeded rather than left empty because "which platform" is a question with no
 * useful blank state: a picker with nothing in it teaches the user to skip the
 * field, and a portfolio with no platform attributed is the state this whole
 * dimension exists to end. The list is the shipped catalogue's brokers, bullion
 * vaults and wallets — the kinds an investment sits on — and every one of them
 * is archivable, so a user who holds nothing at Upstox hides it in one click.
 *
 * Idempotent through `RegisterInstitution`, which matches on the normalised
 * name: a re-run finds the existing row, and a user who renamed "Groww" to
 * "Groww (family)" does not get a second one.
 */
async function seedPlatforms(userId: UserId): Promise<void> {
  const { platforms, repositories } = services();
  // Cheap guard so the common path is one query rather than thirty upserts.
  const existing = await repositories.platforms.list(userId, { includeArchived: true });
  if (existing.length > 0) return;

  for (const provider of FINANCIAL_PROVIDERS) {
    const kind = SEEDED_PLATFORM_KINDS[provider.kind];
    if (!kind) continue;
    await platforms.register.execute({
      userId,
      name: provider.name,
      kind,
      providerId: provider.id,
      country: provider.country,
    });
  }
}

/**
 * Which catalogue kinds become platforms, and as what.
 *
 * Banks are excluded on purpose: a savings account is not a platform a holding
 * sits on, and seeding forty of them would bury the six brokers the picker
 * exists to offer. A user who does hold investments at a bank adds it by hand.
 */
const SEEDED_PLATFORM_KINDS: Readonly<Partial<Record<ProviderKind, InstitutionKind>>> = {
  BROKER: "BROKER",
  BULLION: "BULLION",
  WALLET: "WALLET",
  RETIREMENT: "SCHEME",
  SAVINGS: "SCHEME",
};

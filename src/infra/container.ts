import "server-only";

import { cache } from "react";
import { SystemClock, UserId } from "@/core/kernel";
import { Currency } from "@/core/money";
import { CalendarDate } from "@/core/time";
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
import {
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
import { RefreshPrices } from "@/app/pricing.usecases";
import { FetchHttpClient, shippedFxProviders, shippedQuoteProviders, systemRuntime } from "@/infra/providers";
import { getCurrentSession } from "@/infra/auth/session";

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
  const journal = new DrizzleTransactionRepository(db);
  const imports = new DrizzleImportRepository(db);
  const rules = new DrizzleCategoryRuleRepository(db);
  const selfPayees = new DrizzleSelfPayeeQuery(db);
  const budgets = new DrizzleBudgetRepository(db);
  const cardTerms = new DrizzleCardTermsRepository(db);
  const lending = new DrizzleDepositRepository(db);
  const instruments = new DrizzleInstrumentRepository(db);
  const lots = new DrizzleLotRepository(db);
  const quotes = new DrizzleQuoteRepository(db);
  const bars = new DrizzleBarRepository(db);
  const leases = new DrizzleGoldLeaseRepository(db);
  const platforms = new DrizzleInstitutionRepository(db);
  const taxSettings = new DrizzleTaxSettingsRepository(db);
  const fxRates = new DrizzleFxRateRepository(db);

  /*
   * The price ladder, adapted to the one method an instrument needs.
   *
   * `PriceBook` takes an `InstrumentRef` with a provider-facing identifier type
   * (`TICKER`, `SCHEME_CODE`, `METAL`, …) while `MarketInstrument.quoteKey()`
   * speaks in its own terms (`SYMBOL`, `SLUG`). The mapping lives here, at the
   * boundary, so neither side has to know the other's vocabulary.
   */
  const providerRuntime = systemRuntime(new FetchHttpClient());
  const priceBook = new PriceBook(shippedQuoteProviders(providerRuntime), quotes);
  const fxBook = new FxBook(shippedFxProviders(providerRuntime), fxRates, clock);
  const balances = new DrizzleBalanceQuery(db, Currency.reporting, fxBook);
  const prices = {
    async priceOn(
      ref: {
        instrumentId: string;
        symbol: string;
        assetClass: PricedAssetClass;
        currency: Currency;
        identifierType: string;
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
  const voidTrade = new VoidTrade(
    journal,
    lots,
    (userId: UserId) => new DrizzleCorporateActionRepository(db, userId),
    reverseTransaction,
  );
  const transfer = new RecordAccountTransfer(accounts, record);

  return {
    clock,
    repositories: { accounts, journal, balances, imports, rules, selfPayees, budgets, cardTerms, lending, instruments, lots, quotes, bars, taxSettings, leases, platforms },
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
      stageImport: new StageStatementImport(accounts, journal, imports, rules, selfPayees),
      confirmUnmatched: new ConfirmUnmatchedRows(imports),
      smartReview: new SmartReviewImport(imports, accounts, rules, selfPayees),
      reviewRow: new ReviewImportRow(imports, accounts),
      postBatch: new PostImportBatch(imports, accounts, record, clock, balances),
      undoImport: new UndoImport(imports, journal, clock),
      reconcile: new ReconcileAccount(accounts, balances, imports),
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
    },
    investing: {
      addInstrument: new AddInstrument(accounts, instruments, openAccount, platforms),
      recordBuy,
      recordSell,
      compareMethods: new CompareDisposalMethods(instruments, lots),
      valuePortfolio: new ValuePortfolio(instruments, lots, prices, fxBook),
      realisedGains: new RealisedGains(lots),
      realisedHistory: new RealisedGainsHistory(lots, instruments, platforms),
      goldAnalytics: new GoldHoldingAnalytics(instruments, lots, leases, quotes, platforms),
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
      returns: new PortfolioReturns(
        accounts,
        instruments,
        journal,
        new ValuePortfolio(instruments, lots, prices, fxBook),
      ),
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
      fx: fxBook,
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
      personal: new PersonalReport(accounts, balances, cardTerms),
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

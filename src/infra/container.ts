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
} from "@/app/leasing.usecases";
import { PriceBook } from "@/domain/pricing";
import { FetchHttpClient, shippedQuoteProviders, systemRuntime } from "@/infra/providers";
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
  const balances = new DrizzleBalanceQuery(db);
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
  const taxSettings = new DrizzleTaxSettingsRepository(db);

  /*
   * The price ladder, adapted to the one method an instrument needs.
   *
   * `PriceBook` takes an `InstrumentRef` with a provider-facing identifier type
   * (`TICKER`, `SCHEME_CODE`, `METAL`, …) while `MarketInstrument.quoteKey()`
   * speaks in its own terms (`SYMBOL`, `SLUG`). The mapping lives here, at the
   * boundary, so neither side has to know the other's vocabulary.
   */
  const priceBook = new PriceBook(shippedQuoteProviders(systemRuntime(new FetchHttpClient())), quotes);
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
  const transfer = new RecordAccountTransfer(accounts, record);

  return {
    clock,
    repositories: { accounts, journal, balances, imports, rules, selfPayees, budgets, cardTerms, lending, instruments, lots, quotes, bars, taxSettings, leases },
    ledger: {
      seedChart: new SeedChartOfAccounts(accounts),
      openAccount,
      record,
      reverse: new ReverseTransaction(journal, clock),
    },
    banking: {
      openCashAccount: new OpenCashAccount(accounts, openAccount),
      listCashPositions: new ListCashPositions(accounts, balances),
      recordSpend: new RecordSpend(accounts, record),
      recordReceipt: new RecordReceipt(accounts, record),
      recordTransfer: transfer,
      stageImport: new StageStatementImport(accounts, journal, imports, rules, selfPayees),
      confirmUnmatched: new ConfirmUnmatchedRows(imports),
      reviewRow: new ReviewImportRow(imports, accounts),
      postBatch: new PostImportBatch(imports, accounts, record, clock),
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
      addInstrument: new AddInstrument(accounts, instruments, openAccount),
      recordBuy: new RecordBuy(accounts, instruments, journal, lots),
      recordSell: new RecordSell(accounts, instruments, journal, lots),
      compareMethods: new CompareDisposalMethods(instruments, lots),
      valuePortfolio: new ValuePortfolio(instruments, lots, prices),
      realisedGains: new RealisedGains(lots),
      applyCorporateAction: (userId: UserId) =>
        new ApplyCorporateAction(
          accounts,
          instruments,
          lots,
          new DrizzleCorporateActionRepository(db, userId),
          clock,
        ),
      corporateActions: (userId: UserId) => new DrizzleCorporateActionRepository(db, userId),
      returns: new PortfolioReturns(
        accounts,
        instruments,
        journal,
        new ValuePortfolio(instruments, lots, prices),
      ),
    },
    leasing: {
      open: new OpenGoldLease(instruments, leases, lots),
      accrue: new AccrueLeaseInterest(accounts, instruments, leases, journal, lots, prices),
      settle: new SettleGoldLease(leases),
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
}

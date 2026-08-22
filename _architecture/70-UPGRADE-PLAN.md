# Stock-Mania — Class-Based Rebuild & Upgrade Plan

> **How to use this document.** Every work item is a checkbox. Tick it only when its
> *Done when* condition holds — not when the code is written. Each phase ends with a
> gate that must be green before the next phase starts. Progress table at the bottom.

> **This file is the single source of truth for progress.** It lives in the repository on
> purpose: any engineer or agent can open it, read the last ticked box, and continue from
> exactly that point with no other context. Do not keep a second copy anywhere.
>
> **Rules for whoever picks this up:**
>
> 1. **Resuming:** read the progress table → find the first unticked box in the earliest
>    incomplete phase → confirm that phase's gate is still green
>    (`npm run typecheck && npm run lint && npm test`) *before* writing anything new.
> 2. **Ticking a box:** only when its *Done when* condition actually holds — not when the
>    code is written. Tick it in the **same commit** as the work, so the diff shows both
>    the change and the claim that it is done.
> 3. **Phases are ordered and gated.** Do not start a phase whose predecessor's gate is
>    red. Within a phase, items may be done in any order.
> 4. **Disagreeing with the plan is allowed.** If an item turns out to be wrong, amend this
>    file in the same commit and say why in the commit message. A silently skipped item is
>    the one failure mode this document exists to prevent.
> 5. **Never tick a box you did not verify.** An unticked box costs an hour; a falsely
>    ticked one costs the trust in every other tick on the page.

---

## Context

The audit of the working tree against `_architecture/` found the repository holds **two
apps**: the live one (`app/`, `features/`, `core/`, `lib/` on mongoose, ~18k LOC, money
as JS floats, no journal) and a dormant redesign (`src/` on drizzle + libSQL, ~5k LOC,
exact `Money`, real double-entry) that nothing but `tests/` imports. 31 specified
capabilities are missing outright — corporate actions, bitemporal prices, four of five
cost-basis methods, TWR, all risk metrics, loan mathematics, indexation and
grandfathering, the audit log, soft delete — and live broker order placement runs with
none of the eight pre-trade risk checks.

This plan does not patch that. It **rebuilds the domain as a class hierarchy** so that
every asset type, every transaction type and every tax rule is a class answering a small
set of polymorphic questions. The reason is explicitly forward-looking: adding options,
futures, deep per-instrument analysis, backtesting and eventual systematic execution must
be *subclassing*, not rewriting. Correctness is the top priority — exact integer money,
invariants enforced in constructors, and every reported number traceable to the rule that
produced it.

**Decisions taken** (agreed before writing this):

| Decision | Choice |
|---|---|
| System of record | **libSQL/SQLite** via drizzle — already installed; invariants live in the domain classes |
| v1 retirement | **Strangler, slice by slice** — each phase moves one domain over and deletes its v1 folder |
| Existing Mongo data | **One-off migration script** replaying rows through the new use cases |
| Charts | **Recharts** for standard, hand-authored SVG for finance-specific, behind one token-applying wrapper |

**Non-negotiables carried through every phase**

1. Money is `Money` (bigint minor units). No `number` on any money path. Ever.
2. Every invariant is enforced in a constructor, not by a caller remembering to validate.
3. Nothing is hard-deleted; corrections are reversals.
4. Every derived number can name the rule or formula that produced it.
5. A missing price is `null`, never zero.

---

## Target shape — fewer files, not more

The current `src/` is 52 files with one class per file. The rebuild lands at **~30 files**
while adding far more capability, by grouping each cluster of classes into the one file
that owns the concept. One file per *concept*, not per *class*.

```
src/
  core/
    kernel.ts        Entity, AggregateRoot, ValueObject, UniqueId, Result, UseCase, AppError, Clock
    money.ts         Money, Currency, RoundingMode, divideRounded, allocate
    numeric.ts       Quantity, Percentage, Rate
    time.ts          CalendarDate, DateRange, FinancialYear, MarketCalendar
  domain/
    accounts.ts      AccountType, AccountCode, Account, ChartOfAccounts, Institution
    transactions.ts  Posting, Transaction (abstract) + 13 subclasses, TransactionContext
    assets.ts        Asset (abstract) -> MarketInstrument / DepositProduct / CashProduct /
                     CreditProduct / PhysicalAsset hierarchies (~24 classes)
    lots.ts          Lot, LotBook, LotSelectionStrategy (FIFO/LIFO/HIFO/Average/SpecificId), Disposal
    charges.ts       BrokerChargeModel (abstract) + Zerodha/Groww/Generic, ChargeBreakdown
    tax.ts           TaxEngine, TaxRegime, TaxRule (abstract) + ~12 rules, TaxableEvent, TaxAssessment
    pricing.ts       Quote, PriceBook, PriceResolution, FxBook, Valuation
    corporate.ts     CorporateAction (abstract) + Split/Bonus/Merger/Spinoff/Dividend/ReturnOfCapital
    portfolio.ts     Portfolio, Position, ReturnSeries, Xirr, Twr, RiskMetrics
    reports.ts       NetWorth, BalanceSheet, IncomeStatement, CashFlow, Allocation
  app/
    ledger.usecases.ts     open account, record transaction, reverse, seed chart
    banking.usecases.ts    statements, import, categorise, budgets, reconcile
    investing.usecases.ts  trades, lots, corporate actions, valuation, returns
    tax.usecases.ts        assess FY, harvest, export
  infra/
    db/schema.ts     all tables (grouped by section, one file)
    db/client.ts     connection + migration runner
    repositories.ts  every drizzle repository, one class each
    providers.ts     PriceProvider (abstract) + 7 concrete providers + registry
  ui/
    tokens.css       the one global stylesheet (design system)
    primitives.tsx   Card, Stat, Table, Money, Pill, Sheet, Field
    charts.tsx       Chart wrapper + Line/Bar/Donut/Candle/Drawdown
```

`app/` (Next routes) and `components/` keep their place; v1's `features/` and `core/`
shrink to nothing as phases land.

---

## The four class hierarchies

These are the load-bearing designs. Everything else is plumbing around them.

### 1. `Transaction` — one abstraction, four polymorphic hooks

Every economic event is a `Transaction` subclass. The base class enforces balance in its
constructor; subclasses answer four questions, and **every downstream engine consumes only
those answers** — which is why adding an asset type never touches the ledger, tax or
returns code.

```ts
abstract class Transaction extends AggregateRoot<TransactionId> {
  // Context the user asked for: parent organisation, currency, instrument, account
  readonly context: TransactionContext   // { institution, currency, account, instrument? }

  protected constructor(...) { super(id); this.assertBalanced(); this.validate(); }

  abstract readonly kind: TransactionKind;
  protected abstract validate(): void;          // subclass-specific legality

  abstract postings(): readonly Posting[];      // how it books into the ledger
  abstract lotEffects(): readonly LotEffect[];  // opens / consumes / rescales lots
  abstract taxableEvents(): readonly TaxableEvent[];  // what the tax engine sees
  abstract cashflows(): readonly Cashflow[];    // what XIRR / TWR see

  reverse(on: CalendarDate): ReversalTransaction;
}
```

Subclasses: `OpeningBalance`, `Expense`, `Income`, `Transfer`, `Buy`, `Sell`, `Dividend`,
`Interest`, `Charge`, `CorporateActionTxn`, `FxConversion`, `ValuationAdjustment`,
`Reversal`.

A `Buy` returns one `LotEffect.Open`, no taxable event and a negative cashflow. A `Sell`
returns `LotEffect.Consume`, a `CapitalGain` taxable event per disposal, and a positive
cashflow. A `Split` returns `LotEffect.Rescale` and nothing else. The tax engine never
learns what a split is.

### 2. `Asset` — every holdable thing, by inheritance

```
Asset (abstract)                    valueOn(asOf, priceBook) | taxProfile() | quoteKey()
├── MarketInstrument (abstract)     priced from quotes, carries lots
│   ├── ListedEquity   ├── Etf      ├── IndexFund
│   ├── MutualFund     ├── LiquidFund  ├── DebtFund   ├── ElssFund
│   ├── Bond           ├── GovtSecurity  ├── SovereignGoldBond
│   ├── DigitalGold    ├── DigitalSilver
│   └── Crypto
├── DepositProduct (abstract)       accrues interest, has maturity, schedule()
│   ├── FixedDeposit   ├── RecurringDeposit
│   ├── Ppf            ├── Epf      └── Nps
├── CashProduct (abstract)
│   ├── BankAccount    ├── Wallet   └── CashInHand
├── CreditProduct (abstract)        negative to net worth, amortises
│   ├── CreditCard     └── Loan (Home/Car/Personal/Education/Gold subclasses)
└── PhysicalAsset (abstract)        valued by assertion, not by quote
    ├── RealEstate     ├── Vehicle  ├── PhysicalGold
    ├── EsopGrant      └── GoldLease
```

Each leaf answers the same three questions differently, and that difference is the whole
point: `LiquidFund.taxProfile()` returns slab-taxed-always; `ListedEquity.taxProfile()`
returns 12-month/12.5% with the ₹1.25L exemption; `Ppf.taxProfile()` returns exempt;
`Nps.valueOn()` reads a NAV while `RealEstate.valueOn()` reads the last asserted
valuation; `FixedDeposit.valueOn()` *computes* accrued interest from its compounding
frequency rather than reading a stored balance.

### 3. `TaxEngine` — rules as objects, with provenance

```ts
class TaxEngine {
  constructor(private readonly regime: TaxRegime) {}
  assess(events: TaxableEvent[], settings: TaxSettings): TaxAssessment
}

abstract class TaxRegime {          // IndiaFY2024, IndiaFY2025, IndiaFY2026...
  abstract readonly effectiveFrom: CalendarDate;
  abstract rules(): TaxRule[];      // returned in priority order
  abstract cii(fy: FinancialYear): number;   // indexation table, shipped as seed data
}

abstract class TaxRule {
  abstract readonly name: string;
  abstract readonly priority: number;
  abstract appliesTo(event: TaxableEvent, ctx: AssessmentContext): boolean;
  abstract compute(event: TaxableEvent, ctx: AssessmentContext): TaxLine[];
}
```

Rules, each its own class: `ExemptRule`, `GrandfatheringRule` (2018-02-01 basis step-up),
`IndexationRule` (CII), `ShortTermGainRule`, `LongTermGainRule`, `LtcgExemptionRule`
(₹1.25L, consumption tracked), `FlatRateRule` (VDA 30%), `SlabIncomeRule`,
`DividendRule`, `InterestRule`, `LossOffsetRule` (set-off ordering), `LossCarryForwardRule`
(8-year), `SurchargeRule`, `CessRule` (4%).

Two properties make this trustworthy: **gain and taxable are reported separately** (they
diverge whenever grandfathering or indexation fires), and every `TaxLine` carries the rule
that produced it, so the UI can show *why* a number is what it is.

### 4. `PriceProvider` — template method with resilience in the base class

```ts
abstract class PriceProvider {
  abstract readonly id: string;
  abstract capabilities(): ProviderCapabilities;
  protected abstract fetchRaw(refs: InstrumentRef[], range: DateRange): Promise<Quote[]>;

  // final: retry with jitter, token bucket, circuit breaker, timeout, normalise
  async fetch(refs, range): Promise<Result<Quote[], ProviderError>> { ... }
}
```

Concrete: `AmfiSchemeProvider`, `MfApiNavProvider`, `YahooQuoteProvider`, `NseQuoteProvider`,
`IbjaMetalProvider`, `CoinGeckoProvider`, `EcbFxProvider`, `ManualProvider`. A `PriceBook`
holds them by priority, fails over on an open circuit, records vendor disagreement above
1%, and applies the resolution ladder: exact date → carry forward with a staleness age →
mark stale past the per-class threshold → **`null`, never zero**.

---

## Phase F — Foundation: a green tree and a running shell

*Not in the original plan. Added because the audit's premise turned out to be wrong in a
way that blocks every gate below.*

**Why this phase exists.** This document assumed v1 was live and could be strangled slice
by slice, each phase deleting one v1 folder. It is not live. The `f7966e7 wip: savepoint
before v2 redesign` commit uninstalled `mongoose`, `ioredis`, `kafkajs`, `kiteconnect`,
`inngest` and `twilio` while leaving the ~120 files that import them in place, so
`tsc --noEmit` reported **39 errors** and `next build` could not run at all. Every phase
gate below is `typecheck && lint && test` — none of them could ever have gone green with
v1 in the tree. So v1 goes first, in one commit, and the strangler ordering is dropped.

**Decisions taken** (with the user, before starting):

| Decision | Choice |
|---|---|
| Layout | This document's consolidated ~30-file tree wins; `ARCHITECTURE.md` §3 is amended to match |
| v1 removal | One commit up front, after freezing the port-reference sources under `_reference/v1/` |
| Live broker orders, Zerodha/Alpaca | Dropped permanently — Phase 6's risk-gate item takes its "or disable the live order path" branch |
| All AI (Gemini parsers, `analysis/`, `signals/`, §7's LLM ingestion) | Dropped permanently; categorisation stays keyword-only |
| SMS/WhatsApp alerts, news digest | Dropped permanently |
| TradingView widgets | Kept — free and keyless |
| Data providers | Keyless only: AMFI, MFAPI, Yahoo, NSE public, IBJA, CoinGecko, ECB, Manual. No Finnhub/EODHD/Kite/AlphaVantage |

- [x] **Freeze the port-reference sources.** The six pure-logic files this plan names under
      *Files that carry over unchanged*, plus `transaction.categories.ts`, the two `lib/`
      data tables and the three hand-rolled charts, copied verbatim to `_reference/v1/` and
      excluded from `tsconfig` and ESLint. **Done when** the snapshot exists and the type
      error count is unchanged by it. ✔ *Verified: 39 before, 39 after, 0 from `_reference/`.*
- [x] **Delete v1; rebuild `app/` on the v2 stack.** Removes `features/`, `core/`,
      `lib/{actions,better-auth,inngest,constants,currencies,financial-providers}`, the two
      `instrumentation` files, the stray `app/tsconfig.json`, the Finnhub price route, nine
      empty API directories, eight already-empty route directories, `components/wealth/` and
      nine dead components. Moves better-auth from `mongodbAdapter` to `drizzleAdapter`
      against the existing libSQL auth tables. Narrows `tsconfig` `paths` so a stale
      `@/features/*` fails loudly instead of resolving against the repo root.
      **Done when** `tsc --noEmit` is 0, `lint` has no errors, `npm test` is green and
      `next build` succeeds. ✔ *Verified: 39 → **0** errors, lint 0 errors / 8 warnings,
      tests 3/3, build emits 13 routes + 3 API routes.*

**Two live v1 defects fixed on the way through**, both found by reading rather than by
testing: `proxy.ts` redirected `/forgot-password` and `/reset-password` to `/sign-in` for
signed-out users, so password reset could never complete; and `lib/nodemailer` read
`NODEMAILER_*` unguarded while `config.email()` reads `SMTP_*` and returns `null` when
absent, so mail was sent with `undefined` credentials rather than skipped.

**Gate:** the app builds, signs a user in, and renders every route. ✔

---

## Phase 0 — Guardrails before domain code

*Cheap, and everything after it depends on it.*

- [ ] **Float prohibition, layer 2.** ESLint rule banning `parseFloat`, `Number(`, unary `+`
      and bare `*` `/` on any identifier typed `Money`, plus any float column in a migration.
      **Done when** a PR adding `parseFloat` to a money path fails `npm run lint`.
- [ ] **Float prohibition, layer 3.** Test asserting no column matching
      `%amount%|%price%|%balance%|%cost%|%value%|%minor%` has a non-integer type.
      **Done when** adding a `REAL` amount column fails `npm test`.
- [ ] **Test runner upgrade.** Keep `scripts/run-tests.mjs` (it works, zero deps) but add
      `assertProperty(gen, predicate, runs)` so property tests can be written without a
      framework. **Done when** the nine properties in §9.1 of `30-CALCULATIONS.md` have a
      place to live.
- [ ] **CI gate.** `typecheck → lint → test` on every push.
      **Done when** a red test blocks the branch.

**Gate:** a commit that puts a float on a money path cannot merge.

---

## Phase 1 — The engines

*The user's step 1: tax, transaction, and the basic setup every other phase consumes.*
*No screens change in this phase; it ends with engines proven by tests.*

### 1a — Consolidate and complete the core primitives

- [ ] **Merge `src/shared/**` (13 files) into `src/core/` (4 files).** Pure moves plus
      barrel deletion — `Money`, `Quantity`, `Percentage`, `CalendarDate`, `DateRange`,
      `FinancialYear`, `Clock`, `Result`, `Entity`, `ValueObject`, `UniqueId`, `AppError`
      are all **correct today and carry over unchanged**. **Done when** `tests/money.spec.ts`
      and `tests/ledger-domain.spec.ts` pass against the new paths with no logic edits.
- [ ] **Add `Money.allocate` property test** — `sum(allocate(m, w)) === m` for generated
      inputs. **Done when** 10k generated cases pass.
- [ ] **Add `MarketCalendar` to `core/time.ts`** — NSE/BSE holiday table as seed data,
      `previousTradingDay()`, `tradingDaysBetween()`. **Done when** day-change on a Monday
      compares against Friday, not Sunday.
- [ ] **Add `Rate` to `core/numeric.ts`** — annualised rates with an explicit day-count
      (`ACT/365F`), so no formula silently picks its own year length.

### 1b — Transaction hierarchy

- [ ] **`domain/transactions.ts`** — the abstract base with the four hooks, `Posting`,
      `TransactionContext`, and all 13 subclasses. Reuses `JournalEntry.assertBalances`
      logic verbatim (it is correct) as the base-class constructor check.
      **Done when** every subclass has a test proving (a) it books the postings claimed,
      (b) an unbalanced construction throws, and (c) `reverse()` returns balances to prior.
- [ ] **Legality matrix as data.** `txn_type_legality` seeded from `20-DOMAIN-MODEL.md` §3.6
      and checked in `Transaction.validate()`. **Done when** posting an expense *from* an
      expense account is rejected, and invariants L06/L07 have tests.
- [ ] **Multi-currency, properly.** `FxConversion` books two currency legs that each sum to
      zero, with the implied rate recorded and reconciled against `FxBook`.
      **Done when** the worked example — buy AAPL in USD funded from an INR account —
      records, balances per currency, and reports correctly in INR.
- [ ] **Invariants L01–L12 as tests.** Each gets a violating-state test and a
      generated-dataset test. **Done when** all twelve are red-then-green.

### 1c — Tax engine

- [ ] **`domain/tax.ts`** — `TaxEngine`, `TaxRegime`, `TaxRule` and the ~14 rule classes.
      Ports the correct FY2025-26 rates from `features/tax/engine/` (equity 20% STCG /
      12.5% LTCG over 12mo, VDA 30% flat no offset, debt at slab, gold 12.5% over 24mo,
      PPF/EPF exempt) and keeps its config-seeded shape.
      **Done when** each rule has a golden fixture with a hand-verified expected number.
- [ ] **Add the missing rules** — grandfathering, indexation with a shipped CII table,
      LTCG exemption consumption, loss set-off ordering, 8-year carry-forward, surcharge,
      cess. **Done when** a pre-2018 equity holding sold today reports a *stepped-up* basis
      and `gain ≠ taxable`.
- [ ] **Provenance.** Every `TaxLine` names its rule and inputs.
      **Done when** the UI can render "why this number" for any line without recomputation.
- [ ] **Regimes are versioned, not replaced.** `IndiaFY2024` and `IndiaFY2025` coexist and
      are selected by the disposal's financial year. **Done when** re-running last FY's
      report after adding a new regime produces the identical number.

### 1d — Charge engine

- [ ] **`domain/charges.ts`** — `BrokerChargeModel` abstract + `Zerodha`, `Groww`,
      `Generic`. Computes brokerage, STT, exchange transaction, SEBI turnover, stamp duty,
      GST and DP charges from first principles, per the seven columns already in the schema.
      **Done when** a real Zerodha contract note reproduces to the paisa.
- [ ] **Deductibility is a property of the charge, not a comment.** STT non-deductible;
      brokerage/exchange/SEBI deductible; stamp duty capitalised.
      **Done when** the tax engine consumes `ChargeBreakdown.deductible` and never a total.

### 1e — Pricing and providers

- [ ] **Schema: make quotes bitemporal.** Widen the key to
      `(instrument, as_of, quote_type, provider)` and add `ingested_at`; corrections insert,
      never overwrite. **Done when** two providers can disagree on one date and both rows survive.
- [ ] **`infra/providers.ts`** — the abstract provider with retry/jitter, token bucket,
      circuit breaker and timeout in the **base class**, plus the 8 concrete providers.
      **Done when** the six conformance tests pass for at least two providers per need.
- [ ] **`domain/pricing.ts`** — `PriceBook` with priority failover, golden-record
      selection, >1% divergence flagging, and the four-rung resolution ladder.
      **Done when** a missing price yields `null` with a staleness reason, and an induced
      provider outage fails over with no user-visible error.
- [ ] **`FxBook`** — `fx_rates` table with `provider_rate` and `user_rate`, resolved by the
      same ladder. **Done when** a user-asserted rate overrides the provider for tax.
- [ ] **Backfill on add.** Adding an instrument fetches full available history.
      **Done when** XIRR over a period predating signup is computable.

### 1f — Ledger infrastructure

- [ ] **Consolidate schema** to `infra/db/schema.ts`, adding: `deleted_at` on every
      user-facing table, `audit_events` (append-only), `ledger_events` (append-only),
      `account.revision`, `institutions`, `counterparties`, `fx_rates`,
      `corporate_actions`, `import_rows`, `documents`, `tax_rules` seed.
      **Done when** migrations apply clean and no table lacks `deleted_at`.
- [ ] **Soft delete everywhere.** All reads go through views/helpers filtering it.
      **Done when** no code path issues a `DELETE`, and A03 has a test.
- [ ] **Audit trail.** Every mutation writes one `audit_events` row with actor, before,
      after, request id. **Done when** A02 has a test and the table has no update path.
- [ ] **`infra/repositories.ts`** — one repository class per aggregate, all in one file.
      Ports the three existing Drizzle repositories, which are correct.
- [ ] **Projection cache keyed by revision.** `(scope, as_of, revision_vector)`; a
      backdated write bumps the revision and invalidates exactly the affected projections.
      **Done when** B04 has a test and a backdated 2019 entry does not invalidate 2024.
- [ ] **Nightly reproducibility job.** Recompute every projection from `ledger_events` and
      diff against cache. **Done when** an induced cache poisoning is detected.

### 1g — Design system and chart kit

*Built now, so every later slice inherits it rather than retrofitting.*

- [ ] **`ui/tokens.css`** — promote the existing CRED-inspired dark system in
      `app/globals.css` (already good: layered near-blacks, hairline borders, single violet
      accent, `tnum` for money) to the single global stylesheet. One type scale, one spacing
      scale, one radius scale, semantic `pos`/`neg`/`warn` separate from the accent.
      **Done when** no component defines a raw hex, enforced by a lint rule.
- [ ] **`ui/primitives.tsx`** — `Card`, `Stat`, `DataTable` (sticky header, tabular nums,
      keyboard row nav), `MoneyText` (never renders a raw number), `Pill`, `Sheet`, `Field`.
      **Done when** three existing manager components are rewritten to use only primitives
      and lose their bespoke CSS.
- [ ] **Add Recharts; build `ui/charts.tsx`.** One `<Chart>` wrapper applying the tokens,
      then `LineChart`, `BarChart`, `DonutChart` on Recharts and `CandleChart`,
      `DrawdownChart`, `LotTimeline` as hand-authored SVG. Replaces `SpendTrendChart`,
      `AllocationDonut`, `NetWorthTimeline`. **Done when** every chart shares one palette,
      has axes, tooltips, an empty state and a reduced-motion path.

**Gate for Phase 1:** `npm test` green with the invariant, property, golden and
conformance suites in it; a contract note reproduces to the paisa; a pre-2018 equity sale
reports gain ≠ taxable. **No screen has changed yet.**

---

## Phase 2 — Banking

*The user's step 2. First slice to reach the UI; the pattern every later slice copies.*

- [ ] **`BankAccount`, `Wallet`, `CashInHand` classes** in `domain/assets.ts` with
      `valueOn()` reading the journal, not a stored balance.
      **Done when** net worth is derived and a stored-balance column no longer exists.
- [ ] **`banking.usecases.ts`** — open account, record expense/income/transfer,
      reconcile a statement, undo an import.
- [ ] **Statement import, upgraded.** Reuse the existing header-alias parser
      (`features/transactions/statement-parser.ts` — genuinely good: narration, particulars,
      withdrawal (dr), chq/ref no) but parse amounts into `Money`, not `parseFloat`.
      **Done when** three real bank statements round-trip with every amount exact.
- [ ] **Import staging.** Rows land in `import_rows` as `DRAFT` → matched → user confirms →
      posted. **Done when** I01 has a test and nothing reaches the ledger unconfirmed.
- [ ] **3-pass dedup matcher.** Port Actual's algorithm wholesale: rules first, then exact
      `external_id`, then ±7-day same-amount ordered by date distance with a shared
      `matched` set, three complete sweeps, `strictIdChecking`.
      **Done when** a golden fixture set reproduces the documented behaviour and a
      re-imported overlapping statement adds nothing.
- [ ] **Categorisation, kept deliberately keyword-based.** Port `categorizer.ts` including
      the self/family payee detection (a genuinely good idea, absent from every reference
      repo). Rules stay normalised rows with priority. **No AI in the categorisation path.**
      **Done when** the same statement re-imported next month categorises identically.
- [ ] **Budgets.** Keep the existing per-account monthly limit with recurring default and
      warn threshold, and add carryover so envelope mode is expressible.
      **Done when** the four formulas of `30-CALCULATIONS.md` §7 are reproduced with tests.
- [ ] **Screens.** Accounts list, transaction register (keyboard-driven, virtualised),
      import wizard with the DRAFT review step, budget view — all on `ui/primitives`.
- [ ] **Delete `features/accounts/`, `features/transactions/`, `features/networth/`.**
      **Done when** nothing imports them and the app still builds.

**Gate:** a year of real statements imports, categorises, and the register and net worth
agree with a hand-checked spreadsheet to the paisa.

---

## Phase 3 — Credit cards

*The user's step 3.*

- [ ] **`CreditCard` class** — a `CreditProduct`, negative to net worth, with statement
      cycle, due date, limit, and `utilisation()`.
      **Done when** a card balance reduces net worth without a special case anywhere.
- [ ] **Billing cycle as a first-class concept.** Statement period, generated statement,
      minimum due, actual due — so "spent this month" and "billed this cycle" are different
      and both correct. **Done when** a mid-cycle purchase appears in spend but not in the
      current statement.
- [ ] **Card payment is a `Transfer`, never an expense.** **Done when** paying a card
      moves money between two accounts and inflates no expense category (invariant L12).
- [ ] **Interest and charges.** Finance charge on revolving balance, late fee, annual fee,
      and the reducing-balance versus flat distinction — via `Rate` with an explicit
      day-count. **Done when** a revolved balance accrues the same interest the issuer bills.
- [ ] **Reward points as a non-money quantity.** Tracked in `Quantity`, valued only on
      redemption. **Done when** points never enter a money column.
- [ ] **Screens.** Card detail with cycle timeline, utilisation gauge, due-date reminder,
      statement list.
- [ ] **Delete card handling from `features/liabilities/`.**

**Gate:** a real card statement reconciles — opening balance + spends − payments + charges
= closing balance, exactly.

---

## Phase 4 — Deposits and retirement

*The user's step 4: FD, RD, PPF, EPF, NPS.*

- [ ] **`DepositProduct` hierarchy** with `interestType` (simple/compound/flat/reducing),
      `compoundingFrequency` (daily → at-maturity), maturity date, and a computed
      `schedule()`. **Done when** each subclass's maturity value matches the bank's own
      certificate for a real deposit.
- [ ] **Accrual as a computation, not a stored balance.** Replace v1's nightly
      balance-mutating job: `valueOn(asOf)` *computes* accrued interest from first
      principles. **Done when** deleting the accrual job changes no reported number.
- [ ] **RD instalment schedule** with missed-instalment handling.
- [ ] **PPF** — annual limit, 15-year lock, extension blocks, EEE tax treatment.
- [ ] **EPF** — employee/employer/VPF split, interest credited annually, taxable-above-
      threshold rules. **Done when** the three sub-balances are tracked separately.
- [ ] **NPS** — tier I/II, scheme-wise NAV allocation (E/C/G/A), and the fact that it is
      priced from a NAV, not accrued. **Done when** NPS value reads a real NAV through the
      `PriceBook`.
- [ ] **Loan mathematics — the whole gap.** `Loan` subclasses with EMI
      (`P·r·(1+r)ⁿ/((1+r)ⁿ−1)`), a generated `amortisation_schedule` with the **mandatory
      final-period adjustment**, prepayment handling, and avalanche versus snowball payoff
      comparison. **Done when** N01–N04 hold: `Σ principal` equals the principal exactly and
      the final closing balance is exactly zero, for generated rates and terms.
- [ ] **Flat versus reducing-balance,** with the effective annual rate always displayed
      alongside — flat quoting is common in Indian consumer lending and overstates nothing
      by accident. **Done when** a flat-rate loan shows both numbers.
- [ ] **Screens.** Deposit ladder with maturity timeline, loan detail with amortisation
      table and payoff comparison.
- [ ] **Delete `features/assets/`, `features/liabilities/`.**

**Gate:** every deposit's computed maturity matches its certificate; every loan schedule
sums to its principal exactly.

---

## Phase 5 — Investments

*The user's step 5. The largest slice, and the one the class design exists for.*

- [ ] **`MarketInstrument` hierarchy** — the 13 leaf classes, each with its own
      `taxProfile()`, `quoteKey()` and `valueOn()`. Notably: `LiquidFund` and `DebtFund`
      taxed at slab always; `ElssFund` with its 3-year lock; `SovereignGoldBond` with
      exempt-at-maturity; `DigitalGold`/`DigitalSilver` in grams.
      **Done when** adding a 14th instrument type touches exactly one file.
- [ ] **`domain/lots.ts` with all five selection strategies** as classes —
      `Fifo`, `Lifo`, `Hifo`, `AverageCost`, `SpecificId` — behind one
      `LotSelectionStrategy` interface, set per account and overridable per disposal.
      Ports the existing FIFO consumption logic (correct) into the `Fifo` strategy, in
      `Money`/`Quantity` rather than floats.
      **Done when** the property test holds — all five methods dispose identical total
      quantity and differ only in basis — and `AverageCost` recomputes forward from the
      first affected transaction on a backdated buy.
- [ ] **`Money.allocate` for basis splits.** **Done when** a fully liquidated position's
      `Σ realised gain` equals `total proceeds − total cost`, exactly, with no leaked paise.
- [ ] **Corporate actions — the critical gap.** `domain/corporate.ts` with `Split`,
      `ReverseSplit`, `Bonus`, `Rights`, `Merger`, `Demerger`, `Spinoff`, `DividendCash`,
      `DividendStock`, `ReturnOfCapital`. **Applied as ledger transactions, never as
      in-place lot edits**, so they are visible, auditable and reversible.
      **Done when** a 1:5 split applied mid-history leaves every historical number correct,
      charts use adjusted prices, basis uses raw prices, and reversing the action undoes it.
- [ ] **Returns.** Rebuild XIRR properly: **bracket first, then Newton inside the bracket**,
      relative tolerance 1e-9 on the NPV residual, ACT/365F, and a typed `XirrUndefined`
      with a reason — never `0`, never a bare `null`. Add **TWR**, both Modified Dietz and
      true sub-period TWR. **Done when** Paisa's golden fixtures pass *including* the
      2982.94% case, and the TWR property test — invariance to cashflow timing — holds.
- [ ] **Risk metrics** in `domain/portfolio.ts`: max drawdown, volatility (√252), Sharpe,
      Sortino, beta, alpha, correlation, historical VaR, yield on cost, dividend yield,
      allocation drift. Risk-free and benchmark series configured, never hard-coded.
      **Done when** each has a golden fixture and a property test.
- [ ] **Positions and valuation** through the `PriceBook` ladder, with staleness surfaced in
      the UI. **Done when** a stale price is visibly marked and a missing one shows "no
      price", not ₹0.
- [ ] **Trade import.** Port the holdings/trade-book importers; the AI parser stays as a
      **fallback behind** the deterministic parser and gains the missing safety step —
      independent regex corroboration of every extracted amount, and a DRAFT row the user
      confirms. **Done when an LLM-extracted amount can never become a posting unreviewed.**
- [ ] **Screens.** Portfolio with per-instrument drill-down, lot table with holding-period
      clock, realised/unrealised split, corporate-action history, returns panel (XIRR *and*
      TWR), allocation and drift.
- [ ] **Delete `features/investments/`, `features/trades/`, `features/portfolio/`,
      `features/returns/`, `features/prices/`, `features/tax/`.**

**Gate:** a real broker trade book imports; cost basis, realised gain, XIRR and TWR match
hand-verified fixtures; a split mid-history breaks nothing.

---

## Phase 6 — Reports, and the extras worth keeping

- [ ] **`domain/reports.ts`** — net worth at `asOf`, balance sheet, income statement, cash
      flow, allocation. **Done when B02 holds:** assets − liabilities = equity + income −
      expenses, at every date, as a test.
- [ ] **Personal-finance metrics** — liquid net worth, savings rate, burn rate, runway, DTI,
      credit utilisation.
- [ ] **Tax reports** — per-FY realised gains with rule provenance, loss carry-forward
      position, and tax-loss harvesting suggestions.
- [ ] **Port the good extras onto the new core:** `EsopGrant` and `GoldLease` as
      `PhysicalAsset` subclasses (both genuinely absent from every reference architecture),
      price alerts over SMS/WhatsApp, news digest, AI market analysis and signals (clearly
      labelled as advisory, never feeding a posting), watchlist, monthly-wealth import.
- [ ] **Order path: risk gate first.** Either implement all eight pre-trade checks
      (position, exposure, order size, fat-finger, daily loss, rate limit, kill switch,
      margin) with fail-closed semantics and a unique `idempotency_key`, **or disable the
      live order path until they exist.** This is the one item that can lose real money.
      **Done when** an order cannot reach a broker without passing the gate.
- [ ] **Delete the remaining `features/`, `core/`, and the mongoose dependency.**

**Gate:** the three financial statements reconcile; no v1 code remains; `mongoose` is out
of `package.json`.

---

## Phase 7 — Data migration and cutover

- [ ] **`scripts/migrate-v1.ts`** — reads each Mongo collection and **replays it through the
      new use cases**, so accounts become opening-balance entries, transactions become
      fingerprinted `Expense`/`Income`/`Transfer`, trades become `Buy`/`Sell` rebuilding the
      lot book, and snapshots become cache rows. Anything failing validation is reported,
      not silently written. **Done when** a dry run prints a complete report and a real run
      is idempotent.
- [ ] **Reconciliation.** Diff computed net worth against v1's stored totals per month and
      account for every difference. **Done when** each remaining difference has a written
      explanation (v1 float drift being the expected one).
- [ ] **Cut over** and archive the v1 database.

**Gate:** the new app shows the user's real financial position, and every divergence from
v1 is explained rather than discovered later.

---

## Phase 8 — Quant readiness (foundation only)

*Not building a trading system — making sure the class design can host one.*

- [ ] **`metadata` on instruments** with a Zod schema per asset class, so `Option` and
      `Future` subclasses can be added without migrating live data.
- [ ] **`Option` and `Future` as `MarketInstrument` subclasses** — strike, expiry,
      underlying, contract month, and their own `taxProfile()` (F&O is business income).
- [ ] **Analysis hooks.** `MarketInstrument.analyse(series): InstrumentAnalysis` as the
      extension point for per-instrument deep analysis, with a technical-indicator
      implementation as the first concrete example.
- [ ] **Bar storage behind a repository interface,** so a granularity change later routes to
      a different store without anything above the repository knowing.
- [ ] **Backtest seam.** `ExecutionVenue` interface with a simulated implementation, so a
      future live venue is an injection, not a rewrite.

**Gate:** adding a new asset class or a new tax regime is a single new class in a single
existing file, proven by doing it once.

---

## Progress

| Phase | Scope | Items | Status |
|---|---|---|---|
| F | Foundation — delete v1, auth on libSQL, green gate | 2 | ✔ Complete (2/2) |
| 0 | Guardrails | 4 | ☐ Not started |
| 1 | Engines — core, transactions, tax, charges, pricing, ledger, UI kit | 27 | ☐ Not started |
| 2 | Banking | 9 | ☐ Not started |
| 3 | Credit cards | 7 | ☐ Not started |
| 4 | Deposits, retirement, loans | 10 | ☐ Not started |
| 5 | Investments | 10 | ☐ Not started |
| 6 | Reports and extras | 6 | ☐ Not started |
| 7 | Migration and cutover | 3 | ☐ Not started |
| 8 | Quant readiness | 5 | ☐ Not started |

Update the status cell to `◐ In progress` / `✔ Complete (n/n)` as phases land.

---

## Verification

**Per phase.** `npm run typecheck && npm run lint && npm test` must be green before the
gate is ticked. Every phase adds its invariants to the suite; no phase removes a test.

**The suites that matter**, added incrementally:

| Suite | What it proves |
|---|---|
| Property tests | `allocate` sums exactly; post-then-reverse restores balances; five lot methods dispose identical quantity; `Σ principal` equals loan principal; XIRR recovers a known rate; TWR is timing-invariant; event-log replay reproduces state |
| Golden fixtures | Hand-verified expected values for XIRR (including the 2982.94% case), TWR, all five basis methods, each tax rule, amortisation, and a real Zerodha contract note |
| Invariant tests | Every id in `30-CALCULATIONS.md` §8 — a violating-state test plus a generated-dataset test |
| Conformance tests | Six per price provider, so a ninth provider is safe to add |
| Reproducibility | Nightly recompute from `ledger_events` diffed against the projection cache |
| Differential | Balances diffed against `ledger-cli` on an equivalent journal; XIRR diffed against a spreadsheet |

**End-to-end, per slice.** Run the app (`npm run dev`), and for each phase drive the real
flow: import a real bank statement (Phase 2), reconcile a real card statement (Phase 3),
check a real FD certificate and loan schedule (Phase 4), import a real trade book and apply
a split (Phase 5), reconcile the three statements (Phase 6). A phase is done when its
numbers match a hand-checked source, not when the screen renders.

**Files that carry over unchanged** — reuse, do not rewrite: `src/shared/money/*`,
`src/shared/numeric/*`, `src/shared/time/*`, `src/shared/kernel/*`,
`src/modules/ledger/domain/value-objects/AccountType.ts`, the three Drizzle repositories,
`features/transactions/statement-parser.ts` (retyped to `Money`),
`features/transactions/categorizer.ts`, `features/trades/fifo.ts` (as the `Fifo` strategy),
`features/tax/engine/india-fy2025.regime.ts` (as the first `TaxRegime`), and the design
tokens in `app/globals.css`.

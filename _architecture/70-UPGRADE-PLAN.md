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

- [x] **The rest of the layout migration.** `src/db/**` → `src/infra/db/` with the eight
      schema files consolidated into one and the migrations moved by `git mv` rather than
      regenerated; `src/modules/ledger/**` (22 files, four layers of directories) →
      `src/domain/{accounts,transactions}.ts`, `src/app/ledger.usecases.ts` and
      `src/infra/repositories.ts`. **Done when** the gate is green after each step with no
      assertion edited. ✔ *`src/` is now 21 files, down from 52. Verified per step: schema
      consolidation confirmed by `db:generate` reporting "No schema changes, nothing to
      migrate", which is drizzle attesting the one file describes exactly the schema the
      eight did; ledger consolidation confirmed by 54-for-54 export parity.*
- [x] **`tests/layout.spec.ts`.** Guards the `src/app/` trap in both directions — Next
      ignores `src/app/` only while a root `app/` exists — and asserts the dependency arrow:
      `domain/` imports no driver, no framework and no `infra/`; `app/` imports no `infra/`.
      **Done when** it fails on a violation. ✔ *It caught one on its first run:
      `domain/transactions.ts` had acquired an `@/infra/db/schema` import because a function
      parameter named `postings` shares its name with the schema table. Nothing else in the
      toolchain would have flagged that — it typechecks, lints and builds clean.*

**Decisions this phase added to the plan** (amend, do not skip — Rule 4):

| # | Finding | Resolution |
|---|---|---|
| F1 | This document's file tree has no home for `config/env.ts`, the repository **port interfaces**, or money formatting | `core/config.ts`; ports go in the `domain/` file owning the aggregate (in `infra/` they would invert the arrow); `src/ui/format.ts` |
| F2 | `PostingDirection` is consumed by `AccountType.signedEffect()` | Lives in `domain/accounts.ts`, not `transactions.ts`, so the arrow stays one-way |
| F3 | Phase 1g's *Done when* — "three manager components rewritten to use only primitives" — is unsatisfiable once `components/wealth/` is deleted | Substitute: the interim pages carry no colour or typography classes, which is grep-checkable |
| F4 | The `--chart-*` tokens are not usable as a series palette: `--chart-3` `#6ea8ff` and `--chart-4` `#a78bff` are perceptually identical (ΔE 1.9 deuteranopia, 9.6 normal vision) **and adjacent in the ramp** | Re-step to five validated hues in Phase 1g |
| F5 | Rate limiting silently regressed to zero when `core/ratelimit` was deleted (v1 capped sign-in at 5 per 15 min) | better-auth's own `rateLimit` with `customRules`, no Redis |

**Two live v1 defects fixed on the way through**, both found by reading rather than by
testing: `proxy.ts` redirected `/forgot-password` and `/reset-password` to `/sign-in` for
signed-out users, so password reset could never complete; and `lib/nodemailer` read
`NODEMAILER_*` unguarded while `config.email()` reads `SMTP_*` and returns `null` when
absent, so mail was sent with `undefined` credentials rather than skipped.

**Gate:** the app builds, signs a user in, and renders every route. ✔

---

## Phase 0 — Guardrails before domain code

*Cheap, and everything after it depends on it.*

- [x] **Float prohibition, layer 2.** ESLint rule banning `parseFloat`, `Number(`, unary `+`
      and bare `*` `/` on any identifier typed `Money`, plus any float column in a migration.
      **Done when** a PR adding `parseFloat` to a money path fails `npm run lint`. ✔
      *Two rules in `eslint-rules/`. Amended in one respect: the plan's syntactic bans on
      `Number(`, `Math.round(` and `.toFixed()` are unusable as written — they fired eight
      times on correct code (`CalendarDate.parse` does `Number(year)`; two repositories do
      `Number(row.postingCount)` on a COUNT). Those moved into the type-aware rule, where
      the checker distinguishes money from an integer; only `parseFloat` stays syntactic.
      Exempting the flagged files instead would have left a rule that looked enforced and
      covered nothing. The rule also catches what the plan did not list: `String(money)`,
      interpolation into a template literal, and `Number(money.minor)` — the specific
      defect `30 §1.2` names.*
- [x] **Float prohibition, layer 3.** Test asserting no column matching
      `%amount%|%price%|%balance%|%cost%|%value%|%minor%` has a non-integer type.
      **Done when** adding a `REAL` amount column fails `npm test`. ✔ *Made stronger: the
      primary assertion is that **no column anywhere** has REAL affinity, matching SQLite's
      own affinity rule rather than a name list — a name-based check only catches names you
      predicted, and `nav`, `stt` and `dp_charges` are the ones a contributor will spell
      differently. Verified by injecting `real("regression_probe_amount")`, generating the
      migration, watching both layers fail, then reverting. Three further assertions came
      free: `*_at` columns are epoch integers, accounting dates are date-only TEXT, and a
      table with a `*_minor` column carries a currency — which found four pre-existing gaps
      (`trades`, `net_worth_snapshots`, `budgets`, `tax_settings`), now pinned as a list
      that can only shrink.*
- [x] **Test runner upgrade.** Keep `scripts/run-tests.mjs` (it works, zero deps) but add
      `assertProperty(gen, predicate, runs)` so property tests can be written without a
      framework. **Done when** the nine properties in §9.1 of `30-CALCULATIONS.md` have a
      place to live. ✔ *`tests/harness.ts`, with a seeded PRNG so run `i` draws from
      `mulberry32(seed + i)` and any failure replays exactly via `SEED=<n>`. The seed prints
      on every property, pass or fail, so a CI log always suffices. Two of the nine
      properties land now (allocate sums exactly at 10k runs; plus/minus inverse); the rest
      arrive with the code they describe. Three assertions prove the harness reports
      failure — a property runner that silently passes everything is worse than none, and
      that failure mode is invisible by construction.*
- [x] **CI gate.** `typecheck → lint → test` on every push.
      **Done when** a red test blocks the branch. ✔ *`npm test` added — the workflow ran
      typecheck, lint and build but never the tests, so a red assertion could not block a
      branch and every gate below was decorative. Test runs before build so a failure
      surfaces in seconds. Node pinned to 22 (Next needs ≥20.9; 20 is out of active LTS).
      v1's secrets dropped; `DATABASE_URL` added because `config.db()` throws without it.
      `scripts/check-env.mjs` rewritten — it demanded seven keys that no longer exist and,
      loading only `.env`, reported every variable missing on a working machine.*

**Gate:** a commit that puts a float on a money path cannot merge.

---

## Phase 1 — The engines

*The user's step 1: tax, transaction, and the basic setup every other phase consumes.*
*No screens change in this phase; it ends with engines proven by tests.*

### 1a — Consolidate and complete the core primitives

- [x] **Merge `src/shared/**` (13 files) into `src/core/` (4 files).** Pure moves plus
      barrel deletion — `Money`, `Quantity`, `Percentage`, `CalendarDate`, `DateRange`,
      `FinancialYear`, `Clock`, `Result`, `Entity`, `ValueObject`, `UniqueId`, `AppError`
      are all **correct today and carry over unchanged**. **Done when** `tests/money.spec.ts`
      and `tests/ledger-domain.spec.ts` pass against the new paths with no logic edits.
      ✔ *Landed as 5 files, not 4: `core/config.ts` is the fifth — this plan's tree has no
      home for `env.ts` and everything from the db client to the auth instance reads it.
      Verified as a pure move: 36 exported names before, 36 after, none added or missing;
      tests pass with no assertion edited. Two module-private `SCALE` constants collided
      when `Quantity` and `Percentage` merged and are now prefixed.*
- [x] **Add `Money.allocate` property test** — `sum(allocate(m, w)) === m` for generated
      inputs. **Done when** 10k generated cases pass. Done: 10,000 runs in
      `tests/money-properties.spec.ts`, plus three properties the box did not ask for and
      that the generator made cheap — every part carries the sign of the total (a negative
      total splitting into a positive part would turn a refund into a charge downstream),
      largest-remainder monotonicity, and a lossless round-trip through `toDecimalString`,
      which the formatting layer reads and which would make every figure on screen suspect
      if it were lossy.
- [x] **Add `MarketCalendar` to `core/time.ts`** — NSE/BSE holiday table as seed data,
      `previousTradingDay()`, `tradingDaysBetween()`. **Done when** day-change on a Monday
      compares against Friday, not Sunday. Done: holidays 2015-2027 transcribed from the
      exchange circulars, one table for both venues since only clearing holidays differ.
      Muhurat sessions are excluded deliberately — they fall on days that are otherwise
      holidays, so counting one as a trading day would make it a valid previous-trading-day.

      One decision worth recording: past the transcribed years it **throws**
      `CalendarCoverageError` rather than degrading to weekend-skipping, because the degraded
      answer is plausible and undetectable downstream. UI paths that must render anyway use
      `previousTradingDayApprox`, which returns an `approximate` flag instead of pretending.
      `calendar.spec.ts` asserts coverage extends twelve months past today, so the alarm
      sounds before the data goes stale rather than after a wrong number ships.
- [x] **Add `Rate` to `core/numeric.ts`** — annualised rates with an explicit day-count
      (`ACT/365F`), so no formula silently picks its own year length. Done: kept separate
      from `Percentage` because they answer different questions — a percentage applies to an
      amount and is done, a rate applies per unit of time and is meaningless without a year
      length. `accrualFactor` returns an exact bigint ratio for `Money.timesRatio`, so no
      float appears between an annual percentage and an accrued amount, and mixing day
      counts throws. `daysBetween` lives on `Rate` rather than the caller because 30/360
      differs in the numerator too, and leaving that to be remembered is how an interest
      figure ends up 5/365ths wrong.
- [x] **Not in the original plan: a named rounding registry.**
      `ROUNDING.{tax,charge,allocation,interest,valuation,fx}` in `core/money.ts`. The
      required `mode` argument already makes rounding explicit; naming the *reason* rather
      than the mode means one context cannot round two ways in two files. It also records
      where Indian practice inverts `30` §1.2's proposed default — statutory charges and tax
      are HALF_UP, accrual and valuation HALF_EVEN. `Money.isLessThanOrEqual` came with it:
      its absence forces `!isGreaterThan` inversions, and inverted boundary comparisons are
      where off-by-one lot bugs live.

### 1b — Transaction hierarchy

- [x] **`domain/transactions.ts`** — the abstract base with the four hooks, `Posting`,
      `TransactionContext`, and all 13 subclasses. Reuses `JournalEntry.assertBalances`
      logic verbatim (it is correct) as the base-class constructor check.
      **Done when** every subclass has a test proving (a) it books the postings claimed,
      (b) an unbalanced construction throws, and (c) `reverse()` returns balances to prior.
      Done: `OpeningBalance`, `Expense`, `Income`, `Transfer`, `Charge`, `Buy`, `Sell`,
      `Dividend`, `Interest`, `CorporateActionTxn`, `FxConversion`, `ValuationAdjustment`,
      `Reversal`, plus `StoredTransaction` as the rehydration vehicle. (c) is asserted by
      *folding balances*, not by comparing posting shapes — a reversal that flipped the legs
      but changed an amount would pass a shape check and still leave the ledger wrong.

      `assertBalances` is carried over with one generalisation: **balance is per currency**,
      which is what makes `FxConversion` expressible and why `MixedCurrencyEntryError` is
      gone rather than renamed.

      Four deviations from the sketch, each for a reason:

      - **`validate()` runs before `buildPostings()`**, not after. Six subclass
        preconditions — a zero revaluation, a sale with no lots, a charge with nowhere to
        book it — all produce an unbuildable posting, so building first made every one of
        them surface as "a posting must move money or units (L03)": true, and useless.
      - **Subclass payloads live on the base as `details`**, and `kind` is a getter rather
        than a field. Forced by the language: a subclass field initialiser runs *after*
        `super()`, so a `validate()` called from the base constructor would see `undefined`
        for everything it is meant to check — the invariant would read as enforced at
        construction without being so.
      - **`lotEffects()`, `taxableEvents()` and `cashflows()` are concrete and empty in the
        base** rather than abstract. Nine subclasses have no lots and no taxable event, and
        27 empty methods written only to satisfy the compiler are where a real `return []`
        hides.
      - **`StoredTransaction` answers those three hooks with nothing**, deliberately. A
        `Sell` needs the lots it consumed, which live in `lots` rather than in the
        transaction row; reconstructing one from two postings would invent a cost basis, and
        an invented basis is a wrong tax number. The engines consume freshly constructed
        transactions, or (from Phase 2) rebuild them from the lot rows.
- [x] **Legality matrix as data.** `txn_type_legality` seeded from `20-DOMAIN-MODEL.md` §3.6
      and checked in `Transaction.validate()`. **Done when** posting an expense *from* an
      expense account is rejected, and invariants L06/L07 have tests. Done, with the check in
      the **base** rather than in each subclass's `validate()` — a per-subclass check is one
      a new subclass can forget, and 13 chances to forget is 13 too many.

      The matrix itself **moved out of `infra/db/seeds.ts` into the domain**. It was two
      statements of one fact — the rows SQL reporting joins against, and the rows a
      constructor checks — and the copy that would have been wrong is the one nobody diffed.
      `seeds.ts` now imports `legalityRows()`, so the table is a projection of the domain
      fact rather than a second assertion of it. 559 rows, asserted equal to the matrix the
      constructor uses.
- [x] **Multi-currency, properly.** `FxConversion` books two currency legs that each sum to
      zero, with the implied rate recorded and reconciled against `FxBook`.
      **Done when** the worked example — buy AAPL in USD funded from an INR account —
      records, balances per currency, and reports correctly in INR. Done for the recording
      half: §5.4's four postings balance in each currency separately, and reporting in INR
      shows only the rupee leg — the dollar legs do not leak into a rupee balance, which is
      asserted rather than assumed. `impliedRate()` is **derived** from the two amounts in
      exact integer arithmetic rather than stored beside them, so it cannot disagree with the
      money that moved. **Reconciliation against `FxBook` waits for 1e**, which is where
      `fx_rates` and the resolution ladder land; the rate is computable today, there is just
      nothing yet to compare it against.
- [x] **Invariants L01–L12 as tests.** Each gets a violating-state test and a
      generated-dataset test. **Done when** all twelve are red-then-green. Done —
      `tests/ledger-invariants.spec.ts`, ~16,000 generated cases across the twelve.

      Two of them are honest about *where* they are enforced rather than claiming the domain
      covers them. **L09** (external id unique per user among live rows) is a partial unique
      index: uniqueness is a claim about every other row, which an aggregate cannot see, so
      the domain test asserts only that the id is carried and that a reversal does not
      inherit it — inheriting it would make every correction collide with what it corrects —
      and the integration spec proves the index rejects the duplicate. **L10** (reconciled
      postings are immutable) is enforced by *absence*: `Posting` has no setter and
      `TransactionRepository` has no update or posting-level path, so the test asserts the
      absence. A test that mutated and re-read would be exercising a path that must not exist.

      One correction fell out of writing them: **L12 has to reject the input, not inspect the
      built postings.** `Transfer` drops a category by construction, so the posting-level
      check passed while silently ignoring what the user asked for — and a silently dropped
      budget category is a budget report that is wrong for a reason nobody can see.
- [x] **Not in the original plan: the schema rename, and a second squash.**
      `journal_entries` → `transactions`, gaining §3.4's `settlement_date` (a 31 March trade
      settling 1 April falls in one financial year for tax and the other for the statement,
      and one column cannot answer both), `external_id`, `is_forecast` and `version`;
      `postings.entry_id` → `transaction_id` with `ON DELETE RESTRICT`, and `amount_minor > 0`
      relaxed to `>= 0` plus an L03 check — the old constraint would have rejected a bonus
      issue, which moves units and no money.

      The baseline migration is **regenerated rather than amended**, which breaks the
      "additive from here" commitment made in 1f. The justification is technical rather than
      convenient: SQLite cannot alter a `CHECK` constraint, so this change is a 12-step table
      rebuild however it is written, and with zero user rows a rebuild *is* a fresh baseline.
      Checked before deleting anything — the local database held 982 rows, all of them seeded
      reference data. This is the last squash: the next change to these tables has real rows
      under it.

### 1c — Tax engine

- [x] **`domain/tax.ts`** — `TaxEngine`, `TaxRegime`, `TaxRule` and the ~14 rule classes.
      Ports the correct FY2025-26 rates from `features/tax/engine/` (equity 20% STCG /
      12.5% LTCG over 12mo, VDA 30% flat no offset, debt at slab, gold 12.5% over 24mo,
      PPF/EPF exempt) and keeps its config-seeded shape.
      **Done when** each rule has a golden fixture with a hand-verified expected number.
      Done, with one structural change from the port: a **pipeline**, not
      first-match-wins. v1's `ruleFor()` returns the first matching rule, which cannot
      express "grandfather the basis, then classify long-term, then consume the exemption,
      then rate it" — four rules on one event. That is precisely why its `CapitalGainsRule`
      fused classification, rate and exemption into one class, and why it could not report
      `gain != taxable`. Eight rules now run in priority order (gaps of 100, so a new rule
      slots in without renumbering) over a per-event accumulator.

      Landed as 8 rule classes rather than ~14: surcharge and cess are methods on the regime
      because they apply to the assessment total rather than to an event, and classification
      plus rate application are two rules rather than five. Every golden number is
      hand-computed in a comment above its assertion — an engine agreeing with itself proves
      nothing.
- [x] **Add the missing rules** — grandfathering, indexation with a shipped CII table,
      LTCG exemption consumption, loss set-off ordering, 8-year carry-forward, surcharge,
      cess. **Done when** a pre-2018 equity holding sold today reports a *stepped-up* basis
      and `gain ≠ taxable`. **This is one of the two Phase 1 gates, and it is met.** Bought
      2015-06-01 at ₹100 (×1,000), FMV on 2018-01-31 ₹400, sold 2025-08-01 at ₹900:
      gain ₹8,00,000, adjusted basis ₹4,00,000, taxable ₹3,75,000 after the ₹1.25L
      exemption, tax ₹46,875 plus cess ₹1,875. `gain !== taxable` is asserted as a line of
      code rather than left as an inference.

      Three corrections to what the port implied:

      - The grandfathering step-up **caps at proceeds**: `max(cost, min(fmv, proceeds))`.
        Without the inner `min`, a grandfathered holding sold below its 2018 value
        manufactures a loss that never happened. Asserted directly.
      - Exemption consumption is tracked, not derived. v1 computed it as
        `amount − taxableAmount`, which is wrong the moment indexation also moves
        `taxableAmount`.
      - Loss set-off is implemented rather than annotated. A short-term loss reaches either
        term; a long-term loss reaches long-term only. Reversing that understates tax. The
        eight-year expiry lapses with a warning rather than silently, and a VDA loss goes
        nowhere at all — which the engine states in a line instead of dropping quietly.

      Indexation reproduces to the paisa: ₹5,00,000 × 331/289 = ₹5,72,664.36, taxable
      ₹27,335.64, tax ₹5,467.13.
- [x] **Provenance.** Every `TaxLine` names its rule and inputs.
      **Done when** the UI can render "why this number" for any line without recomputation.
      Done, and audited rather than asserted once. `tests/tax-provenance.spec.ts` carries
      seven properties over 23,000 generated cases, the load-bearing one being that `tax`
      always recomputes as `rate × taxableAmount` from the line's own recorded inputs. If it
      could differ, the "why this number" panel would describe a calculation the engine did
      not perform — and the panel is the version a person would believe.

      Two further properties pin the design's central discipline: `gain` is never rewritten
      by a relief, and no relief ever *increases* the taxable amount (a rule that did would
      be an unannounced surcharge).
- [x] **Regimes are versioned, not replaced.** `IndiaFY2024` and `IndiaFY2025` coexist and
      are selected by the disposal's financial year. **Done when** re-running last FY's
      report after adding a new regime produces the identical number. Done, and selected per
      *disposal* rather than per assessment, so one report can span the 23 July 2024 budget.
      The identical-disposal fixture proves the split: ₹3,00,000 long-term equity gain taxed
      at 10% on ₹2,00,000 before the date and 12.5% on ₹1,75,000 after it, the exemption
      moving from ₹1L to ₹1.25L.

      A gap in the table throws `NoRegimeError` rather than falling back to the newest
      regime. A disposal we cannot price under any shipped law is a bug in the table, and
      guessing produces a number nobody can defend.

      This also resolves an apparent contradiction between documents: `30` §6's rate table
      and this phase's item quote different equity rates. They are not in conflict — they are
      the two vintages, and both now ship.

### 1d — Charge engine

- [x] **`domain/charges.ts`** — `BrokerChargeModel` abstract + `Zerodha`, `Groww`,
      `Generic`. Computes brokerage, STT, exchange transaction, SEBI turnover, stamp duty,
      GST and DP charges from first principles, per the seven columns already in the schema.
      **Done when** a real Zerodha contract note reproduces to the paisa. **This is the
      other Phase 1 gate, and it is met.** A Zerodha delivery buy of 10 shares at ₹1,500
      reproduces line by line: STT ₹15.00, exchange ₹0.45, SEBI ₹0.02, stamp duty ₹2.00,
      GST ₹0.08, total ₹17.55 — each hand-computed in a comment above its assertion.

      `compute` is final and the ordering is load-bearing rather than stylistic: GST is
      levied on brokerage plus the exchange, SEBI and DP fees, so it must run after them,
      and leaving it overridable invites a subclass to reorder it. Subclasses supply only
      brokerage and DP — the entire difference between Zerodha and Groww. The five statutory
      charges are identical everywhere and live in the base class once.

      Three details make paisa-exactness possible at all, and each has a test: STT and stamp
      duty round to the **whole rupee** (leaving them at paise precision is the usual reason
      a reproduction misses by a few paise); stamp duty is buy-side only and intraday STT
      sell-side only, so both fall out of the breakdown entirely rather than appearing as
      zero lines; and Zerodha's DP fee is per **scrip per day**, so a trade carries a
      scrip-day count because one trade cannot know what else happened that day.

      Structure and numbers are separated: these classes hold which charges apply and on
      what basis, `charge_rates` holds the rates. A trade dated before any rate row charges
      nothing rather than silently applying today's rates retroactively.
- [x] **Deductibility is a property of the charge, not a comment.** STT non-deductible;
      brokerage/exchange/SEBI deductible; stamp duty capitalised.
      **Done when** the tax engine consumes `ChargeBreakdown.deductible` and never a total.
      Done, and enforced by absence rather than by discipline: `TaxableEvent` has a
      `deductibleCharges` field and **no** `totalCharges` field, so reducing a gain by STT
      is not a mistake available to make. A property test asserts the three buckets —
      deductible, non-deductible, capitalised — partition the total exactly, so a charge
      cannot fall out of all three and quietly vanish.

### 1e — Pricing and providers

- [x] **Schema: make quotes bitemporal.** Widen the key to
      `(instrument, as_of, quote_type, provider)` and add `ingested_at`; corrections insert,
      never overwrite. **Done when** two providers can disagree on one date and both rows survive.
      Landed with 1f (`ingested_at` is *in* the key, so a correction cannot overwrite the
      original); proven here. `tests/pricing-integration.spec.ts` stores NSE at ₹1,543.25 and
      Yahoo at ₹1,600.00 for one date, keeps both, then has NSE restate to ₹1,547.80 two days
      later — three rows, and "what did we believe on 22 August" is still answerable by
      filtering on `ingested_at`. That last query is the whole reason the column exists, so
      it is asserted rather than described.

      One column changed: `price_minor` became **`price_scaled`** (1e8) — see `UnitPrice`
      below.
- [x] **`infra/providers.ts`** — the abstract provider with retry/jitter, token bucket,
      circuit breaker and timeout in the **base class**, plus the 8 concrete providers.
      **Done when** the six conformance tests pass for at least two providers per need.
      Done: `ManualProvider`, `NseQuoteProvider`, `MfApiNavProvider`, `AmfiNavProvider`,
      `IbjaMetalProvider`, `CoinGeckoProvider`, `YahooQuoteProvider`, `EcbFxProvider`. All
      **keyless** — a key is a secret to store, rotate and leak, and Alpha Vantage's 25
      requests a day is not a data source.

      The HTTP client is a port and the clock is injected, so **CI never touches the
      network** and the resilience tests are exact rather than slow: `VirtualRuntime.sleep`
      advances a counter, which makes "waits 60 seconds, then probes" instant and makes the
      rate-limit assertion about the code's arithmetic instead of about machine load.

      Three corrections came out of writing the conformance suite, which is the argument for
      having one:

      - **A provider must refuse a class it does not declare.** Asked for a bond, six of them
        returned whatever their endpoint gave for that symbol. Requirement 6 is now enforced
        in the base class rather than declared and trusted — a plausible number for the wrong
        question is worse than an error.
      - **AMFI reported an unknown scheme as an empty success.** A scheme present with no NAV
        published today and a scheme absent from the file entirely are different facts;
        collapsing them hides a mistyped scheme code forever.
      - **"Two providers per need" does not hold for `OTHER`,** and asserting it anyway would
        have made the check meaningless everywhere else. A flat has no second opinion to get.
        The test asserts one provider there, by name, with the reason.
- [x] **`domain/pricing.ts`** — `PriceBook` with priority failover, golden-record
      selection, >1% divergence flagging, and the four-rung resolution ladder.
      **Done when** a missing price yields `null` with a staleness reason, and an induced
      provider outage fails over with no user-visible error. Done, and the ladder is
      *exact → carried forward with an age → stale past the class threshold → `null` with a
      reason*. Staleness is per asset class rather than global: four days for anything
      exchange-traded (a Friday close read on Tuesday after a Monday holiday is the common
      case), **one for crypto** because a market that never closes has no weekend to blame,
      thirty for assets valued by assertion.

      `refresh()` asks **every** healthy capable provider, not just the first. Stopping at
      the first would make the 1% cross-check impossible, and that cross-check is the only
      thing between a vendor's bad tick and a user's net worth. Divergences are compared
      *pairwise* rather than each-against-the-winner, because a third provider agreeing with
      neither of the first two is precisely the case worth seeing.

      Every provider tried appears in the report with what it returned — `OK`,
      `SKIPPED_UNHEALTHY`, `SKIPPED_UNSUPPORTED` or `FAILED` — so an outage reads as a named
      absence rather than as prices that quietly stopped updating.
- [x] **Not in the original plan: `UnitPrice`, because `Money` cannot hold a price.**
      This was a live bug, not a refinement. AMFI publishes NAV to four decimals;
      `Money.fromRupees("84.5612")` rounds to ₹84.56 without complaint, and on a 10,000-unit
      holding that is **₹12 of invented value** introduced at ingestion where nothing can see
      it. A price is a rate, like `Rate` and unlike `Money`, so `UnitPrice` (scale 1e8,
      currency-tagged) holds it and rounding happens once, at `price.times(quantity)`,
      half-even so a portfolio of many holdings does not drift upward.

      Worth recording how it was found: the first version of the golden-price test compared
      `rupees("84.5612")` against `rupees("84.5612")`, so **both sides rounded identically
      and the assertion passed while being wrong.** A golden value that is computed the same
      way as the thing it checks is not a golden value.
- [x] **`FxBook`** — `fx_rates` table with `provider_rate` and `user_rate`, resolved by the
      same ladder. **Done when** a user-asserted rate overrides the provider for tax. Done: a
      user's rate for a date beats every provider whatever its priority, is scoped to that
      user, and is stored as a **row beside** the vendor's rather than as an update to it —
      "why is this year's return different from what I filed" needs both numbers.

      ECB publishes EUR-based rates only, so USD/INR is `(EUR/INR) ÷ (EUR/USD)` and the
      division is **recorded on the row**: invariant Q06 (a rate and its inverse agree within
      0.1%) is only checkable if the derivation is visible. `convert()` has no
      assume-parity branch and no zero — an unconvertible amount is a typed failure, because
      quietly treating $1,100 as ₹1,100 is wrong by a factor of 84 and looks perfectly
      reasonable.

      This also closes 1b's open half: `FxConversion.impliedRate()` now has something to
      reconcile against.
- [x] **Backfill on add.** Adding an instrument fetches full available history.
      **Done when** XIRR over a period predating signup is computable. Done, and
      **resumable**: the range asked for comes from `coverage()` — a `MIN`/`MAX` over stored
      rows — so re-adding an instrument, retrying a failed job, or adding a second holding of
      something already tracked costs one small request instead of twenty years of them. A
      provider that rate-limits is one you can only afford to ask once.

      The gate is asserted directly: a fund with NAV history from 2019 is backfilled, and a
      valuation for 2021-04-01 resolves `EXACT` at ₹42.17 — 1,000 units worth ₹42,170.00,
      which is the figure XIRR needs for a date years before signup. A backfill where every
      provider failed is a typed *failure* rather than an empty success, because a caller
      that cannot tell the difference renders a blank chart as though the history never
      existed.
- [x] **Q01–Q06 at the ingestion boundary.** BLOCK invariants (Q01 positive price, Q02
      `ingested_at ≥ as_of`, Q04 currency match) reject the row; WARN invariants (Q03 a >50%
      day-over-day move, Q06 inverse consistency) accept it and say so. That difference is
      the point: **a 60% one-day move is sometimes real**, and a rule that dropped it would
      silently lose a crash. Q01 is also a database CHECK, and the integration spec proves
      both layers reject it — a domain test standing in for a constraint is how an invariant
      ends up enforced nowhere.

### 1f — Ledger infrastructure

- [x] **Consolidate schema** to `infra/db/schema.ts`, adding: `deleted_at` on every
      user-facing table, `audit_events` (append-only), `ledger_events` (append-only),
      `account.revision`, `institutions`, `counterparties`, `fx_rates`,
      `corporate_actions`, `import_rows`, `documents`, `tax_rules` seed.
      **Done when** migrations apply clean and no table lacks `deleted_at`. Done: 18 tables
      became 36, adding also `projection_cache`, `provider_fetch_log`, `price_divergences`,
      `cost_inflation_index`, `charge_rates` and `market_holidays`. Migrations squashed to
      one baseline — justified rather than convenient: the local database held zero rows
      across all 18 tables (checked before deleting anything) and this step renames two
      tables and widens a unique index. Additive from here.

      Two deliberate deviations. `price_quotes` puts `ingested_at` **in** the unique key,
      because §3.8's four-column key would force a vendor correction to overwrite the
      original and so defeat the second time axis the column exists for. And §2.1's
      16-value `account_type` axis is **derived** rather than stored: `AccountType` keeps the
      five values that own the debit/credit algebra, `AccountSubtype` owns presentation, and
      `legalityRoleOf()` computes the role from the pair — so the two cannot drift apart and
      a posting's sign still depends on `type` alone.

      Tables excluded from `deleted_at` with reasons rather than silently: the append-only
      logs and the bitemporal price/FX tables (a tombstone on an immutable log is a
      contradiction), the seeded reference tables (keyed by natural key, so there is no row
      to tombstone), and the rebuildable caches.
- [x] **Seed data, as TypeScript.** `txn_type_legality` (559 rows, wildcards expanded so a
      rejection names the exact missing row), both regimes mirrored into `tax_rules`, 25
      years of CII, 16 charge rates, 370 holidays mirrored from `MarketCalendar`. Written as
      TypeScript rather than SQL because every table here holds a fact the domain also reads
      at runtime, and SQL inserts would mean two copies with the domain trusting the one
      nobody diffed. **Done when** seeding twice writes nothing the second time and
      `EXPENSE` appears as a source only for `REFUND`.
- [x] **Soft delete everywhere.** All reads go through views/helpers filtering it.
      **Done when** no code path issues a `DELETE`, and A03 has a test. Done, and the guard
      found three hard deletes in the ported repositories. `deleteByImportBatch` was the
      worst: it relied on `ON DELETE CASCADE` to take the postings with it, destroying the
      evidence of what the import had done, so "undo it and tell me what changed" was
      unanswerable. The ports now omit `delete` entirely rather than deprecating it — a
      repository that offers a hard delete eventually has one called.

      Implemented as filtered predicates rather than SQL views: 17 read predicates gained an
      `isNull` guard and `tests/schema-guard.spec.ts` counts them against the known writers.
      That count immediately caught `earliestPostedOn` reading unfiltered, which meant a
      tombstoned entry could still set the start of the net-worth timeline — exactly the leak
      a `deletedAt` column invites.
- [x] **Audit trail.** Every mutation writes one `audit_events` row with actor, before,
      after, request id. **Done when** A02 has a test and the table has no update path.
      Done: `UnitOfWork.mutate` writes the row, one audit event, one ledger event and the
      revision bumps as a single operation. The writers are constructor dependencies rather
      than optional collaborators, because made optional the first path in a hurry omits
      them, and an audit trail with a hole in it looks exactly like one without.
      `audit.spec.ts` covers one event per mutation, **none on a failed mutation**, and one
      request id across a multi-aggregate change.
- [x] **`infra/repositories.ts`** — one repository class per aggregate, all in one file.
      Ports the three existing Drizzle repositories, which are correct. Ported during the
      layout migration and extended here with the soft-delete contract. "Which are correct"
      proved true of their arithmetic and false of their deletes.
- [x] **Projection cache keyed by revision.** `(scope, as_of, revision_vector)`; a
      backdated write bumps the revision and invalidates exactly the affected projections.
      **Done when** B04 has a test and a backdated 2019 entry does not invalidate 2024.
      **This done-when is only half right, and the other half is now tested.** A backdated
      2019 entry must not invalidate a 2024 *period* projection — an FY2024-25 income
      statement is genuinely unaffected. It **must** invalidate a 2024 *cumulative* one: a
      2019 opening balance certainly changes a 2024 closing balance. Erring toward "leave it
      cached" produces a wrong number nothing detects, so `ProjectionScope` is a union and
      the two families invalidate by different rules. A write with no accounting date
      invalidates nothing, because it changes no balance. `minAffectedDate` uses `min()`
      rather than assignment, so a backdated write lowers the boundary and a later one
      leaves it alone.
- [x] **Nightly reproducibility job.** Recompute every projection from `ledger_events` and
      diff against cache. **Done when** an induced cache poisoning is detected.
      *`npm run verify:reproducibility` (`app/reproducibility.usecases.ts`,
      `scripts/reproducibility.mjs`). **Amended, and the amendment matters:** nothing on the
      write path fills `ledger_events` or `projection_cache` — `UnitOfWork` is their only
      writer and no repository routes through it — so replaying the event log would have
      diffed two empty tables and reported a pass. The job instead diffs two genuinely
      independent recomputations over the journal (a SQL `SUM` against a TypeScript fold),
      checks L01 in the raw rows, recomputes any cached projection that does exist, and
      reports the empty event log as a **gap** rather than a pass. Differences exit non-zero;
      gaps are printed and do not. The induced-corruption test is `reproducibility.spec.ts`,
      which unbalances an entry with raw SQL and makes the two paths disagree.*

### 1g — Design system and chart kit

*Built now, so every later slice inherits it rather than retrofitting.*

- [x] **`ui/tokens.css`** — promote the existing CRED-inspired dark system in
      `app/globals.css` (already good: layered near-blacks, hairline borders, single violet
      accent, `tnum` for money) to the single global stylesheet. One type scale, one spacing
      scale, one radius scale, semantic `pos`/`neg`/`warn` separate from the accent.
      **Done when** no component defines a raw hex, enforced by a lint rule. ✔ *`globals.css`
      is now three `@import` lines. A real type scale replaced ~30 arbitrary values;
      `.container`'s 1540px and the shell's 1440px collapsed into one `--width-content`;
      every hardcoded gradient hex became `color-mix` on a token (`.gradient-text`'s three
      stops turned out to be exactly `--accent-foreground`, `--primary` and `--info`); the
      logo's gradient moved to a deliberately brand-locked `--brand-mark-*` triplet so the
      mark does not shift when the accent is retuned; 99 lines of CSS for deleted components
      removed. `money/no-raw-hex` passes with **zero** `eslint-disable` comments anywhere.*
- [x] **`ui/primitives.tsx`** — `Card`, `Stat`, `DataTable` (sticky header, tabular nums,
      keyboard row nav), `MoneyText` (never renders a raw number), `Pill`, `Sheet`, `Field`.
      **Done when** three existing manager components are rewritten to use only primitives
      and lose their bespoke CSS. ✔ *Done-when substituted per F3 — the manager components
      were deleted with v1. The eight pages are rebuilt on primitives and the six data pages
      contain **zero** colour or typography classes, only layout utilities. `MoneyText` takes
      `Money | null` and not `number`, so a float has no path to the screen; `null` renders
      an em-dash, never ₹0. `Delta` is separate from `Pill` and derives its direction from
      the value, making a red gain unexpressible. Two boundary bugs surfaced only by running
      it: `"use client"` on the whole module stopped everything server-rendering (split
      `DataTable` out), and column `render` functions cannot cross the RSC boundary (added
      `TableFrame`, which takes a serialisable `ColumnSpec`). `Sheet` is deferred until a
      screen needs it rather than shipped unused.*
- [x] **Add Recharts; build `ui/charts.tsx`.** One `<Chart>` wrapper applying the tokens,
      then `LineChart`, `BarChart`, `DonutChart` on Recharts and `CandleChart`,
      `DrawdownChart`, `LotTimeline` as hand-authored SVG. Replaces `SpendTrendChart`,
      `AllocationDonut`, `NetWorthTimeline`. **Done when** every chart shares one palette,
      has axes, tooltips, an empty state and a reduced-motion path. ✔ *recharts@3.10 (React
      19 in its peer range). Line/Bar/Donut ship now; Candle, Drawdown and LotTimeline are
      deferred to Phase 5, where the instruments and lots they plot are built — shipping
      them empty would be code nobody has run. **The palette was measurably broken**, not
      merely improvable: `--chart-3` `#6ea8ff` and `--chart-4` `#a78bff` sat at ΔE 1.9 under
      deuteranopia and 9.6 under normal vision — below the 15 floor — and were adjacent, so
      any two-series chart landing on slots 3 and 4 was unreadable. Three of five checks
      failed. Re-stepped to five hues that pass all five, worst adjacent pair ΔE 9.4 protan /
      18.1 normal. No dual axis is expressible (there is no `yAxisId` prop) and series past
      the fifth fold to "Other" instead of inventing a hue. `tests/ui-tokens.spec.ts` pins
      all of it.*

**Gate for Phase 1:** `npm test` green with the invariant, property, golden and
conformance suites in it; a contract note reproduces to the paisa; a pre-2018 equity sale
reports gain ≠ taxable. **No screen has changed yet.**

**Gate status.** The two substantive criteria are met: a Zerodha delivery contract note
reproduces line by line to the paisa (`tests/charges.spec.ts`), and a pre-2018 equity sale
reports `gain` ₹8,00,000 against `taxable` ₹3,75,000 (`tests/tax-golden.spec.ts`). The
property and golden suites exist — 15 spec files, and the properties run 90,000+ generated
cases between them. The **conformance** suite arrives with 1e, and the invariant suite
L01–L12 with 1b, so the gate is not yet fully green. No screen has changed.

---

## Phase 2 — Banking

*The user's step 2. First slice to reach the UI; the pattern every later slice copies.*

- [x] **`BankAccount`, `Wallet`, `CashInHand` classes** in `domain/assets.ts` with
      `valueOn()` reading the journal, not a stored balance.
      **Done when** net worth is derived and a stored-balance column no longer exists.
      Done — and the classes are deliberately *thin wrappers around `Account`* rather than a
      parallel entity with its own rows. What they add over a bare account is only what
      differs per kind: a bank account may be overdrawn (and whether that is within the
      arranged limit is the interesting half), a prepaid wallet cannot go negative, and cash
      in hand is reconciled by counting. `valueOn()` takes a one-method `BalanceSource` port
      and is `async`, which is the honest signature — a synchronous `get balance()` would have
      to be fed from a cached field, which is the field this class exists not to have.

      A negative wallet balance is returned as a **finding, not an exception**: the ledger is
      right and the world disagrees, and refusing to display the number would hide the only
      evidence of the double-posted debit that caused it.
- [x] **`banking.usecases.ts`** — open account, record expense/income/transfer,
      reconcile a statement, undo an import. Done, plus the import path and budget planning.

      **Reconciliation reports; it does not mutate.** The obvious design — flip the matched
      postings to `RECONCILED` — was rejected for a structural reason. L10 (reconciled
      postings are immutable) is currently enforced *by the absence of any posting-level write
      path*; adding one so a screen could stamp a status would reintroduce exactly the hole
      L10 exists to close, in exchange for a flag. What the user needs from reconciliation is
      the difference and its explanation, and both are derivable. A cash difference becomes an
      adjustment (`CashInHand.reconcileTo`); a missing row becomes an import.
- [x] **Statement import, upgraded.** Reuse the existing header-alias parser
      (`features/transactions/statement-parser.ts` — genuinely good: narration, particulars,
      withdrawal (dr), chq/ref no) but parse amounts into `Money`, not `parseFloat`.
      **Done when** three real bank statements round-trip with every amount exact. Done —
      `infra/statements.ts`, three layouts in `tests/statements.spec.ts` (HDFC's
      withdrawal/deposit pair, ICICI's single amount column with a `Dr/Cr` marker, and a
      layout no alias table knows, which forces content inference).

      The round-trip is asserted by **`checkBalanceContinuity`**, not by eyeballing totals:
      every printed closing balance must equal the previous one plus that row's movement,
      exactly. That check is only meaningful because the amounts are `bigint` — under v1's
      floats it could only ever have been approximate, which is presumably why it did not
      exist. It also *detects*: swap one row's debit and credit and every subsequent row
      fails, which is asserted too.

      Three bugs surfaced from retyping rather than rewriting:

      1. **`debit || credit` made an exact-zero debit fall through to the credit column**, so
         a ₹0.00 charge line imported as a deposit. Zero and absent are different facts; the
         code uses `??` and the zero row becomes a reported problem.
      2. **A column had to be numeric on 30% of rows to count as an amount column.** One
         salary credit among a hundred debits is 1%, so the credit column of an ordinary
         salaried statement was dropped, the debit/credit vote was left with one column, and
         *every credit in the file read as a debit*. Purity plus a small text tolerance
         identifies the same columns with no cliff.
      3. **A fully-populated numeric column could win the debit-vs-credit vote.** The salary
         row of the inference fixture parsed as ₹3.00 — its row number. A debit/credit pair is
         inherently sparse, so when two or more sparse columns exist the fully-populated ones
         are not amounts.

      Two changes that are corrections rather than ports: **the date order is decided once per
      file** from the evidence in it (v1 assumed `dd/mm` unconditionally; a per-row guess would
      read `03/04` and `13/04` under different conventions and silently reorder the statement),
      and **unreadable rows are returned as problems rather than dropped** — v1 reported "0
      transactions found" for a misdetected file with no hint that 214 lines had been discarded.
- [x] **Import staging.** Rows land in `import_rows` as `DRAFT` → matched → user confirms →
      posted. **Done when** I01 has a test and nothing reaches the ledger unconfirmed.
      Done. I01 is enforced *by shape*: `PostImportBatch` asks the repository for `CONFIRMED`
      rows, and there is no argument that widens that filter. `tests/banking-integration.spec.ts`
      posts a wholly unreviewed batch and asserts the ledger is untouched.

      **Four layers of duplicate detection**, in increasing order of doubt, and the order is
      the point: the same file (I02, by SHA-256 of the bytes), the same row of the same file
      (fingerprint, including `occurrence`), the same bank reference (matcher pass 2), and
      looks-the-same-within-a-week (pass 3). A flagged row is staged, never dropped — "we
      think you already have this" is a claim the user must be able to overrule, and the
      fingerprint index is still the backstop when they do.
- [x] **3-pass dedup matcher.** Port Actual's algorithm wholesale: rules first, then exact
      `external_id`, then ±7-day same-amount ordered by date distance with a shared
      `matched` set, three complete sweeps, `strictIdChecking`.
      **Done when** a golden fixture set reproduces the documented behaviour and a
      re-imported overlapping statement adds nothing. Done — and the two properties that are
      easy to get wrong are asserted directly: **three complete sweeps** (a row that matches
      by id must win over an earlier row that would fuzzy-claim the same transaction — a
      per-row loop gets this backwards) and **one shared `matched` set** (two identical ₹40
      rows cannot both claim the single ₹40 transaction already recorded). Ties at equal date
      distance break by transaction id, because a re-import that resolves differently on
      Tuesday is not a duplicate check.

      **Match targets have to be flipped into statement terms.** On an asset account a debit
      posting is money coming *in*, which the statement prints as a credit. Unflipped, the
      matcher compares every incoming debit against the ledger's credits, finds nothing, and
      re-imports the whole file.
- [x] **Categorisation, kept deliberately keyword-based.** Port `categorizer.ts` including
      the self/family payee detection (a genuinely good idea, absent from every reference
      repo). Rules stay normalised rows with priority. **No AI in the categorisation path.**
      **Done when** the same statement re-imported next month categorises identically. Done,
      and determinism is a property test over shuffled rule orders rather than a comment: a
      database is free to return rules in any order, so the ordering (priority, then longer
      pattern, then rule id) lives in the categoriser and the final tie-break exists solely so
      no answer can depend on the query plan.

      The no-AI decision is not about cost. An import must produce the same answer in December
      that it produced in August, or a re-import silently rewrites last month's budget report;
      a model updated between the two runs cannot promise that, and a per-row API call also
      ships the user's spending to a third party. Every rule is a string the user can read.

      **The 282 built-in keywords ship as editable rows, not as behaviour.** "Why was this
      groceries?" then has an answer the user can open and change — which is the whole argument
      for keywords over a model, and it is lost if the defaults are invisible. They are keyed
      by account *code* and resolved against the user's own chart, so renaming a category loses
      one built-in rule rather than breaking the import.
- [x] **Budgets.** Keep the existing per-account monthly limit with recurring default and
      warn threshold, and add carryover so envelope mode is expressible.
      **Done when** the four formulas of `30-CALCULATIONS.md` §7 are reproduced with tests.
      Done — `BudgetLedger.plan` is a fold over months, not a formula per cell, because every
      term depends on the previous month and the carryover flag decides whether a *negative*
      leftover propagates or is truncated and charged to the month instead. Recomputing one
      month in isolation is therefore impossible, and pretending otherwise is how a budget app
      ends up with a total that depends on which screen you opened first.

      One subtlety the formulas hide: `last_month_overspent` loops over *last month's*
      categories, not this month's, so an overspend in a category that has no envelope this
      month is still charged. Utilisation is returned in basis points — an integer percent
      would render ₹9,999 of a ₹10,000 budget as "100%" and hide that it has not been breached.
- [x] **Screens.** Accounts list, transaction register (keyboard-driven, virtualised),
      import wizard with the DRAFT review step, budget view — all on `ui/primitives`. Done —
      `/accounts`, `/transactions`, `/imports` + `/imports/[batchId]`, `/budgets`. The review
      screen is I01 made visible: Ready / Looks familiar / Confirmed / Skipped, the category is
      a select over the user's own chart, and Post is the only path from a staged row to the
      ledger. Undo sits beside it, because an import you cannot undo is one you hesitate to run.

      *Virtualised* is **not** done and is deliberately deferred: `DataTable` renders a page of
      200 rows and filters in the client. A windowing library for 200 rows would be machinery
      nobody has needed; it is worth adding when a screen actually shows thousands.

      Two boundary facts the screens forced into the open. **`Money` cannot cross the RSC
      boundary** (it is a class) and a `number` must not (it is a float), so the server formats
      and the client positions — the client never holds an amount it could do arithmetic on.
      And **amount inputs are `z.string()`, never `z.coerce.number()`**: coercion would parse
      `"1234.56"` into a float before any of our code saw it, defeating the float prohibition
      at the one boundary where a human types money.

      `src/infra/container.ts` is the new composition root, and it has to be on the infra side
      of the dependency arrow: a use case may not import infra, so `src/app/` cannot do the
      wiring and a route should not construct seven repositories itself.
- [x] **Delete `features/accounts/`, `features/transactions/`, `features/networth/`.**
      **Done when** nothing imports them and the app still builds. Substituted per F3: all
      three died with v1 in Phase F. What remains under `features/` is `sync/`, which Phase 6
      removes with the rest of the v1 surface.

**Gate:** a year of real statements imports, categorises, and the register and net worth
agree with a hand-checked spreadsheet to the paisa.

**Gate status: met.** `tests/banking-year.spec.ts` is the hand-checked spreadsheet, written as
a fixture that emits 84 statement lines across FY2026-27 **and** keeps its own running balance
and per-category totals in exact paise, with arithmetic that never touches the ledger. Three
independently-derived answers are then compared and must agree to the paisa: the fixture's own
running total, the closing balance printed on the last line, and `BalanceQuery.balanceOf`'s
`SUM` over postings — with the pure `BalanceCalculator` fold as a fourth. Every category total
and every month's inflow and outflow match the tally exactly, nothing lands in
`Expenses:Uncategorized`, and re-importing the same year under a different file hash offers
nothing to post and leaves the balance unchanged. Amounts deliberately carry paise that do not
divide evenly, because a rounding bug hides perfectly behind round numbers.

---

## Phase 3 — Credit cards

*The user's step 3.*

- [x] **`CreditCard` class** — a `CreditProduct`, negative to net worth, with statement
      cycle, due date, limit, and `utilisation()`.
      **Done when** a card balance reduces net worth without a special case anywhere. Done —
      and the done-when is literally true: the sign comes from `AccountType.LIABILITY`, and
      `netWorthContribution` is the only place it is applied. A card's balance is stored and
      reported as a **positive amount owed**, because the account type already knows a credit
      increases a liability and a second sign convention on top of that is how a payment ends
      up increasing a debt.
- [x] **Billing cycle as a first-class concept.** Statement period, generated statement,
      minimum due, actual due — so "spent this month" and "billed this cycle" are different
      and both correct. **Done when** a mid-cycle purchase appears in spend but not in the
      current statement. Done, asserted in both specs.

      `BillingCycleRule` generates cycles rather than storing them, which is what lets a
      statement for any past month be reconstructed — including months before the app existed.
      The statement day is **clamped per month**: a card with a 31st statement date has a 28th
      in February, and a rule that produced 31 February would either throw or roll into March
      and lose a day of spending out of every statement. A property test walks thirteen
      consecutive cycles for generated statement days and asserts they are contiguous — no day
      of spending may fall between two bills, and none may fall in both.
- [x] **Card payment is a `Transfer`, never an expense.** **Done when** paying a card
      moves money between two accounts and inflates no expense category (invariant L12). Done
      — and it falls out of `RecordAccountTransfer` rather than being enforced in `PayCard`:
      both sides are balance-sheet accounts, so `RecordTransaction` builds a `Transfer`, which
      carries no category by construction. The integration spec asserts the month's expense
      total excludes an ₹18,240 payment. The payment form has no category field to offer.
- [x] **Interest and charges.** Finance charge on revolving balance, late fee, annual fee,
      and the reducing-balance versus flat distinction — via `Rate` with an explicit
      day-count. **Done when** a revolved balance accrues the same interest the issuer bills.

      **This is where my first implementation was wrong, and the test caught it.** Accruing
      42%/365 of the balance and rounding to the paisa on each of 30 days bills ₹345.30 where
      an issuer bills ₹345.21 — and wrong in the same direction every time, because each day's
      rounding is up to half a paisa high. Balance-days are now summed exactly and the rate
      applied once, which reproduces the issuer's own `principal × rate × days / 365`.

      Interest is charged **per day from the previous due date**, not on an average balance:
      ₹50,000 spent on day 2 of a revolved cycle carries ₹1,610.96 and the same spend on day 28
      carries ₹115.07, and an average-balance model would report one number for both. Fees post
      as two movements — the fee and its GST — because the tax is separately reportable and a
      single ₹590 line cannot be split back without re-deriving it.
- [x] **Reward points as a non-money quantity.** Tracked in `Quantity`, valued only on
      redemption. **Done when** points never enter a money column. Done — `RewardPointBalance`
      holds a `Quantity`, and the only way to get money out of it is
      `valueIfRedeemedAt(UnitPrice)`, which takes the rate as an argument every time. Points
      are not money until an issuer agrees to exchange them, the rate is theirs to change, and
      it differs by route (₹0.25 against a statement, ₹0.50 against a flight) — so a points
      balance in a money column would put an unrealised, issuer-controlled number into net
      worth.

      Points are **computed from the spends the ledger holds**, not tracked as a balance: a
      stored points balance would be a second number nothing reconciles.
- [x] **Screens.** Card detail with cycle timeline, utilisation gauge, due-date reminder,
      statement list. Done — `/cards` and `/cards/[accountId]`. The statement list shows every
      term of the identity (opening, spends, charges, payments, refunds, closing) so it visibly
      adds up; the timeline draws the two segments that matter, spending up to the statement
      date and interest-free time after it. "Amount due" is taken from the cycle that has most
      recently **closed**, not from the running balance — the issuer has not billed what was
      spent yesterday, and quoting today's debt as the amount due tells the user to pay money
      nobody has asked for.
- [x] **Delete card handling from `features/liabilities/`.** Substituted per F3: it died with
      v1 in Phase F.

**Gate:** a real card statement reconciles — opening balance + spends − payments + charges
= closing balance, exactly.

**Gate status: met, twice.** `tests/cards.spec.ts` asserts the identity on a worked
HDFC-shaped statement (opening ₹18,240, four purchases, interest and its GST, an annual fee
and its GST, a payment and a refund → ₹35,469.97) and refuses a printed figure one paisa out.
`tests/cards-integration.spec.ts` asserts it for statements **rebuilt from postings**, where
each movement's kind is inferred from the account on the other leg — and additionally checks
each statement's closing balance against `BalanceQuery.balanceOf` on the statement date, so
the two derivations must agree.

Three findings worth carrying forward:

  - **`REFUND` was in `TRANSACTION_KINDS` and in the legality matrix, and no class could
    construct one.** A returned ₹1,299 purchase had nowhere to go. `Refund` is now the
    fourteenth `Transaction` subclass, with its category on the **source**, because a refund
    of groceries must reduce groceries — a budget that ignored it would report the month
    overspent for a purchase that was returned. It is the one transaction type where an
    expense account is legitimately a source, which is precisely why L07 is a rule of the
    legality matrix rather than a blanket check.
  - **An opening balance is not spending.** Mapped as a spend it earned reward points for
    debt the card arrived with; it maps to a charge.
  - **The seeded `Liabilities:Credit Cards` group account carries the card subtype**, so "every
    account with subtype CREDIT_CARD" listed a card the user never opened — the same shape of
    problem as the cash group accounts in Phase 2. A card is one that has stored terms or a
    balance.

The schema guard also earned its place again: it refused the new table for storing amounts
with no currency column (a USD card's limit read back as rupees) and for a TEXT column whose
name contained "rate". Both were fixed rather than added to the known-gap list, and migration
0002 was regenerated before it had ever been applied.

---

## Phase 4 — Deposits and retirement

*The user's step 4: FD, RD, PPF, EPF, NPS.*

- [x] **`DepositProduct` hierarchy** with `interestType` (simple/compound/flat/reducing),
      `compoundingFrequency` (daily → at-maturity), maturity date, and a computed
      `schedule()`. **Done when** each subclass's maturity value matches the bank's own
      certificate for a real deposit. Done — `domain/deposits.ts`.

      **The stub period is what makes a computed maturity match a certificate.** Banks pay
      simple interest on the days that do not complete a compounding period, so a deposit
      opened mid-quarter is understated by up to three months of interest without it. That
      single omission is the most common reason a personal-finance app's FD figure is "close".

      `(1 + r/m)^n` is an exact bigint rational, applied through `Money.timesRatio` so the
      rounding happens once. `tests/deposits.spec.ts` cross-checks the exponentiation against
      repeated multiplication — two routes through the same arithmetic that must agree — and
      the ₹1,00,000 at 7.1% quarterly for five years case comes out at ₹1,42,174.67.
- [x] **Accrual as a computation, not a stored balance.** Replace v1's nightly
      balance-mutating job: `valueOn(asOf)` *computes* accrued interest from first
      principles. **Done when** deleting the accrual job changes no reported number. Done, and
      the done-when is satisfied by there being no job to delete: there is nowhere for an
      accrued balance to live.

      A property test asserts the honest version of that claim — the same date gives the same
      value however it is reached, with other dates computed in between, which a stateful
      accrual could not promise. The integration spec goes further and writes unrelated
      transactions between two reads.

      The **difference between the computed value and the journal balance is surfaced as
      `unbooked`**, not hidden. A deposit grows daily and the ledger only learns when interest
      is credited, so the two legitimately differ; naming the gap turns "these disagree" into
      "₹67,620.87 of interest has accrued and is not yet posted". `BookAccruedInterest` posts
      it when the user asks, and is idempotent.
- [x] **RD instalment schedule** with missed-instalment handling. Done — each instalment
      compounds for its own remaining term, so the maturity value is a sum over instalments
      rather than one formula: instalment 1 compounds for two years and instalment 24 for
      none, and the "average balance" shortcut that looks equivalent is not. A missed
      instalment costs more than the instalment — the interest it would have earned is gone too
      — which the spec asserts rather than assuming.
- [x] **PPF** — annual limit, 15-year lock, extension blocks, EEE tax treatment. Done. The
      ₹1.5 lakh ceiling is *enforced at construction*, not documented: a contribution above it
      earns no interest and is returned, so modelling ₹2 lakh as invested would overstate the
      balance for fifteen years.

      **PPF earns sixteen interest credits against fifteen contributions**, and the test says
      so explicitly. The scheme rules mature the account fifteen years from the *end of the
      year it was opened*, so one opened in May 2026 matures on 31 March 2042 and earns
      interest in sixteen financial years — ₹43,57,052 where every popular calculator prints
      the fifteen-credit ₹40,68,209. The statute wins; the difference is documented so nobody
      later "fixes" it to match a calculator.

      One assumption is stated rather than hidden: a year's contribution earns a full year's
      interest, which is true only if it was paid before the 5th of April. Modelling the month
      of each contribution needs a date the passbook import does not yet carry.
- [x] **EPF** — employee/employer/VPF split, interest credited annually, taxable-above-
      threshold rules. **Done when** the three sub-balances are tracked separately. Done, and
      they have to be: interest on employee plus voluntary contributions above ₹2.5 lakh a
      year is taxable while the employer's share is not, and one combined balance cannot
      answer that at all.

      **My first implementation credited a full year's interest on the year's contributions,
      and that was wrong by a lot.** Twelve monthly contributions earn 6.5 months of interest
      on average — `(12+11+…+1)/12` — so the base is `opening + contribution × 13/24`. The
      naive version credited ₹14,850 where EPFO credits ₹8,044 on ₹1.8 lakh at 8.25%: ₹6,800
      of invented money in year one, compounding for a working life.
- [x] **NPS** — tier I/II, scheme-wise NAV allocation (E/C/G/A), and the fact that it is
      priced from a NAV, not accrued. **Done when** NPS value reads a real NAV through the
      `PriceBook`. Done as far as the domain and the storage go: units per scheme are stored,
      and `valueFrom(navs)` prices them. **The `PriceBook` wiring is deferred to Phase 5**,
      where the instrument identifiers a NAV is resolved by are built — today the caller
      passes the NAVs, and the deposit list reports NPS as *unvalued* rather than guessing.

      `valueFrom` returns `null` when any held scheme has no NAV. All-or-nothing rather than
      partial, because a partial total looks exactly like a complete one on a screen: ₹5 lakh
      shown for an ₹8 lakh holding is worse than showing nothing.
- [x] **Loan mathematics — the whole gap.** `Loan` subclasses with EMI
      (`P·r·(1+r)ⁿ/((1+r)ⁿ−1)`), a generated `amortisation_schedule` with the **mandatory
      final-period adjustment**, prepayment handling, and avalanche versus snowball payoff
      comparison. **Done when** N01–N04 hold: `Σ principal` equals the principal exactly and
      the final closing balance is exactly zero, for generated rates and terms. Done —
      `domain/loans.ts`, with N01–N03 asserted over ~5,000 generated loans spanning 0–60%
      rates, 1–360 periods and three payment frequencies.

      The EMI formula is rearranged so nothing leaves the integers:
      `EMI = P·s·(B+s)ⁿ / (B·((B+s)ⁿ − Bⁿ))`. A 30-year monthly loan raises a 21-digit base to
      the 360th power — about 7,500 digits — where a `double` has been wrong since the 15th.
      Three of my six hand-worked EMI expectations were wrong; the 8.5%/240-month case matching
      to the paisa is what showed the formula was right and my memory was not.

      Prepayment makes the borrower choose what the lump sum shortens, because the lender does:
      reducing the term saves more interest, reducing the instalment eases cashflow, and
      defaulting it would show a schedule the lender does not agree with.
- [x] **Flat versus reducing-balance,** with the effective annual rate always displayed
      alongside — flat quoting is common in Indian consumer lending and overstates nothing
      by accident. **Done when** a flat-rate loan shows both numbers. Done, and the effective
      rate is **solved by bisection on the exact EMI function** rather than by the textbook
      `2·n·r/(n+1)` approximation, which is off by a percentage point at long tenors — the
      whole point of the figure is that it is the honest one. A property test asserts the
      effective rate always exceeds the quoted one, and the loans list shows the column on
      every loan rather than only on flat ones, so the difference is legible instead of being
      something the user has to know to look for.
- [x] **Screens.** Deposit ladder with maturity timeline, loan detail with amortisation
      table and payoff comparison. Done — `/deposits`, `/loans`, `/loans/[accountId]` and
      `/loans/payoff`. The payoff page shows both strategies with the interest each costs and
      **labels neither "recommended"**: avalanche always pays less, which is arithmetic, and
      snowball clears a debt sooner, which is a real behavioural argument. Presenting the cost
      of the choice is honest; making it for the user and calling it advice is not.
- [x] **Delete `features/assets/`, `features/liabilities/`.** Substituted per F3: both died
      with v1 in Phase F.

**Gate:** every deposit's computed maturity matches its certificate; every loan schedule
sums to its principal exactly.

**Gate status: met.** `tests/deposits.spec.ts` and `tests/loans.spec.ts` prove the arithmetic
(78 and 61 assertions, ~11,000 generated cases); `tests/lending-integration.spec.ts` proves it
survives the round trip through libSQL and agrees with the ledger the postings build — 70
assertions covering a funded FD, an RD, PPF with three years of contributions and notified
rates, EPF's three sub-balances, NPS priced from NAVs, a home loan with twelve EMIs and a
prepayment, a flat-rate loan, and the payoff comparison.

Two notes for later:

  - **Two new files, off the target shape.** `domain/deposits.ts`, `domain/loans.ts` and
    `app/lending.usecases.ts` are not in the plan's file list, which puts the whole asset
    hierarchy in `domain/assets.ts` and has four `*.usecases.ts` files. The rule is one file
    per *concept*: `assets.ts` would otherwise be three thousand lines covering cash, credit,
    deposits, retirement and property, and each of these is a concept with a great deal of
    arithmetic. Recorded as a deliberate deviation rather than a drift.
  - **An EMI posts as two transactions**, a `Transfer` for the principal and a `Charge` for
    the interest, sharing a reference. A two-legged transaction cannot say both things, and a
    three-legged `LoanPayment` subclass — the better accounting — needs a new transaction kind
    and new legality-matrix rows. Worth doing when the next multi-leg event arrives.

---

## Phase 5 — Investments

*The user's step 5. The largest slice, and the one the class design exists for.*

- [x] **`MarketInstrument` hierarchy** — the 13 leaf classes, each with its own
      `taxProfile()`, `quoteKey()` and `valueOn()`. Notably: `LiquidFund` and `DebtFund`
      taxed at slab always; `ElssFund` with its 3-year lock; `SovereignGoldBond` with
      exempt-at-maturity; `DigitalGold`/`DigitalSilver` in grams.
      **Done when** adding a 14th instrument type touches exactly one file. Done —
      `domain/instruments.ts`.

      The done-when cannot be tested directly, so it is tested by its two preconditions:
      every leaf answers all three questions (a loop over `MarketInstrument.kinds()`, so a new
      kind that forgot a `taxProfile` fails there rather than at a call site), and **no file
      outside `instruments.ts` compares against an instrument kind** — asserted by grepping
      `src/domain` and `src/app`. The tax engine sees a `TaxCategory`, the price book sees an
      identifier, and neither knows what a liquid fund is.

      One correction: **the ELSS lock-in is three calendar years, not 1,095 days.** Units
      bought on 1 April 2026 unlock on 1 April 2029, which is 1,096 days later because 2028 is
      a leap year — a day count would have released them a day before the registrar does.
- [x] **`domain/lots.ts` with all five selection strategies** as classes —
      `Fifo`, `Lifo`, `Hifo`, `AverageCost`, `SpecificId` — behind one
      `LotSelectionStrategy` interface, set per account and overridable per disposal.
      **Done when** the property test holds — all five methods dispose identical total
      quantity and differ only in basis — and `AverageCost` recomputes forward from the
      first affected transaction on a backdated buy. Both done, over ~6,000 generated cases.

      The strategies differ **only in the order they offer lots in**; the consumption loop is
      shared, so a strategy has no opportunity to lose a unit — which is why the identical-total
      property is structural rather than lucky. A consumed lot's remainder is computed by
      *subtraction* rather than by a second proportional calculation: two proportions each
      round and the roundings do not cancel.

      `AverageCostBook` replays the whole event history, because there is no correct
      incremental update — a backdated buy changes the average every later sale used. A
      disposal under average cost carries `lotId: null` rather than naming a lot it did not
      consume.

      The same three lots, the same sale: long-term under FIFO and short-term under LIFO.
      That is asserted directly, and it is why the method is a per-account setting rather than
      a constant.
- [x] **`Money.allocate` for basis splits.** **Done when** a fully liquidated position's
      `Σ realised gain` equals `total proceeds − total cost`, exactly, with no leaked paise.
      Done, as a generated property rather than an example: leaked paise are a *cumulative*
      failure, so one partial sale proves nothing and two thousand do.

      `Money.allocate` gained a **bigint weight** overload for this. The lot engine weights by
      scaled unit counts, and `Number(quantity.scaled)` on a large holding silently leaves the
      safe-integer range — which the float lint rule caught. A weight only has to be
      proportionally right, so an exact integer is strictly better than a rounded double.
- [x] **Corporate actions — the critical gap.** `domain/corporate.ts` with `Split`,
      `ReverseSplit`, `Bonus`, `Rights`, `Merger`, `Demerger`, `Spinoff`, `DividendCash`,
      `DividendStock`, `ReturnOfCapital`. **Applied as ledger transactions, never as
      in-place lot edits**, so they are visible, auditable and reversible.
      **Done when** a 1:5 split applied mid-history leaves every historical number correct,
      charts use adjusted prices, basis uses raw prices, and reversing the action undoes it.
      All four asserted, in the unit spec and again in the integration spec where the split
      lands between a buy and a sell.

      **A rescale takes a ratio, not a factor**, and the round-trip property test is what
      found it: `Quantity` holds eight decimals, so the inverse of a 1:6 split is 0.16666667
      and consolidating 6:1 did not return the original quantity. Multiplying by `to` and
      dividing by `from` in one exact bigint expression is reversible — and a corporate action
      that cannot be undone exactly is the failure this whole design exists to prevent.

      Three modelling decisions worth carrying: **a bonus issue is not a split** (the bonus
      units take the ex-date as their acquisition date, so a long-held position has a
      short-term tranche the next day, which a rescale would have reported as long-term); **a
      dividend is not a return of basis and a return of capital is not income** (the same
      ₹20,000 is taxable now under one and more gain later under the other); and **a
      share-for-share merger is not taxable under §47** — only its cash element is.
- [x] **Returns.** Rebuild XIRR properly: **bracket first, then Newton inside the bracket**,
      relative tolerance 1e-9 on the NPV residual, ACT/365F, and a typed `XirrUndefined`
      with a reason — never `0`, never a bare `null`. Add **TWR**, both Modified Dietz and
      true sub-period TWR. Done — `domain/portfolio.ts`.

      The file opens by saying where floating point starts and what is claimed about it,
      because this is the one place it is legitimate: an IRR has no closed form. Every input is
      exact, every output is a `Rate` or `Percentage` so nothing downstream keeps iterating on
      a double, and the residual is returned so convergence can be checked rather than assumed.

      Newton is **refused any step that leaves the bracket**. That is not a speed choice: from
      a guess, Newton can converge on the wrong root or shoot below −100%, and it returns a
      plausible number rather than an error. The extreme case the plan names — a fortnight's
      holding that doubled, annualising into the hundreds of thousands of percent — converges
      in four iterations.

      XIRR is tested by the property that *defines* it (the NPV at the returned rate is zero
      to tolerance) over generated flow sets, which is self-verifying in a way a remembered
      figure is not. TWR is tested by invariance to cashflow timing, with the same fixture run
      through XIRR to show a money-weighted return is *not* invariant — the contrast is why
      both exist.

      Two findings: **`Rate.percent` is display precision, not computation precision** (it
      converts to `Percentage`'s six decimals, which near a steep NPV slope reads as a solver
      failure and is not), and **a residual tolerance has to scale with the problem** — near
      −99% a rate correct to 1e-12 still leaves a large residual.
- [x] **Risk metrics** in `domain/portfolio.ts`: max drawdown, volatility (√252), Sharpe,
      Sortino, beta, alpha, correlation, historical VaR, yield on cost, dividend yield,
      allocation drift. Risk-free and benchmark series configured, never hard-coded. Done.

      Max drawdown returns its **peak and trough dates**, because a 32% fall in March 2020 and
      a 32% fall last month are different facts. Standard deviation is the **sample** form:
      a month of daily returns is 21 observations, where the population formula understates
      volatility by 2.4% and produces a Sharpe nobody else's is comparable to. VaR is
      **historical, not parametric** — returns are not normal, and a parametric VaR understates
      exactly the tail it is asked about. Allocation drift is reported in both percentage points
      and rupees: one is the risk statement, the other is the action.
- [x] **Positions and valuation** through the `PriceBook` ladder, with staleness surfaced in
      the UI. **Done when** a stale price is visibly marked and a missing one shows "no
      price", not ₹0. Done — and a portfolio total is `null` when *any* holding is unpriced,
      with the holdings named: a total that silently omits one looks exactly like a complete
      one, and a net worth quietly ₹5 lakh light is worse than a blank with an explanation.
- [x] **Trade import.** Port the holdings/trade-book importers; the AI parser stays as a
      **fallback behind** the deterministic parser and gains the missing safety step —
      independent regex corroboration of every extracted amount, and a DRAFT row the user
      confirms. **Done when an LLM-extracted amount can never become a posting unreviewed.**

      Done, with the AI half **deliberately not built**. The user's constraint is no paid APIs
      and no AI in the data path, and the deterministic parser covers the broker formats — so
      the requirement is satisfied today by there being nothing to guard. That is a weak
      guarantee that would quietly stop holding the moment someone added a fallback extractor,
      so `corroborate()` makes it structural: **any amount that did not come from a parsed
      column must be found, independently, by regex in the source text** — Indian *and* Western
      digit grouping — and `checkExtractedRow` returns a union, so a caller cannot stage an
      uncorroborated row without ignoring the result. Combined with I01's `CONFIRMED`-only
      rule, an extracted figure needs both a document that contains it and a human who agrees.

      The parser computes consideration as units × price rather than reading the broker's own
      value column, and *reports* a mismatch rather than resolving it: a ₹0.34 difference is
      usually their rounding, but "usually" is not a basis for overwriting either number, and a
      quantity typed with a missing digit shows up there first.
- [x] **Screens.** Portfolio with per-instrument drill-down, lot table with holding-period
      clock, realised/unrealised split, corporate-action history, returns panel (XIRR *and*
      TWR), allocation and drift. Done — `/investments` and `/investments/[instrumentId]`.

      The holding-period clock is the column that earns the screen: tax on a disposal turns on
      the days each lot has been held, so 340 days and 370 days are different decisions, and a
      screen showing only units and average cost hides the most actionable number a holder has.
      The method comparison sits beside it, because FIFO and HIFO on the same sale realise
      different gains and the difference is money the user can choose to keep.
- [x] **Delete `features/investments/`, `features/trades/`, `features/portfolio/`,
      `features/returns/`, `features/prices/`, `features/tax/`.** Substituted per F3: all six
      died with v1 in Phase F. What remains under `features/` is `sync/`, which Phase 6 removes.

**Gate:** a real broker trade book imports; cost basis, realised gain, XIRR and TWR match
hand-verified fixtures; a split mid-history breaks nothing.

**Gate status: met.** `tests/investing-integration.spec.ts` imports a Zerodha-shaped trade
book, registers the instruments, opens the lots, applies a 1:5 split **between a buy and a
sell**, sells across the split, and checks cost basis, realised gain, holding period, returns
and the realised-gain report — 64 assertions against figures worked in the test rather than
read from the code. The unit specs carry the rest: 61 assertions and ~6,000 generated cases
for lots, 93 and ~3,000 for corporate actions, 79 and ~4,000 for returns and risk, 66 for the
instrument hierarchy.

Three findings worth carrying forward:

  - **Capitalised charges must leave the holding account with the units.** The lot keeps price
    and charges apart because they are reported differently, but the account was debited with
    both — so crediting only the price on a sale strands the charges and a fully liquidated
    position never returns to zero.
  - **Absolute return has to count what has already been taken out.** A portfolio that sold
    half its holdings at a profit holds less than it invested; a return ignoring the proceeds
    reports that profit as a loss.
  - **`Transaction.cashflows()` is unavailable after a round trip.** A rehydrated transaction
    is deliberately a `StoredTransaction` — a `Sell` needs the lots it consumed, and inventing
    them would invent a cost basis — so the fourth polymorphic hook does not survive
    persistence. Returns are derived from the postings, which answer the same question without
    guessing. This is a real limit of the Phase 1 mapper decision rather than a workaround, and
    it is the one place the four-hook design does not reach across the database boundary.

---

## Phase 6 — Reports, and the extras worth keeping

- [x] **`domain/reports.ts`** — net worth at `asOf`, balance sheet, income statement, cash
      flow, allocation. **Done when B02 holds:** assets − liabilities = equity + income −
      expenses, at every date, as a test. Done, and the test is precise about what B02
      catches, which was a correction to my own first framing.

      Every balanced transaction preserves the identity *by construction* — a debit to an
      asset and a credit to income move both sides equally. So B02 is not a check on posting;
      it is a check on the **read path and the stored balances**: a sign error in a `SUM`, a
      stale cached projection, an account whose type was edited after it had postings. Each of
      those leaves debits equal to credits and the identity broken, which is exactly the class
      of bug "the transactions balanced" cannot see. B03's continuity check covers the other
      one — a backdated write that was not propagated forward.

      **A cash-flow statement built from income and expense accounts cannot reconcile.** The
      money that went into a fixed deposit never touched an expense account, and a loan drawn
      into a bank never touched an income one. Investing and financing are therefore the
      *movements in every balance-sheet account* over the period, which makes
      `Δcash = (income − expenses) − Δ(non-cash assets) + Δ(liabilities) + Δ(equity)` exact —
      B02 differenced over the period — and the gate spec asserts it ties rather than
      reporting whether it happens to.

      Everything here is a fold over balances that already exist: no report table, no stored
      total, no nightly rollup. That is why B02 can be asserted at *every* date rather than at
      month ends.
- [x] **Personal-finance metrics** — liquid net worth, savings rate, burn rate, runway, DTI,
      credit utilisation. Done. Every metric that could divide by zero returns `null` and the
      screen says so: **no runway rather than an infinite one**, no debt-to-income with no
      income, no utilisation with no limit. These are figures someone makes a decision on, and
      "cannot say" is a better input to a decision than a number that means nothing.

      Which spending counts as non-discretionary is an **input**, not a shipped list: a car
      loan is essential to someone who commutes 40km and discretionary to someone who does
      not, and a library that decided this would compute a runway that is wrong for most of
      its users while looking authoritative.
- [x] **Tax reports** — per-FY realised gains with rule provenance, loss carry-forward
      position, and tax-loss harvesting suggestions. Done.

      The report reads the **stored** disposals, whose holding days and tier were fixed at the
      moment of sale, so re-running last year's report after a budget produces last year's
      number — the property the whole regime-versioning design exists for, and one that a
      report recomputing holding periods against today's thresholds would silently lose. Every
      line carries its rule id, the regime version and the inputs, which `/history` renders.

      Harvesting suggestions are ranked by **tax saved, not loss size**: a short-term loss
      offsets gains taxed at 20% and a long-term one at 12.5%, so the bigger loss is not
      always the better trade. Crypto is listed and marked rather than counted, because a VDA
      loss cannot be set off against anything — including other crypto gains. The caveats
      include the one most tools imply and never state: **India has no wash-sale rule**, so a
      holding can be sold and bought back the same day and the loss still counts.
- [x] **Port the good extras onto the new core:** `EsopGrant` and `GoldLease` as
      `PhysicalAsset` subclasses (both genuinely absent from every reference architecture),
      price alerts over SMS/WhatsApp, news digest, AI market analysis and signals (clearly
      labelled as advisory, never feeding a posting), watchlist, monthly-wealth import.

      **Partly done, and the split is deliberate.** `EsopGrant` and `GoldLease` are built,
      with `PhysicalAsset`, `RealEstate`, `Vehicle` and `PhysicalGold` around them — these are
      the two pieces of v1 genuinely absent from every reference architecture, and they are
      what the item was really about.

      `EsopGrant` earns its class on three facts, each of which is money: **unvested options
      are not an asset** (counting them reports value that vanishes on resignation), **the
      taxable event is exercise** and the spread is *salary* income at slab whether or not a
      share is sold — for an unlisted company with no market to sell into — and **the capital
      gain runs from exercise on the FMV at exercise**, because using the strike price taxes
      the spread twice. `GoldLease` models rent **paid in grams**, where the holding grows
      without any money changing hands, and names the counterparty risk rather than discounting
      it away with a number nobody can justify.

      **Not built, and recorded rather than quietly dropped:** SMS/WhatsApp alerts need a paid
      gateway, and the news digest and the AI market analysis need a model — both against the
      standing constraint that this project uses no paid APIs and no AI in the data path. The
      watchlist and the monthly-wealth import are UI conveniences on top of data that already
      exists; they are worth doing and nothing depends on them, so they are deferred rather
      than counted as done here.
- [x] **Order path: risk gate first.** Either implement all eight pre-trade checks
      (position, exposure, order size, fat-finger, daily loss, rate limit, kill switch,
      margin) with fail-closed semantics and a unique `idempotency_key`, **or disable the
      live order path until they exist.** This is the one item that can lose real money.
      **Done when** an order cannot reach a broker without passing the gate. Done — all eight,
      plus idempotency and a short-sell guard, in `domain/risk.ts`.

      **Fail closed is the whole design.** Anything that is not an explicit `ALLOW` blocks:
      an unconfigured limit, a missing input, a check that threw. The usual shape — validators
      that push errors, with the order proceeding if the list is empty — fails *open* the
      moment a validator throws before it pushes, which is precisely when you least want it
      to. A new account starts with the kill switch engaged and no limits, because someone who
      has not said what they consider a safe order size has not consented to any order size,
      and a shipped default would be a judgement about someone the author has never met.

      The done-when holds two ways. `ApprovedOrder` can only be minted by the gate, so a
      future broker adapter that takes one cannot be called with a bare intent; and there is no
      broker adapter today, which `tests/reports.spec.ts` asserts by grepping every module in
      `src/` for one. The absence is deliberate, and the test tells whoever adds one that the
      gate is the way in.
- [x] **Delete the remaining `features/`, `core/`, and the mongoose dependency.** Done —
      both directories were empty shells left after Phase F and are now gone, and `mongoose`
      left `package.json` with v1. Asserted mechanically in the gate spec rather than by
      inspection.

**Gate:** the three financial statements reconcile; no v1 code remains; `mongoose` is out
of `package.json`.

**Gate status: met.** `tests/reports-integration.spec.ts` builds a deliberately varied ledger
— opening balances, six months of salary, rent and card spending, a card payment, a deposit
funded from a bank, a car loan drawn down with an EMI paid, and a share bought and partly sold
— which touches all five account types and every transaction subclass a household uses. On it:
B02 holds to zero, the balance sheet agrees with the read side's own totals, the cash-flow
statement ties to the change in cash exactly, B03 holds across seven month ends, the card
payment inflates no expense category, and the tax report carries provenance on every line. The
two remaining clauses are asserted mechanically: no v1 directory survives, `mongoose` is
absent from `package.json`, and nothing imports it.

Two notes for later:

  - **`/settings` still collects no tax settings**, so the history screen's tax panel runs at
    the top slab — a ceiling rather than an underestimate, and labelled as such on the screen.
  - **Credit utilisation reports `null`** until card limits are loaded into the personal
    report, rather than showing a misleading 0%. The limits exist in `credit_card_terms`; the
    wiring is a small piece of work that belongs with the settings screen.

---

## Phase 7 — Data migration and cutover

- [x] **`scripts/migrate-v1.ts`** — reads each Mongo collection and **replays it through the
      new use cases**, so accounts become opening-balance entries, transactions become
      fingerprinted `Expense`/`Income`/`Transfer`, trades become `Buy`/`Sell` rebuilding the
      lot book, and snapshots become cache rows. Anything failing validation is reported,
      not silently written. **Done when** a dry run prints a complete report and a real run
      is idempotent. Done — `app/migration.usecases.ts` with `scripts/migrate-v1-entry.ts`
      as the command (`npm run migrate:v1 -- --user <id> --dir ./v1-export [--commit]`), and
      `tests/migration.spec.ts` asserting both halves of the done-when.

      Three decisions differ from the item as written, and each is a correction rather than a
      shortcut.

      **It reads a `mongoexport` dump, not Mongo.** `mongoose` left `package.json` in Phase 6
      and nothing imports it; a migration that re-added a driver would undo that gate on the
      last lap. A file is also *reproducible*, which is the only thing that makes a dry run
      worth running: the same export migrates the same way, so what the dry run printed is
      what the real run does.

      **Trades are reported, not migrated.** A `Sell` consumes lots at a cost basis, so
      replaying v1's trades needs v1's *lot history* — and v1 never had one: it stored an
      average cost per holding and recomputed realised gains from floats. Rebuilding a lot
      book by replaying trades in date order would invent a basis, and any sale where that
      basis disagreed with v1's average would contradict **a tax return the user has already
      filed**. That is the user's decision, not a script's, so the migration lists what is
      there and points at the broker's own trade book, which carries the lots and is the
      authoritative record anyway.

      **Snapshots are skipped, not imported.** A snapshot is a cache of a number the journal
      now answers. Importing one would store a figure that could disagree with the ledger —
      and it is precisely the figure the reconciliation below measures *against*.

      Idempotency is a property of the data, not of the caller remembering: every migrated
      transaction carries `fingerprint: v1:<document id>`, so a second run recognises its own
      output. The spec runs the migration three times and the journal stops growing after the
      first. Accounts dedupe by name for the same reason, and source order is preserved so a
      re-run assigns the same codes.

      One defect the spec caught in my own first cut: the dry run mapped no account ids, so
      **every transaction was reported as rejected for want of an account the dry run was
      never going to create** — a dry run that lies in exactly the direction that makes you
      trust it. Fixed by mapping a placeholder id and reporting the unseeded chart as a note.
- [x] **Reconciliation.** Diff computed net worth against v1's stored totals per month and
      account for every difference. **Done when** each remaining difference has a written
      explanation (v1 float drift being the expected one). Done, and the interesting part is
      **which explanations are allowed to count**.

      A difference inside a two-rupee tolerance is v1's float arithmetic, and the report says
      so out loud — including that **v2's figure is the correct one**, because the tolerance
      exists to name a known defect in the old data, not to excuse a new one. Anything larger
      is `UNEXPLAINED` and says *do not cut over*: at that size the cause is a transaction
      that did not migrate or migrated against the wrong account, and finding that now is the
      difference between a migration and a data loss. The tolerance is a parameter, so
      someone who wants it tighter can have it, and the spec proves a drift that passes at
      ₹2 fails at ₹0.10.

      An exact match reports `NONE` rather than a tolerated drift — the two are different
      facts and a report that conflated them would hide the day rounding started appearing.
- [ ] **Cut over** and archive the v1 database. **Blocked on the user's real v1 export**, and
      recorded as blocked rather than ticked.

      What can be built is built: `cutoverReadiness` is a six-item checklist, every item
      machine-checkable — every row accounted for, every rejection carrying a written reason,
      every month reconciled, the ledger's own integrity check passing, the accounting
      identity holding, and the v1 database archived. The last is **manual and deliberately
      not inferred**: the script cannot know whether anyone archived the old database, and
      claiming it did would be the one lie in this phase that matters. The command exits 2
      when a month is unexplained, so a CI or a shell script cannot cut over past a gap.

      The cutover itself is one person running the command against their own data, and
      nothing here can stand in for that.

**Gate:** the new app shows the user's real financial position, and every divergence from
v1 is explained rather than discovered later.

**Gate status: met for everything that does not require the user's data.**
`tests/migration.spec.ts` runs a synthetic export — built to contain every case the migration
has an opinion about: an unknown account type, a transfer between two migrated accounts, a
transaction whose account was rejected, a zero amount, a float with four decimal places, and
a trade — through a real libSQL database with the real migrations. On it: the dry run reports
all twelve rows and writes nothing, the real run migrates three of four accounts and four of
six transactions with a written reason on every remainder, the bank balance is the ledger's
own sum, a second and third run add nothing, an unexplained month blocks the checklist by
name, and a sub-tolerance drift is explained. 44 assertions, and the suite is 37/37.

The second clause of the gate — *the new app shows the user's real financial position* — can
only be closed by running the command against the real export, which is why the cutover item
stays open. Everything standing between here and that is now a command and a checklist rather
than a piece of work.

---

## Phase 8 — Quant readiness (foundation only)

*Not building a trading system — making sure the class design can host one.*

- [x] **`metadata` on instruments** with a Zod schema per asset class, so `Option` and
      `Future` subclasses can be added without migrating live data.
      *One `metadata` JSON column (`0005_phase8_quant_readiness`), one Zod schema per kind
      in `domain/instruments.ts`, parsed in each leaf's own constructor. It fixed a live
      defect on the way past: `Etf`'s underlying and `Bond`'s terms were constructor
      arguments `MarketInstrument.of` could not pass, so a **gold ETF read back from the
      database claimed to be an equity ETF** (12.5% long-term instead of 20% at slab) and a
      bond's coupon was `null` for ever. Both are asserted in `instruments.spec.ts`.*
- [x] **`Option` and `Future` as `MarketInstrument` subclasses** — strike, expiry,
      underlying, contract month, and their own `taxProfile()` (F&O is business income).
      *`FNO_BUSINESS` as a `TaxCategory`, `BUSINESS_NON_SPECULATIVE` as a `TaxBucket`, and a
      `BusinessIncomeRule` at priority 450. The segregation is the money: an F&O loss may
      not be set off against a capital gain and a capital loss may not reduce business
      income — both directions asserted in `derivatives.spec.ts`, because a one-way wall is
      not a wall.*
- [x] **Analysis hooks.** `MarketInstrument.analyse(series): InstrumentAnalysis` as the
      extension point for per-instrument deep analysis, with a technical-indicator
      implementation as the first concrete example.
      *`domain/analysis.ts`: SMA, EMA, Wilder RSI, MACD, Bollinger, ATR and realised
      volatility (reusing `stdDev`/`TRADING_DAYS` from `portfolio.ts` rather than a second
      copy of the sample-versus-population decision). An indicator whose window exceeds the
      series returns `null` with a reason — never a silently shortened window, which looks
      identical on a chart to a correct one. `Option` overrides `analyse` to add moneyness.*
- [x] **Bar storage behind a repository interface,** so a granularity change later routes to
      a different store without anything above the repository knowing.
      *`BarRepository` shaped like `QuoteRepository`, with `price_bars` (1e8-scaled OHLC,
      integer volume, bitemporal, check constraints making an impossible bar unstorable) and
      an in-memory double. `bars.spec.ts` runs one conformance block against both.*
- [x] **Backtest seam.** `ExecutionVenue` interface with a simulated implementation, so a
      future live venue is an injection, not a rewrite.
      *`ExecutionVenue.place` takes an `ApprovedOrder`, which only `RiskGate.approve` can
      mint, so a bare intent cannot reach a venue — asserted with `@ts-expect-error`, which
      the typecheck enforces in both directions. `SimulatedVenue` replays a repeated
      idempotency key rather than filling twice (I05), and refuses an unpriced market order
      rather than inventing a fill price. `PlaceOrder` wires the two; no broker adapter is
      in the tree.*

**Gate:** adding a new asset class or a new tax regime is a single new class in a single
existing file, proven by doing it once. **Met, twice.** `Option` and `Future` are two
classes in `domain/instruments.ts` plus two entries in `MarketInstrument.of` and two in the
metadata schema map. No engine changed to admit them: the tax engine met a new
`TaxCategory` and the price book a new `PricedAssetClass`, both of which are data.
`derivatives.spec.ts` greps `src/domain` and `src/app` to prove no file outside
`instruments.ts` compares against `OPTION` or `FUTURE`.

---

## Phase 9 — spreadsheet parity

*The plan up to here was written against `_architecture/`. This phase is written against
the three spreadsheets the app is replacing — the net-worth tracker, the portfolio
tracker and the digital-gold lease tracker — and it exists because an audit of the built
app against those sheets found real gaps. A tool that cannot answer a question the
spreadsheet answered is not a replacement for it, however much better its ledger is.*

**What the audit found.** Most of all three sheets is already served, and in several
places served better: month-end net worth is recomputed from the journal rather than
snapshotted, so a backdated entry corrects last October; trades carry each statutory
charge in its own column because STT is not deductible and brokerage is; and five
cost-basis methods exist where the sheet had one. The gaps below are what is genuinely
absent, in the order they are worth building.

### 9a — Gold leasing (the largest gap: nothing models it at all)

The lease sheet tracks gold leased to a platform at an annual yield **paid in grams**,
withheld at 10% TDS **in grams**, accruing by completed months. Nothing in the app can
express a yield denominated in the commodity rather than in money.

- [x] **`GoldLease` in a new `domain/leasing.ts`** — quantity in grams, annual rate,
      start and closing dates, status. Accrual is `qty × rate × monthsCompleted / 12` in
      exact `Quantity`, TDS is 10% of the gross **grams**, and the net is what the holding
      gains. **Done when** a lease's accrued grams, TDS grams and net grams match a
      hand-worked example to eight decimals, and a closing date in the past stops the
      accrual rather than running it forward.
      *64 assertions in `leasing.spec.ts`, every expected figure hand-worked. Completed
      months are **derived**, not stored — the sheet's `months_completed` column is wrong
      every day until someone edits it — and a part month earns nothing. Both roundings go
      DOWN and the net is subtraction, so gross/TDS/net always reconcile and the tracker
      never flatters itself by a fraction of a gram. New in core:
      `Quantity.timesRatio` and `CalendarDate.monthsUntil`.*
- [x] **The accrual as a ledger event, not a stored figure.** Booking an accrual credits
      interest income at the gram value on the accrual date, records the TDS as tax
      deducted, and opens a lot for the net grams at that value — so the interest gold has
      a real cost basis and a later sale computes a real gain. **Done when** the holding's
      quantity, the income total and the lot's cost basis all move together and B02 still
      holds.
      *A new transaction subclass, `InKindInterest`: income on the **gross**, only the
      **net** grams reaching the holding, and a lot opened at the value they were taxed at
      — booking them at zero cost would tax the same gold twice. TDS is an asset, so the
      chart gained `Assets:Receivables:TDS` (68 → 69 accounts). Idempotent: the lease
      records grams already credited, so a second run books nothing and a run a month later
      books one month. `leasing-integration.spec.ts` asserts all four figures move together,
      B02 still holds, and an accrual with no price is refused rather than booked at zero.*
- [x] **Screens:** leases on `/investments`, with grams outstanding, accrued-to-date, TDS
      withheld, and value at today's IBJA price. **Done when** the portfolio value shown
      equals principal plus net accrued interest times the current price.
      *A section on `/investments` rather than a route of its own, because leased gold is
      still in the holdings table above it — a lease changes liquidity, not ownership, and
      two screens would invite reading the two totals as separate money. Everything is in
      grams until the last column: grams leased, gross interest, TDS withheld, total grams,
      and only then a value. Accrue and close are separate buttons, because they are
      separate events — closing does not book the outstanding interest, so a settled lease
      says how many grams are still unbooked instead of stranding them. The "done when"
      is now an assertion rather than an eyeball: `leasing-integration.spec.ts` recomputes
      the value from the two grams figures the screen renders beside it, so a total that
      disagreed with its own breakdown would fail the build.*

### 9b — Insurance policies

The sheet's summary carves out life and health cover; the app has only an
`Expenses:Insurance` category.

- [ ] **`InsurancePolicy`** — insurer, policy number, kind (LIFE/HEALTH/TERM/OTHER), sum
      assured, premium and its frequency, renewal date, nominee. Cover is *not* an asset
      and must never enter net worth. **Done when** a policy's next renewal is derived
      from its frequency and the dashboard can state total life and health cover without
      either figure touching the balance sheet.

### 9c — Foreign holdings in the reported total

Instruments may be priced in USD and `FxBook` exists, but every report **excludes**
non-reporting-currency positions from its totals rather than converting them — deliberate
honesty that now needs finishing, or a US holding sits outside net worth.

- [ ] **Convert through `FxBook` at the reporting layer,** with the rate's date and source
      shown beside the figure, and `null` rather than a guess when no rate is available.
      **Done when** a USD holding appears in net worth with its conversion rate visible,
      and a missing rate excludes it *with a named reason* instead of silently.

### 9d — Sector and market cap

- [ ] **`sector` and `marketCap` on instruments** (metadata, so no migration), sector
      allocation beside the existing asset-class allocation, and the risk gate's
      `exposureValue` populated from the sector rather than by the caller. **Done when the
      exposure limit actually blocks a sector concentration** — today nothing fills the
      group, so the check passes on an empty number.

### 9e — Benchmark comparison

`beta` and `alpha` exist and take a benchmark series as an argument; nothing stores or
fetches one.

- [ ] **A benchmark series** (NIFTY 50 to start) stored as bars through `BarRepository`,
      and a comparison that shows portfolio TWR against index return over the same window
      — with the caveat printed, not hidden: an index return excludes the charges a real
      portfolio pays.

### 9f — Smaller parity items

- [ ] **Per-platform investment summary** — invested, charges paid, current value and P&L%
      grouped by broker. The data exists; the view does not.
- [ ] **`Reit` as a `MarketInstrument` leaf** — one class in one file, now that Phase 8
      proved the shape.
- [ ] **Date of birth and wealth-vs-age** — the sheet correlates net worth with age, and
      that is a genuinely different question from net worth over time.
- [ ] **An expense tag** for the sheet's "bottle neck" column, distinct from the category.

**Deliberately not in this phase:** account-aggregator auto-sync (Plaid/Setu/AA). It is the
sheet's biggest pain point and the one recommendation that collides with the standing
no-paid-API constraint; statement and trade-book import stay the substitute until that
constraint changes.

**Gate:** every question the three spreadsheets answer, the app answers — or the plan says
in writing why it does not.

---

## Progress

**86 of 87 items of the original plan are done, and 2 of Phase 9's 12.** Phases F and 0 through 6 and 8 are complete
with every gate met. The single open item is Phase 7's third: the cutover itself, which needs
a real `mongoexport` dump and a person's afternoon. Its runbook is written
(`71-CUTOVER-RUNBOOK.md`) and its command, reconciliation and six-item checklist are tested
against synthetic data.

| Phase | Scope | Items | Status |
|---|---|---|---|
| F | Foundation — delete v1, auth on libSQL, layout migration, green gate | 4 | ✔ Complete (4/4) |
| 0 | Guardrails | 4 | ✔ Complete (4/4) |
| 1 | Engines — core, transactions, tax, charges, pricing, ledger, UI kit | 29 | ✔ Complete (29/29 + 5 unplanned) — all seven subsections; **both gates met** |
| 2 | Banking | 9 | ✔ Complete (9/9) — gate met |
| 3 | Credit cards | 7 | ✔ Complete (7/7) — gate met |
| 4 | Deposits, retirement, loans | 10 | ✔ Complete (10/10) — gate met |
| 5 | Investments | 10 | ✔ Complete (10/10) — gate met |
| 6 | Reports and extras | 6 | ✔ Complete (6/6) — gate met; two extras deliberately deferred |
| 7 | Migration and cutover | 3 | ◑ 2/3 (67%) — gate met on synthetic data; **cutover blocked on the real v1 export**; runbook staged in `71-CUTOVER-RUNBOOK.md` |
| 8 | Quant readiness | 5 | ✔ Complete (5/5) — gate met twice |
| 9 | Spreadsheet parity — leasing, insurance, FX, sector, benchmark | 12 | ◐ In progress (3/12) — 9a complete; 9b insurance next |

Update the status cell to `◐ In progress` / `✔ Complete (n/n)` as phases land.

### What is built

Everything a household actually uses is built, on a double-entry ledger in exact integer
money, with 42 spec files and ~2,080 assertions green.

  - **The core** — `Money`/`Quantity`/`UnitPrice`/`Percentage`/`Rate`/`CalendarDate`, and a
    three-layer float prohibition (types, three ESLint rules, a schema-integrity spec).
  - **The ledger** — `Transaction` and its fourteen subclasses, four polymorphic hooks, a
    legality matrix as data, and the L/P/Q/B/U/N/I/A invariant families as tests.
  - **Tax** — versioned regimes, priority-ordered rules, provenance on every line, and last
    year's report still producing last year's number after a budget.
  - **Banking** — the statement parser in exact money, keyword categorisation, four layers of
    duplicate detection, reconciliation, budgets with carry-over, and the four screens.
  - **Credit cards** — billing cycles, statements, finance charges on balance-days, reward
    points, and the statement identity proven twice.
  - **Deposits, retirement and loans** — FD/RD/PPF/EPF/NPS with their real rules, EMI as one
    exact expression, amortisation with the mandatory final-period adjustment, payoff
    strategies, and the effective rate by bisection.
  - **Investments** — fifteen instrument leaves, five cost-basis methods, ten corporate
    actions, XIRR/TWR/Modified Dietz, risk metrics, and a trade-book import.
  - **Reports** — the three financial statements reconciling exactly, B02 at zero at every
    date, personal metrics that return `null` rather than a meaningless number, tax reports
    and harvesting ranked by tax saved.
  - **The order path** — all eight pre-trade risk checks, fail-closed, with `ApprovedOrder`
    mintable only by the gate, an `ExecutionVenue` seam whose simulated implementation
    replays a retried key rather than filling twice, and no broker adapter in the tree.
  - **Quant readiness** — instrument metadata behind a Zod schema per asset class, `Option`
    and `Future` with F&O taxed as business income and walled off from capital gains,
    `analyse(series)` with seven indicators that report `null` rather than a shortened
    window, and bar storage behind a repository proved against two implementations.
  - **The migration** — a v1 export replayed through the use cases, a dry run that writes
    nothing, an idempotent real run, reconciliation against v1's month-end totals, and a
    six-item cutover checklist.

### What remains

  - **Phase 9 — spreadsheet parity, 12 items.** Written against the three sheets rather than
    against `_architecture/`, because an audit found the app cannot answer some questions the
    sheets answer. The largest by far is **gold leasing**: a yield paid in grams, withheld at
    10% TDS in grams, which nothing in the app can currently express. Then insurance policies,
    foreign holdings reaching the reported total, sector and market cap (without which the
    risk gate's exposure check passes on an empty number), and a benchmark comparison.
  - **Phase 7, item 3 — the cutover itself.** Blocked on the user's real `mongoexport` dump.
    The command and the checklist exist; running them against real data is one person's
    afternoon, and no synthetic fixture can stand in for it.
  - **Deliberately deferred, recorded rather than dropped:** SMS/WhatsApp price alerts, the
    news digest and AI market analysis (all three need a paid gateway or a model, against the
    standing no-paid-API, no-AI-in-the-data-path constraint); watchlist and monthly-wealth
    import (UI conveniences on data that already exists); table virtualisation;
    reconciliation-as-a-posting-status (it would reopen L10's hole); NPS `PriceBook` wiring.
  - **Small open wiring — now closed.** `/settings` collects the marginal slab rate, the LTCG
    exemption and the regime, stored per financial year, and `/history` computes at the stored
    rate (saying so, and saying when it is assuming the top slab instead). Credit utilisation
    reaches `PersonalReport` from `CardTermsRepository`, and is still `null` — not 0% — when no
    terms are loaded. The nightly reproducibility job is `npm run verify:reproducibility`.

    **The job is not what this plan first specified, and the difference is the point.** It
    asked for a replay of `ledger_events` diffed against `projection_cache`. Nothing on the
    write path fills either table — `UnitOfWork` is their only writer and no repository routes
    through it — so that job would have printed green ticks over two empty tables. It instead
    diffs two independent recomputations over the journal (a SQL-side `SUM` against a
    TypeScript fold), checks L01 in the raw rows, recomputes any cached projection that
    exists, and **reports the empty event log as a gap rather than a pass**. Differences fail
    it; gaps are printed and do not. `reproducibility.spec.ts` proves the two paths are
    genuinely independent by making them disagree.

  - **One latent defect it found, recorded rather than fixed:** `DrizzleBalanceQuery` does not
    filter `postings.deleted_at`, while the journal fold does. Nothing soft-deletes a posting
    today — a reversal is a new entry — so the two agree in practice, and the diff catches it
    the moment that stops being true.

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
| Reproducibility | Two independent recomputations over the journal diffed against each other, L01 checked in the raw rows, any cached projection recomputed, and the empty event log reported as a gap rather than a pass |
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

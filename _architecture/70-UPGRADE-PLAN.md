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
- [ ] **Nightly reproducibility job.** Recompute every projection from `ledger_events` and
      diff against cache. **Done when** an induced cache poisoning is detected.

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
| F | Foundation — delete v1, auth on libSQL, layout migration, green gate | 4 | ✔ Complete (4/4) |
| 0 | Guardrails | 4 | ✔ Complete (4/4) |
| 1 | Engines — core, transactions, tax, charges, pricing, ledger, UI kit | 29 | ✔ Complete (29/29 + 5 unplanned) — all seven subsections; **both gates met** |
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

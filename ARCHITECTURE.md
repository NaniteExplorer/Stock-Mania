# Architecture — v2

A **single-user personal finance manager** for the Indian market. All data is
entered manually (or imported from files you already have). Every dependency is
free. No AI, no brokers, no message queues, no schedulers.

This document is the contract. If code disagrees with it, the code is wrong.

---

## 1. What changed from v1, and why

v1 was a 20.6k-line, 26-module app with Kafka, Zookeeper, Redis, Inngest,
Kubernetes (HPA + ingress), Twilio and Gemini wired into a tracker used by one
person. Eleven pages were reachable; ten domains (`signals`, `watchlist`,
`stocks`, `orders`, `news`, `alerts`, `esops`, `gold-lease`, `analysis`,
`portfolio`) had no route and no caller.

Three defects mattered more than the bloat:

| v1 defect | v2 fix |
| --- | --- |
| Money as JS floats (`amount: Number`) | `Money` value object over `bigint` **paise**. No float touches money, ever. |
| Balances *stored* on accounts, transactions in an unrelated collection — the two can silently drift | **Double-entry ledger.** Balances are derived by summing postings. Drift is not representable. |
| `export const xService = { ... }` object literals, a `Repository<T>` interface nobody implemented, 5 files per domain with a pass-through repository layer | Classes with invariants, real ports/adapters, use-case objects. Layers exist only where they carry weight. |

Also removed: the net-worth figure's silent stubs — v1 hardcoded `dayChange: 0`,
`esops: 0` and `brokerage: 0` into the number shown on the dashboard.

---

## 2. Stack

| Concern | Choice | Why this one |
| --- | --- | --- |
| Framework | Next.js 16 App Router, React 19 | Already in use; server components keep the DB server-side with no API tier to maintain. |
| Database | **libSQL / Turso** via **Drizzle ORM** | The only genuinely free *hosted* SQL option available to us (Neon and Supabase free tiers are not). A real free tier, not a trial. Speaks HTTP, so it works from any serverless host. Identical schema code locally (a file) and in production (Turso URL + token). |
| Money storage | `INTEGER` minor units (paise) | SQLite has no `NUMERIC`. Integer minor units are the correct representation for money on any engine — the float column was the bug, so this is not a compromise. |
| Auth | better-auth (Drizzle adapter) | Free, self-hosted, already integrated. |
| Validation | Zod 4 | Parses at the process boundary only (see §6). |
| Styling | Tailwind v4 + the `globals.css` token system | Kept from v1 — it is the one part that was well built. |

**Deliberately absent:** Kafka, Zookeeper, Redis, Inngest, Kubernetes, Twilio,
Gemini, Alpaca, Zerodha, TradingView. A single user editing their own finances
needs none of it, and each was an unbounded failure mode.

### Why not Postgres

Postgres is the better engine for a ledger (native `NUMERIC`, richer
constraints). It is not available *free and hosted* under our constraints. The
schema targets a portable Drizzle subset, so moving to Postgres later is a
dialect swap plus a column-type change — the domain layer is untouched, because
it never sees a driver.

---

## 3. Folder structure

> **Amended.** This section previously described a four-layer tree under
> `src/modules/<context>/{domain,application,infrastructure,presentation}` and put
> the Next routes at `src/app/`. `_architecture/70-UPGRADE-PLAN.md` — the plan of
> record, written later — chose a consolidated layout instead: **one file per
> concept, not per class**, landing at ~30 files while adding far more capability.
> That decision wins, and this section now describes it. The layering did not go
> away; it moved from directory nesting to a dependency direction between files.

```
src/
  core/
    kernel.ts        Entity, AggregateRoot, ValueObject, UniqueId, Result, UseCase, AppError, Clock
    money.ts         Money, Currency, RoundingMode, ROUNDING, divideRounded, allocate
    numeric.ts       Quantity, Percentage, Rate
    time.ts          CalendarDate, DateRange, FinancialYear, MarketCalendar
    config.ts        validated, server-only environment configuration
  domain/
    accounts.ts      AccountType, AccountSubtype, AccountCode, Account, ChartOfAccounts
    transactions.ts  Posting, Transaction (abstract) + 13 subclasses, TransactionContext
    assets.ts        Asset (abstract) -> MarketInstrument / DepositProduct / CashProduct /
                     CreditProduct / PhysicalAsset hierarchies
    lots.ts          Lot, LotBook, LotSelectionStrategy (FIFO/LIFO/HIFO/Average/SpecificId)
    charges.ts       BrokerChargeModel (abstract) + Zerodha/Groww/Generic, ChargeBreakdown
    tax.ts           TaxEngine, TaxRegime, TaxRule (abstract) + ~14 rules, TaxAssessment
    pricing.ts       Quote, PriceBook, PriceResolution, FxBook, Valuation
    corporate.ts     CorporateAction (abstract) + Split/Bonus/Merger/Spinoff/Dividend/...
    portfolio.ts     Portfolio, Position, ReturnSeries, Xirr, Twr, RiskMetrics
    reports.ts       NetWorth, BalanceSheet, IncomeStatement, CashFlow, Allocation
  app/
    ledger.usecases.ts     open account, record transaction, reverse, seed chart
    banking.usecases.ts    statements, import, categorise, budgets, reconcile
    investing.usecases.ts  trades, lots, corporate actions, valuation, returns
    tax.usecases.ts        assess FY, harvest, export
  infra/
    auth/            better-auth instance, session, actions, mail
    db/schema.ts     all tables, grouped by section
    db/client.ts     libSQL connection + migration runner
    repositories.ts  every Drizzle repository, one class each
    providers.ts     PriceProvider (abstract) + concrete keyless providers + registry
  ui/
    tokens.css       the one global stylesheet (design system)
    primitives.tsx   Card, Stat, DataTable, MoneyText, Pill, Delta, Sheet, Field
    charts.tsx       Chart wrapper + Line/Bar/Donut/Candle/Drawdown
    format.ts        money and percentage formatting — takes Money, never number
```

`app/` (Next routes) and `components/` stay at the repository root.

**A trap worth naming.** Next ignores `src/app/` **only while a root `app/` exists**
(`next/dist/docs/01-app/03-api-reference/03-file-conventions/src-folder.md`). So
`src/app/*.usecases.ts` is safe today, but adding `src/app/page.tsx` would create
dead code that looks alive, and deleting the root `app/` would silently promote
`src/app/` to the router. `tests/layout.spec.ts` asserts both directions.

### Inside a concept file

The dependency arrows that the old per-module tree enforced by nesting are now
enforced between files, and the ordering *within* a file follows the same
direction — value objects, then entities, then services, then ports:

```
core/  <-  domain/  <-  app/  <-  infra/
                                 <-  ui/   (types only)
```

**Rules, enforced by ESLint `no-restricted-imports`:**

1. `domain/` imports only `core/` and other `domain/` files. No Drizzle, no Next,
   no Zod. Plain TypeScript, unit-testable with zero I/O.
2. `app/` imports `domain/` and `core/`. Never `infra/`.
3. `infra/` implements the ports declared in `domain/`. It is the only layer that
   knows `db/`.
4. `ui/` imports `core/` types for rendering (`Money`, `Percentage`) and nothing
   else from the domain.
5. Route handlers and server actions in `app/` (the Next one) import
   `src/app/*.usecases.ts`. Never a repository directly.

**Where the ports live.** A repository interface belongs in the `domain/` file that
owns its aggregate — `AccountRepository` in `domain/accounts.ts`,
`JournalRepository` in `domain/transactions.ts`. Putting them in
`infra/repositories.ts` would invert rule 1. The plan of record does not say this;
it is the one place its file list was under-specified.

Why this beats v1's five-files-per-domain: v1 mandated a repository file for every
domain even where it only forwarded to Mongoose, and let services import each
other's internals (`networth.service` reached into four sibling services and
hardcoded zeros for the rest). Why it also beats the per-class tree this section
used to describe: 52 files of one class each, for a domain whose classes are only
meaningful in clusters, made the shape of the domain harder to see, not easier.

### Composition root

`core/kernel.ts` carries the `UseCase` contract; the wiring itself is typed factory
functions, not a reflection framework:

```ts
const ledger = container.ledger()
await ledger.recordTransaction.execute(dto)
```

Server actions resolve from the container; nothing else constructs a repository.
Swapping libSQL for Postgres, or a repository for an in-memory fake in tests, is
one line there.

## 4. The accounting core

Everything financial in the app is a projection of one immutable table of
postings.

### Chart of accounts

Five account types, each with a **normal balance**. This one rule is what makes
signs unambiguous across the entire app:

| Type | Normal balance | Increases with | Examples |
| --- | --- | --- | --- |
| `ASSET` | Debit | Debit | HDFC Savings, Zerodha Holdings, Gold, Home |
| `LIABILITY` | Credit | Credit | ICICI Credit Card, Home Loan |
| `EQUITY` | Credit | Credit | Opening Balances, Retained Earnings |
| `INCOME` | Credit | Credit | Salary, Interest, Dividends |
| `EXPENSE` | Debit | Debit | Groceries, Rent, Brokerage & Charges |

Accounts form a tree via `parentId` (`Assets:Bank:HDFC`), so reports roll up at
any depth.

### Journal entries

A `JournalEntry` is an aggregate root holding ≥2 `Posting`s. Its invariant is
checked in the constructor, so an unbalanced entry **cannot be instantiated**:

```
2026-08-05  "Big Bazaar — groceries"
  DEBIT   Expenses:Food:Groceries      1,240.00
  CREDIT  Assets:Bank:HDFC             1,240.00
                       Σ debits − Σ credits = 0   ✔
```

Postings are append-only. Corrections are *reversing entries*, never updates — so
history is auditable and a report run twice gives the same answer.

This removes v1's whole bug class:

- A **transfer** (HDFC → credit-card payment) is one entry touching two of your
  own accounts. It nets to zero across net worth automatically, instead of being
  double-counted or special-cased.
- **Net worth** = `Σ ASSET − Σ LIABILITY`, summed from postings. There is no
  second copy of a balance available to disagree with it.
- **Income and expense** for a period are that same sum restricted by date, so
  the dashboard and the reports page cannot print different numbers.

### Derived, never stored

`BalanceProjector` computes balances with one windowed query:

```sql
SUM(amount_minor) OVER (PARTITION BY account_id ORDER BY posted_at, seq)
```

Stored balances were the drift. Monthly snapshots exist only as a *cache*,
rebuildable from the journal at any time.

---

## 5. Investments — invested capital, charges, and true return

Requirement: charges and taxes must come out of the amount actually committed,
and unrealized return must be a real XIRR.

### Trades carry a full Indian charge breakdown

Every `Trade` (BUY/SELL) records quantity, price, and each statutory component
separately rather than one lumped "fees" number:

`brokerage`, `stt`, `exchangeTxnCharge`, `sebiTurnoverFee`, `stampDuty`, `gst`,
`dpCharges`

Recording a trade writes a journal entry, so the portfolio and the ledger are
the same truth:

```
BUY 10 INFY @ 1,500.00, charges 23.60
  DEBIT   Assets:Investments:Zerodha:INFY   15,000.00
  DEBIT   Expenses:Investing:Charges            23.60
  CREDIT  Assets:Bank:HDFC                  15,023.60
```

### Definitions used everywhere (one source, no drift)

- **Invested (total amount given)** = `Σ (qty × price) + buy charges` over open
  lots. Buy charges are capitalized into cost basis — they are money you gave up,
  so they belong in the denominator of your return.
- **Market value** = `open units × latest price`.
- **Unrealized return** = `market value − invested`.
- **Realized P&L** = FIFO-matched proceeds `− (matched cost basis + buy charges
  on matched lots + sell charges)`.
- **Tax** comes from the tax engine (§7) and is deducted to give **post-tax
  realized P&L**. Open positions carry an *estimated* liability, shown separately
  and never mixed into realized figures.

### XIRR

Computed over **actual dated cash flows**, not a simplified CAGR:

- every BUY → outflow of `(qty × price + buy charges)`
- every SELL → inflow of `proceeds − sell charges − tax`
- dividends / interest → inflow on receipt
- current market value → terminal inflow dated today

Solved by Newton–Raphson with a bisection fallback over `[-0.9999, 10]`, so it
converges on the flow sets where Newton alone diverges. Available per holding,
per instrument kind, and portfolio-wide.

### FIFO lots

`Lot` is a domain entity with remaining units; `FifoMatcher` is a pure domain
service. Selling consumes lots oldest-first and records each match, so the
holding period — and therefore short- vs long-term tax treatment — is exact.

---

## 6. Cross-cutting decisions

**Value objects, not primitives.** `Money`, `CalendarDate`, `AccountCode`,
`Quantity`, `Percentage`. Each validates on construction and is immutable, so an
invalid value has no path to the database.

```ts
Money.fromRupees('1240.50')      // 124050n paise
a.plus(b)                        // throws on currency mismatch
m.allocate([1, 1, 1])            // splits 100 paise losing no paisa
```

**`Result<T, E>` for expected failures, exceptions for bugs.** A duplicate import
row or an unbalanced entry is a `Result` the UI renders. A null repository
response where the type promised otherwise throws.

**Validation at the boundary only.** Zod parses `FormData` in server actions and
external JSON in gateways. Inside the domain, types are already proven — no
re-parsing.

**Time is injected.** A `Clock` port, never a bare `new Date()`, so
financial-year boundaries and XIRR terminal dates are testable.

**Auth on every server function.** Server actions are public POST endpoints. Each
resolves the session and scopes every query by `userId`; `proxy.ts` stays an
optimistic redirect, not a security boundary.

**Next.js 16 specifics.** `params`/`searchParams` are awaited; mutations use
`updateTag` for read-your-writes and pass `revalidateTag`'s now-required second
argument; `proxy.ts`, not `middleware.ts`.

---

## 7. Tax engine

Ported from v1 — the one genuinely valuable non-trivial piece — into a rules
pipeline: a `TaxRegime` (India FY 2025-26) holds versioned slab and
capital-gains `Rule` objects; the engine applies them to realized events and
returns a per-rule audit trail rather than one opaque number. Regimes are keyed
by financial year, so past years keep computing under the law that applied then.

## 8. Analytics

`analytics/` is read-only and owns no tables. It projects from the ledger and
investment modules:

- net worth over time (monthly, rebuilt from postings)
- asset allocation and liability composition
- income vs expense per month, and savings rate
- category spend: month-over-month and year-over-year
- per-holding invested vs market value vs XIRR
- realized vs unrealized, pre- and post-tax

## 9. Pricing

Manual price entry is always authoritative and always available. On-demand
refresh uses keyless public sources (AMFI's published NAV file for mutual funds,
NSE public quotes for equities, a public metals feed for digital gold) behind one
`QuoteGateway` port with per-source adapters. No API keys, no scheduler, no
background jobs — you press refresh. A failed source degrades to the last known
price with its timestamp shown, never to a silent zero.

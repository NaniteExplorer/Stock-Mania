# UI Redesign v2 — Internal Research (Stock-Mania)

Status: PLANNING
Owner: Research Agent (internal audit lane)
Updated: 2026-10-19

## Requirement
Produce a factual inventory of every route, the shipped design system, domain/calculation essentials, and realistic sample data, so a design agent can mock up a professional redesign of the whole app without reading the codebase.

Execution path chosen by the user: **Research then experiment** (mockups only; no production code). Mode: **Research** (this document) feeding **Experiment** (interactive HTML mockups).

## Acceptance criteria
- [x] Every route inventoried with purpose, real data fields, current UI, and gaps
- [x] Design system, tokens, fonts, icons, chart library recorded
- [x] Domain model, precision rules, and implemented-vs-specified analytics recorded
- [x] Realistic Indian-market sample rows using shipped field names
- [x] Existing terminology captured so mockups stay consistent

---

## 1. Design system in use

- **Tailwind v4** (`tailwindcss ^4`, `@tailwindcss/postcss`). **No `tailwind.config.*`** — theming is CSS-first in `src/ui/tokens.css`, imported by `app/globals.css` (3 lines: `@import "tailwindcss"; @import "tw-animate-css"; @import "../src/ui/tokens.css";`).
- **shadcn/ui**: `components.json` style `radix-vega`, baseColor `neutral`, cssVariables true, iconLibrary `lucide`. Present in `components/ui/`: **avatar, button, command, dialog, dropdown-menu, input, label, popover, select, sonner** — nothing else. No table, tabs, card, badge, tooltip, sheet, skeleton, accordion, chart.
- **Hand-rolled primitive kit** is the real system: `src/ui/primitives.tsx` (`MoneyText, Card, Delta, Pill, Stat, TableFrame, EmptyState, PageHeader, Field, ColumnSpec`), `src/ui/data-table.tsx` (`DataTable`, `Column<T>`), `src/ui/filter-bar.tsx` (`FilterBar`, `FilterSpec`), `src/ui/charts.tsx`, `src/ui/action-form.tsx`.
- **Dark mode: dark-only.** `app/layout.tsx:31` hardcodes `<html lang="en" className="dark">`. No theme toggle exists.
- **Theme tokens** (`src/ui/tokens.css`, CRED-inspired, `--radius: 1rem`):
  - Neutral ramp: `--gray-950 #04050a`, `--gray-900 #07080d` (page bg), `--gray-800 #0e0f16` (cards), `--gray-700 #161822` (raised/hover), `--gray-600 #20222f` (hairline borders), `--gray-500 #8b90a3` (muted text), `--gray-400 #c6cad6` (body), `--gray-300 #dadde6`, `--gray-100 #f6f7fb` (headings).
  - Brand violet: `--brand-300 #b3a8ff`, `-400 #9d90ff`, `-500 #7c6cff` (= `--primary`), `-600 #6a58f5`, `-950 #1e1b4b`. Sidebar bg `#0a0b12`.
  - Semantic: `--pos #34d399` (all `green-*` remap), `--neg #fb6f86` (all `red-*`), `--info #6ea8ff` (`blue-*`), `--accent2 #a78bff` (`purple-*`), `--teal #2dd4bf`, `--yellow-500 #f0b34d` (literal gold assets only).
  - Type scale: `--text-micro .6875rem`, `--text-tiny .625rem`, `--text-display 1.75rem`, `--text-hero 2.6rem`. Tracking: `--tracking-label .14em`, `-kicker .18em`, `-eyebrow .22em`, `-snug -.025em`. Layout: `--width-content: 1440px`, `--width-prose: 68ch`.
  - Utility classes in use: `.panel`, `.panel-hover`, `.metric-label`, `.section-kicker`, `.section-title`, `.eyebrow`, `.icon-chip`, `.side-link`/`.side-link-active`/`.side-group-label`, `.header`, `.table-scroll`, `.primary-btn`, `.ghost-btn`, `.tnum` (tabular numerals, on every money figure), `.aurora-bg`, `.grid-overlay`, `.gradient-text`, `.scrollbar-hide`.
- **Fonts**: `Geist` + `Geist_Mono` via `next/font/google` → `--font-sans` / `--font-mono`.
- **Icons**: `lucide-react ^1.11.0`.
- **Charts**: `recharts ^3.10.1`, wrapped by `src/ui/charts.tsx` (`Chart`, `LineSeries`, `BarSeries`, `DonutSeries`, `foldSeries`). Fixed-order 5-hue accessibility-validated palette: `--chart-1 #8b7cff` violet, `--chart-2 #25a37b` green, `--chart-3 #c08529` amber, `--chart-4 #5b93e0` blue, `--chart-5 #d15f92` rose. `SCATTER_SAFE_SERIES = 3`; a 6th series folds into "Other". Rule: *text never wears the series colour*; grid `var(--border)`, axis text `var(--gray-500)`.
- Other deps: `radix-ui ^1.4.3`, `cmdk` (installed for a future transaction command palette, unwired), `sonner`, `react-hook-form`, `zod ^4`, `class-variance-authority`, `tailwind-merge`, `tw-animate-css`, `drizzle-orm` + `@libsql/client` (SQLite/libSQL), `better-auth`, `exceljs`, `unpdf`.

## 2. Shared layout and navigation

`app/(root)/layout.tsx` (41 lines): `await connection()` → `getCurrentSession()` → `AuthUnavailableError` renders `<ServiceUnavailable/>`; no session → `redirect("/sign-in")`. Shell: `<div class="flex min-h-screen text-gray-400">` → **`<Sidebar/>`** (sticky, `w-[272px]`, `hidden lg:flex`, `bg-sidebar/95 backdrop-blur-xl`, right hairline) + column with **`<Header/>`** (sticky) and `<main class="flex-1 px-4 pb-24 pt-6 md:px-6 lg:px-8">` wrapping `max-w-[1440px]` + **`<MobileNav/>`** (bottom bar).

**Sidebar** (`components/Sidebar.tsx`): `BrandMark` with subtitle "Wealth OS"; optional net-worth summary card (label "Net worth", big `tnum` figure, up/down arrow + change in green/red); grouped nav from `src/ui/nav.ts`; footer card "**Manual mode** — Your entries change only when you edit them or request a price refresh."

`NAV_GROUPS`:
- **Overview**: Net Worth `/dashboard` (LayoutDashboard), History `/history` (CalendarClock)
- **Wealth**: Accounts `/accounts` (Landmark), Transactions `/transactions` (History), Budgets `/budgets` (PiggyBank), Import `/imports` (Upload), Investments `/investments` (LineChart), Platforms `/platforms` (Building2), Realised gains `/investments/history` (TrendingUp), Assets `/assets` (Gem), Deposits `/deposits` (PiggyBank), Cards `/cards` (CreditCard), Loans `/loans` (Landmark), Liabilities `/liabilities` (Wallet)
- **Account**: Settings `/settings` (Settings)

`MOBILE_NAV_ITEMS`: Net Worth, Accounts, Invest, Monthly (`/history`), Settings.

**Header** (`components/Header.tsx`): mobile-only brand, spacer, violet "Quick add" button (→ `/accounts`), `UserDropdown`. Deliberately no search, notifications, or live-status pill (removed in v2).

**Investments sub-nav** (`investments/investment-nav.tsx`): Overview · Holdings · Performance · Analysis · Market tracker · Compare · Activity · Live data · Add.
**Holding detail tabs** (`[instrumentId]/holding-nav.tsx`): Summary · Performance · Lots & tax · Activity · Income & leases · Settings.
**Add-investment lanes** (`new/entry-lane-nav.tsx`): "Stocks, ETFs & funds" · "Digital gold & metals" · "Manual / unlisted".

**Gap:** Wealth group is a flat 12-item list with duplicate icons (PiggyBank ×2, Landmark ×2) and mixes top-level sections with a deep link (`/investments/history`). No breadcrumbs, no global search/command palette, no shared tabs component, no notification/alert surface.

## 3. Domain model and calculation essentials

### Entities (shipped Drizzle/SQLite schema, `src/infra/db/schema.ts`, 2411 lines, 47 tables)
`user`, `session`, `account`(auth), `verification`, **`ledger_accounts`** (:352), **`transactions`** (:425), **`postings`** (:486), **`instruments`** (:646), `instrument_catalog` (:717), `instrument_catalog_listings`, `instrument_provider_mappings`, `instrument_catalog_fetches`, `instrument_catalog_links`, **`trades`** (:872), **`lots`** (:928), **`lot_matches`** (:969), `price_quotes` (:1011), `gold_leases` (:1109), `price_bars` (:1209), `instrument_incomes` (:1252), `category_rules`, `budgets` (:1358), `credit_card_terms` (:1410), `tax_settings` (:1480), `deposit_terms` (:1532), `deposit_contributions`, `scheme_rates`, `nps_holdings`, `loan_terms` (:1693), `loan_prepayments`, `import_batches` (:1771), `import_rows`, `net_worth_snapshots`, `audit_events`, `ledger_events`, `institutions` (:1920), `counterparties`, `fx_rates`, `corporate_actions`, `documents`, `projection_cache`, `provider_fetch_log`, `price_divergences`, `txn_type_legality`, `tax_rules`, `cost_inflation_index`, `charge_rates`, `market_holidays`.

> `_architecture/20-DOMAIN-MODEL.md` describes a **PostgreSQL multi-tenant target** (tenants, memberships, RLS, 16 account types, 23 asset classes, 18 transaction types). The **shipped** schema is single-user SQLite with narrower enums. Mockups use the shipped names.

**Shipped enums**: `ACCOUNT_TYPES = ASSET | LIABILITY | EQUITY | INCOME | EXPENSE` (:166). `ACCOUNT_SUBTYPES = BANK, SAVINGS, CASH, WALLET, DEPOSIT, CREDIT_CARD, LOAN, MORTGAGE, BROKERAGE, RETIREMENT, REAL_ESTATE, VEHICLE, …` (:174). `INSTRUMENT_KINDS = EQUITY, ETF, MUTUAL_FUND, BOND, GOVT_SECURITY, DIGITAL_GOLD, DIGITAL_SILVER, DIGITAL_METAL, REIT, CRYPTO, DERIVATIVE, …` (:583). `TAX_ASSET_CLASSES = LISTED_EQUITY, EQUITY_MUTUAL_FUND, DEBT, GOLD, CRYPTO, UNLISTED, FNO_BUSINESS` (:607). `QUOTE_SOURCES = MANUAL | AMFI | NSE | METALS` (:623). `INSTRUMENT_CLASSES` = 17 leaves. Posting `direction = DEBIT | CREDIT`; posting `status = PENDING|CLEARED|RECONCILED|VOID`; lot_match `taxTier = STCG|LTCG|SLAB|EXEMPT`.

**Invariants surfaced in UI**: `B02` accounting identity (assets − liabilities = equity + income − expenses) displayed on the dashboard; `B03` net-worth month-to-month continuity; `L03/L04/L12` posting checks; transactions are append-only, corrected by REVERSAL, never edited.

### Money / quantity precision (`30-CALCULATIONS.md` §1, `src/core/money.ts`, `src/core/numeric.ts`)
- **Money** = `BIGINT` minor units + ISO currency (`Money { minor: bigint, currency }`), rounded only at explicit points. **Quantity** = `NUMERIC(38,18)`, never rounded, truncated only at `instruments.quantity_scale` on input. **Rate/ratio** = `Decimal`, never rounded in intermediates.
- **Floats are mechanically prohibited** (custom eslint rules in `eslint-rules/`). Formatting starts from an exact decimal string.
- Penny allocation uses the **largest-remainder method**.
- Formatting (`src/ui/format.ts`): `formatMoney` → `₹15,023.60` (en-IN lakh/crore grouping); `formatMoneyCompact` → `₹2.48Cr` with **Cr / L / K**, truncated toward zero, never rounded up; `formatMoneySignedCompact` → `+₹3.42L` / `-₹1.2K`; `formatPercentSigned` → `+12.50%`; `formatPercent` → `12.50%`. Every money cell carries `.tnum`.

### Analytics — implemented vs specified
- **Implemented in `src/`**: `XIRR` (typed `XIRR_UNDEFINED` instead of silent 0, bracket to +1000%, relative 1e-9 NPV tolerance) surfaced as `workspace.metrics.xirr`; absolute return; realised/unrealised P&L; FIFO/LIFO/HIFO/AVERAGE/SPECIFIC_ID cost basis; Indian charge stack (brokerage, STT, exchange txn, SEBI turnover, stamp duty, GST, DP); STCG/LTCG tiering with financial-year stamping; EMI/amortisation + avalanche vs snowball payoff; envelope-budget carry-over; deposit (FD/RD/PPF/EPF/NPS) terms-based valuation; credit-card cycle/min-due/utilisation. `src/domain/analysis.ts`: sma, ema, rsi, macd, bollinger, atr, realisedVolatility, analyseSeries, weekdayGaps, **period return**, **maximum drawdown**.
- **Specified but NOT computed**: **TWR** always returns `unavailable("TWR_BOUNDARY_VALUATIONS_UNAVAILABLE")` (`investing.usecases.ts:1181`); **income** and **total investment gain** always `unavailable` (:1173–1174). CAGR, day change, yield on cost, dividend yield, Sharpe, Sortino, beta, Jensen's alpha, VaR, allocation drift, rebalancing — documented in §4.3, not implemented. §"Metrics deliberately not built" rules out Sharpe/Sortino/alpha on single non-diversified retail assets, plus candlesticks.
- Personal-finance metrics §4.4: net worth, liquid net worth, savings rate, burn rate, **runway** (on dashboard), DTI, credit utilisation.
- **Design implication**: mockups must show an explicit "unavailable, and why" state. House rule: *an em-dash is an admission, a zero is a claim*.

## 4. Per-route inventory

### `app/(marketing)/page.tsx` (343 ln, public landing)
Hero `h1` + eyebrow; three stat chips (NASDAQ + NSE/BSE · Real-time quotes & charts · AI signal engine); "Market overview" with TradingView widgets (US heatmap S&P 500, India heatmap SENSEX, Market quotes — `src/ui/tradingview.ts`); "A complete wealth workspace" feature grid; CTA. Uses `.aurora-bg`, `.gradient-text`.
**Gap**: copy promises real-time quotes and AI signals the app (explicitly "Manual mode") does not provide — credibility mismatch to resolve.

### `app/(auth)/*`
Split-screen shell: left = brand mark, back-to-home, form (`max-w-md`); right (lg+) = `HeroVisual` 3D showcase, eyebrow "Broker-ready architecture", headline "Your whole **net worth**, in one place", 2×2 grid (Net worth / Accounts / Watchlists / AI signals).
`sign-in` (98 ln) Email+Password. `sign-up` (125 ln) Full Name, Email, Password, Country (`src/ui/countries.ts`). `forgot-password` (107 ln) Email. `reset-password` (shell → `reset-form.tsx` 107 ln) new+confirm password, token from query.
**Gaps**: no social/passkey, no password-strength meter, no 2FA, no inline validation summary; right panel advertises Watchlists and AI signals that don't exist.

### `/dashboard` — "Net worth"
Data: `reports.statements.execute({userId, asOf, period: last 12 months})` → `balanceSheet.netWorth / assets.total / assets.rows / liabilities.total`, `allocation[] {label, value, weight}`, `incomeStatement.income.total / expenses.total / net / savingsRate`, `identityHolds`, `identityDifference`; `reports.netWorthSeries.execute({months:12})` → `series[].netWorth`, `continuityHolds`; `reports.personal.execute()` → `liquidNetWorth`, `runwayMonths`; `repositories.imports.pendingRowCounts()` (page.tsx:35–47).
UI: `PageHeader` + `Pill "Live"`; amber Card for part-reviewed imports; 4 `Stat` tiles (Net worth + delta, Assets, Liabilities, Liquid + runway); 2-col grid "Where it is" (allocation as **CSS progress bars**) + "This year" (Income/Expenses/Saved/Savings rate/Peak net worth); "The books" card with `B02 holds`/`B02 fails` pill; 5 quick-link tiles.
**Gaps**: **no chart at all** (the 12-month series is fetched but used only for a delta and a peak); no time-range selector; no day change; no top movers; no upcoming bills/maturities; no goals; allocation bars have no colour coding or legend.

### `/accounts`
Data: `banking.listCashPositions.execute({asOf, includeClosed:true})` → `positions[].asset {id, displayName, kind, currency, account{code, institution, accountNumberSuffix, isClosed, isSystem, sortOrder}}`, `position.balance`, `anomalies[]`; `repositories.balances.monthlyFlows()` → `{month, income, expense}`; `countPostings()`; pending import rows (page.tsx:47–51).
UI: PageHeader + "Export CSV"; 4 Stats (Total balance, Accounts, Money in, Money out — this month); amber cards for pending imports and "Worth a look" anomalies; **`FilterBar`**: search ("Search name, bank or code"), Status (Open and closed / Open only / Closed only), Kind (Bank/Wallet/Cash), Sort (Your order / Largest balance / Name A–Z / Most active); `AccountsTable` **Account · Kind · Currency · Status · Balance · Actions**; "Open an account" form.
**Gaps**: no bank logos, no per-account sparkline, no grouping by institution, no multi-select/bulk actions, no balance-over-time column; filters are full-page-reload `<form method=get>`.

### `/accounts/[accountId]` (461 ln)
Data: account record (name, code, subtype, institution, accountNumberSuffix, isClosed, sortOrder), computed `balance` at `asOf`, posting count, monthly flows, posting list.
UI: PageHeader + open/closed Pill; 4 Stats (Balance "As at <date>", Postings, Money in, Money out); "Balance as at" date field; `BalanceChart` (recharts line); `ReconcilePanel` (asserts a real-world balance, posts the difference to an equity adjustment); searchable `LedgerTable` **Date · Narration · Other side · Amount · Actions**; "Details" edit card; "Closing and deleting" danger card.
**Gaps**: no running-balance column, no date-range filter, no category/type filter, no CSV export, no attachments.

### `/assets`
**Placeholder — Phase 4, no data access.** PageHeader + `Pill "Phase 4"`; 4 null Stats (Total value, Assets, Last revalued, Share of assets); `TableFrame` **Asset · Class · Valued on · Value** + `EmptyState` (Gem).
**Gap**: unbuilt; needs full design (revaluation posts the delta to an equity adjustment account).

### `/budgets`
Data: `banking.planBudgets.execute({months})` → `months[] {month, totalBudgeted, toBudget, lastMonthOverspent, warnings[], envelopes[] {accountId, budgeted, spent, carriedIn, leftover}}`; `BudgetLedger.utilisationBasisPoints(spent, budgeted)` (page.tsx:37).
UI: 4 Stats (Budgeted, To budget, Last month's overspend, Envelopes); "Over-allocated" amber card; one `panel` per month (current + two behind) headed "`<month>` — to budget `<money>`" with table **Category · Budgeted · Spent · Carried in · Left · Used(%)**; "Set a budget" form.
**Gaps**: no per-envelope progress bars, no category icons/colours, no month navigation beyond the fixed 3, no overspend highlighting beyond text colour, categories render as raw ledger codes (`Expenses:Food`).

### `/cards`
Data: `cards.list.execute({asOf})` → `summary {daysToDue, owed, billedLastCycle, …}`, `terms {creditLimit, statementDay, graceDays, financeRate, minimumDueRule}`.
UI: 4 Stats (Total owed, Cards, Due soonest, Billed last cycle); card tiles with a due-date `Pill` (brand tone when `daysToDue <= 3`); `UtilisationGauge`; "Add a card" form.
**Gaps**: no card art/issuer branding, no utilisation colour thresholds, no rewards summary, no spend-by-category per card, no payment-due calendar.

### `/cards/[accountId]` (197 ln)
Data: `cards.view.execute()` → `detail {owed, billedLastCycle, minimumDue, available, card.terms.creditLimit}` + cycle data.
UI: due Pill; 4 Stats (Owed today "Including this cycle's spending", Billed last cycle, Minimum due, Available "Limit ₹x"); "Utilisation" card; "This cycle" 2-col with `CycleTimeline`; "Pay this card" form ("Recorded as a transfer between two accounts you own — never as an expense"); "Reward points" card.
**Gaps**: no statement list/PDF, no cycle transaction list, no interest-if-revolved projection.

### `/deposits`
Data: `lending.listDeposits.execute({asOf})` → `positions[] {deposit.displayName, kind, maturesOn, valueToday, bookedInJournal, accrued}`; NPS valued units × NAV.
UI: 4 Stats (Total value, Accrued-unbooked, Deposits, Next maturity); `MaturityLadder` card; table **Deposit · Kind · Matures · Value today · In the journal · Accrued · Manage**; separate "Priced, not accrued" card for NAV schemes; "Add a deposit" form.
**Gaps**: thin maturity ladder, no interest-earned-to-date chart, no reinvestment reminders, no effective-vs-quoted yield comparison.

### `/history`
Data: `reports.netWorthSeries.execute({months})` → `points[] {on, netWorth, income, expense}`; `reports.tax.execute({financialYear})` → `assessment {disposals, gain, taxable, totalTax}`.
UI: current-FY badge; 4 Stats (Income, Expenses, Saved, Net worth change); period tab-nav 1/2/3 years (`HISTORY_PERIODS`, violet active border); `NetWorthChart` (recharts); table of month-end net worth + that month's income/expenses; tax block **Disposals · Gain · Taxable · Tax**.
**Gaps**: single flat line, no income-vs-expense bars, no stacked composition, no CSV export, no event annotations.

### `/imports`
UI: PageHeader "Import a statement"; "Upload" card (`UploadForm`, 183 ln) subtitled with the **four layers of duplicate detection** (same file, same row, same bank reference, looks-the-same-within-a-week); "Open an account first" guard; `FilterBar` search by file name + Status (Any / Awaiting review / Posted / Undone / Failed) + Account; batch list.
**Gaps**: no drag-and-drop affordance, no per-batch progress, no format/parser hints, no undo in the list.

### `/imports/[batchId]` (425 ln + `review-table.tsx` **969 ln**, largest component)
Data: batch `{status, fileName, account, bankTotals}`, `counts {ready, needsChoice, flagged, confirmed, posted, rejected}`, parsed rows, unparseable lines.
UI: status Pill; **6 Stats** — Ready "Categorised, unconfirmed" · Needs choice "Pick an account" · Look familiar "Possible duplicates" · Confirmed "Waiting to post" · Posted "In the ledger" · Skipped "Kept as evidence"; warning cards ("This statement cannot check itself", "This does not match the bank's own totals", "Worth checking before you post this", "Imported over a failed balance check"); the review table; unreadable lines listed, not counted.
**Gaps**: 969-line table with no virtualisation, no documented keyboard-first bulk-confirm pattern, six stat tiles compete for attention, no side-by-side original-document preview.

### `/liabilities`
**Placeholder (Phase 3–4), no data access.** 4 null Stats (Outstanding, Cards, Loans, Monthly outgo); `TableFrame` **Liability · Type · Rate · Outstanding** + EmptyState.
**Gap**: unbuilt and redundant with `/cards` + `/loans` — redesign must decide: real debt hub, or retire it.

### `/loans`
Data: `lending.listLoans.execute({asOf})` → `terms.annualRate`, `instalment()`, booked owed, schedule totals.
UI: 4 Stats (Owed "From the journal", Monthly commitment, Loans, Interest over the terms); loan list; "Add a loan" card ("A loan disbursed into an account you track raises the debt and the balance together, so net worth is unchanged").
**Gaps**: no amortisation chart, no payoff-date column, no link-through to `/loans/payoff`.

### `/loans/payoff`
Data: `lending.comparePayoff.execute({monthlyBudget, asOf})`.
UI: "Monthly budget" input; failure card "That budget will not clear the debts"; Stats **Avalanche interest · Snowball interest · Avalanche saves · And finishes (n months sooner)**.
**Gaps**: no schedule chart comparing strategies, no per-debt order table, no budget slider.

### `/loans/[accountId]`
Data: `loan.terms.annualRate.percent`, `loan.instalment()`, booked balance, `schedule.totalInterest`, effective rate, last-12-months interest.
UI: rate Pill ("x.xx% quoted"); 4 Stats (Instalment, Owed, Interest over the term, Effective rate); "What a flat rate actually costs" card; "Interest paid, last twelve months"; "Record a payment" form (principal/interest split from the schedule, never typed).
**Gaps**: no full amortisation table, no prepayment what-if (`loan_prepayments` exists), no balance-over-time chart.

### `/platforms` (314 ln)
Data: `investing.valuePortfolio.execute({asOf})` + institutions; `inUse[]`, `idle[]`, archived.
UI: badge "N in use"; 4 Stats (Platforms in use, Holdings, Market value, Unattributed); per-platform rollup rows; "Registered, holding nothing" card; "Archived" card; "Add a platform" form; `PlatformRowActions`.
**Gaps**: no platform logos, no concentration/exposure chart, no per-platform return, no charges-by-platform.

### `/settings`
UI (`max-w-3xl`, single column): FY Pill; "Account" `<dl>` Name/Email; "Reporting currency" panel (read-only, with a note that changing it needs a preferences table + FX book); "Tax settings" → `TaxSettingsForm` (financialYear, marginalSlabPercent default 30, ltcgExemption default 125000.00, regimeKey `india-fy2025`, usesNewRegime); "Manual mode is active" assurance panel.
**Gaps**: no appearance/theme, notifications, data export/import, account deletion, sessions/security, or number-format sections.

### `/transactions`
Data: paginated transaction page (`PAGE_SIZE`), monthly income/expense, uncategorised count.
UI: 4 Stats (Inflow, Outflow, Net, Uncategorised "Awaiting a rule"); `RegisterTable` via `DataTable` **Date (7rem) · Narration · Category · Account · Amount**; Previous/Next "Page n of m · N transactions"; header action "Import a statement". Kind labels: `WITHDRAWAL→Spend, DEPOSIT→Receipt, TRANSFER→Transfer, OPENING_BALANCE→Opening balance, RECONCILIATION→Adjustment, CHARGE→Charge, REVERSAL→Reversal`.
**Gaps**: **no FilterBar at all** on the highest-volume screen — no search, date range, account, category, amount or type filter; no sorting; no bulk categorise; no inline edit; no split view; no running balance; the cmdk palette is unwired.

### `/investments` (overview)
Data: `investing.workspace.execute({asOf})` → `metrics` (9 keys), `dataQuality {status: COMPLETE|PARTIAL, unpricedPositions[], stalePositions[], unconvertedPositions[]}`, `reportingCurrency`, `asOf`, positions.
UI: data-quality Pill; 3 `MetricStat` cards (marketValue, unrealisedPnl, realisedPnl); "Valuation status" card with three `QualityList`s (Unpriced / Stale / FX unavailable) + amber note "The portfolio total is withheld until every holding has a price and required FX conversion"; `AllocationDashboard` (donut); 4 `RouteCard`s.
**Gaps**: no top gainers/losers, no day change, no sector/asset-class breakdown beyond the donut; route cards duplicate the sub-nav.

### `/investments/holdings`
Data: `workspace.positions`. UI: `HoldingsTable` (216 ln) with a search box and a price-state filter (All / Priced / Stale / Unpriced / FX unavailable); columns **Holding · Type · Platform · Units · Invested · Market value · Realised · Price state**.
**Gaps**: **no gain/loss column, no % return, no day change, no current price, no portfolio-weight column**; no sorting; no grouping by asset class or platform; no row expansion to lots.

### `/investments/activity`
UI: badge "current" or "N need attention"; cards "Holding records", "Realised history", "Data quality".
**Gap**: a link hub, not an activity feed — no chronological trade/dividend/corporate-action timeline despite `trades`, `instrument_incomes`, `corporate_actions` holding the data.

### `/investments/analysis`
Data: `investing.analysis.execute({from, through, instrumentId})` → `rows[] {instrumentId, symbol, name, kind, assetFamily, asOf, barsUsed, series[], periodReturn, maximumDrawdown, indicators[] {name, window, value, status, reason}, provenance[], range, gaps[], warnings[]}`.
UI: "Analysis scope" filter card — Range (preset keys), Asset family, Instrument (URL-persisted); selected-instrument header (`SYMBOL  Name`, "`range` range · as of `date` · `n` bars"); 4 `MetricStat`s **Period return · Maximum drawdown · RSI · Realised volatility**; `AnalysisChart`; "Technical indicators" table **Indicator · Window · Value · Status**; "Data provenance" `<dl>` (Sources, Stored range, Data gaps, Eligible instruments); amber "Data-quality notes".
**Gaps**: one instrument at a time; indicators not overlaid on the price chart; no benchmark comparison.

### `/investments/compare` (253 ln + `comparison-chart.tsx` 211 ln)
2+ holdings and a market index on one axis, **each rebased to 100 at their first shared day**. Pill "Indexed"; "Choose what to compare" card ("The selection lives in the address, so a comparison you like is a link you can keep"); multi-select; indexed line chart.
**Gaps**: no correlation matrix, no per-selection period-return table, no date-range picker beyond the shared window, no benchmark library.

### `/investments/data` — "Live Data Center" (208 ln, own `loading.tsx` + `error.tsx`)
Data: `liveData.view.execute()` → `coverage {indianStocks, indianFunds, usStocks, other}`, per-instrument `preferredPriceFreshness`, provider `state`.
UI: Pill "Data tracking"; 4 Stats (Indian stocks "NSE and exchange-traded holdings", Indian mutual funds "AMFI scheme-code tracking", US stocks "USD holdings and optional quotes", Other instruments "Manual or non-streaming assets"); per-instrument rows with freshness Pill; provider cards with state Pill.
**Gaps**: no consistent last-sync timestamps, no per-source manual refresh, no error-log surface (`provider_fetch_log`, `price_divergences` unsurfaced).

### `/investments/history` — "Realised gains" (312 ln)
Data: `investing.realisedHistory.execute({userId, financialYear?, asOf})`.
UI: FY-scope Pill; 4 Stats (Realised, Short term, Long term "Held 365 days or more", After charges); "Disposals with no holding behind them" warning; FY tab nav; three breakdown cards — By category, By platform, By financial year (**Year · Disposals · Short term · Long term · Total**); "By holding" table **Holding · Disposals · Proceeds · Cost · Charges · Realised**.
**Gaps**: no tax-payable column, no ITR export, no indexation display for eligible debt, no chart.

### `/investments/new` (86 ln + 3 large forms)
Lane badge; `EntryLaneNav`; `InstrumentSearch` (369 ln, catalogue-backed), `RecordInvestmentForm` (392 ln), `RecordMetalForm` (394 ln), `AddInstrumentForm` (343 ln), `PlatformSelect` (154 ln).
**Gaps**: very long single-column forms, no stepper, no review-before-save summary, no inline charge preview.

### `/investments/performance`
asOf Pill; `PerformanceChart`; 6 `MetricPanel`s (investedAmount, marketValue, unrealisedPnl, realisedPnl, income, totalInvestmentGain) then 3 (absoluteReturn, xirr, twr).
**Gaps**: 3 of 9 metrics (income, totalInvestmentGain, twr) are *always* unavailable; no benchmark line, no period selector, no contribution-vs-growth decomposition.

### `/investments/tracker` — "Market tracker"
Data: `investing.tracker.execute({asOf})` → `rows[] {freshness, assetFamily, latest stored value, source, timing}`.
UI: Pill "As of `<date>`"; 3 Stats (Tracked "Non-digital instruments", Values available "Stored observations only", Needs attention); filter form — Freshness and Asset family with Apply/Reset; `TrackerTable`; `FreshnessPill`.
**Gaps**: read-only, no per-row refresh, heavy overlap with `/investments/data` — redesign should merge them.

### `/investments/[instrumentId]` (**1179 ln**, heaviest page)
Data: `investing.valuePortfolio`, `investing.returns`, `investing.compareMethods` (FIFO/LIFO/HIFO/AVERAGE side by side), `leasing.list`, `investing.goldAnalytics`, `investing.goldBenchmark`, `instrumentCatalog.search` (page.tsx:153, 188, 206, 232, 244, 375, 414).
UI: Stats **Invested** ("Price plus charges", or "Cash paid; lease credits excluded" for digital metal) · **Market value** · **Realised** · **Unrealised gain / loss**; for metals also **Average buy rate / gram**; `GramBar` splits (Leased and earning / Unleased wallet balance; Bought with money / Credited by a lease); quote-freshness Pill; children: `ReturnsPanel`, `PriceHistoryChart` (300 ln), `InvestmentActivity` (224 ln), `TradeForms`, `TradeRowActions`, `GoldLotLadder`, `GoldProfitChart` (285 ln), `GoldReturnsPanel`, `GoldTaxStatement`, `GoldBenchmarkTable`, `GoldXirr`, `GoldAdvisoryNote`, `DigitalGoldLeaseForm`, `MetalHoldingForm`, `NonDigitalHoldingProfile`, `InstrumentAdmin`; cards "What selling everything today would realise" (per cost-basis method), "Corporate actions", "Record a trade", "This holding's details".
**Gaps**: one 1179-line page serving equity, funds, SGB and digital gold with divergent layouts; tab state is client-side (`activeView`), not URL-addressable; no consistent header summary bar across asset types.

## 5. Terminology to preserve

- **Net worth**, Assets, Liabilities, **Liquid**, **runway**, **Peak net worth**, **Saved**, **Savings rate**, **Money in / Money out**, **Inflow / Outflow / Net**.
- **Holding** (not "position"), **Units** (not "shares"), **Invested**, **Market value**, **Realised**, **Unrealised gain / loss**, **Price state** (Priced / Stale / Unpriced / FX unavailable), **Platform** (not "broker"), **Instrument**, **Lot**, **Disposal**, **Proceeds**, **Cost**, **Charges**.
- **Short term / Long term** ("Held 365 days or more"), STCG / LTCG / SLAB / EXEMPT, **Financial year** (`2025-26`), **Taxable**, **Tax**.
- Ledger: **Posting**, **Narration**, **Other side**, **Category**, **Envelope**, **Carried in**, **Left**, **Used**, **To budget**, **Uncategorised**, **Reconcile**, **Adjustment**, **Reversal**, **Opening balance**.
- Transaction kinds: Spend · Receipt · Transfer · Opening balance · Adjustment · Charge · Reversal.
- Accounts: **Kind** = Bank / Wallet / Cash; **Status** = Open / Closed; **Bank or provider**; **Last four digits**.
- Cards: Owed today, Billed last cycle, Minimum due, Available, Utilisation, This cycle, Reward points.
- Loans: Instalment, Owed, Interest over the term, Effective rate, Avalanche / Snowball.
- Deposits: Value today, In the journal, Accrued, Matures, Maturity ladder.
- Imports: Ready, Needs choice, Look familiar, Confirmed, Posted, Skipped, Review, Staged rows.
- Data quality: Complete / Partial, Unpriced, Stale, FX unavailable, Needs attention, Live / Current, Provenance, Data gaps.
- Stance phrases: **"Manual mode"**, "Live", "Phase 2/3/4" badges, "B02 holds" / "B02 fails", "summed from journal postings at read time, never stored", "an em-dash is an admission, a zero is a claim".

## 6. Realistic sample data (shipped field names, INR)

### Holdings — `/investments/holdings`
| symbol | name | kind / class | taxAssetClass | Platform | units | invested | market value | realised | priceState |
|---|---|---|---|---|---|---|---|---|---|
| RELIANCE | Reliance Industries Ltd | EQUITY / LISTED_EQUITY | LISTED_EQUITY | Zerodha | 45 | ₹58,423.50 | ₹63,918.00 | 0 | Priced |
| INFY | Infosys Ltd | EQUITY / LISTED_EQUITY | LISTED_EQUITY | Zerodha | 60 | ₹91,386.00 | ₹88,722.00 | ₹12,405.00 | Priced |
| HDFCBANK | HDFC Bank Ltd | EQUITY / LISTED_EQUITY | LISTED_EQUITY | Groww | 80 | ₹1,30,240.00 | ₹1,42,560.00 | 0 | Priced |
| TATAMOTORS | Tata Motors Ltd | EQUITY / LISTED_EQUITY | LISTED_EQUITY | Upstox | 150 | ₹1,13,250.00 | ₹1,08,900.00 | 0 | Stale |
| NIFTYBEES | Nippon India ETF Nifty 50 BeES | ETF / ETF | EQUITY_MUTUAL_FUND | Zerodha | 420 | ₹1,12,560.00 | ₹1,23,900.00 | 0 | Priced |
| 120503 | Parag Parikh Flexi Cap — Direct Growth | MUTUAL_FUND / EQUITY_FUND | EQUITY_MUTUAL_FUND | Kuvera | 1842.317 | ₹1,50,000.00 | ₹1,89,312.40 | 0 | Priced |
| 119533 | HDFC Corporate Bond — Direct Growth | MUTUAL_FUND / DEBT_FUND | DEBT | Groww | 2410.882 | ₹75,000.00 | ₹82,174.30 | 0 | Priced |
| SGBAUG32 | Sovereign Gold Bond 2024-25 Series II | GOVT_SECURITY / SGB | GOLD | ICICI Direct | 20 | ₹1,39,400.00 | ₹1,56,200.00 | 0 | Priced |
| GOLD-SG | Digital Gold (24K) | DIGITAL_GOLD | GOLD | SafeGold | 38.4210 g | ₹2,95,176.00 | ₹3,31,845.00 | ₹4,523.00 | Priced |
| SILVER-AUG | Digital Silver | DIGITAL_SILVER / DIGITAL_METAL | GOLD | Augmont | 1250.000 g | ₹1,18,750.00 | ₹1,30,625.00 | 0 | Priced |
| AAPL | Apple Inc. | EQUITY / LISTED_EQUITY | UNLISTED | INDmoney | 12 | ₹2,14,560.00 | — | 0 | FX unavailable |
| ITC | ITC Ltd | EQUITY / LISTED_EQUITY | LISTED_EQUITY | Angel One | 200 | ₹82,400.00 | — | 0 | Unpriced |

Real platform names (`src/ui/providers.ts`): HDFC Bank, ICICI Bank, Paytm Payments Bank, Zerodha, Groww, INDmoney, Upstox, Angel One, ICICI Direct, HDFC Sky, SafeGold, Augmont, MMTC-PAMP, Paytm Gold, Jar, Gullak.

### Trades — `trades` (minor units)
| tradedOn | symbol | side | quantity | pricePerUnitMinor | brokerage | stt | exchangeTxn | sebiFee | stampDuty | gst | dp | settlementAccount |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 2025-04-11 | RELIANCE | BUY | 45 | 129830 | 2000 | 5842 | 173 | 6 | 877 | 391 | 0 | Assets:Bank:HDFC |
| 2025-05-06 | INFY | BUY | 60 | 152310 | 2000 | 9139 | 271 | 9 | 1371 | 409 | 0 | Assets:Bank:HDFC |
| 2025-06-18 | HDFCBANK | BUY | 80 | 162800 | 2000 | 13024 | 386 | 13 | 1954 | 431 | 0 | Assets:Bank:ICICI |
| 2025-07-02 | NIFTYBEES | BUY | 420 | 26800 | 0 | 1126 | 334 | 11 | 1126 | 62 | 0 | Assets:Bank:HDFC |
| 2025-08-21 | INFY | SELL | 25 | 168400 | 2000 | 4210 | 125 | 4 | 0 | 383 | 1550 | Assets:Bank:HDFC |
| 2025-09-09 | GOLD-SG | BUY | 12.5000 g | 768200 | 0 | 0 | 0 | 0 | 0 | 43211 | 0 | Assets:Wallets:SafeGold |
| 2025-10-01 | 120503 | BUY | 612.104 | 81424 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | Assets:Bank:HDFC |

### Register — `/transactions`
| txnDate | Narration | Category | Account | Amount | Kind |
|---|---|---|---|---|---|
| 2026-10-01 | Salary — October | Income:Salary | HDFC Savings ••1234 | +₹1,85,000.00 | Receipt |
| 2026-10-02 | BigBasket groceries | Expenses:Food:Groceries | HDFC Savings ••1234 | −₹2,450.00 | Spend |
| 2026-10-03 | SIP — Parag Parikh Flexi Cap | — | Assets:Broker:Kuvera | −₹25,000.00 | Transfer |
| 2026-10-05 | Rent — October | Expenses:Housing:Rent | HDFC Savings ••1234 | −₹38,000.00 | Spend |
| 2026-10-07 | HDFC Regalia card payment | — | HDFC Savings ••1234 | −₹24,318.40 | Transfer |
| 2026-10-09 | Zerodha brokerage + GST | Expenses:Investing:Charges | Assets:Broker:Zerodha | −₹391.00 | Charge |
| 2026-10-12 | Dividend — ITC Ltd | Income:Dividends | HDFC Savings ••1234 | +₹2,800.00 | Receipt |
| 2026-10-14 | Electricity — BESCOM | Expenses:Utilities | HDFC Savings ••1234 | −₹1,860.00 | Spend |
| 2026-10-18 | FD interest accrual — ICICI 7.1% | Income:Interest | ICICI FD ••9087 | +₹4,112.00 | Receipt |
| 2026-10-19 | Opening balance — Cash in hand | — | Cash in hand | +₹12,000.00 | Opening balance |

### Headline figures for mockups
Net worth **₹48.72L** · Assets **₹56.18L** · Liabilities **₹7.46L** · Liquid **₹9.34L** (6.2 months runway) · Portfolio market value **₹16.1L** · Unrealised **+₹1.84L** · Realised FY2025-26 **+₹68,420** · XIRR **+15.23%** · Max drawdown **−12.4%**.

## 7. Cross-cutting gaps

1. **Charts are scarce and thin** — recharts is installed and wrapped, but the dashboard has zero charts; allocation is CSS bars; history is a single line. No sparklines, no stacked composition, no benchmark overlays.
2. **Filtering is inconsistent** — `FilterBar` only on Accounts and Imports; Transactions has none; Holdings has a bespoke filter; Analysis/Tracker use raw `<form method="get">`. All filters full-reload.
3. **No sorting on any table** except the Accounts sort dropdown.
4. **No day change and no % return columns** anywhere in investments.
5. **Three placeholder routes** (`/assets`, `/liabilities`, much of `/investments/activity`) and three always-unavailable metrics (income, totalInvestmentGain, twr).
6. **Duplication**: `/investments/data` vs `/investments/tracker`; `/liabilities` vs `/cards`+`/loans`; `/investments` route cards vs the sub-nav.
7. **shadcn coverage is minimal** — no Table, Tabs, Badge, Tooltip, Sheet, Skeleton, Card or Chart primitives; tabs hand-rolled per page; holding-page tab state not URL-addressable.
8. **No loading skeletons** except `investments/data/loading.tsx`.
9. **Dark-only, no theme toggle, no density setting, no accessibility preferences.**
10. **Header has no search/command palette** despite `cmdk` being installed for it.
11. `/imports/[batchId]/review-table.tsx` (969 ln) and `/investments/[instrumentId]/page.tsx` (1179 ln) are the two screens most in need of structural redesign.

## Constraints for the design agent

- **Dark-only, violet-accent, CRED-inspired**: layered near-black surfaces (`#07080d` page / `#0e0f16` card / `#161822` raised), hairline `#20222f` borders, `--radius: 1rem`, generous whitespace, Geist Sans + Geist Mono, tabular numerals on every figure.
- **INR formatting with Indian grouping** and Cr/L/K compaction, truncated not rounded; signed values always carry an explicit `+`/`−`.
- **Unavailable ≠ zero**: every metric needs a designed "—, and here is why" state.
- 5-colour fixed-order chart palette only; 3 max for scatter/small-multiples; never colour text with a series hue.
- Content max-width 1440px; sidebar 272px (lg+), bottom nav below lg.

## QA record
Status: NOT_RUN (research lane — no production code changed)

---

## Wave 1 — Foundation + Dashboard

Lane: **Experiment** (non-production interactive mockup). Updated: 2026-10-19.

**Artifact:** https://claude.ai/artifact/M73JMRQLrTDzvBc6QhnruP — two sections in a left-rail switcher: *Foundation* (living style guide) and *Dashboard* (`/dashboard` redesigned, fully interactive).

### Decisions made in this wave

- **Visual direction.** The CRED violet/dark-only look is abandoned. Light is the default; a three-state theme control (System → Light → Dark) is wired per the artifact theming contract (`:root` light tokens, redefined under `@media (prefers-color-scheme: dark)` guarded by `:root:not([data-theme="light"])`, and again under `:root[data-theme="dark"]`). Hairline borders carry all elevation; radii are 3/6/8px with table cells at 0; motion is ~0.
- **Tokens.** The design-research §1.4 set is adopted unchanged (neutral ramp, one indigo accent, teal-leaning green / orange-leaning red for P&L only). Components reference semantic aliases only.
- **Chart palette — deviation from the brief.** The shipped `--chart-1..5` (violet/green/amber/blue/rose) was *not* reused: its green collides with `--gain` and its rose with `--loss`, which breaks the "colour is a data channel" rule. A new five-hue ramp was generated and machine-validated (lightness band, chroma floor, CVD adjacent-pair ΔE, normal-vision floor, 3:1 contrast) separately against the light surface `#FFFFFF` and the dark surface `#13181D`; both pass all checks.
  - Light: `#5468D6 #1F94A8 #B5801F #A14C9E #4E7A3A`, overflow `#8C98A6`.
  - Dark: `#8A7FE8 #2FA3BA #B68530 #C76BA0 #6FA14E`, overflow `#64707E`.
- **Navigation regrouped.** The flat 12-item "Wealth" group with duplicate icons is replaced by six intent-named groups, each icon used once, no deep link masquerading as a section, and `/liabilities` retired (it is redundant with `/cards` + `/loans`):
  - Overview — Net worth, History
  - Cash & spending — Accounts, Transactions, Budgets, Import *(count badge for rows awaiting review)*
  - Investments — Portfolio, Holdings, Realised gains, Platforms, **Market data** *(merges `/investments/data` and `/investments/tracker`)*
  - Savings & assets — Deposits, Property & valuables *(`/assets`, NEW)*
  - Debt — Cards, Loans
  - Account — Settings
- **Attribution chart on one axis.** §4.7 asks for contribution-vs-growth stacked columns plus the cumulative net-worth line with no second axis. Monthly *deltas* (₹0.3–1.6 L) are invisible beside a ₹38–49 L line, so each column stacks **value carried into the range + cumulative contributions + cumulative growth**; the stack top equals net worth and the line traces it. Same ₹ axis, no distortion.
- **"Unavailable, and why" is designed, not implied.** Two surfaces carry it: a TWR panel stating that daily valuations exist only from 1 Apr 2026 with the real error key `TWR_BOUNDARY_VALUATIONS_UNAVAILABLE`, and the `1D`/`1W` ranges, where the attribution chart refuses to draw because neither component can be derived inside one snapshot interval. In the holdings table, AAPL (FX unavailable) and ITC (Unpriced) render `—` with the reason on hover *and* on keyboard focus; TATAMOTORS renders a stale figure in muted ink with a dotted underline.
- **Figure consistency.** The holdings preview is explicitly "12 of 34", so its subtotal (₹14,18,157 priced across 10 rows) does not contradict the portfolio KPI of ₹16.10 L / +₹1.84 L. The Market value tile states that ₹1.92 L is carried at last known value.
- **Density default is Compact (32px)**, theme-independent, with Comfortable (36px) and Dense (28px) working in the mockup.
- **Sorting** cycles desc → asc → none on click; shift-click appends a key with an ordinal; nulls sort last in both directions; sorting uses numeric values, never formatted strings; a clearable "Sorted by" chip makes multi-sort discoverable.
- **Mobile.** Below 768px the holdings table becomes the two-column summary cards of design-research §7.3; the rail collapses behind a Menu control; no horizontal page scroll at any width.

### Marked NEW (designed, but the backend cannot compute it today)

Today's change KPI · benchmark selector `vs NIFTY 50` · allocation `Target%` and `Drift` columns · the `Market cap` allocation dimension · the `Day change` holdings column · the `Weight%` holdings column · the `Property & valuables` (`/assets`) nav entry.

Deliberately *not* chipped NEW, because they are a different category: TWR, income and total investment gain are **always unavailable** and get the explicit refusal state instead; XIRR, realised P&L, maximum drawdown, liquid and runway are already implemented.

### Open questions carried forward

1. Is a target-allocation model stored per user? Target% / Drift is drawn but has no source.
2. Is a NIFTY 50 / NIFTY 500 series obtainable under the keyless, free market-data constraint? Benchmark comparison, alpha and beta all depend on it.
3. Does the app store a previous close per instrument? Without it, "Today's change" cannot ship at all and the tile should be cut rather than chipped.
4. Retire `/liabilities` as proposed, or rebuild it as a real debt hub?
5. Should the 36 remaining screens assume a table primitive with saved views and column visibility (design-research §2.3/§2.6), or is that a later wave?

### QA record (Wave 1)
Status: NOT_RUN — experiment lane, no production code changed. Verified: chart palettes pass the six-check validator in both themes; the page's script parses.

## Coordinator verification — Wave 1 open questions (2026-10-19)

Three of the Wave 1 design agent's open questions are facts in the codebase, not user decisions. Verified directly:

| Question | Verdict | Evidence |
|---|---|---|
| Is a target-allocation model available? | **Yes, already in the domain.** Keep the `Target%` / `Drift` columns. | `src/domain/portfolio.ts:638-694` computes `targetWeight`, `drift` (`actual − target`) and `rebalanceAmount` (as money, "positive means sell"). Only per-user storage and the UI are missing. |
| Is a NIFTY benchmark series obtainable under the free/keyless constraint? | **Yes.** Keep the benchmark selector, alpha and beta. | `src/market-data/adapters/india/nse-index-close.ts` reads the official `nsearchives.nseindia.com` daily index close (`^NSEI` NIFTY 50, `^CNX100`, `^CRSLDX` NIFTY 500, `^NSEBANK`), free and keyless, from ~2013; Yahoo `^NSEI` is the long-history primary, this is the failover and cross-check. Index levels carry `adjusted: false` deliberately. |
| Is a previous close stored, so "Today's change" can ship? | **Yes.** Keep the tile. | `src/app/investment-analysis.usecases.ts:153,303` already computes `dayChangePercent` from the prior stored value. |

Consequence: none of the three features is cut. The `NEW` chip remains correct for all of them — it marks "not surfaced in the UI today", not "not computable".

Still a genuine user decision: retire `/liabilities` (Wave 1's assumption) or rebuild it as a unified debt hub. The Assets & Debt design agent is designing a recommendation.

## User decisions — 2026-10-20

### Product emphasis (user's own words)
> "for credit cards i will update the values manually just wanted to track the bank account money and other financial analytics and savings, bank accounts via pdf, json or CVS parsing"

Consequences for the redesign:

1. **Credit cards are a manual-value surface, not an analytical one.** Drop the interest-if-revolved projection, the card APR field, the reward conversion rates and the cross-product payoff roadmap. The mockup's invented 43.2% APR and ₹0.25/point have no source and the app should not guess them. Cards keep: owed, billed last cycle, minimum due, available, utilisation, due date.
2. **`/liabilities` is retired.** Settled — not on the revolving-balance argument, but because cards are not an analytical surface for this user. The five aggregate figures (total outstanding, blended rate, monthly outgo, debt-to-asset, debt-free date) move to the Debt nav group header and `/dashboard`.
3. **Statement ingestion is core, not peripheral.** Bank accounts are tracked by parsing PDF, JSON and CSV statements. `/imports` and `/imports/[batchId]` are therefore primary product surfaces and deserve weighting to match. **PDF parsing has not been covered by any mockup** — the repo already depends on `unpdf`, so the gap is UI, not capability. Needs: per-format parser affordances, a PDF page/column-mapping step, the four duplicate-detection layers, and the side-by-side original-document pane (designed in the Banking artifact).
4. **"Other financial analytics and savings" is the headline value**, alongside investments. Savings rate, runway, budget variance, cashflow waterfall and net-worth attribution are not secondary features.

### Saved views: IN SCOPE for v2
Naming and storing a filter + sort + column-set + order + widths + grouping + density combination. Core, not deferred. Requires a per-user storage table that does not exist in the schema today. Affects the toolbar on roughly a dozen table screens, so it must be settled before the table primitive is implemented.

### Delivered mockup artifacts (experiment lane)
| Artifact | Scope |
|---|---|
| https://claude.ai/artifact/M73JMRQLrTDzvBc6QhnruP | Foundation style guide + `/dashboard` |
| https://claude.ai/artifact/5DCknnwiSkNPPz1qg8p1YL | Landing, auth ×4, settings, command palette, search, alerts, errors, onboarding, nav IA |
| https://claude.ai/artifact/SmtWkzWxD2ZZubG6P7PDLr | Investments ×10 incl. holdings, tax harvesting, merged market data |
| https://claude.ai/artifact/55dP8AxSEaht8HDxNqQWvq | Cards, loans, payoff, deposits, assets, liabilities, platforms |
| https://claude.ai/artifact/5NNyzMvd2vEqQ5tyNK2bok | Transactions, accounts, budgets, imports, review, history |

Caveat on all five: no agent had a browser preview tool, so **no rendered page was visually inspected**. Layout, chart label crowding at narrow widths and dark-theme rendering are unverified by eye.

## Component library — the control bench (2026-10-20)

Lane: **Experiment** (non-production interactive mockup). Owner: component-craft design agent.

**Artifact:** https://claude.ai/artifact/G7p2WaM2VsKP5X7y1fxJwF — nine sections (Foundations, Buttons, Form controls, Data display, Navigation, Overlays, Feedback, Icons, Compositions). Every specimen carries a **Page / Light / Dark** control that pins that specimen's body to a theme in place, plus a global "All light / All dark" in the chrome, so each control is checked against both grounds without leaving the page.

This wave answers the verdict on the first two artifacts — *"decent, but I want a more classy and elegant design — every button, every checkbox, every icon, every dropdown."* The composition in those artifacts was kept; only the component layer was rebuilt. **Other design agents should refit to the scales and token corrections below.**

### Scales settled (binding)

| Scale | Values | Rule |
|---|---|---|
| **Control height** | `--h-xs 24` · `--h-sm 28` · `--h-md 32` · `--h-lg 36` · `--h-xl 40` | 32px is the default *because the Compact table row is 32px* — a control dropped in a cell does not change the row height. 24px only for controls nested inside another control (chip close, stepper arm). 40px is the mobile touch size. Forms use 36px. |
| **Radius** | `--r-1 2` · `--r-2 3` · `--r-3 4` · `--r-4 6` · `--r-5 8` · `--r-pill 999` · table cell `0` | **Radius is bound to height, not chosen per component.** ≤32px control → `--r-2`; ≥36px control → `--r-3`; panel/menu/popover → `--r-4`; modal/sheet → `--r-5`; nested-in-a-control → `--r-1`; status dots only → `--r-pill`. |
| **Border** | one width (1px); five strength steps: `--border-subtle` → `--border` → `--border-control` → `--border-hover` → `--border-active` | Hover = +1 step, press = +2 steps. Hover **darkens**, never re-hues. |
| **Transition** | `--t-fast 90ms` (state) · `--t 110ms` (bar/fill widths) · `--ease cubic-bezier(.2,0,.38,1)` | Only `background-color`, `border-color`, `color`, `box-shadow`, `transform` are animated. Collapses to 1ms under `prefers-reduced-motion`; both spinners become a static dotted ring beside `aria-busy`. |
| **Surface step** | light `#FFFFFF → #F6F8FA → #EFF2F5` (6.4% then 11.6% luminance) · dark `#1A2026 → #232A31 → #2A323A` | rest → hover → pressed. |

### Token corrections to design-research §1.4 (all four found by measuring)

| # | Token | Was | Now | Why |
|---|---|---|---|---|
| 1 | **`--border-control`** *(new)* | `--border-strong` light `#B9C2CC` **1.80:1**, dark `#343C45` **1.60:1** | light `#808C9A` **3.42:1**, dark `#64707E` **3.54:1** | §1.4 assigns `--border-strong` to form-control boundaries and claims 3:1. Measured, **both themes fail WCAG 1.4.11** — an input's edge was not a boundary. Both existing artifacts ship this failure on `.inp`, `.btn-ghost` and `.seg`. `--border-strong` is retired as a control token and survives only as decorative chrome. |
| 2 | **`--border` (dark)** | `--n-800 #232A31` → **1.23:1** on `#13181D` | `--n-700 #343C45` → **1.60:1** | In a borders-carry-all-elevation system, dark panels had no visible edge at all. |
| 3 | **`--bg-subtle` (light)** | `#EFF2F5` — `--fg-muted` on it measures **4.49:1** | `#F2F5F8` — **4.61:1** | A hair under AA for every caption on a subtle fill. Lifting the fill was cheaper than darkening every caption, and it makes the subtle surface read as a tint of the canvas rather than a third grey. |
| 4 | **`--fg-disabled`** | light `#8C98A6` **2.93:1**, dark `#49545F` **2.31:1** | light `#7C8896` **3.61:1**, dark `#5C6875` **3.14:1** | WCAG exempts inactive controls, but faintness alone is the lazy version of this state. **Contrast is not a state channel**: disabled is now carried by fill (`--bg-subtle`), border (weakened one step), removal of the inner highlight, and `cursor:not-allowed`. |

**Two new ramp steps**, both required by the above: `--n-450 #808C9A` (light control border) and `--n-775 #2A323A` (dark pressed surface).

**New tokens added:** `--border-subtle`, `--border-control`, `--border-hover`, `--border-active`, `--bg-active`, `--bg-sunken`, `--accent-active`, `--accent-soft` / `--accent-soft-hover` / `--accent-line`, `--gain-line` / `--loss-line` / `--warn-line` / `--info-line`, `--loss-on`, `--inner-hl` / `--inner-hl-2`, `--tip-bg` / `--tip-fg`, `--skel-a` / `--skel-b`.

**`--inner-hl` inverts between themes, deliberately.** Light has no room above `#FFFFFF`, so a raised control is *seated* with `inset 0 -1px 0 rgb(19 24 29 / .07)`; dark has room, so it flips to a true top highlight `inset 0 1px 0 rgb(255 255 255 / .055)`. One token, two opposite values.

**Unchanged:** the neutral ramp, the indigo accent, the gain/loss pair, the five-hue chart ramp (both themes), the type scale, and the borders-over-shadows stance. Fonts settled as **Inter + IBM Plex Mono** (the two earlier artifacts disagreed — one used JetBrains Mono).

### Craft rules the kit establishes

- **Pressed shifts the label 0.5px, not the button.** A button that moves as a whole breaks alignment with its neighbours.
- **Loading keeps the button's width** — the label goes `visibility:hidden` and the spinner is absolutely centred over it, so a toolbar never reflows.
- **Selection is a 2px inset accent bar, never a filled row.** A fill would collide with hover and with the expanded-row fill.
- **Menu separators inset 9px each side; container edges stay full-bleed.** A full-width divider reads as a cut through the surface.
- **The hairline beside a selected flush segment is suppressed on both sides** — a divider touching a filled segment reads as a seam.
- **Focus ring: 2px accent at `offset:2px` standalone, `offset:-2px` for controls packed in a row** (table headers, menu items, calendar days), `offset:1px` on input shells, where the border simultaneously turns accent.
- **Success uses `--accent`, never `--gain`.** Green means money up; borrowing it for "saved" makes a confirmation look like a profit.
- **`Unpriced` is an outline badge, not a warning.** A missing price is an absence; amber is reserved for `Stale` and `FX unavailable`, where a figure exists but should not be trusted as current.
- **Read-only ≠ disabled.** Read-only keeps `--fg-secondary` ink and takes a *dashed* border so the value still reads as real data; disabled drops to `--fg-disabled` on `--bg-subtle` with the inner highlight removed.
- **Icons are hand-authored inline SVG**, 16-unit grid, 1.3-unit stroke (so optical weight stays constant at 14 / 16 / 20px), `fill:none`, round caps and joins. 55 icons across nav / action / domain. No icon font, no library.
- **The em-dash is `tabindex="0"`** with a dotted underline, so "unavailable, and why" is reachable by keyboard, not only on hover.

### Verified

Contrast ratios above were computed from the hex values with a WCAG 2.x relative-luminance script, not estimated. The page's script parses; `rupee` / `compact` were run on sample inputs and produce `₹1,42,560`, `₹58,423.50`, `−₹4,350.00`, `₹48.72L`, `+₹1.84L`, `₹1.61Cr` (en-IN grouping, U+2212, L/Cr truncated toward zero). All 55 icon names referenced in markup resolve to a defined path.

**Not verified:** no browser preview tool was available, so no rendered frame was inspected by eye. Layout at narrow widths and the live hover/press rendering are unverified visually.

### Wave 1 refit to the control bench (2026-10-21)

The Foundation + Dashboard artifact (https://claude.ai/artifact/M73JMRQLrTDzvBc6QhnruP, version 2, same URL) was rebuilt on the control-bench component layer. Composition, navigation regrouping and the NEW list are unchanged; the token and component layers were replaced.

**Four WCAG defects removed.** All four were shipped by version 1 of this artifact: `--border-control` (new) replaces `--border-strong` on every input, ghost button and segmented control (1.80:1 / 1.60:1 → 3.42:1 / 3.54:1); `--border` dark `#232A31` → `#343C45`; `--bg-subtle` light `#EFF2F5` → `#F2F5F8`; `--fg-disabled` → `#7C8896` / `#5C6875`, with disabled now carried by fill, a weakened border and `cursor:not-allowed` rather than by faintness. Ramp steps `--n-450` and `--n-775` added. Fonts settled on Inter + IBM Plex Mono (version 1 used JetBrains Mono).

**Component layer adopted:** the 24/28/32/36/40 height scale with 32 as the default, radius bound to height, one border width with five strength steps, `--t-fast` / `--t` transitions on colour and transform only, the theme-inverting `--inner-hl`, pressed shifting the label 0.5px, loading holding the button width, selection as a 2px inset accent bar, focus-ring offsets of +2 / −2 / +1, success on `--accent` rather than `--gain`, `Unpriced` as an outline badge with amber reserved for `Stale` and `FX unavailable`, read-only as `--fg-secondary` ink behind a dashed border, and the unavailable em-dash as `tabindex="0"`.

**Portfolio figures corrected to the §6 rows.** The ₹16.1 L / +₹1.84 L headline is withdrawn; the sample rows are authoritative. Priced market value **₹14,18,156.70**, invested **₹12,84,185.50**, unrealised **+₹1,33,971.20** (+10.43% on cost). The holdings table is now the whole portfolio — "All 12", not "12 of 34" — so the KPI tiles and the table footer reconcile exactly. All three allocation dimensions were rebased to ₹14,18,156.70 and each sums to it: asset class (4 buckets, the "carried at last known value" bucket removed, since AAPL and ITC are excluded until a price and an FX rate exist), platform (top 5 + Other), market cap. Net worth ₹48.72 L, assets ₹56.18 L, liabilities ₹7.46 L, liquid ₹9.34 L / 6.2 months and XIRR +15.23% are unchanged, and the 12-month attribution series still resolves exactly from ₹38.40 L to ₹48.72 L.

**Scope settled by the user and reflected here:** `/liabilities` is retired. Cards are a record-keeping surface (values entered manually), so no APR, reward-rate or interest-projection features. Statement ingestion is core product. Saved views are in scope for v2.

**Not refitted.** The bench's richer components that this screen has no slot for — custom listbox, token field, date-range picker, stepper, command-palette rows, switches, checkboxes, dual-handle range with histogram, bullet and gauge bars — are left for the screens that need them. The benchmark selector and the Target%/Drift columns remain marked NEW and still have no data source.

---

## Statement ingestion (PDF / JSON / CSV)

Lane: **Experiment** (non-production interactive mockup). Owner: statement-ingestion design agent. Updated: 2026-10-21.

**Artifact:** https://claude.ai/artifact/Eamd8tRPuzwpAZL4Lp9JZD — eight screens behind a stage switcher: Upload · Format detection · Pages & regions · Column mapping · Reconcile · JSON import · Format library · Handoff. Built on the Control Bench component language (https://claude.ai/artifact/G7p2WaM2VsKP5X7y1fxJwF) with its four corrected tokens. **Additive to** the Banking Console (https://claude.ai/artifact/5NNyzMvd2vEqQ5tyNK2bok): it designs what happens *before* `/imports/[batchId]` and stops at a stated boundary. The review table is not redesigned.

The mapping screen is a working parser, not a picture of one. Changing a column assignment, the amount shape, the date order or any of the four reading rules re-parses the sample file and moves the preview, the running-balance check, the acceptance gate, the problem list and the staged-row counts together.

### What the repo already does, and what the mockup invents

This is UI for a capability that mostly exists. `src/infra/statements.ts`, `src/infra/pdf-statements.ts`, `src/infra/pdf-columns.ts` and `src/infra/statement-header.ts` already ship:

| Already in `src/` | Where |
|---|---|
| PDF text extraction via `unpdf` (bundled pdf.js, no native build, no key, file never leaves the machine) | `pdf-statements.ts:extractPdfLines` |
| Password-protected PDFs, distinguishing "needs a password" from "wrong password" | `pdf-statements.ts:passwordProblem`, `StatementLockedError` |
| The scanned/no-text-layer refusal, with the "ask the bank for a CSV or an Excel export" wording | `pdf-statements.ts` |
| Column recovery from PDF geometry; page furniture removal | `pdf-columns.ts`, `isFurniture` |
| The header alias table for 8 column roles (`date, description, reference, debit, credit, amount, type, balance`) | `statements.ts:HEADER_ALIASES`, `headerRole` |
| Indian grouping, `(1,234.56)` negatives, `.01` sub-rupee cells, exact `bigint` minor units | `statements.ts:readAmount`, `NUMERIC_CELL` |
| DMY/MDY resolution | `statements.ts:resolveDateOrder`, `readDate` |
| Running-balance continuity → `RECONCILED` / `UNVERIFIED` / `BROKEN` | `statements.ts:checkBalanceContinuity`, `StatementVerdict` |
| Printed control totals → `ABSENT` / `MATCHED` / `MISMATCHED` | `statements.ts:ControlCheck`, `withPrintedTotals`, `withOpeningBalance` |
| Letterhead account suffix, statement period, printed closing | `statement-header.ts:StatementHeader`, `accountMatches`, `periodsOverlap`, `gapInDays` |
| Layout fingerprint | `statements.ts:layoutFingerprint` |
| Delimited text and OFX readers | `parseDelimitedText`, `parseOfx` |
| Four duplicate layers (file hash, row fingerprint, bank reference, looks-alike within a week) | `banking.usecases.ts:StageStatementImport` |
| Keyword categorisation, user-maintained, never AI | `category_rules` table |

Marked **NEW** in the mockup, because the repo has no equivalent today:

- **Saved named formats and the format library** — `layoutFingerprint` exists but nothing stores a format, so there is no table, no versioning, no export/import. This is the single largest new persistence requirement.
- **Per-page and per-region selection** — furniture removal is automatic; there is no UI to choose pages or mark the balance block.
- **A multi-file upload queue** with per-file state and inline recovery.
- **A JSON reader.** `statements.ts` has delimited text, OFX and PDF. There is no JSON path, no path picker, no key mapping.
- **A confidence signal** on format detection.
- **`import_batches.formatId`** and **`import_batches.verdictJson`** — the parse verdict is computed today but not persisted with the batch, so the review screen cannot repeat it.

### What real Indian statements actually do

Gathered by a research pass over bank documentation and over open-source parsers written against real files. No bank publishes a statement specification, so every literal header below the official line is reconstructed from parser source; layouts change without notice.

**Column order differs between banks, and a wrong default does not fail — it inverts the sign on every row and still imports cleanly.** This is the single most dangerous variation and it drove the mapping screen's design:

| Bank | Amount columns, in print order | Source |
|---|---|---|
| HDFC | `Withdrawal Amt.` → `Deposit Amt.` | [hdfc.py](https://github.com/akhilnarang/bank-statement-parser/blob/master/bank_statement_parser/parsers/hdfc.py) |
| ICICI | `DEPOSITS` → `WITHDRAWALS` | [ICICI statement PDF](https://urise.up.gov.in/resources/profile_image/tu/1638247481_Ritesh_Kr__Srivastava_(Statement).pdf), [icici.py](https://github.com/akhilnarang/bank-statement-parser/blob/master/bank_statement_parser/parsers/icici.py) |
| SBI monthly e-statement | `Credit` → `Debit` | [sbi.py](https://github.com/akhilnarang/bank-statement-parser/blob/master/bank_statement_parser/parsers/sbi.py) |
| Axis | `Debit` → `Credit` | [Axis sample](https://financefileconverter.com/bank-statement-examples/axis-bank) |
| Kotak | `Withdrawal (Dr.)` → `Deposit (Cr.)` | [kotak.py](https://github.com/akhilnarang/bank-statement-parser/blob/master/bank_statement_parser/parsers/kotak.py) |

**Literal column headers**

- **HDFC** — `Date / Narration / Chq./Ref.No. / Value Dt / Withdrawal Amt. / Deposit Amt. / Closing Balance` ([public statement](https://rera.bihar.gov.in/PassBook/RERAP231120170002304021133582022.pdf)). Summary block `Opening Balance | Debit Amount | Credit Amount | Closing Balance` on the last page ([source](https://dc.allahabadhighcourt.in/assets/documents/request/request1697513908.pdf)). Footer `This is a computer generated statement and does not require signature.` plus the Lower Parel registered-office line ([source](https://dc.allahabadhighcourt.in/assets/documents/request/request1678098514.pdf)) and `*Closing balance includes funds earmarked for hold and uncleared funds` ([source](https://urise.up.gov.in/resources/profile_image/tu/1660286777_act_stmnt_all.pdf)).
- **ICICI** — `DATE / MODE** / PARTICULARS / DEPOSITS / WITHDRAWALS / BALANCE`; `B/F` opening row, `Total:` per page ([source](https://urise.up.gov.in/resources/profile_image/tu/1638247481_Ritesh_Kr__Srivastava_(Statement).pdf), [icici.py](https://github.com/akhilnarang/bank-statement-parser/blob/master/bank_statement_parser/parsers/icici.py)).
- **SBI YONO PDF** — `Txn Date / Value Date / Description / Chq/Ref / Debit / Credit / Balance`, bounded by `Statement From :` and `Statement Summary` ([sbi.py](https://github.com/akhilnarang/bank-statement-parser/blob/master/bank_statement_parser/parsers/sbi.py)).
- **SBI legacy .xls** — tab-separated plaintext, `Txn Date / Value Date / Description / Ref No./Cheque No. / Debit / Credit / Balance`, `skiprows=20`, `skipfooter=2`, dates `%d %b %Y` ([SBICSV2Gnucash.py](https://github.com/abhijit86k/gnucash_statement_preprocessors/blob/master/SBICSV2Gnucash.py)).
- **SBI YONO XLSX** — header at `A18:F18`, `Account Number` at `B9`, `IFSC Code  :  SBIN` at `B11`, dates `%d/%m/%Y` ([SBIXLS2Gnucash.py](https://github.com/abhijit86k/gnucash_statement_preprocessors/blob/master/SBIXLS2Gnucash.py)).
- **Axis** — `Tran Date / Chq No / Particulars / Debit / Credit / Balance / Init.Br` ([source](https://financefileconverter.com/bank-statement-examples/axis-bank)).
- **Kotak** — `# / Date / Description / Chq/Ref. No. / Withdrawal (Dr.) / Deposit (Cr.) / Balance`, dates `DD Mon YYYY`, opening row padded with `-` ([kotak.py](https://github.com/akhilnarang/bank-statement-parser/blob/master/bank_statement_parser/parsers/kotak.py)).
- **CAMS / KFintech CAS** — `Date / Transaction / Amount (INR) / Units / Price (INR) / Unit Balance`, with a header that occupies **two physical rows** (CAMS 2 baselines, KFin 4), multi-line descriptions, parenthesised negatives ([cams_detailed.py](https://github.com/codereverser/casparser/blob/main/casparser/parsers/cams_detailed.py)).

**One bank, several formats**

- **HDFC ships two live layouts, both called "Statement of Account."** In one, an entire page is packed into a single table row with `\n`-joined cells, and the narration is re-split on a `Value Dt DD/MM/YYYY [Ref XXXXXXXXX]` terminator; the unused amount side prints `0.00`. In the other, rows are per transaction ([hdfc.py](https://github.com/akhilnarang/bank-statement-parser/blob/master/bank_statement_parser/parsers/hdfc.py)). The file name tells you nothing — the fingerprint does.
- **SBI has four distinct formats** across its download channels: the monthly e-statement PDF, the YONO "Statement of Account" PDF, the YONO XLSX and the legacy tab-separated `.xls` ([sbi.py](https://github.com/akhilnarang/bank-statement-parser/blob/master/bank_statement_parser/parsers/sbi.py), [gnucash_statement_preprocessors](https://github.com/abhijit86k/gnucash_statement_preprocessors)).
- **ICICI statements carry no ruled table at all.** `pdfplumber` finds zero tables; the reader works on x-coordinate thresholds (deposit < 420, withdrawal 420–520, balance > 520) and on narration lines sitting symmetrically above and below the date baseline at an 8.47 pt pitch ([icici.py](https://github.com/akhilnarang/bank-statement-parser/blob/master/bank_statement_parser/parsers/icici.py)). A "pick the column region" UI is therefore not optional for ICICI; it is the only way in.

**PDF passwords — derivable for five issuers, not for the rest**

| Issuer | Rule | Source |
|---|---|---|
| HDFC | Numeric Customer ID | [hdfc.bank.in](https://www.hdfc.bank.in/blogs/digital-banking/download-account-statement-via-netbanking) |
| ICICI | First 4 letters of the account name + DOB `DDMM`, lowercase, 8 characters | [help.icicibank.com](https://help.icicibank.com/Phone-Bank-FAQ/909216713/What-is-the-password-to-open-my-e-statement.htm) |
| NSDL CAS | PAN of the first/sole holder, capitals | [investor.nsdl.com](https://investor.nsdl.com/portal/en/kb/articles/faqs-on-cas-26-10-2023) |
| CDSL CAS | PAN of the first/sole holder, capitals | [cdslindia.com](https://www.cdslindia.com/CAS/FAQ.html) |
| Zerodha contract notes | PAN in capitals | [support.zerodha.com](https://support.zerodha.com/category/console/reports/contract-note/articles/where-can-i-get-the-contract-notes-for-the-trades-i-ve-taken) |
| Groww reports | PAN in capitals | [groww.in/help](https://groww.in/help/stocks,-f&o,-ipo-&-mtf/discoverable/what-is-the-password-to-open-my-report) |
| SBI PDF e-statement | **Not documented by SBI.** Third-party claims only | [onlinesbi.sbi/faq](https://onlinesbi.sbi/faq.html) |
| Axis, Kotak | **No official rule published** | [Axis FAQ](https://www.axisbank.com/bank-smart/internet-banking/faqs) |
| CAMS / KFintech CAS | **Chosen by the investor at request time** | [scripbox](https://scripbox.com/mf/consolidated-mutual-fund-statement/) |

Design consequence: the unlock step offers a derived hint only for the five issuers above, and asks plainly everywhere else. A wrong guess is indistinguishable from a corrupt file, so guessing costs the user a re-download they did not need. The SBI YONO **XLSX** password is `NNNNNDDMMYY` — last 5 mobile digits plus DOB ([README](https://github.com/abhijit86k/gnucash_statement_preprocessors/blob/master/README.md)) — which is a spreadsheet, not a PDF, and needs `msoffcrypto`, not pdf.js.

**Narration reference shapes** (verbatim field orders, for the reference/externalId extraction and for `category_rules` keyword authoring):

- HDFC — `UPI-<NAME>-<vpa>-<IFSC>-<RRN>-<REMARK>`, `IMPS-<RRN>-<NAME>-<bank>-<masked_acct>-<REMARK>`, `ACH D- <SCHEME> <date> <PROC>-<ref>`, `ACHC-<SCHEME>-<ref>`, `POS<masked card>…HH:MM:SS<MERCHANT>` ([hdfc_counterparty.py](https://github.com/akhilnarang/bank-statement-parser/blob/master/bank_statement_parser/parsers/utils/hdfc_counterparty.py))
- SBI — `UPI/<CR|DR>/<rrn>/<NAME>/<BANK>/<vpa>/<remark>`, `IMPS/<rrn>/<BANK>-<acct>-<NAME>/<remark>`, `NEFT*<ifsc>*<utr>*<NAME>`, `OTHPG <12-digit rrn><MERCHANT> <city>` ([sbi_counterparty.py](https://github.com/akhilnarang/bank-statement-parser/blob/master/bank_statement_parser/parsers/utils/sbi_counterparty.py))
- ICICI and generic — `UPI/<merchant>/<vpa>/<remarks>/<bank>/<rrn>/<txnid>`, `MMT/IMPS/<rrn>/<remark>/<beneficiary>/<bank>`, `BIL/INFT|ONL/<ref>/…`, `CLG/…` ([counterparty.py](https://github.com/akhilnarang/bank-statement-parser/blob/master/bank_statement_parser/parsers/utils/counterparty.py))
- Kotak — `UPI/<name>/<rrn>/<remark>`, `811:BBPS/<biller_id>/<biller_name>`, `PCD/<card_last4>/<merchant>/<loc><date>/<time>` ([kotak_counterparty.py](https://github.com/akhilnarang/bank-statement-parser/blob/master/bank_statement_parser/parsers/utils/kotak_counterparty.py))
- Channel markers and id regexes — UTR `[A-Z]{4}[A-Z0-9]\d{7,}`, RRN 12–22 digits; `ACH C` / `ACH D` / `NACH` / `ENACH` / `SI/` / `POS` / `CARD` / `MCD REF` / `CMS` ([channels.py](https://github.com/akhilnarang/bank-statement-parser/blob/master/bank_statement_parser/parsers/utils/channels.py))

**CAS is both holdings and transactions**, not one or the other — NSDL describes it as "a single account statement consisting of transactions and holdings" ([NSDL FAQ](https://investor.nsdl.com/portal/en/kb/articles/faqs-on-cas-26-10-2023)). Monthly issues carry activity; half-yearly ones are holdings only ([CDSL FAQ](https://www.cdslindia.com/CAS/FAQ.html)). Section markers, the page-2 account roster and the DETAILED-vs-SUMMARY split are in [casparser](https://github.com/codereverser/casparser/blob/main/casparser/parsers/detect.py). Re-printed CAS PDFs are unsupported by every parser surveyed. **CAS is out of scope for this mockup** — it is an investments feed, not a bank statement, and belongs with `/investments`, not `/imports`.

**Everything else that varies**, and that the mapping screen therefore exposes as a control: three amount models (two columns / one signed column / one amount plus a Dr/Cr marker, where the marker may be its own column or glued to the number); the unused side printed as blank, `0`, `0.00` or `-`; dates as `DD/MM/YY`, `DD/MM/YYYY`, `DD-MM-YY`, `DD-MMM-YYYY` or `DD Mon YYYY`; narrations wrapping across physical lines, sometimes mid-word; headers reprinted mid-table; `Cr`/`Dr` suffixes on balances; Indian grouping `1,52,581.54`; parenthesised negatives; and summary rows (`OPENING BALANCE`, `CLOSING BALANCE`, `TOTAL`, `B/F`, `Statement Summary`) sitting *inside* the transaction table ([cross-bank gotchas](https://github.com/akhilnarang/bank-statement-parser/blob/master/.agents/skills/add-bank-parser/SKILL.md)).

Marked **UNVERIFIED** by the research pass and therefore kept out of the mockup's sample data: the `ATW-` narration prefix, the `POS 1234XXXXXX5678 MERCHANT` field order, Axis row date format, Zerodha and Groww literal column headers, and whether HDFC/ICICI/Kotak/Axis offer CSV or XLS exports at all.

### Field-mapping contract

Eight source roles, matching `statements.ts:ColumnKey` exactly, so the UI and the alias table cannot drift apart:

| Role | Domain field | Required | Notes |
|---|---|---|---|
| `date` | `txnDate` | yes | Read under a resolved `DateOrder` |
| `valueDate` | `valueDate` | no | Aliased to `date` in `HEADER_ALIASES` today; the mockup separates them |
| `description` | `description` (Narration) | yes | Wrapped lines joined before this is set |
| `reference` | `refNo` | no | Also yields `externalId` when the value is per-transaction |
| `debit` | `amount` + `direction: DEBIT` | in `TWO_COLUMNS` | |
| `credit` | `amount` + `direction: CREDIT` | in `TWO_COLUMNS` | |
| `amount` | `amount` | in `SIGNED` / `AMOUNT_PLUS_TYPE` | |
| `type` | `direction` | in `AMOUNT_PLUS_TYPE` | A column, or a `Cr`/`Dr` suffix on the amount |
| `balance` | `balanceAfter` | no, but it is the only proof | Absent ⇒ `UNVERIFIED`, never a silent pass |

Reading rules saved alongside the roles: `dateOrder` (`DMY` / `MDY` / detect), `joinWrappedNarration`, `skipBlankRows`, `skipSummaryRows`, `stripCrDrMarkers`, the `summaryRows` label list, the `controlBlock` labels, and a `furniture` pattern list.

`amount` is **always positive** and `direction` carries the sign, matching `Posting` and `StatementRow` — a signed amount makes `−500` ambiguous between a withdrawal and a reversed deposit. Amounts are integer paise end to end; the mockup's own parser is integer-only so the acceptance gate is an exact equality, which no floating-point sum can promise.

A saved format is `stock-mania/import-format@1`: issuer, source type, fingerprint, page range and furniture line counts, the column map, the column order, the amount shape, the reading rules, the control-block labels, and an optional password hint. It carries **no account id, no user id and no figures**, so exporting one tells nobody anything about the owner's money. Formats are **versioned, never edited in place** — a batch imported under v1 must stay explainable after v2 exists.

### Acceptance gate

`opening + credits − debits == closing`, in minor units. Shown as the visible pass/fail with each term's paise value under it, and backed by two weaker checks that are reported separately because they fail separately:

1. **Row-wise continuity** against each printed balance → `RECONCILED` / `UNVERIFIED` / `BROKEN`.
2. **Printed control totals** (the `TOTAL` row, the statement summary block) → `ABSENT` / `MATCHED` / `MISMATCHED`.
3. **The gate** itself.

They are not redundant. Row-wise continuity tests the links in a chain and cannot see a link that was never read — a reader that stops one row short produces rows that reconcile perfectly with each other and a ledger short one payment; only a figure printed outside the table catches that. Conversely, **the control-total check cannot catch a swapped debit/credit mapping**, because it reads the same two columns as the rows do and swaps with them; only the running balance catches that. The mockup demonstrates all three: swapping HDFC's two amount columns yields `BROKEN` with 9 breaks and a failed gate while the control check still says `MATCHED`.

### Handoff boundary

Intake ends, and `/imports/[batchId]` begins, at one `import_batches` row plus N `import_rows`. Crossing the line:

- `import_batches` — `id, kind, accountId, fileName, fileHash, rowsRead, rowsImported, rowsDuplicate, rowsFailed, problemsJson, status ∈ {COMPLETED|PARTIAL|FAILED|UNDONE}`, plus **NEW** `formatId` and `verdictJson` (`trust`, `checked`, `breaks`, `controls`, `dateOrder`, `mapping`) so the review screen can repeat the warning instead of re-deriving it.
- `import_rows` — `id, batchId, rowIndex, rawJson` (the source line verbatim, so a re-parse never needs the upload back), `parsedJson` (`date, valueDate, description, reference, externalId, amountMinor, direction, currency, balanceAfterMinor, occurrence, suggestedAccountId`), `status ∈ {DRAFT|PARSED|MATCHED|CONFIRMED|REJECTED}`, `matchedTransactionId`, `matchPass`, `rejectedReason`.

The Banking Console's review row renders from that: `{i, id, date, raw, amt (paise, negative = out), cat, state ∈ ready|needs|dup|confirmed|posted|skipped, ref, closing}`. `amt` is the signed render of `amountMinor` + `direction`; `state` is `dup` where `matchPass` is set; `cat` is `suggestedAccountId`.

**Not crossing:** the mapping itself (it lives in the format, referenced by `formatId`, so one correction fixes every future statement rather than one batch); the file bytes (document archive, batch keeps `fileHash`); the PDF password; any category *decision* (keyword rules fire during staging and write a suggestion, the choice belongs to review); and anything in the ledger — no posting exists until review posts the batch.

Neither side owns the duplicate decision. Intake flags with a layer; review decides.

### Decisions a human still has to make

1. **A format-storage table.** Saved formats are the whole value of the library and there is nowhere to put one. Also needed: `import_batches.formatId` and `import_batches.verdictJson`.
2. **Does JSON import ship at all?** No Indian bank publishes a JSON statement. The path serves app exports and files the owner converted himself. It is designed; whether it is worth building is a product call.
3. **ICICI needs region selection, not column selection.** Its statements have no table. The page-and-region stage is mandatory for ICICI and optional everywhere else — build it, or do not support ICICI PDFs.
4. **Confidence thresholds.** The mockup proposes ≥85% apply, 50–85% pre-fill, <50% treat as unknown. These are invented numbers and need one real statement corpus behind them.
5. **What happens on a failed gate.** The mockup allows posting with a permanent flag, matching the Banking Console's "Posting anyway is allowed, and the batch is flagged". Confirm that is the wanted behaviour rather than a hard block.
6. **CAS** stays out of `/imports`. Confirm.

### QA record

Status: NOT_RUN — experiment lane, no production code changed.

Verified: all four script blocks parse under `node --check`; every `getElementById` target resolves to an id in the markup; the parser was run headlessly over all three sample files — HDFC 9 rows / 2 unreadable / `RECONCILED` / gate `PASS`, SBI 6 rows / 0 unreadable / `RECONCILED` / gate `PASS`, Paytm 5 rows / 0 unreadable / `RECONCILED` / gate `PASS`, each reconciling exactly in integer paise; and the four designed failure modes were exercised — swapping HDFC's amount columns gives `BROKEN` with 9 breaks, forcing `MM/DD` drops 9 rows to 5 with 8 unreadable lines, turning off marker-stripping on a balance column printed `… Cr` gives `UNVERIFIED`, turning off wrapped-narration joining gives 9 orphaned lines. Currency formatting produces `₹1,24,318.40`, `−₹43,500.00`, `+₹0.00`, `₹16,10,000.00` (en-IN grouping, U+2212).

Not verified: no browser preview tool was available, so no rendered frame was inspected by eye. Layout at narrow widths, the PDF page preview's region bands and dark-theme rendering are unverified visually.

---

## Mutation model — Edit / Remove one / Remove all / Undo / Redo (2026-10-21)

Appended by the mutation-model design agent. Everything above is preserved verbatim; other agents have also
written to this file.

**Lane:** research then mockup. No production code changed. Artifact:
https://claude.ai/artifact/7QPCpfeFEE2DRh3pQpENdJ

### The constraint, restated from source

- `src/domain/transactions.ts:2567-2629` — the repository has `save`, `saveMany`, `softDelete`,
  `softDeleteByImportBatch`, `softDeleteByAccount`. **No `update`, no posting-level write path.** That absence
  is how **L10** (reconciled postings are immutable) is enforced structurally.
- `src/domain/transactions.ts:1018` — `Transaction.reverse()` returns a `Reversal` carrying flipped legs,
  with `fingerprint` and `externalId` nulled so the unique index does not reject it.
- `src/app/ledger.usecases.ts:486-513` — `ReverseTransaction`. Reversing a reversal is **blocked**
  (`:492`); a double reversal is blocked (`:495`); a future-dated reversal is **clamped to today** (`:503`).
- `src/app/banking.usecases.ts:1388-1410` — `UndoImport` tombstones the batch and sets status `UNDONE`,
  freeing the file hash so a corrected re-import is not blocked by I02.
- `src/app/trade-corrections.usecases.ts:86-96, 409-421` — `TradeVoidMode = "REVERSE" | "DELETE"`.
  *"A reversal says 'this happened and was recorded wrongly', a delete says 'this never happened'."*
  `CorrectTrade` = void + re-record, always `REVERSE`.
- `app/(root)/accounts/actions.ts:458-540` — the same distinction already shipped for bank transactions, plus
  a page-scoped `bulkDeleteTransactionsAction` capped at 500 and **deliberately non-atomic**.
- No existing architectural decision covers Edit/Undo/Redo as user-facing verbs. `_architecture` records only
  decision 9 ("nothing is hard-deleted; corrections are reversals") and A03. This section does not supersede
  anything; it extends it.

### Design decision 1 — three data classes

| Class | Meaning | Verbs compile to | Examples (with `src/infra/db/schema.ts` line) |
|---|---|---|---|
| **A — ledger** | Append-only with reversal | post / reverse / tombstone / restore | `transactions` 425, `postings` 486, `trades` 872, `lots` 928, `lot_matches` 969, `corporate_actions` 2062, `import_batches` 1771, `import_rows` 2107, `deposit_contributions` 1597, `instrument_incomes` 1252, `gold_leases` 1109 (postings only) |
| **B — reference** | Ordinary mutable data | `UPDATE` in place + tombstone | `category_rules` 1315, `budgets` 1358, `instruments` 646, `deposit_terms` 1532, `loan_terms` 1693, `credit_card_terms` 1410, `nps_holdings` 1661, `loan_prepayments` 1741, `tax_settings` 1480, `institutions` 1920, `counterparties` 1967, `documents` 2138, plus **saved views** and the planned **insurance / subscription / income-stream** records (no tables yet) |
| **C — system** | No user verbs at all | refetch / override / rebuild / nothing | `price_quotes` 1011, `fx_rates` 2005, `price_bars` 1209, `audit_events` 1843, `ledger_events` 1880, `tax_rules` 2310, `charge_rates` 2362, `cost_inflation_index` 2345, `market_holidays` 2403, `txn_type_legality` 2284, `net_worth_snapshots` 1809, `projection_cache` 2175, `price_divergences` 2249 |

Straddling rule: a class B header (loan, deposit, lease) that *generates* postings stays class B; its postings
are class A. Editing the header is effective-dated and never retroactively rewrites posted entries.

### Design decision 2 — undo is tombstone/restore, never reverse-a-reversal

The central finding. Reversing a reversal is blocked because it makes the current state unreadable — but a
reversal is itself a row, and a row can be tombstoned.

- **Undo of an Edit** = tombstone the reversal *and* the replacement. The original returns to every balance.
- **Undo of a Remove** = clear `deletedAt`.
- **Undo of an import undo** = not a restore; it is a re-import (the hash was already freed).

This needs exactly **one new repository primitive: `restore(userId, id)`**, the inverse of `softDelete`. No new
accounting concept, no weakening of append-only, no new table for the ledger side.

### Design decision 3 — the batch identity already exists

`audit_events.request_id` (schema.ts:1843, *"groups every event from one request, so a multi-aggregate change
is one story"*) and `ledger_events.request_id` (1880) are the undo unit. **One mutation batch = one
`request_id`.** One row edited, fifteen removed, a whole import undone — all the same unit.

The two genuinely missing pieces for the whole model are therefore: `restore()`, and a user-facing **Activity**
surface reading `audit_events`.

### Design decision 4 — redo

Undo is a *query* over durable state and needs no memory. Redo needs memory — but `audit_events` already stores
`beforeJson` and `afterJson`, so a redo is representable today.

**Recommendation: redo exists, but for class A it is a one-step cursor, not a stack** — session-scoped,
user-scoped, and invalidated the moment any newer mutation touches an entity in the undone batch. For class B
it is an ordinary bounded stack (depth 20, per user), because the data is mutable by design.

Rejected: a true multi-step ledger redo stack. It needs a command log the app does not have, and every entry
is a promise to re-run an operation whose preconditions may no longer hold — a second source of truth beside
the ledger, which is what `00-INDEX.md` decisions 9 and 10 exist to prevent.

### Design decision 5 — "remove all"

Always scoped to the **current filter**, resolved **server-side at confirm time** (not from the rendered id
list — today's `bulkDeleteTransactionsAction` takes a comma-joined id string, which is right for a visible
multi-select and wrong for "all 1,240 rows this filter matches"). Confirmation pattern:

1. Restate the scope as the literal filter chips.
2. Preview exact **count**, **net amount**, **date range touched**, and **protected rows that will stay**.
3. **Typed phrase carrying the count** — `remove 1240 rows` — so a phrase memorised from last time cannot be
   typed blind against a different scope.
4. Quiet danger styling (`btn-danger-quiet` in the footer bar, far from any primary action), never the default.
5. One `request_id`, one undo, plus a session-persistent banner above the now-empty table.
6. Refused outright on an unfiltered table.

### Design decision 6 — bulk atomicity

**A filter-scoped bulk mutation is atomic**, matching `saveMany`'s existing contract (*"an import either lands
or does not"*, transactions.ts:2584). "12 of 15 succeeded" is therefore not a state this design produces; the
user sees **"Nothing was removed"**, the blocking rows named with reasons, and **Retry without them** as a new
batch. This contradicts today's deliberately non-atomic `bulkDeleteTransactionsAction` and needs the user's
confirmation.

A mixed selection (reversible + non-reversible) is not an error: the toolbar counts only what it can act on,
the dialog lists what it will skip and why, and skipped rows stay selected afterwards.

### Design decision 7 — affordances

One place per verb per context. Row hover reveals **only a kebab** (never bare destructive icons); the kebab
holds the single-row verbs including the **disabled entries with their reasons inline**; the selection toolbar
holds bulk verbs and appears only when something is selected; the table footer bar holds Undo, Redo and Remove
all because their scope is the filter; the `cmdk` palette (installed, unwired) exposes every verb with its
scope spelled out in the item and **never skips the confirm dialog**.

Keyboard: `↑ ↓` cursor, `Space` select, `Ctrl+A` select-all-in-filter, `E` edit, `Del` opens the confirm (never
fires directly), `Ctrl+Z` undo, `Ctrl+Y` / `Ctrl+Shift+Z` redo, `Esc` clears selection → closes menu → closes
dialog. **Hard guard: the global handler returns immediately when `document.activeElement` is an input,
textarea, select or contenteditable, or when a dialog is open.** Inside the edit dialog Ctrl+Z is the browser's
text undo and nothing else.

### Design decision 8 — feedback has three layers

1. **In place** — optimistic row update; a refusal reverts the row and shows the error *on the row*.
2. **Toast, 12 s** — count, amount, one Undo, visible drain, paused on hover/focus. Navigating away loses
   nothing because the action already committed; **no action is ever "pending until the toast expires"**.
3. **Activity, 30 days** — reads `audit_events`. The durable path. A toast is a shortcut into it, never the
   only route.

Retention: undo of a tombstone is available while the tombstone survives (**30 days proposed**); undo of a
correction is available indefinitely, because it only tombstones the reversal pair.

### "Not permitted" is a first-class state

Show the control, disable it, say why. Never hide it, never let the click fail. The four real cases:
reconciled postings (L10), an already-reversed transaction, a row that *is* a reversal, and an `UNDONE` import.
Trade voids add four more refusals, each already implemented and each worth surfacing verbatim
(`trade-corrections.usecases.ts:18-46`).

### Marked NEW in the artifact (the repo cannot do these today)

`restore()` on `TransactionRepository` · the **Activity** surface · ledger **Edit** as one action (only
`CorrectTrade` exists, for trades) · **Redo** anywhere · filter-scoped **Remove all** · the command palette
wiring · saved-views storage.

### Decisions the user must make

1. Is a filter-scoped bulk mutation atomic? (Contradicts today's `bulkDeleteTransactionsAction`.)
2. Does redo exist for ledger data at all, or class B only?
3. Tombstone retention — 30 days?
4. Does editing a class B header offer to restate the postings already made from it?
5. Typed phrase vs. count-match for "remove all"?
6. Does "remove all" require a filter? (Recommended: yes.)
7. Saved-views storage table (already carried forward above).
8. Does the command palette get the destructive verbs, or only navigational ones?

### Not verified

No browser preview tool was available, so the artifact was not inspected by eye; `node --check` passed on its
script. Contrast ratios were not measured numerically — the Control Bench token set was lifted unchanged and is
relied on for WCAG 2.2 conformance. The `src/domain` and `src/app` citations were read directly; the 47-table
taxonomy was built from `sqliteTable` declarations in `src/infra/db/schema.ts` and each entity's class was
assigned from its doc comment and its use sites, not from an exhaustive read of every table body.

---

## Visual elevation pass (2026-10-23)

Lane: **Experiment** (non-production mockup). Owner: design agent. Answers the owner's second
verdict on the v2 surface — *"the UI is looking very basic — can it be more classy?"*

**Artifact:** https://claude.ai/artifact/52M35wom7TZS284Quai8RM — four screens (Dashboard,
Holdings, Register, What changed) with a **Before / After toggle**. Before and After share one
set of markup, one data set and one token set; every difference is a custom property on a single
`.stage` element, so the flip isolates exactly which decisions changed and nothing else.

### Diagnosis — the deficit is the composition layer, not the components

The first verdict was answered by rebuilding the component layer (the Control Bench), and that
was the correct fix for what was then wrong. The verdict returned because the **composition
layer was never touched**: the Wave 1 refit replaced tokens and components but kept the scales,
the spacing and the chrome uniformity. Better buttons arranged flatly still read flat.

Evidence, read out of the Institutional Shell's own stylesheet rather than inferred:

| Channel | Measured from the shipped CSS |
|---|---|
| **Type** | **Thirteen distinct sizes, ten of them between 9px and 15px** — 9, 10, 10.5, 11, 11.5, 12, 12.5, 13, 14, 15 — then a jump to 22 / 24 / 30. Ten near-identical steps cannot express rank. |
| **Figures** | `code,.mono{font-size:11.5px}` pins IBM Plex Mono at 11.5px, so the mono face carries only chrome (badges, keycaps, annotations) and **every real number is set in Inter**. Backwards for a finance product. |
| **Hero** | The largest figure is 30px against a 13px body — a ratio of **2.3x** — and it sits inside a bordered, rounded panel identical to every other panel, so the most important number on the screen is shaped like a form field. |
| **Space** | Every container pads 9–18px (panel 14, panel header 11/14, KPI 12/14, toolbar 9/14, page gap 18). One interval repeated; no rhythm. |
| **Surfaces** | Five border strengths are defined; two are used structurally (`--border` on every box, `--border-subtle` on every divider). The hierarchy channel exists and is not spent. |

The hypothesis that surfaces "read flat because borders-only is flat" is **rejected**. Borders
are sufficient; the system simply applies one strength everywhere.

### The four moves

1. **Figures move to IBM Plex Mono with room to breathe.** Every number is mono with
   `tabular-nums slashed-zero`; the rupee glyph and the `L` / `Cr` unit drop to `0.46em` /
   `0.40em` in `--fg-muted`, so the digits carry the weight. Inter becomes chrome. No new font —
   the division of labour between the two faces was the defect, not the faces.
2. **Type scale collapses from thirteen sizes to six** — 11 / 13 / 20 in Inter, 13 / 22 / 52 in
   Plex Mono. Hero-to-body ratio goes **2.3x → 4.0x**.
3. **Spacing becomes 4 / 8 / 16 / 24 / 40, with the large intervals used.** Section gap
   18px → 40px; panel padding 14px → 20/24px; intra-group spacing stays tight. Table row
   32px → 34px, and no further — ledger density is correct and is not the problem.
4. **Border strength is spent as three ranks.** Rank 1, the net-worth figure: no panel at all,
   on the canvas, with a 34x2px `--accent` tick (the page's one signature mark). Rank 2, the KPI
   strip: no box, a single `--border-control` top rule. Rank 3, tables: the full bordered box.

Two smaller moves: the withheld em-dash gains a 9.5px mono reason caption on the row
(`NO FX RATE`, `NO QUOTE`) so the house rule reads as a decision rather than a load failure; and
colour contracts — the `Priced` badge is dropped from the ten rows that are normal, register
amounts lose green/red because `+` and U+2212 already carry direction, and day change uses
up/down triangles in muted ink, which also removes a colour-alone encoding.

### Token and scale changes, with measured contrast

**No new colour is introduced.** The four measured token corrections of 2026-10-20 are carried
unmodified, and every pair the direction relies on was recomputed from hex with a WCAG 2.x
relative-luminance script:

| Pair | Light | Dark | Floor |
|---|---|---|---|
| Hero figure `--fg` on `--bg-canvas` | **16.77:1** | **17.94:1** | 4.5:1 pass |
| Currency / unit glyph `--fg-muted` on `--bg-canvas` | **4.74:1** | **6.51:1** | 4.5:1 pass |
| `--fg-secondary` on `--bg-canvas` | **7.26:1** | **10.59:1** | 4.5:1 pass |
| `--gain` on `--bg-canvas` | **4.82:1** | **9.20:1** | 4.5:1 pass |
| `--loss` on `--bg-canvas` | **5.11:1** | **7.50:1** | 4.5:1 pass |
| `--accent` on `--bg-canvas` | **4.85:1** | **6.19:1** | 4.5:1 pass |
| **KPI top rule `--border-control` vs `--bg-canvas`** *(new use)* | **3.21:1** | **3.78:1** | 3:1 pass |

The one genuinely new application is `--border-control` as a **structural rule on the canvas**,
not only as a control boundary. It clears the 3:1 non-text floor on both grounds, so the rule is
load-bearing rather than decorative. Nothing in this pass gets fainter; moving the hero and the
KPI strip off panels in fact *reduces* reliance on the sub-3:1 decorative hairlines
(`--border` measures 1.30:1 light / 1.71:1 dark against the canvas), which remain exempt as pure
separators and are unchanged.

### `DESIGN.md` rules superseded

- **§1.1 "type scale … unchanged"** is superseded for composition surfaces: six sizes, listed
  above, replace the thirteen in use. The component layer's own sizes inside controls are
  unaffected.
- **§2 craft rules are all retained.** None is superseded. The pass adds two:
  - *Figures take the mono face; the UI face is chrome.* The currency symbol and the L/Cr unit
    are set at roughly 0.45em in `--fg-muted` so the digits lead.
  - *Border strength is a hierarchy channel, spent in three ranks* — no chrome for the page's
    single hero figure, one rule for the KPI strip, a full box for tables.
- **§4 numbers on screen** is extended, not changed: the em-dash now carries its reason as a
  visible mono caption on the row as well as in the `title` and via `tabindex="0"`.
- **Borders over shadows (§1), Inter + IBM Plex Mono (§1), the neutral ramp, the accent, the
  gain/loss pair, the chart ramp, the state vocabulary, the icon set, the keyboard model and the
  32px-based row density are all explicitly kept.** The deficit was never too little colour or
  too much density, and adding either would have made the verdict worse.

### Verified

Contrast ratios computed from hex with a relative-luminance script, not estimated. The page's
script parses (`node --check`). `money` / `compact` were run on sample inputs and return
`₹1,42,560`, `₹58,423.50`, `−₹4,350.00`, `₹14,18,156.70`, `₹12,84,185.50`, `+₹1,33,971.20`,
`₹48.72L`, `₹56.18L`, `₹7.46L`, `₹9.34L`, `₹1.61Cr`, `+₹9.22L` — en-IN grouping, U+2212, L/Cr
truncated toward zero. All totals on the page are derived from the §6 rows at render time rather
than hardcoded, so the ten priced rows sum to exactly ₹14,18,156.70 market value and
₹12,84,185.50 invested, the four allocation buckets sum to the same ₹14,18,156.70, and the
12-month attribution resolves from ₹38.40L to ₹48.72L (+₹9.22L contributions, +₹1.10L growth).

### Not verified

**No browser or screenshot tool was available; no frame of the artifact has been inspected by
eye.** Specifically unverified: the `clamp(40px, 7.2vw, 56px)` hero between roughly 420px and
760px wide; whether the nine-column holdings table crowds its headers at 10.5px with `.085em`
letter-spacing; how Plex Mono weight 500 reads at 52px on the dark canvas, where mono faces
commonly look heavier than intended; and whether the 9.5px withheld-reason caption is legible in
practice rather than merely contrast-compliant. The Control Bench artifact was not re-read in
full in this pass — the diagnosis was taken from the Institutional Shell, which is the surface
the verdict was given on.

### Open decision for the owner

This is a direction, not a refit. If it is accepted, the other six v2 artifacts need the same
composition pass, and Banking Console still needs its token refit first (`DESIGN.md` §1.3).

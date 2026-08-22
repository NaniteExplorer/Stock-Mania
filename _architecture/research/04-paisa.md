# Dossier 04 — Paisa

> Source: `paisa/` @ commit `1a89224` (2026-08-16). ~31,950 LOC (12.3K TS, 10.0K Go, 9.0K Svelte).
> Go (Gin) backend + SvelteKit frontend, embedded via `embed.FS` into a single binary.
> Wraps `ledger` / `hledger` / `beancount` CLIs over a plain-text journal, caching into SQLite via GORM.

## 1. Positioning

Paisa is the **only one of the four repos that genuinely models investments**. It is a thin,
opinionated analytics layer over plain-text accounting: the journal file is the source of truth, and
Paisa materialises it into SQLite for querying, then computes portfolio analytics, capital-gains tax,
allocation drift, and retirement projections on top.

It is India-specific in its *defaults* (INR, April fiscal year, CII indexation, NPS, AMFI), but the
*mechanisms* — commodity-typed holdings, pluggable price providers, FIFO lot matching, tax-category-driven
gain classification — are exactly the abstractions we need, and they generalise.

**This repo is the primary reference for the investment half of our system.**

---

## 2. The plain-text accounting core

### 2.1 Architecture

```
journal file (.ledger/.beancount)   <- source of truth, user-editable text
        |  shell out to `ledger` / `hledger` / `beancount` CLI
        v
   parsed postings
        |  GORM
        v
   SQLite cache (postings, prices, schemes, cii, ...)
        |  internal/query (DSL) -> internal/service -> internal/server (Gin)
        v
   SvelteKit UI
```

`internal/ledger/ledger.go` shells out and parses. `config.LedgerCli` selects the binary
(default `"ledger"`); `internal/binary/` discovers and validates it. Three separate Dockerfiles
(`Dockerfile.beancount`, `Dockerfile.hledger`, `Dockerfile.ledger`) exist because each CLI must be
installed separately.

**Trade-off.** Delegating parsing to a mature CLI gets you a battle-tested multi-commodity accounting
engine for free. The costs are severe for a product: a process fork per query, a hard external binary
dependency, output-format coupling (the code carries a comment referencing
`https://github.com/ledger/ledger/issues/2007` at `internal/ledger/ledger.go:591`), no write API,
and no concurrency story. **We take the data model, not the delegation.**

### 2.2 The Posting model

`internal/model/posting/posting.go` — this is the central record, and it is instructive because
**it carries both `Amount` and `Quantity`**:

| Field | Type | Meaning |
|---|---|---|
| `ID` | uint PK | Cache row id |
| `TransactionID` | string | Groups postings into a transaction |
| `Date` | time.Time | Posting date |
| `Payee` | string | Counterparty |
| `Account` | string | Full colon-delimited account path |
| `Commodity` | string | `INR`, `NIFTY`, `AAPL`, … |
| `Quantity` | decimal.Decimal | **Units of the commodity** (shares, grams, units) |
| `Amount` | decimal.Decimal | **Cost in the reporting currency** |
| `Status` | string | Cleared/pending marker |
| `TagRecurring`, `TagPeriod` | string | Recurrence tags parsed from the journal |
| `TransactionBeginLine`, `TransactionEndLine`, `FileName` | | Round-trip back to the source text — enables in-app editing |
| `Forecast` | bool | Synthetic future posting |
| `Note`, `TransactionNote` | string | |
| `MarketAmount` | decimal (not persisted) | `Quantity × current price` — computed at query time |
| `Balance` | decimal (not persisted) | Running balance — computed at query time |

**This `Quantity` + `Amount` + derived `MarketAmount` triple is the core insight the budgeting apps
lack.** Cost basis and market value are different numbers; unrealised gain is their difference. Actual
and Firefly have only one number and therefore cannot express it.

All money uses `github.com/shopspring/decimal` — arbitrary-precision decimal, no floats. Good.

### 2.3 Accounts are a naming convention, not a schema

There is no account table. Semantics come from colon-delimited prefixes, grepped from the codebase and
fixtures:

`Assets:Checking:*`, `Assets:Equity:*`, `Assets:Debt:*` (EPF, NPS, Chit), `Assets:House`,
`Assets:Unknown`, `Liabilities:*`, `Income:*`, `Expenses:*` (`Expenses:Interest:Homeloan`,
`Expenses:Rent`, `Expenses:Food`, `Expenses:Charges`, …), `Equity:*`.

**Trade-off.** Infinitely flexible and zero-migration — but unvalidated, untypeable, and prone to typos
that silently create a new account. Paisa mitigates with a `doctor` check and a `Strict` config flag.
**We use a real account table with a typed hierarchy**, and keep the readable path as a display concern.

### 2.4 Configuration is the public contract

`internal/config/config.go`. Top-level `Config` keys:

| Key | Default | Meaning |
|---|---|---|
| `journal_path` | — | Source journal |
| `db_path` | — | SQLite cache |
| `sheets_directory` | — | Spreadsheet files |
| `readonly` | `false` | Disable writes |
| `ledger_cli` | `"ledger"` | Which CLI backend |
| `default_currency` | `"INR"` | Reporting currency |
| `display_precision` | `0` | Display decimals |
| `amount_alignment_column` | `52` | Journal formatting |
| `locale` | `"en-IN"` | |
| `time_zone` | `""` | |
| `financial_year_starting_month` | `4` (April) | **Configurable fiscal year — essential** |
| `week_starting_day` | `0` | |
| `strict` | `no` | Reject unknown accounts/commodities |
| `budget.rollover` | `yes` | Envelope carryover |
| `commodities[]` | — | See §3 |
| `allocation_targets[]` | `{name, target, accounts[]}` | Target allocation percentages |
| `schedule_al[]` | `{code, accounts[]}` | India Schedule AL asset classification |
| `credit_cards[]` | `{account, credit_limit, statement_end_day, due_day, network, number, expiration_date}` | |
| `goals.retirement[]` | `{name, swr, expenses[], savings[], yearly_expenses, priority}` | **SWR-based FIRE modelling** |
| `goals.savings[]` | `{name, target, target_date, rate, payment_per_period, accounts[], priority}` | |
| `import_templates[]` | `{name, content}` | Handlebars import templates |
| `accounts[]`, `user_accounts[]` | | Icons; auth |

`financial_year_starting_month` and the `goals.retirement.swr` (safe withdrawal rate) modelling are
both features the other three repos lack entirely.

---

## 3. Commodities — the instrument model

`internal/config/config.go:32-40` and `internal/model/commodity/commodity.go`.

```go
type CommodityType string
const (
    MutualFund CommodityType = "mutualfund"
    NPS        CommodityType = "nps"
    Stock      CommodityType = "stock"
    Metal      CommodityType = "metal"
    Unknown    CommodityType = "unknown"
)

type Commodity struct {
    Name        string
    Type        CommodityType
    Price       Price            // { Provider, Code }
    Harvest     int              // days threshold for tax-harvest suggestions
    TaxCategory TaxCategoryType
}
```

Only **five** commodity types. Notably absent: bond, ETF (folded into stock), fixed deposit, PPF/EPF
(modelled as plain `Assets:Debt` accounts with manual interest postings), real estate (`Assets:House`,
untyped), crypto, options, futures, REIT. This is the main extension point for our design.

The `Price{Provider, Code}` pair is the clean part: an instrument declares *which provider* prices it
and *what identifier* that provider uses. That indirection is exactly right.

---

## 4. Investment analytics

### 4.1 XIRR — `internal/xirr/xirr.go`

Newton-Raphson on the standard NPV objective:

```go
func newtonXIRR(transactions []Transaction, initialGuess float64) (float64, bool) {
    x := initialGuess
    const MAX_TRIES = 100
    const EPSILON = 1.0e-6
    for tries := 0; tries < MAX_TRIES; tries++ {
        fxs, dfxs := 0.0, 0.0
        for _, tx := range transactions {
            fx  := tx.Amount / (math.Pow(1.0+x, tx.Years))
            dfx := (-tx.Years * tx.Amount) / (math.Pow(1.0+x, tx.Years+1))
            fxs += fx; dfxs += dfx
        }
        xNew := x - fxs/dfxs
        if math.IsNaN(xNew) { return 0, false }
        if math.Abs(xNew-x) <= EPSILON { return x, true }
        x = xNew
    }
    return 0, false
}
```

Fallback when Newton fails (`calculateXIRR`): sweep `guess` from `-0.99` upward in `0.01` steps,
retrying Newton at each, until one converges.

Time basis: `Years = daysBetween(firstCashflowDate, cfDate) / 365`, where `daysBetween` divides
millisecond difference by 86,400,000 — DST-safe because Go's `Sub` is absolute. Fixed 365-day year
(no ACT/365F leap handling).

Result: `decimal.NewFromFloat(rate * 100).Round(2)`.

**Three defects to fix in our implementation:**

1. **Silent zero on failure.** `calculateXIRR` logs `"XIRR didn't converge"` and returns `0`. A 0% return
   is indistinguishable from a genuine 0% return. This must be a typed error / null, never a number.
2. **The sweep caps at `+1.0`** (100%). If Newton fails from 0.1 and the true rate is above 100% —
   entirely normal for a young SIP or a small recent position — every guess in `[-0.99, 1.0)` is tried
   and it still may not converge, yielding a silent 0.
3. **Float64 internals** despite a decimal API. Acceptable for a rate (it is inherently iterative and
   approximate), but the tolerance should be relative, not absolute.

The test suite (`internal/xirr/xirr_test.go`) is a golden-file suite over CSV fixtures in
`internal/xirr/samples/` with hard-coded expected values including extremes (`random_100.csv` → 2982.94,
`30-3.csv` → 585.25). **This is exactly the right testing pattern to copy.**

### 4.2 FIFO lot matching — `internal/accounting/accounting.go:77`

Returns the **remaining open lots** after consuming sales against purchases in order:

```go
func FIFO(postings []posting.Posting) []posting.Posting {
    var available []posting.Posting
    for _, p := range postings {
        if utils.IsCurrency(p.Commodity) {
            if p.Amount.GreaterThan(decimal.Zero) { available = append(available, p) } else {
                amount := p.Amount.Neg()
                for amount.GreaterThan(decimal.Zero) && len(available) > 0 {
                    first := available[0]
                    if first.Amount.GreaterThan(amount) {
                        first.AddAmount(amount.Neg()); available[0] = first; amount = decimal.Zero
                    } else {
                        amount = amount.Sub(first.Amount); available = available[1:]
                    }
                }
            }
        } else { /* identical, but on p.Quantity */ }
    }
    return available
}
```

Two branches — currency positions consume by `Amount`, commodity positions by `Quantity`. Partial lot
consumption mutates the head in place; full consumption pops it. `CostBalance` then groups by account
and sums the surviving lots' `Amount` to get cost basis.

Clean and correct. Limitations: **FIFO only** — no LIFO, average cost, HIFO, or specific-identification,
all of which real tax regimes permit or require. And it is recomputed from the full posting history on
each call rather than maintained incrementally.

### 4.3 Capital gains and tax — `internal/taxation/tax.go`

Tax categories (`config.go:22-30`): `debt`, `equity`, `equity65`, `equity35`, `unlisted_equity`.
(`equity65`/`equity35` are hybrid funds classified by equity allocation percentage.)

Regime constants:

```go
EQUITY_GRANDFATHER_DATE         = 2018-02-01
DEBT_INDEXATION_REVOCATION_DATE = 2023-04-01
CII_START_DATE                  = 2001-03-31
ONE_YEAR, TWO_YEAR, THREE_YEAR
```

`Calculate()` applies, in order:

1. **Grandfathering** — for equity sold *before* 2018-02-01, gain is entirely exempt.
   For equity *bought* before that date, the cost basis is stepped up to the price on 2018-02-01
   (`service.GetUnitPrice(db, commodity.Name, EQUITY_GRANDFATHER_DATE)`).
2. **Indexation** — for `debt` held > 3 years (bought after CII start), and for `unlisted_equity`
   held > 2 years, the purchase price is inflated by the Cost Inflation Index ratio:

   ```
   indexedCost = purchasePrice × CII(FY(sellDate)) / CII(FY(purchaseDate))
   ```

3. **Rate application:**

   | Category | Long-term threshold | LTCG rate | STCG rate |
   |---|---|---|---|
   | `equity`, `equity65` | 1 year | 10% | 15% |
   | `debt` | 3 years *and* bought before 2023-04-01 | 20% (indexed) | slab |
   | `equity35` | 3 years | 20% | slab |
   | `unlisted_equity` | 2 years | 20% (indexed) | slab |

Returns `Tax{Gain, Taxable, Slab, LongTerm, ShortTerm}` — note **`Gain` and `Taxable` differ**
whenever grandfathering or indexation applies. Keeping both is the right call.

**The generalisable design:** an instrument declares a *tax category*; the tax category plus the
holding period plus the acquisition and disposal dates select a rule; the rule is date-versioned so
historical regimes stay correct. That structure survives any jurisdiction. **Adopt it, and make the
rule table data rather than a chain of `if` statements** — the current implementation hard-codes Indian
rates in Go and will need a code change every budget cycle.

### 4.4 Tax harvesting — `internal/server/harvest.go`

Uses `accounting.FIFO(postings)` to get open lots, then surfaces lots approaching the
long-term threshold, driven by the per-commodity `Harvest` day count from config.

### 4.5 Other analytics (`src/lib/`)

`networth.ts`, `gain.ts`, `investment.ts`, `portfolio.ts`, `allocation.ts` (targets and drift versus
`config.allocation_targets`), `cash_flow.ts`, `income_statement.ts`, `savings.ts`, `goals.ts`
(SWR-based retirement plus savings goals), `credit_cards.ts`, `liabilities/`, `repayment.ts`,
`harvest.ts`, `schedule_al.ts`, `recurring.ts` + `transaction_sequence.ts` (periodicity detection),
`doctor.ts` (validation checks), `sheet.ts` + `spreadsheet.ts` + `sheet/functions.ts` (a small formula
language exposing `cost`, `balance`, `fifo`, `negate` — see `src/lib/sheet/functions.ts:82`).

`internal/prediction/` drives forecasting; `internal/generator/config.go:497-498` shows the sheet
language in use:

```
cost_basis(x)          = cost(fifo(x AND date_query))
cost_basis_negative(x) = cost(fifo(negate(x AND date_query)))
```

---

## 5. Market data — the provider abstraction

### 5.1 The interface — our extensibility template

`internal/model/price/provider.go`:

```go
type PriceProvider interface {
    Code() string
    Label() string
    Description() string
    AutoCompleteFields() []AutoCompleteField
    AutoComplete(db *gorm.DB, field string, filter map[string]string) []AutoCompleteItem
    ClearCache(db *gorm.DB)
    GetPrices(code string, commodityName string) ([]*Price, error)
}
```

What is good: the provider is **self-describing** — it declares its own configuration fields
(`AutoCompleteFields`) and can populate them interactively (`AutoComplete`), so the UI for adding a new
instrument is generated from the provider rather than hard-coded. Cache invalidation is part of the
contract.

What is missing for our purposes: no capability declaration (does it do intraday? historical bars?
corporate actions?), no rate-limit budget, no explicit staleness/as-of semantics, no health check, and
`GetPrices` returns the *entire* history rather than supporting an incremental range fetch.

### 5.2 Every upstream URL in the repo

Exhaustive grep of `internal/**/*.go` for `http(s)://`:

| Provider | Asset class | Endpoint |
|---|---|---|
| Yahoo Finance | Stocks, ETFs, indices | `https://query2.finance.yahoo.com/v8/finance/chart/{ticker}?interval=1d&range=50y` (`stock/yahoo.go:130`) |
| Alpha Vantage | Stocks | `https://www.alphavantage.co/query?function=TIME_SERIES_DAILY&symbol={t}&outputsize=full&apikey={k}` (`stock/alphavantage.go:99`) |
| Alpha Vantage | FX | `...function=FX_DAILY&from_symbol={c}&to_symbol={base}&outputsize=full&apikey={k}` (`:111`) |
| Alpha Vantage | Symbol search | `...function=SYMBOL_SEARCH&keywords={t}&apikey={k}` (`:166`) |
| MFAPI | Mutual fund NAV | `https://api.mfapi.in/mf/{schemeCode}` (`mutualfund/nav.go:20`) |
| AMFI | MF scheme master | `https://portal.amfiindia.com/DownloadSchemeData_Po.aspx?mf=0` (`mutualfund/scheme.go:13`) |
| finbodhi | MF portfolio | `https://mutualfund.finbodhi.com?default_format=JSON` (`mutualfund/portfolio.go:19`) |
| finbodhi | NPS scheme list | `https://nps.finbodhi.com/api/schemes.json` (`nps/scheme.go:15`) |
| finbodhi | NPS NAV | `https://nps.finbodhi.com/api/schemes/{code}/nav.json` (`nps/nav.go:19`) |
| finbodhi | Metals | `https://india.finbodhi.com/api/metal/{code}/price.json` (`metal/provider.go:54`) |
| finbodhi | Cost Inflation Index | `https://india.finbodhi.com/api/cii/v2.json` (`india/cii.go:15`) |

Alpha Vantage's own config help text admits the constraint (`alphavantage.go:193`):
*"Alpha Vantage provides free api key with 25 requests per day limit."*

### 5.3 The production risk this exposes

**Four of the eleven endpoints point at `finbodhi.com`** — a personal domain operated by the project
author. CII data, all metal prices, all NPS data, and MF portfolio holdings have a single point of
failure with no SLA, no versioning guarantee, and no fallback. `query2.finance.yahoo.com/v8` is an
*undocumented internal endpoint* that Yahoo has broken repeatedly and rate-limits by IP.

This is entirely reasonable for a self-hosted hobby project and **completely unacceptable for a
product**. It is the strongest argument in this whole analysis for:

- a provider interface with **declared capabilities and health**,
- **at least two providers per data need** with automatic failover,
- **our own normalised instrument master** so a provider swap does not invalidate user data,
- and **persisted historical prices** so a dead upstream degrades to stale rather than empty.

---

## 6. Platform

- Go + Gin (`internal/server/`), GORM over SQLite, SvelteKit frontend built and embedded with
  `embed.FS` into one binary. Desktop wrapper in `desktop/`.
- `internal/query/` is a small composable query DSL over the posting cache.
- The UI has a **search query language with a PEG grammar** (`src/lib/search/`,
  `search_query_editor.ts`) and a CodeMirror-based journal editor with ledger syntax highlighting
  (`src/lib/editor/`).
- Import via **Handlebars templates** (`internal/model/template/templates/`) with 11 shipped templates:
  HDFC Account Statement (+ XLS), ICICI Credit Card, IDFC First Credit Card PDF, SBI Account Statement,
  Kuvera Transactions, Consolidated Account Statement (CAS), National Pension Scheme,
  Annual Income Tax Statement 26AS, Paytm, Mint. PDF parsing via `src/lib/pdf.ts`.
- Build: Makefile, `flake.nix`, four Dockerfiles, `fly.toml`.

---

## 7. Judgement

### Adopt

1. **`Quantity` + `Amount` + derived `MarketAmount`** on every posting (§2.2) — the single most
   important idea in this repo.
2. **`decimal.Decimal` (arbitrary precision) for quantities**, never floats (§2.2).
3. **`Commodity{Type, Price{Provider, Code}, TaxCategory}`** — instrument declares its pricing source
   and its tax treatment (§3).
4. **The self-describing `PriceProvider` interface** (§5.1), extended with capabilities, rate limits,
   health, and incremental range fetch.
5. **Date-versioned tax rules keyed by tax category + holding period** (§4.3), including keeping
   `Gain` and `Taxable` as separate outputs.
6. **FIFO as a lot-consumption queue** (§4.2) — generalised to LIFO/AVG/HIFO/SPEC-ID.
7. **Golden-file numeric test suites** for XIRR and friends (§4.1).
8. **`financial_year_starting_month`** and SWR-based retirement goals (§2.4).
9. **Import templates as data**, with a real template language (§6).

### Reject

1. **Shelling out to a CLI** (§2.1) — fork-per-query, external binary, no write path.
2. **Accounts as an unvalidated naming convention** (§2.3) — use a typed account table.
3. **Silent `0` on XIRR non-convergence, and the `+1.0` sweep ceiling** (§4.1) — genuine correctness bugs.
4. **FIFO-only cost basis** (§4.2).
5. **Hard-coded tax rates in Go** (§4.3) — must be data.
6. **Single-source, unofficial, personally-operated data endpoints** (§5.3).
7. **Only five commodity types** (§3) — nowhere near enough coverage.

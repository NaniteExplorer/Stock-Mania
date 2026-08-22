# Dossier 06 — Unified taxonomy across all four repos

> Cross-repo synthesis. Legend: **✅** first-class (typed, enforced, priced) · **◐** partial
> (representable by convention or workaround) · **✖** absent.
> Sources: Dossiers 01–05.

This document answers task #2: *every* distinct financial concept the four codebases support, deduplicated
and evidenced. It is the coverage checklist the new system must meet or consciously exclude.

---

## 1. Account types

| Concept | Actual | Firefly III | Paisa | myFinance | Evidence / notes |
|---|---|---|---|---|---|
| Asset account (bank/checking) | ✅ | ✅ `Asset account` | ◐ `Assets:Checking:*` | ◐ | Firefly `AccountTypeEnum.php` |
| Savings account | ◐ | ✅ role `savingAsset` | ◐ | ◐ | Firefly stores role in `account_meta` |
| Shared/joint account | ✖ | ✅ role `sharedAsset` | ✖ | ✖ | |
| Cash (physical) | ◐ | ✅ `Cash account` | ◐ | ✖ | |
| Credit card | ◐ `balance_limit` only | ✅ role `ccAsset` + `ccType`, `ccMonthlyPaymentDate` | ✅ `config.credit_cards[]` | ◐ | Paisa has limit, statement day, due day, network |
| Expense account (merchant) | ✖ (payee only) | ✅ `Expense account` | ◐ `Expenses:*` | ✖ | Firefly makes the counterparty a real account |
| Revenue account (employer) | ✖ (payee only) | ✅ `Revenue account` | ◐ `Income:*` | ✖ | |
| Loan | ✖ | ✅ `Loan` | ◐ | ◐ `mypf_loans` | |
| Debt (generic) | ✖ | ✅ `Debt` | ◐ | ✖ | |
| Mortgage | ✖ | ✅ `Mortgage` | ◐ | ◐ | |
| Initial-balance pseudo-account | ✖ (flag on txn) | ✅ `Initial balance account` | ◐ `Equity:*` | ✖ | Actual uses `starting_balance_flag` |
| Liability-credit pseudo-account | ✖ | ✅ `Liability credit account` | ✖ | ✖ | Opposing leg when a liability increases |
| Reconciliation pseudo-account | ✖ (flag) | ✅ `Reconciliation account` | ✖ | ✖ | |
| Import staging account | ✖ | ✅ `Import account` | ✖ | ✖ | |
| On-budget / off-budget split | ✅ `offbudget` | ◐ | ✖ | ✖ | Actual's core distinction |
| Account closure | ✅ `closed` | ✅ | ✖ | ✖ | |

**Master list (14 + 2 modifiers):** ASSET, SAVINGS, SHARED, CASH, CREDIT_CARD, EXPENSE, REVENUE, LOAN,
DEBT, MORTGAGE, INITIAL_BALANCE, LIABILITY_CREDIT, RECONCILIATION, IMPORT; modifiers ON_BUDGET/OFF_BUDGET,
OPEN/CLOSED.

---

## 2. Asset classes and instrument types

| Asset class | Actual | Firefly | Paisa | myFinance | How priced (best available) |
|---|---|---|---|---|---|
| Listed equity (stock) | ✖ | ✖ | ✅ `stock` | ✅ | Yahoo `v8/finance/chart`, Alpha Vantage, Finnhub |
| ETF | ✖ | ✖ | ◐ (as `stock`) | ◐ | Same as equity |
| Index (benchmark) | ✖ | ✖ | ◐ | ✅ `mypf_nifty_*` | NSE `/api/allIndices` |
| Mutual fund | ✖ | ✖ | ✅ `mutualfund` | ✅ | MFAPI `api.mfapi.in/mf/{code}`, AMFI master |
| NPS | ✖ | ✖ | ✅ `nps` | ✖ | finbodhi NPS NAV |
| EPF / PPF | ✖ | ✖ | ◐ `Assets:Debt:EPF` | ✖ | Manual interest postings |
| Fixed deposit | ✖ | ✖ | ✖ | ✅ `mypf_fds` | Computed from rate + tenure |
| Recurring deposit | ✖ | ✖ | ✖ | ✅ `mypf_rds` | Computed |
| Post-office schemes | ✖ | ✖ | ✖ | ✅ `mypf_po` | Computed |
| Bond / debenture / G-sec | ✖ | ✖ | ◐ (`debt` tax cat only) | ✖ | **Nobody models these** |
| Sovereign gold bond | ✖ | ✖ | ✖ | ✅ `mypf_sgb` | IBJA + coupon |
| Physical gold/silver | ✖ | ✖ | ◐ `metal` | ✅ + duty/GST | IBJA, finbodhi metals |
| Digital gold | ✖ | ✖ | ◐ | ◐ | |
| Commodity | ✖ | ✖ | ◐ `metal` only | ✖ | |
| Crypto | ✖ | ◐ (currency, 12dp) | ✖ | ✖ | **Nobody models these** |
| Real estate | ✖ | ✖ | ◐ `Assets:House` | ✅ `mypf_realty` | Manual valuation |
| REIT / InvIT | ✖ | ✖ | ◐ | ✖ | |
| Insurance (as asset) | ✖ | ✖ | ✖ | ✅ `mypf_insurance` | Surrender value |
| Options | ✖ | ✖ | ✖ | ✖ | **Nobody** — required for quant phase |
| Futures | ✖ | ✖ | ✖ | ✖ | **Nobody** — required for quant phase |
| Foreign currency | ◐ | ✅ | ✅ | ◐ | Firefly `transaction_currencies` |
| Chit fund | ✖ | ✖ | ◐ `Assets:Debt:Chit` | ✖ | |

**Paisa's typed set is only 5:** `mutualfund`, `nps`, `stock`, `metal`, `unknown`
(`internal/config/config.go:32-40`). Everything else above is either untyped convention or absent.

**Master list (22):** EQUITY, ETF, INDEX, MUTUAL_FUND, NPS, EPF, PPF, FIXED_DEPOSIT, RECURRING_DEPOSIT,
POST_OFFICE_SCHEME, BOND, GOVT_SECURITY, SOVEREIGN_GOLD_BOND, PHYSICAL_METAL, DIGITAL_GOLD, COMMODITY,
CRYPTO, REAL_ESTATE, REIT, INSURANCE, OPTION, FUTURE, FX, CHIT_FUND.

---

## 3. Liabilities and loans

| Concept | Actual | Firefly | Paisa | myFinance |
|---|---|---|---|---|
| Loan / debt / mortgage as typed account | ✖ | ✅ 3 types | ◐ | ◐ |
| Interest rate stored | ✖ | ✅ `interest` 0–100 | ◐ | ✅ |
| Interest period | ✖ | ✅ `daily`/`monthly`/`yearly` | ✖ | ◐ |
| Direction (owed by/to you) | ✖ | ✅ `credit`/`debit` | ✖ | ✖ |
| Liability increase as a transaction type | ✖ | ✅ `Liability credit` | ✖ | ✖ |
| Amortisation schedule | ✖ | ✖ | ◐ `repayment.ts` | ✖ |
| EMI calculation | ✖ | ✖ | ◐ | ◐ |
| Payoff strategy (avalanche/snowball) | ✖ | ✖ | ✖ | ✖ |
| Credit limit / utilisation | ◐ | ✅ | ✅ | ◐ |
| Statement cycle + due date | ✖ | ✅ `ccMonthlyPaymentDate` | ✅ `statement_end_day`, `due_day` | ✖ |

**Nobody models a real amortisation schedule.** Firefly stores a rate and a period but never
computes principal/interest split, remaining term, or payoff projections
(`app/Api/V1/Requests/Models/Account/UpdateRequest.php:113-114`).

**Master list (9):** MORTGAGE, HOME_LOAN, PERSONAL_LOAN, AUTO_LOAN, STUDENT_LOAN, CREDIT_CARD,
OVERDRAFT, BNPL, PERSONAL_DEBT (bidirectional).

---

## 4. Transaction types

| Type | Actual | Firefly | Paisa | myFinance |
|---|---|---|---|---|
| Withdrawal / expense | ✅ | ✅ `Withdrawal` | ✅ | ✅ |
| Deposit / income | ✅ | ✅ `Deposit` | ✅ | ✅ |
| Transfer | ✅ `transferred_id` | ✅ `Transfer` | ✅ | ✖ |
| Opening balance | ◐ flag | ✅ `Opening balance` | ✅ | ✖ |
| Reconciliation adjustment | ◐ flag | ✅ `Reconciliation` | ✖ | ✖ |
| Liability credit | ✖ | ✅ `Liability credit` | ✖ | ✖ |
| Split transaction | ✅ parent/child | ✅ multi-journal group | ✅ multi-posting | ✖ |
| Buy (acquire units) | ✖ | ✖ | ✅ | ✅ |
| Sell (dispose units) | ✖ | ✖ | ✅ | ✅ |
| Dividend | ✖ | ✖ | ◐ | ◐ |
| Interest received/paid | ◐ | ◐ | ✅ `Expenses:Interest:*` | ✅ |
| Stock split / bonus / merger | ✖ | ✖ | ✖ | ✖ |
| Fee / charge | ◐ | ◐ | ✅ `Expenses:Charges` | ◐ |
| Tax / TDS | ✖ | ◐ | ✅ | ◐ |
| Refund / reimbursement | ◐ | ◐ | ◐ | ✖ |
| Forecast / projected | ✖ | ◐ recurrence | ✅ `Posting.Forecast` | ✖ |

**No repo models corporate actions.** A 1:5 split, a bonus issue, a merger, or a rights issue would
silently corrupt cost basis and historical charts in all four.

**Master list (18):** WITHDRAWAL, DEPOSIT, TRANSFER, OPENING_BALANCE, RECONCILIATION, LIABILITY_CREDIT,
BUY, SELL, DIVIDEND, INTEREST, FEE, TAX, REFUND, SPLIT_ADJUST, BONUS, MERGER, RIGHTS, FX_CONVERSION.

---

## 5. Budgeting and planning

| Concept | Actual | Firefly | Paisa | myFinance |
|---|---|---|---|---|
| Category / category group | ✅ | ✅ | ◐ account tree | ✅ |
| Envelope (zero-sum) budgeting | ✅ `envelope.ts` | ✖ | ◐ | ✖ |
| Tracking/report budget | ✅ `tracking.ts` | ✅ | ✅ | ✅ |
| Rollover / carryover of surplus | ✅ `leftover_pos` | ✅ auto-budget `rollover` | ✅ `budget.rollover` | ◐ |
| Overspend absorption | ✅ `last_month_overspent` | ◐ | ✖ | ✖ |
| Budget limits per period | ✅ | ✅ `budget_limits` | ✅ | ✅ |
| Available budget (total pot) | ✅ `to-budget` | ✅ `available_budgets` | ✖ | ✖ |
| Auto-budget (reset/rollover/adjusted) | ✖ | ✅ `AutoBudgetType` | ✖ | ✖ |
| Declarative budget template DSL | ✅ **10 directives** | ✖ | ✖ | ✖ |
| Priority-ordered funding | ✅ `#template-N` | ✖ | ✖ | ✖ |
| Piggy bank / sinking fund | ◐ | ✅ + repetitions + events | ✖ | ✖ |
| Savings goal | ✅ goal targets | ✅ | ✅ `goals.savings[]` | ◐ |
| Retirement goal (SWR) | ✖ | ✖ | ✅ `goals.retirement[].swr` | ✅ `mypf_retirement` |
| Bill / subscription tracking | ✅ schedules | ✅ `bills` + matching | ◐ | ✖ |
| Recurring transactions | ✅ schedules | ✅ `recurrences` | ✅ tags + detection | ✅ SIP plans |
| Allocation targets + drift | ✖ | ✖ | ✅ `allocation_targets[]` | ◐ |

Actual's 10 template directives (`goal-template.pegjs`): `simple`, `by`, `spend`, `periodic`,
`percentage`, `schedule`, `remainder`, `average`, `copy`, `goal`.

---

## 6. Tax constructs

Essentially **Paisa only** (`internal/taxation/tax.go`, `internal/model/cii/cii.go`).

| Concept | Detail |
|---|---|
| Tax categories | `debt`, `equity`, `equity65`, `equity35`, `unlisted_equity` |
| Short vs long term | Equity 1yr · debt 3yr · equity35 3yr · unlisted equity 2yr |
| LTCG rates | Equity 10% · debt 20% (indexed) · equity35 20% · unlisted 20% |
| STCG | Equity 15% · others taxed at slab |
| Grandfathering | Equity bought before 2018-02-01 gets stepped-up basis; sold before that date is exempt |
| Indexation (CII) | `indexedCost = cost × CII(FY_sell) / CII(FY_buy)`; revoked for debt bought after 2023-04-01 |
| Cost basis method | FIFO only (`internal/accounting/accounting.go:77`) |
| Tax-loss/gain harvesting | ✅ `internal/server/harvest.go` + per-commodity `Harvest` day threshold |
| Schedule AL | ✅ `config.schedule_al[]` |
| Form 26AS import | ✅ Handlebars template |
| Fiscal year | ✅ `financial_year_starting_month` (default 4 = April) |

Missing everywhere: wash-sale rules, LIFO/AVG/HIFO/specific-ID, TDS reconciliation, advance-tax
projection, capital-loss carry-forward.

---

## 7. Analytics and metrics

| Metric | Actual | Firefly | Paisa | myFinance |
|---|---|---|---|---|
| Net worth | ◐ | ✅ | ✅ `networth.ts` | ✅ |
| Balance sheet | ✖ | ✅ | ✅ | ◐ |
| Income statement | ◐ | ✅ | ✅ `income_statement.ts` | ◐ |
| Cash flow | ◐ | ✅ | ✅ `cash_flow.ts` | ◐ |
| Savings rate | ✖ | ◐ | ✅ `savings.ts` | ◐ |
| Absolute return | ✖ | ✖ | ✅ `gain.ts` | ✅ |
| **XIRR** | ✖ | ✖ | ✅ Newton + sweep | ✅ |
| CAGR | ✖ | ✖ | ◐ | ◐ |
| TWR / Modified Dietz | ✖ | ✖ | ✖ | ✖ |
| Realised vs unrealised P&L | ✖ | ✖ | ✅ (FIFO + market) | ◐ |
| Cost basis | ✖ | ✖ | ✅ `CostBalance` | ◐ |
| Day change | ✖ | ✖ | ◐ | ✅ |
| Allocation + drift | ✖ | ✖ | ✅ `allocation.ts` | ◐ |
| Rebalancing trade list | ✖ | ✖ | ◐ | ✖ |
| Max drawdown | ✖ | ✖ | ✖ | ✖ |
| Volatility / Sharpe / Sortino | ✖ | ✖ | ✖ | ✖ |
| Beta / alpha / correlation | ✖ | ✖ | ✖ | ✖ |
| VaR | ✖ | ✖ | ✖ | ✖ |
| Credit utilisation | ✖ | ◐ | ✅ `credit_cards.ts` | ◐ |
| DTI ratio | ✖ | ✖ | ✖ | ✖ |
| Burn rate / runway | ✖ | ✖ | ◐ | ✖ |
| Forecast / prediction | ✖ | ◐ | ✅ `internal/prediction/` | ◐ |
| Benchmark comparison | ✖ | ✖ | ◐ | ✅ Nifty |

**Every risk metric is absent from all four repos.** Drawdown, volatility, Sharpe, Sortino, beta,
correlation, and VaR are the entire foundation of the future quant phase and must be built from scratch.

---

## 8. The four gaps that define our work

Consolidating the ✖ columns above, no repo in this workspace provides:

1. **Corporate actions.** Splits, bonuses, mergers, rights issues, and the retroactive lot/price
   adjustment they require. Without this, cost basis silently rots.
2. **Risk analytics.** Drawdown, volatility, Sharpe/Sortino, beta/alpha, correlation, VaR — the
   prerequisites for anything quantitative.
3. **Derivatives and fixed income.** Options, futures, bonds, and G-secs are unmodelled everywhere.
   Options need strike/expiry/greeks; bonds need coupon schedules, accrual, and YTM.
4. **Real loan mathematics.** Amortisation schedules, principal/interest split, payoff projection,
   refinance comparison, avalanche vs snowball.

Plus two cross-cutting weaknesses:

5. **Cost-basis methods beyond FIFO** (LIFO, average, HIFO, specific-ID).
6. **True time-weighted return** (Modified Dietz / daily-valuation TWR), needed to compare a portfolio
   against a benchmark independently of cashflow timing. XIRR alone cannot do this.

---

## 9. What to take from each repo

| Repo | The one thing to take |
|---|---|
| **Actual** | The **spreadsheet dependency graph** — incremental recomputation of derived values with correct invalidation on backdated edits. Plus the 3-pass import matcher and the goal-template DSL. |
| **Firefly III** | The **balanced-journal double-entry model** with pseudo-accounts for equity legs, and the **source→destination legality matrix** as configuration data. Plus rule triggers unified with the search DSL. |
| **Paisa** | The **`Quantity` + `Amount` + `MarketAmount` posting**, the self-describing `PriceProvider` interface, FIFO lot consumption, and date-versioned tax rules keyed by tax category. |
| **myFinance** | The **asset-class coverage checklist** for Indian retail, and the **broker adapter registry** for five brokers — the starting point for the quant phase. |

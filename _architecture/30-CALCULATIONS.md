# 30 — Calculations, Correctness, and Invariants

> Every number the system reports, specified precisely enough to implement and test.
> Where a source repo already solved it, the reference is cited; where it got it wrong, the defect is named.

---

## 1. Money and precision

### 1.1 The three numeric kinds

The single most consequential mistake available here is using one numeric type for everything. Firefly
uses `decimal(32,12)` for money, quantities, *and* FX rates (Dossier 03 §2.3) and leaks floats at the
boundaries. We separate three kinds:

| Kind | Storage | In-memory | Rounding |
|---|---|---|---|
| **Money** | `BIGINT` minor units + `CHAR(3)` currency | `Money { minor: bigint, currency: string }` | Explicit, at defined points only |
| **Quantity** | `NUMERIC(38,18)` | `Decimal` (decimal.js-light) | Never rounded; truncated only at `instruments.quantity_scale` on input |
| **Rate / ratio** | `NUMERIC(38,18)` | `Decimal` | Never rounded in intermediate steps |

Rates include FX rates, interest rates, percentages, and returns. A return is *not* money and must
never be stored as such.

### 1.2 The `Money` value object

```ts
class Money {
  private constructor(readonly minor: bigint, readonly currency: string) {}

  static of(minor: bigint, currency: string): Money;
  static fromDecimal(d: Decimal, currency: string): Money;   // scales by currencies.minor_unit

  plus(o: Money): Money;      // throws CurrencyMismatchError if currencies differ
  minus(o: Money): Money;
  negate(): Money;
  times(r: Decimal, rounding: RoundingMode): Money;          // rounding is REQUIRED, no default
  allocate(weights: Decimal[]): Money[];                     // see §1.4
  compare(o: Money): -1 | 0 | 1;
}
```

Design rules, each fixing an observed defect:

- **No arithmetic between different currencies.** Throws. Firefly permits it structurally.
- **`times()` requires an explicit rounding mode.** No default. Actual's implicit `Math.round`
  (Dossier 01 §3.1) is asymmetric for negatives: `Math.round(-0.5) === -0`, so a rounding error on a
  refund behaves differently from the same error on a charge. We use banker's rounding
  (`HALF_EVEN`) as the standard, with `HALF_UP` available where a tax authority mandates it.
- **`bigint`, not `number`.** Actual's `number` is exact to 2^53 and adequate, but `bigint` costs
  nothing here and removes the ceiling entirely.
- **No implicit conversion to `number`.** A lint rule (`no-restricted-syntax`) bans
  `Number(money.minor)` outside the formatting layer.

### 1.3 Float prohibition — mechanically enforced

Three layers, because documentation does not prevent this:

1. **Types.** `Money` and `Decimal` have no arithmetic operators; `money + money` is a TypeScript error.
2. **Lint.** A custom ESLint rule flags `parseFloat`, `Number(`, `+x`, `*`, `/` on any identifier whose
   inferred type is `Money`, and any `FLOAT`/`REAL`/`DOUBLE PRECISION` column in a migration.
3. **Schema test.** A CI test queries `information_schema.columns` and fails if any column matching
   `%amount%|%price%|%balance%|%cost%|%value%` has a floating-point type.

Paisa's Go code uses `shopspring/decimal` correctly for money — but drops to `float64` inside XIRR
(Dossier 04 §4.1). That is defensible for an iterative solver and indefensible anywhere else; the rule
above permits it only inside explicitly annotated numeric-method modules.

### 1.4 Allocation — the classic penny problem

Splitting 100.00 three ways cannot be done with division. `Money.allocate()` uses the **largest
remainder method**: integer-divide, then distribute the remainder one minor unit at a time in
descending fractional-remainder order.

```
allocate(10000, [1,1,1]) → [3334, 3333, 3333]   // sums exactly to 10000
```

**Invariant:** `sum(allocate(m, w)) === m`, always, for every input. Property-tested (§4.2). This is
required for split transactions, fee apportionment across lots, and tax allocation.

---

## 2. Portfolio valuation

### 2.1 Position

```
position(account, instrument, asOf)
  = Σ postings.quantity
    WHERE account_id = account AND instrument_id = instrument
      AND txn_date <= asOf AND deleted_at IS NULL
```

### 2.2 Market value

```
market_value(p, asOf) = position(p, asOf) × price(instrument, asOf, base_currency)
```

`price()` resolution order — explicit, because "no price today" is the normal case, not an error:

1. A quote for exactly `asOf` from the highest-priority healthy provider.
2. The most recent quote before `asOf`, **carried forward**, flagged `price_source_type =
   'CARRIED_FORWARD'` with a staleness age in days.
3. If staleness exceeds the per-asset-class threshold (equities 5 days, mutual funds 7, property 365),
   the value is returned **marked stale** and the UI must show it as such.
4. If no quote exists at all, market value is `null` — **never zero**. A missing price silently
   becoming a zero valuation is a catastrophic and easy bug.

Cross-currency: convert with the FX rate for the same `asOf`, resolved by the same ladder.

### 2.3 Cost basis

```
cost_basis(account, instrument, asOf) = Σ lots.remaining_quantity × (lots.cost_basis_minor / lots.original_quantity)
                                        for lots open as of asOf
```

Materialised in `lots` (`20-DOMAIN-MODEL.md` §3.7), not recomputed from postings on each call as Paisa
does (Dossier 04 §4.2).

### 2.4 Unrealised and realised P&L

```
unrealised_pnl = market_value(asOf) − cost_basis(asOf)
realised_pnl(period) = Σ lot_disposals.realised_gain_minor WHERE disposed_on IN period
total_return_amount = realised_pnl + unrealised_pnl + income_received
```

`income_received` is dividends and interest — omitting it is the most common portfolio-tracker error,
and it is what makes a dividend-heavy portfolio look worse than it is.

---

## 3. Cost-basis methods

Paisa implements FIFO only (Dossier 04 §4.2). All five are specified here.

Given a disposal of quantity `q` from a set of open lots:

| Method | Lot ordering |
|---|---|
| `FIFO` | `acquired_on ASC, id ASC` |
| `LIFO` | `acquired_on DESC, id DESC` |
| `HIFO` | `unit_cost DESC` (highest cost first — minimises gain) |
| `AVERAGE` | Single synthetic lot at the weighted-average unit cost |
| `SPECIFIC_ID` | Caller supplies explicit `lot_id → quantity` pairs |

**The consumption algorithm** (generalising Paisa's `internal/accounting/accounting.go:77`):

```
remaining := q
for lot in orderedLots:
    if remaining == 0: break
    take := min(lot.remaining_quantity, remaining)
    basis := Money.allocate(lot.cost_basis_minor,
                            [take, lot.original_quantity − take])[0]
    emit LotDisposal{ lot, take, basis,
                      proceeds: allocate(totalProceeds, byQuantity)[i],
                      gain_term: classify(lot.acquired_on, disposalDate, instrument.tax_category),
                      holding_days: disposalDate − lot.acquired_on }
    lot.remaining_quantity −= take
    remaining −= take
if remaining > 0: raise InsufficientQuantityError   // NEVER allow a negative position silently
```

Note `Money.allocate` for the basis split — integer division here is where cost basis leaks pennies.

**`AVERAGE` caveat:** many jurisdictions (and Indian mutual funds) require average cost, and it is
*path-dependent* — the average changes on every buy. It must be recomputed forward from the first
affected transaction whenever a backdated buy is inserted. This is the single strongest reason the
lot ledger is materialised and revision-keyed.

---

## 4. Return metrics

### 4.1 XIRR — with Paisa's three defects fixed

Solve for `r` in `Σᵢ cᵢ / (1+r)^(dᵢ/365) = 0`, where `cᵢ` is cashflow and `dᵢ` is days from the first
cashflow.

**Cashflow construction** (sign convention: outflows from the investor are negative):

- Every buy → negative; every sell → positive.
- Dividends and interest received → positive.
- **Terminal market value at `asOf` → positive**, as a synthetic final cashflow. Omitting this is the
  most common XIRR bug.

**Numeric method — a bracketed solver, not bare Newton:**

```
1. Verify a sign change exists: f(-0.9999) and f(+10.0) must differ in sign.
   If not, return XIRR_UNDEFINED (a typed result, never a number).
2. Bisection to bracket to within 1e-3.
3. Newton-Raphson from the bracket midpoint, max 100 iterations,
   relative tolerance 1e-9, clamped to stay inside the bracket.
4. If Newton escapes the bracket or stalls, fall back to Brent's method
   (scipy.optimize.brentq in the analytics service).
5. On failure: return XIRR_UNDEFINED with a reason. NEVER return 0.
```

The three defects being fixed, from Dossier 04 §4.1:

| Paisa defect | Fix |
|---|---|
| Returns `0` silently on non-convergence (`calculateXIRR`) | Typed `XIRR_UNDEFINED`; 0% and "could not compute" are different answers |
| Guess sweep caps at `+1.0`, so rates above 100% can fail | Bracket to `+10.0` (1000%); young SIPs routinely exceed 100% |
| Absolute tolerance `1e-6` on the rate | Relative tolerance `1e-9` on the NPV residual |

Also: use a 365-day year consistently (as Paisa does) and document it; ACT/365F is the convention for
retail reporting.

### 4.2 Time-weighted return — absent from all four repos

XIRR answers "what return did *I* achieve"; TWR answers "how did the *portfolio* perform,
independent of when I added money". Benchmark comparison requires TWR. **Both must be reported.**

**Modified Dietz** (per period, cheap):

```
MD = (EMV − BMV − CF) / (BMV + Σ (wᵢ × CFᵢ))
where wᵢ = (D − dᵢ) / D    -- fraction of the period the flow was invested
```

**True TWR** (daily valuation, correct):

```
TWR = Π over sub-periods ( (MVₑ − CFₑ) / MVₛ ) − 1
```

Sub-periods break at every external cashflow. Requires a daily valuation series — which is exactly what
the projection cache (`10-SYSTEM-ARCHITECTURE.md` §8) makes affordable.

### 4.3 The rest

| Metric | Formula | Notes |
|---|---|---|
| Absolute return | `(MV + realised + income − invested) / invested` | Paisa `src/lib/gain.ts` |
| CAGR | `(EV/BV)^(1/years) − 1` | Only meaningful with no interim flows |
| Day change | `Σ qty × (price_t − price_{t−1})` | `t−1` = previous *trading* day, not calendar day |
| Yield on cost | `annual_income / cost_basis` | |
| Dividend yield | `annual_dividend / current_price` | |
| Max drawdown | `min over t of (V_t − max_{s≤t} V_s) / max_{s≤t} V_s` | Absent from all four repos |
| Volatility | `stddev(daily returns) × √252` | 252 trading days |
| Sharpe | `(Rp − Rf) / σp` | `Rf` from a configured risk-free series, never hard-coded |
| Sortino | `(Rp − Rf) / σ_downside` | Downside deviation below MAR |
| Beta | `cov(Rp, Rb) / var(Rb)` | Needs a benchmark series |
| Alpha (Jensen) | `Rp − [Rf + β(Rb − Rf)]` | |
| VaR (historical) | 5th percentile of the daily return distribution | Prefer historical to parametric; returns are not normal |
| Allocation drift | `actual_weight − target_weight` | Paisa `src/lib/allocation.ts` |
| Rebalancing trades | Minimise `Σ|w_after − w_target|` subject to lot-level tax cost | Genuinely an optimisation, not a subtraction — `cvxpy` |

### 4.4 Personal-finance metrics

| Metric | Formula |
|---|---|
| Net worth | `Σ asset market values − Σ liability balances`, at `asOf` |
| Liquid net worth | Same, restricted to accounts flagged liquid |
| Savings rate | `(income − expenses) / income` over the period |
| Burn rate | Trailing 3-month mean of non-discretionary expenses |
| Runway | `liquid_net_worth / burn_rate`, in months |
| DTI | `monthly_debt_payments / monthly_gross_income` |
| Credit utilisation | `Σ card balances / Σ card limits` (Paisa `src/lib/credit_cards.ts`) |

### 4.5 In-kind income and the digital-gold module — implemented 2026-09

Digital gold earns income in **grams**, not rupees: a lease credits metal, and by the time it
reaches the holding it is indistinguishable from bought metal. That breaks the assumption
every §4.1 cashflow rule rests on, so the conventions are settled here rather than per caller.
Implemented in `src/app/gold-analytics.usecases.ts` and `src/app/gold-benchmark.usecases.ts`.

**Three conventions were tested against the real solver before one was chosen** (evidence:
`.agents/work/digital-gold-analytics/EXPERIMENT.md`):

| Convention | Treatment of a lease credit | Measured XIRR |
|---|---|---|
| **A — reinvested in kind** | Not a cashflow at all; surfaces in the terminal value | 15.2318% |
| **B — synthetic dividend + repurchase** | `+inflow` and an equal simultaneous `−outflow` at the credit-date rate | 15.2318% |
| **C — lease as separate business** | Excluded; terminal value covers bought grams only | 14.1338% |

`|A − B| = 0.000e+0` percentage points — **bit-identical, measured, not argued**. So:

- **A is the rate.** B costs 48 extra flows on a 30-month holding and changes nothing.
- **B is the ledger.** Its per-credit rupee valuation is the FY tax statement, and A ≡ B means
  the rate and the ledger can never disagree on screen.
- **C is the secondary split**, reported beside A. It sits strictly below A whenever a lease
  has credited anything.

**Valuation basis — the buy-back rate, never the benchmark.** Digital gold has two prices: you
buy at the vault rate plus GST and sell a few percent under IBJA. Valuing at the benchmark
shows a gain that selling could not realise. Measured overstatement: **3.99 pp of annualised
return** at a 2.5-year horizon, 5% spread, 3% GST. The drag is **horizon-dependent** — a
one-off cost amortised over an annualised rate — so no fixed figure may be quoted in code or
copy. `Institution.realisablePrice()` applies the discount once, at the boundary.

**Long-term eligibility.** `longTermDays` comes from the tax regime via the instrument's tax
category (`GOLD` = 730 days, 12.5%, no indexation post-23-Jul-2024), never a literal. The
boundary is **strictly greater**, matching `tax.ts:441/503`: day 730 is short-term,
`longTermOn = acquiredOn + threshold + 1`. A category with `longTermDays: null` renders "no
long-term treatment", which is not the same as "not yet eligible".

**Break-even gram rate** = `investedCost ÷ totalGrams` — the buy-back rate at which the holding
recovers cash paid. The benchmark equivalent is grossed up through the spread and
ceiling-rounded, so discounting it lands on or above break-even rather than a paisa below.

**GST is not derivable, and the schema is why.** `recordTrade` (`repositories.ts:3288`) writes
the entire charge total into `otherChargesMinor` — deliberately, because splitting it would
make STT appear deductible when it is not. `gstPaid` is therefore always `null`, carrying
`gstPaidReason`. **No 3% back-solve is permitted.** Deriving it needs a contract-note import
that populates `gstMinor`.

**Benchmark replay.** The user's dated rupee outflows are replayed into each alternative with
its own entry load and its own tax at the holding period each dated purchase implies, then
`xirr()` over those outflows plus the post-tax terminal inflow. Sales and lease credits are
excluded from **every** row including the actual holding, so all rows answer the same
question — which makes the actual row's XIRR a *different figure* from the holding page's
headline. That divergence is explained in a `basis` string the UI must render verbatim.
Gold-ETF tax composes two regime lookups — rate from `GOLD`, holding period from
`LISTED_EQUITY` (365 days) — rather than inventing a category; the composition is published on
`BenchmarkTaxTreatment` so it stays auditable.

**What the FY statement does and does not cover.** It reports lease income as Income from
Other Sources, valued at the credit-date buy-back rate, plus TDS withheld. It does **not**
report realised LTCG/STCG: no term-split realised figure exists on the analytics contract,
and deriving one in the view layer would put cost-basis arithmetic in a component. The
screen states the omission rather than showing a plausible wrong number. Adding it means
extending the use case with a term-split realised figure sourced from `disposalsWithin`,
not changing the UI.

**Lease TDS defaults to zero**, and the mechanism is retained rather than deleted, so a
platform that does withhold can still be modelled. §194A withholds on "interest", which
§2(28A) defines as payable on moneys borrowed or a debt incurred — arguably neither for a
gram-denominated fee on a bailment of metal. No CBDT circular, ruling or FAQ covers
gold-lease income, so the head of income is an assumption the product discloses rather than
asserts. Stored leases keep whatever rate they were opened with; the default is a fallback,
never a rewrite.

**Metrics deliberately not built here:** Sharpe, Sortino and alpha on a single non-diversified
asset at retail scale are unstable and were judged noise; candlesticks and technical indicators
do not apply to a holding that cannot be traded intraday.

---

---

## 5. Loan mathematics — absent from all four repos

Firefly stores a rate and a period and computes nothing (Dossier 03 §3; Dossier 06 §3).

**EMI (equal instalment):**

```
EMI = P × r × (1+r)^n / ((1+r)^n − 1)
where r = annual_rate / periods_per_year, n = total periods
```

**Amortisation schedule** — generated into `amortisation_schedule` at loan creation and regenerated on
any rate or prepayment change:

```
for k in 1..n:
    interest_k  = round(opening_balance_k × r)          # HALF_EVEN
    principal_k = EMI − interest_k
    closing_k   = opening_k − principal_k
# Final period: principal_n = opening_n, EMI_n = opening_n + interest_n
```

The final-period adjustment is mandatory — accumulated rounding otherwise leaves a few paise
outstanding forever.

**Payoff strategies:** avalanche (highest rate first) and snowball (smallest balance first), each
returning a month-by-month projection and total interest paid, so the two can be compared.

**Reducing-balance vs flat interest** must both be supported — flat-rate quoting is common in Indian
consumer lending and materially overstates the effective rate. Always display the effective annual
rate alongside.

---

## 6. Tax

Generalising Paisa (Dossier 04 §4.3), whose logic is correct but hard-coded in Go.

**Rules are data, not code:**

```sql
CREATE TABLE tax_rules (
  jurisdiction        TEXT NOT NULL,        -- 'IN', 'US', 'GB'
  tax_category        TEXT NOT NULL,        -- 'EQUITY', 'DEBT', 'UNLISTED_EQUITY', ...
  effective_from      DATE NOT NULL,
  effective_to        DATE,
  long_term_days      INTEGER NOT NULL,
  ltcg_rate           NUMERIC(6,4),
  stcg_rate           NUMERIC(6,4),         -- NULL = taxed at slab
  indexation_allowed  BOOLEAN NOT NULL DEFAULT false,
  grandfather_date    DATE,
  exemption_limit_minor BIGINT,
  PRIMARY KEY (jurisdiction, tax_category, effective_from)
);
```

Seeded from Paisa's constants, which become *rows*:

| Category | LT days | LTCG | STCG | Indexation | Grandfather |
|---|---|---|---|---|---|
| `EQUITY` | 365 | 10% | 15% | no | 2018-02-01 |
| `EQUITY65` | 365 | 10% | 15% | no | 2018-02-01 |
| `DEBT` (bought < 2023-04-01) | 1095 | 20% | slab | **yes** | — |
| `DEBT` (bought ≥ 2023-04-01) | — | — | slab | no | — |
| `EQUITY35` | 1095 | 20% | slab | no | — |
| `UNLISTED_EQUITY` | 730 | 20% | slab | **yes** | — |

**Evaluation order** (preserving Paisa's sequence):

1. If disposal predates `grandfather_date` → exempt.
2. If acquisition predates `grandfather_date` → step basis up to the price on that date.
3. If `indexation_allowed` and holding exceeds the threshold →
   `indexed_cost = cost × CII(FY(sell)) / CII(FY(buy))`.
4. Classify `SHORT_TERM` / `LONG_TERM` by `long_term_days`.
5. Apply the rate; `NULL` rate means slab.
6. Report **`gain` and `taxable` separately** — they differ whenever step 2 or 3 fired. Paisa gets
   this right and it matters.

Not yet in any repo, and required: wash-sale / bed-and-breakfasting rules, capital-loss
carry-forward, and set-off ordering.

---

## 7. Budget engine

Adopting Actual's formulas exactly (Dossier 01 §4.1), which are correct:

```
leftover[c,m]     = budgeted[c,m] + spent[c,m]
                    + (carryover[c,m−1] ? leftover[c,m−1] : leftover_pos[c,m−1])
leftover_pos[c,m] = max(0, leftover[c,m])
last_month_overspent[m] = Σ_c ( carryover[c,m−1] ? 0 : min(0, leftover[c,m−1]) )
to_budget[m] = available_funds[m] + last_month_overspent[m] + total_budgeted[m] − buffered[m]
```

Sign convention: `spent` is negative (an outflow posting).

The 10 template directives (`simple`, `by`, `spend`, `periodic`, `percentage`, `schedule`,
`remainder`, `average`, `copy`, `goal`) are reimplemented from Actual's Peggy grammar, with
priority-ordered funding and `remainder` last — but stored in a dedicated `budget_templates` column
rather than the notes field.

---

## 8. Invariant registry

Each invariant has an id, a severity (`BLOCK` = reject the write, `WARN` = flag), and an enforcement
mechanism. Mined from Firefly's 35 correction commands (Dossier 03 §7), Paisa's doctor, Actual's
validations, plus additions.

### Ledger

| Id | Invariant | Sev | Enforced by |
|---|---|---|---|
| L01 | Postings of a transaction sum to zero **per currency** | BLOCK | Deferred constraint trigger |
| L02 | Every transaction has ≥ 2 postings | BLOCK | Trigger |
| L03 | No posting has `amount_minor = 0` **and** `quantity = 0` | BLOCK | CHECK |
| L04 | `instrument_id`, `quantity`, `unit_cost` are coherently set | BLOCK | CHECK `commodity_coherent` |
| L05 | Posting currency matches its account currency, or the account is multi-currency | BLOCK | Trigger |
| L06 | `(txn_type, source_type, destination_type)` exists in `txn_type_legality` | BLOCK | Service layer |
| L07 | An `EXPENSE` account is never a source | BLOCK | L06 data |
| L08 | No posting references a soft-deleted account | BLOCK | Trigger |
| L09 | `external_id` is unique per tenant among live transactions | BLOCK | Partial unique index |
| L10 | Reconciled postings are immutable | BLOCK | Trigger |
| L11 | `txn_date` is not more than 1 day in the future unless `is_forecast` | WARN | Service |
| L12 | Transfers carry no budget category | BLOCK | CHECK (Firefly `CorrectsTransferBudgets`) |

### Lots and positions

| Id | Invariant | Sev |
|---|---|---|
| P01 | `Σ lots.remaining_quantity = position(account, instrument)` for every pair | BLOCK |
| P02 | `remaining_quantity ≤ original_quantity`, both ≥ 0 | BLOCK |
| P03 | `Σ lot_disposals.quantity` per lot ≤ `original_quantity` | BLOCK |
| P04 | No position goes negative unless the account permits shorting | BLOCK |
| P05 | `Σ disposal.cost_basis_minor` for a fully closed lot = its `cost_basis_minor` | BLOCK |
| P06 | Every disposal has a `gain_term` and `holding_days ≥ 0` | BLOCK |
| P07 | A lot's `acquired_on` ≤ every disposal's `disposed_on` | BLOCK |

### Prices

| Id | Invariant | Sev |
|---|---|---|
| Q01 | `price > 0` for all asset classes except `OPTION` and `FUTURE` | BLOCK |
| Q02 | `ingested_at ≥ as_of` (we cannot know a price before its date) | BLOCK |
| Q03 | A day-over-day move > 50% is flagged for review | WARN |
| Q04 | Quote currency matches the instrument currency | BLOCK |
| Q05 | Staleness beyond the class threshold marks the valuation stale | WARN |
| Q06 | An FX rate and its inverse are consistent within 0.1% | WARN |

### Balances and derived values

| Id | Invariant | Sev |
|---|---|---|
| B01 | Cached balance = `Σ` postings for that account and revision | BLOCK |
| B02 | Assets − Liabilities = Equity + (Income − Expenses), at every date | BLOCK |
| B03 | Net worth at `t` = net worth at `t−1` + net change at `t` | BLOCK |
| B04 | A projection's `revision_vector` matches current account revisions | BLOCK |
| B05 | Recomputation from the event log reproduces every cached value | BLOCK (nightly) |

### Budgets

| Id | Invariant | Sev |
|---|---|---|
| U01 | In `ENVELOPE` mode, `Σ budgeted ≤ available_funds` | WARN |
| U02 | `leftover_pos = max(0, leftover)` | BLOCK |
| U03 | Budget period start < end (Firefly `CorrectsInvertedBudgetLimits`) | BLOCK |
| U04 | Template priorities are unique per category | BLOCK |

### Loans

| Id | Invariant | Sev |
|---|---|---|
| N01 | `Σ schedule.principal = loan principal` (exactly, after final-period adjustment) | BLOCK |
| N02 | Final closing balance = 0 | BLOCK |
| N03 | Every schedule row: `opening − principal = closing` | BLOCK |
| N04 | Loan account balance = remaining scheduled principal ± prepayments | WARN |

### Import and integration

| Id | Invariant | Sev |
|---|---|---|
| I01 | An import row never enters the ledger without `CONFIRMED` status | BLOCK |
| I02 | Re-importing the same file (same SHA-256) is a no-op | BLOCK |
| I03 | An `external_id` never matches two live transactions | BLOCK |
| I04 | Broker tokens never appear in a response body or a log | BLOCK (test + Pino redaction) |
| I05 | Every mutating request carries an `Idempotency-Key` | BLOCK |

### Audit

| Id | Invariant | Sev |
|---|---|---|
| A01 | `audit_events` has no `UPDATE`/`DELETE` grant | BLOCK (permissions) |
| A02 | Every ledger mutation produces exactly one audit event | BLOCK |
| A03 | Nothing is hard-deleted; `deleted_at` only | BLOCK |

---

## 9. Testing strategy

### 9.1 Property-based tests (fast-check / Hypothesis) — mandatory

These properties, not examples, are what catch money bugs:

| Property |
|---|
| `sum(Money.allocate(m, w)) === m` for all `m`, all weight vectors |
| `m.plus(n).minus(n) === m` |
| Posting a transaction then reversing it returns every balance to its prior value |
| FIFO/LIFO/HIFO over the same lots yield **identical total quantity disposed** and differ only in basis |
| `Σ realised_gain` over a fully liquidated position = `total_proceeds − total_cost`, exactly |
| XIRR of a single −P at t₀ and +P(1+r)^n at t₀+n years returns `r` within 1e-6 |
| TWR is invariant to the timing of external cashflows (its defining property) |
| Amortisation: `Σ principal === loan principal`, exactly, for all rates and terms |
| Replaying the event log from empty reproduces the current state byte-for-byte |

### 9.2 Golden-file tests

Directly adopting Paisa's pattern (`internal/xirr/samples/*.csv` with hard-coded expected values —
Dossier 04 §4.1). We ship fixture portfolios with hand-verified expected outputs for XIRR, TWR, cost
basis under all five methods, tax under each rule set, and amortisation. Include Paisa's own extreme
cases (a 2982.94% XIRR) — they are exactly where naive solvers fail.

### 9.3 Differential testing

Where a mature reference exists, diff against it: `ledger-cli` for balance reports over a generated
journal, and Excel/LibreOffice `XIRR` for return calculations. A disagreement is a bug in one of us,
and finding out which is always worth the time.

### 9.4 Invariant tests

Every id in §8 has a test that (a) constructs a violating state and asserts it is rejected, and
(b) asserts the invariant holds across a large generated dataset. Firefly needed 35 repair commands
because these tests did not exist.

### 9.5 Reproducibility test

The nightly job (B05) recomputes every projection from the event log and diffs against the cache. Any
mismatch pages. This is the safety net that makes the caching layer trustworthy.

---

## 10. Time and calendars

| Concern | Rule |
|---|---|
| Accounting dates | `DATE` (no time, no zone). Temporal `PlainDate` in memory. |
| Event timestamps | `TIMESTAMPTZ`, stored UTC. Temporal `Instant`/`ZonedDateTime`. |
| Never | Mix the two. Firefly's `ConvertsDatesToUTC` and `CorrectsTimezoneInformation` (Dossier 03 §7) are a retrofit we avoid by deciding now. |
| Tenant timezone | Used only to derive "today" and to render event times. |
| Fiscal year | `tenants.fiscal_year_start_month`. All period arithmetic goes through one `FiscalCalendar` service — never inline month math. |
| Market calendars | Per-exchange holiday tables. "Previous trading day" for day-change; "trading days elapsed" for volatility. |
| Settlement | `settlement_date` distinct from `txn_date`. T+1 for Indian equities. Cost basis uses trade date; cash availability uses settlement date. |
| Week start | Configurable (Paisa's `week_starting_day`). |
| DST | Never affects `DATE` arithmetic — a further reason accounting dates are date-only. |

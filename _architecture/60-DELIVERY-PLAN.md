# 60 — Delivery Plan

> Phase sequencing with acceptance criteria. Written so an AI agent can pick up any single work item
> and know what "done" means.

---

## 1. Sequencing principle

Build **inward-out**: the ledger and its invariants first, then the things that read it. Every phase
ships something usable, and no phase requires re-architecting an earlier one
(`50-QUANT-ROADMAP.md` §7).

The riskiest work is front-loaded: the sum-to-zero trigger, the money type, and the bitemporal price
schema are all Phase 1 or 2, because getting them wrong is the only class of mistake that is expensive
to undo.

---

## 2. Phase 0 — Foundations

**Goal:** a repository where correctness rules are mechanically enforced before any domain code exists.

| Work item | Done when |
|---|---|
| Monorepo skeleton (pnpm + Turborepo) | `pnpm build` and `pnpm test` pass on an empty graph |
| Postgres + Timescale via Testcontainers | Integration tests spin a real DB in CI |
| `Money` value object | Property tests in `30-CALCULATIONS.md` §9.1 pass |
| Float-prohibition lint rule | A PR introducing `parseFloat` on a money path fails CI |
| Schema float test | A migration adding a `FLOAT` amount column fails CI |
| `dependency-cruiser` boundaries | A cross-module import fails CI |
| Drizzle + migration-safety linter | Destructive DDL without an override fails CI |
| Pino with PII redaction | A log containing a token fails the redaction test |
| CI pipeline | typecheck → lint → unit → integration → migration dry-run |

**Exit criterion:** the three enforcement layers of `30-CALCULATIONS.md` §1.3 are live and demonstrably
block a bad commit. Everything after this depends on them.

---

## 3. Phase 1 — The ledger

**Goal:** a correct multi-commodity double-entry ledger with import.

| Work item | Done when |
|---|---|
| Schema: tenants, users, accounts, currencies, instruments | Migrations apply; RLS policies enforced by test |
| Transactions + postings | Schema per `20-DOMAIN-MODEL.md` §3.4 |
| **Sum-to-zero deferred constraint trigger** | An unbalanced multi-row insert fails at COMMIT |
| Legality matrix seeded from Firefly | All rows of `20-DOMAIN-MODEL.md` §3.6 present; illegal combos rejected |
| Invariants L01–L12 | Each has a violating-state test and a generated-dataset test |
| Event log + audit log | Append-only; `UPDATE`/`DELETE` grants absent |
| Soft delete + `v_*` views | No code path hard-deletes |
| Counterparties, categories | LTREE trees query correctly |
| CSV / OFX / CAMT.053 / PDF import | Round-trips a real statement from three banks |
| Import staging (`import_rows`) | Nothing enters the ledger unconfirmed (I01) |
| **3-pass dedup matcher** | Reproduces Actual's behaviour on a golden fixture set (`40-MARKET-DATA.md` §6.5) |
| Content-addressed file dedup | Re-importing the same file is a no-op (I02) |
| Rules engine | Normalised rows, not JSON; typed field/operator allow-list per `research/01-actual.md` §5.2 |
| Recurrences | First-class with RRULE, not implemented as rules |
| REST + OpenAPI, idempotency keys | Duplicate `Idempotency-Key` returns the original result |

**Exit criterion:** a user can import a year of bank statements, have them categorised by rules, and
see correct balances — with every ledger invariant enforced by the database rather than by convention.

**Reference check:** balances must match `ledger-cli` on an equivalent journal
(`30-CALCULATIONS.md` §9.3).

---

## 4. Phase 2 — Portfolio

**Goal:** holdings, cost basis, valuation, and returns.

| Work item | Done when |
|---|---|
| Instrument master + provider mappings | Same instrument resolves across two providers |
| **Bitemporal `quotes` hypertable** | `as_of` vs `ingested_at` distinct; corrections are new rows |
| FX rates with `user_rate` override | |
| Provider abstraction + conformance suite | Two providers registered, both pass all six conformance tests |
| Rate limit, retry, circuit breaker, failover | Induced provider failure fails over without user-visible error |
| Lots + disposals | Invariants P01–P07 enforced |
| **All five lot methods** | FIFO/LIFO/AVERAGE/HIFO/SPECIFIC_ID; property test in `30-CALCULATIONS.md` §9.1 |
| Valuation with the price-resolution ladder | Missing price yields `null` + stale marker, never zero |
| **XIRR with bracketed solver** | Passes Paisa's golden fixtures *including* the 2982.94% case; returns `XIRR_UNDEFINED`, never 0 |
| **TWR (Modified Dietz + true)** | Invariant to cashflow timing (property test) |
| Corporate actions | Split replay retro-adjusts lots and charts correctly |
| Projection cache keyed by revision | Backdated write invalidates exactly the affected projections |
| Nightly reproducibility job (B05) | Recompute from event log matches cache |

**Exit criterion:** a user connects a broker, sees correct holdings with cost basis, unrealised P&L,
XIRR and TWR — and a 1:5 split applied mid-history leaves every historical number correct.

---

## 5. Phase 3 — Planning and the full product

| Work item | Done when |
|---|---|
| Budgets (envelope + tracking) | Actual's exact formulas (`30-CALCULATIONS.md` §7) reproduced |
| Budget template DSL | All 10 directives; priority-ordered funding; `remainder` last |
| Goals incl. retirement SWR | |
| **Loans + amortisation** | N01–N04 hold; `Σ principal` equals loan principal exactly |
| Payoff strategies | Avalanche vs snowball comparison |
| **Tax engine** | `tax_rules` as data; gain and taxable reported separately |
| Tax-loss harvesting | |
| Reports: net worth, balance sheet, income statement, cash flow, allocation drift | |
| Search/query DSL | Peggy grammar; **unified with rule triggers** (Firefly's insight) |
| Web UI: register, accounts, budgets, portfolio, reports | Keyboard-driven register matching Actual's ergonomics |
| Multi-user households | Owner/editor/viewer/accountant roles |
| Webhooks | Delivery/attempt/response model from Firefly |

**Exit criterion:** feature parity with the union of the four repos, minus their defects.

---

## 6. Phase 4 — Analytics

| Work item | Done when |
|---|---|
| Python analytics service (FastAPI) | Stateless; receives valuation snapshots only |
| Arrow/Parquet snapshot contract | Zero-copy handoff |
| Risk metrics | Drawdown, volatility, Sharpe, Sortino, beta, alpha, correlation, VaR — all with property tests |
| Benchmark comparison | TWR vs index |
| Feature store | Bitemporal and versioned |
| Rebalancing optimiser (`cvxpy`) | Lot-level tax-aware trade list |
| Vectorised backtester | Parameter sweeps |

---

## 7. Phase 5 — Execution

Gated on an explicit decision, and on `50-QUANT-ROADMAP.md` §6 (regulatory).

| Work item | Done when |
|---|---|
| Event-driven backtester | **Shares the live code path**, differing only in injected venue |
| Cost model | Brokerage, STT, exchange, GST, stamp duty, SEBI fees |
| Survivorship-bias-free universe | Delisted instruments retained |
| Walk-forward validation | Default mode |
| Orders + fills schema | Unique `idempotency_key` per tenant |
| **Pre-trade risk gate** | Fails closed; all eight checks of `50-QUANT-ROADMAP.md` §5.2 |
| Kill switch | Honoured within one tick |
| Paper trading | Runs for 90 days before any live order |

---

## 8. Cross-cutting, every phase

| Concern | Standing requirement |
|---|---|
| Invariants | Every new entity adds its invariants to the registry with tests |
| Property tests | Any new formula ships with its properties |
| Golden files | Any new metric ships with hand-verified fixtures |
| Migrations | Additive; destructive DDL needs an explicit override |
| Security checklist | Every row is an executable test (`40-MARKET-DATA.md` §8) |
| Observability | Every external call traced; every job instrumented |

---

## 9. Top risks

| Risk | Mitigation |
|---|---|
| **Float creeps into a money path** | Three enforcement layers, live from Phase 0 |
| **Lookahead bias in backtests** | Bitemporal prices from Phase 2 — unrecoverable if deferred |
| **Provider outage or shutdown** | Two providers per need; persisted history degrades to stale, not empty |
| **Bank/broker adapter sprawl** | Budget for it: Actual needed 48 adapters (`research/02` §5.2). Adapter + conformance suite from day one |
| **Backdated-write invalidation bugs** | Revision-keyed projections + nightly reproducibility job |
| **Corporate action corrupts basis silently** | Actions as ledger transactions, replayable and reversible |
| **Scope: four repos' union is very large** | Phases 1–2 are the differentiator; Phase 3 is table stakes and can be trimmed |
| **Zerodha daily token expiry** | Product constraint, not a bug — design the UX around it |
| **Regulatory drift in Phase 5** | Boundaries named in `50-QUANT-ROADMAP.md` §6; counsel before multi-tenant strategies |

---

## 10. First ten work items, in order

For an agent starting now:

1. Monorepo skeleton + CI (Phase 0).
2. `Money` value object with `allocate()` and its property tests.
3. The three float-prohibition enforcement layers.
4. Core schema migration: tenants, currencies, accounts (with RLS).
5. `transactions` + `postings` with the `commodity_coherent` CHECK.
6. **The deferred sum-to-zero constraint trigger** and its violating-state tests.
7. Seed `txn_type_legality` from `20-DOMAIN-MODEL.md` §3.6.
8. Invariants L01–L12 with tests.
9. Append-only event log and audit log with grants locked down.
10. CSV import → `import_rows` staging → the 3-pass dedup matcher.

At that point the system has a provably correct ledger, and everything else is additive.

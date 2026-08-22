# 10 — System Architecture

> **Codename:** `ledgerworks` (placeholder).
> **Scope:** end-to-end personal finance + net-worth + portfolio analytics platform, designed so that a
> quantitative research and (eventually) execution capability can be added without re-architecting.
> **Audience:** AI coding agents and human engineers. Every decision states its alternatives and why
> they were rejected.

---

## 1. Product thesis in one page

The four analysed repos each solve one third of the problem and none solves the whole:

| | Cash/budget rigour | Investment modelling | Asset-class breadth |
|---|---|---|---|
| Actual | **Excellent** | None | Narrow |
| Firefly III | **Excellent** | None | Narrow |
| Paisa | Good | **Excellent** | Medium |
| myFinance | None | Basic | **Excellent** |

`ledgerworks` is **one multi-commodity double-entry ledger** that treats a grocery purchase and a
100-share equity buy as the same kind of object — a balanced set of postings — differing only in
whether the commodity is a currency or an instrument. That single decision is what lets budgeting and
portfolio analytics share a spine, and it is what makes the quant phase an extension rather than a
rewrite.

**Non-negotiable properties**

1. Every economic event is a balanced transaction. Sum-to-zero **per currency** is a database-enforced
   invariant, not a repair job (rejecting Firefly's approach — Dossier 03 §2.2).
2. Money is never a float. Anywhere. Enforced by lint and by type.
3. Cost basis and market value are distinct, independently derived numbers (adopting Paisa's
   `Quantity`/`Amount`/`MarketAmount` — Dossier 04 §2.2).
4. Every derived number is reproducible: same inputs and same `as_of` produce the same output, forever.
5. No user-entered data is ever destroyed. Soft-delete plus an append-only audit trail.

---

## 2. Architecture at a glance

```
┌──────────────────────────────────────────────────────────────────────────┐
│  CLIENTS                                                                 │
│  Web (React/TanStack)   Mobile (Expo)   CLI (oclif)   Public API         │
└───────────────────────────────┬──────────────────────────────────────────┘
                                │  tRPC (internal) · REST+OpenAPI (public) · SSE (live)
┌───────────────────────────────▼──────────────────────────────────────────┐
│  EDGE                                                                     │
│  Fastify gateway · authn/authz · rate limit · idempotency · audit         │
└───┬──────────────┬──────────────┬───────────────┬───────────────┬────────┘
    │              │              │               │               │
┌───▼────────┐ ┌───▼─────────┐ ┌──▼──────────┐ ┌──▼──────────┐ ┌──▼────────┐
│ LEDGER     │ │ PORTFOLIO   │ │ MARKETDATA  │ │ INGESTION   │ │ PLANNING  │
│ core       │ │ positions   │ │ providers   │ │ bank/broker │ │ budgets   │
│ postings   │ │ lots        │ │ quotes      │ │ files       │ │ goals     │
│ accounts   │ │ valuation   │ │ corp actions│ │ email/LLM   │ │ rules     │
│ invariants │ │ cost basis  │ │ FX          │ │ dedup       │ │ schedules │
│ (TypeScript)│ │ (TypeScript)│ │ (TypeScript)│ │ (TypeScript)│ │(TypeScript)│
└───┬────────┘ └───┬─────────┘ └──┬──────────┘ └──┬──────────┘ └──┬────────┘
    │              │              │               │               │
    └──────────────┴──────┬───────┴───────────────┴───────────────┘
                          │
              ┌───────────▼─────────────┐        ┌──────────────────────────┐
              │ PostgreSQL 16           │        │ ANALYTICS  (Python)      │
              │  + TimescaleDB (prices) │◄──────►│ risk · attribution ·     │
              │  + pgvector (search)    │        │ backtest · optimisation  │
              └───────────┬─────────────┘        └──────────────────────────┘
                          │
              ┌───────────▼─────────────┐        ┌──────────────────────────┐
              │ Redis  (cache, locks)   │        │ FUTURE: EXECUTION (Rust) │
              │ BullMQ (jobs)           │        │ ticks · OMS · strategies │
              └─────────────────────────┘        └──────────────────────────┘
```

**Deployment shape:** a **modular monolith** — one deployable process containing the five TypeScript
modules with enforced internal boundaries — plus the Python analytics service as a separate process.
Not microservices. See §7.

---

## 3. Language and runtime decisions

### 3.1 Core services — TypeScript on Node 22 LTS

**Chosen because:**

- One type system from database row to React prop. The domain has ~40 entities and ~25 enums
  (see `20-DOMAIN-MODEL.md`); duplicating those across a Go backend and a TS frontend is a permanent
  drift tax.
- Actual proves a full financial engine works in TypeScript at 298K LOC, including exact money
  arithmetic via integer minor units (Dossier 01 §3.1).
- Integer money in JS is exact to 2^53 minor units (≈90 trillion cents) — well beyond any personal
  portfolio.

**Rejected alternatives:**

| Option | Why not |
|---|---|
| **Go** (as Paisa) | Single binary and great concurrency, but no type sharing with the client, and a weaker ecosystem for the import/parsing work (PDF, OFX, CAMT.053) that dominates real effort. |
| **PHP/Laravel** (as Firefly) | Excellent framework ergonomics, but the numeric story is BCMath-strings-or-bust and it leaks floats in practice (Dossier 03 §2.2). Poor fit for the analytics future. |
| **Python everywhere** | Best analytics ecosystem, worst web-service type safety and slowest ledger throughput. Used for analytics *only*. |
| **Rust everywhere** | Correct for the eventual HFT path, far too slow to build the 90% of the product that is CRUD, import, and reporting. |

### 3.2 Analytics — Python 3.12, separate service

Risk metrics, factor attribution, optimisation, and backtesting are not worth reimplementing in
TypeScript. The Python scientific stack is the reason this service exists and the reason it is
separate: it has a different deploy cadence, a different scaling profile (CPU-bound, burst), and a
different dependency risk surface.

**Contract:** the analytics service never touches the ledger tables directly. It receives an immutable
*valuation snapshot* (positions, lots, price series, cashflows) and returns metrics. This keeps it
stateless, trivially cacheable, and safe to run untrusted user-authored strategy code in later.

### 3.3 Future execution engine — Rust

Deferred to Phase 5 (`50-QUANT-ROADMAP.md`). Nothing in Phases 1–4 may assume its absence *or* its
presence; the market-data and order abstractions are designed so a Rust process can replace the
TypeScript one behind the same interfaces.

---

## 4. Data stores

### 4.1 PostgreSQL 16 — the system of record

Everything transactional: accounts, transactions, postings, lots, budgets, rules, users.

**Why not SQLite** (as all four repos use): we need concurrent multi-user writes, row-level security,
`NUMERIC` with 38 digits, partitioning for the price series, `CHECK` constraints with deferred
evaluation for the sum-to-zero invariant, and logical replication for read replicas. SQLite gives us
none of those. Actual's SQLite choice follows from local-first; we are rejecting local-first as the
primary model (§6).

**Key extensions:**

| Extension | Purpose |
|---|---|
| **TimescaleDB** | Hypertables for `quotes` and `bars`. Native time partitioning, continuous aggregates for OHLC rollups, and columnar compression (typically 10–20× on price data). |
| **pgvector** | Embedding-based payee/merchant matching and semantic transaction search. |
| **pg_partman** | Partition lifecycle for `audit_events` and `quotes`. |

**Why TimescaleDB rather than a separate ClickHouse from day one:** one database means one backup
story, one connection pool, and joins between prices and postings without a federation layer. Price
volume for a personal-finance product (thousands of instruments × daily bars) is 10⁶–10⁸ rows, which
Timescale handles comfortably. **Revisit at tick granularity** — see `50-QUANT-ROADMAP.md` §3, where
ClickHouse or Arctic becomes correct.

### 4.2 Redis 7

Cache (quote fan-out, computed rollups), distributed locks (per-account write serialisation),
rate-limit counters, and the BullMQ job backend. **Never** a system of record.

### 4.3 Object storage (S3-compatible)

Statements, receipts, PDFs, import batch originals. Content-addressed by SHA-256 so re-uploading the
same statement is a no-op — a cheap and effective import-idempotency layer.

---

## 5. The library manifest

The user asked explicitly for library choices. Every pick below is load-bearing; anything not listed is
a free choice for the implementing agent.

### 5.1 Backend core (TypeScript)

| Concern | Library | Why this one |
|---|---|---|
| HTTP server | **Fastify 5** | ~2× Express throughput, first-class JSON-schema validation and serialisation, mature plugin encapsulation. |
| Internal RPC | **tRPC 11** | End-to-end types with zero codegen for our own clients. |
| Public API | **Fastify + `@fastify/swagger`** generating **OpenAPI 3.1** | Third-party consumers need a spec, not TypeScript types. |
| Validation | **Zod 3** | One schema drives tRPC input types, OpenAPI output, and runtime validation. |
| ORM / query | **Drizzle ORM** | SQL-first (we write real SQL for the ledger), fully typed, migrations as versioned SQL files. **Rejected Prisma:** its query engine obstructs CTEs, window functions, and `FOR UPDATE`, all of which the ledger needs. |
| Migrations | **drizzle-kit** + hand-written SQL for constraints/triggers | Firefly's 35 correction commands (Dossier 03 §7) exist because constraints were absent; ours go in migrations from day one. |
| Money | **Custom `Money` value object** over `bigint` minor units | See `30-CALCULATIONS.md` §1. No library models currency-scaled integers the way we need. |
| Decimal (quantities, rates) | **decimal.js-light** | Arbitrary precision for share counts and FX rates. Mirrors Paisa's `shopspring/decimal` choice, which is proven correct. |
| Dates | **Temporal** (via `@js-temporal/polyfill` until native) | `PlainDate` for posting dates and `ZonedDateTime` for events is *exactly* the distinction Firefly had to retrofit painfully (Dossier 03 §7, `ConvertsDatesToUTC`). **Rejected Moment** (dead), **Luxon/date-fns** (no plain-date type). |
| Jobs / scheduling | **BullMQ** | Redis-backed, supports repeatable jobs, priorities, and per-job retry/backoff — needed for price refresh, bank sync, and webhook delivery. |
| Rule/expression evaluation | **`expr-eval`** in a sandbox, plus our own PEG-compiled matcher | Firefly uses Symfony ExpressionLanguage for the same purpose (Dossier 03 §6.2). |
| Grammars (query DSL, budget templates) | **Peggy** | Exactly what Actual uses for `goal-template.pegjs` (Dossier 01 §4.3) and Paisa for its search grammar. Proven fit. |
| Templating (import mappers, rule actions) | **Handlebars** | Both Actual (rule actions) and Paisa (import templates) chose it independently. |
| CSV | **`csv-parse`** (streaming) | Handles quoting/encoding edge cases that hand-rolled splitters do not. |
| OFX/QFX | **`ofx-js`** + custom SGML fallback | OFX in the wild is frequently malformed SGML, not XML. |
| CAMT.053 / ISO 20022 | **`fast-xml-parser`** + our own mapper | No maintained library covers the dialects; the mapper is per-bank anyway (see Dossier 02 §5.2). |
| PDF statements | **`pdfjs-dist`** for text extraction | Same engine Paisa uses (`src/lib/pdf.ts`). |
| Excel | **`exceljs`** | Streaming reader; `xlsx` has had unpatched advisories. |
| Crypto | Node `node:crypto` (AES-256-GCM, scrypt) | No third-party crypto. |
| Secrets | **`@aws-sdk/client-secrets-manager`** or Vault | Never `process.env` for broker credentials — the myFinance failure (Dossier 05 §2.5). |
| Logging | **Pino** | Structured JSON, low overhead; redaction of PII fields configured centrally. |
| Tracing/metrics | **OpenTelemetry SDK** → Grafana/Tempo/Prometheus | |
| Testing | **Vitest** (unit/integration), **fast-check** (property-based), **Testcontainers** (real Postgres), **Playwright** (E2E) | Property-based testing is mandatory for money arithmetic — see `30-CALCULATIONS.md` §4. |

### 5.2 Frontend (web)

| Concern | Library | Why |
|---|---|---|
| Framework | **React 19** + **Vite 6** | |
| Routing | **TanStack Router** | Type-safe routes and search params; search params carry report filters, which must be shareable URLs. |
| Server state | **TanStack Query 5** | Caching, background refetch, optimistic updates. |
| Client state | **Zustand** | Small, no boilerplate. Redux is unjustified here. |
| Tables/grids | **TanStack Table 8** (headless) | The transaction register is the app's most-used screen; Actual's keyboard-driven grid (Dossier 02) is the bar. Headless lets us own the keyboard model. |
| Virtualisation | **TanStack Virtual** | Registers reach 10⁵ rows. |
| Charts | **Visx** (d3 primitives + React) for bespoke financial charts; **Recharts** for standard ones | Paisa uses raw d3, which is powerful but verbose; Visx keeps d3's scales and shapes while staying declarative. Candlesticks, drawdown bands, and allocation sunbursts need Visx. |
| Forms | **React Hook Form** + Zod resolver | Same Zod schemas as the API. |
| Styling | **Tailwind CSS 4** + **Radix UI** primitives | Radix for accessibility (menus, dialogs, comboboxes) without visual opinions. |
| Editor (rules, formulas, journal) | **CodeMirror 6** | Exactly Paisa's choice; lets us ship a real query-language editor with autocomplete and linting. |
| i18n | **`i18next`** with ICU message format | Plurals and currency formatting are locale-dependent. |
| Money formatting | **`Intl.NumberFormat`** | Never hand-roll. |

### 5.3 Analytics service (Python)

| Concern | Library | Why |
|---|---|---|
| API | **FastAPI** + **Pydantic v2** | Typed contract mirroring the Zod schemas. |
| Numerics | **NumPy**, **SciPy** | `scipy.optimize.brentq` for IRR root-finding — a bracketed method that cannot silently fail the way Paisa's Newton does (Dossier 04 §4.1). |
| Dataframes | **Polars** | Lazy, multi-threaded, Arrow-native. **Rejected pandas as the default** for its memory profile and index semantics; kept available for interop. |
| Risk / performance | **`empyrical-reloaded`** for standard metrics; our own implementations for anything we report as authoritative | Never report a number we cannot derive ourselves — see `30-CALCULATIONS.md`. |
| Optimisation | **`cvxpy`** | Convex portfolio optimisation with real constraints. |
| Backtesting | **`vectorbt`** (research), custom event-driven engine (production) | Vectorised backtests are fast and wrong about fills; the production engine must model latency and slippage. |
| Serialisation | **Apache Arrow / Parquet** | Zero-copy handoff of price panels between services. |
| Testing | **pytest**, **Hypothesis** | Property-based testing again. |

### 5.4 Infrastructure

| Concern | Choice |
|---|---|
| Containers | Docker, multi-stage; distroless runtime images |
| Orchestration | Docker Compose (dev) → Kubernetes or Fly.io (prod) |
| Migrations in CI | `drizzle-kit` + a **migration-safety linter** rejecting destructive DDL without an explicit override |
| CI | GitHub Actions: typecheck → lint → unit → integration (Testcontainers) → E2E → migration dry-run |
| Monorepo | **pnpm workspaces** + **Turborepo** | Actual's yarn+lage works; pnpm's stricter linking prevents phantom dependencies |

---

## 6. The local-first question — decided

Actual's CRDT (Dossier 02) is the most sophisticated engineering in the four repos, and we are **not**
adopting it as the primary model.

**The disqualifying argument** (Dossier 02 §4): per-column last-write-wins cannot preserve invariants
that span rows. Two offline clients editing two legs of one split transaction both merge cleanly and
produce a transaction whose children no longer sum to the parent. For a budgeting app that is an
annoyance; for a system that computes cost basis and tax liability it is a correctness failure.

Compounding it: full end-to-end encryption means the server can compute nothing. Our product's core
value — valuing a portfolio against live prices, computing risk, running analytics — **requires**
server-side computation over plaintext holdings.

**What we do instead — a three-tier model:**

| Tier | Data | Model |
|---|---|---|
| **Server-authoritative** | Postings, lots, balances, valuations, tax events | Single writer per account via a Redis lock; optimistic concurrency with a row `version`; conflicts surface to the user |
| **Offline-capable capture** | Draft transactions, receipts, notes entered on mobile | Queued locally, submitted as *proposals* with a client-generated idempotency key; server validates and either accepts or returns a conflict |
| **Local-only** | UI preferences, column layouts, collapsed sections | Browser storage, never synced |

This keeps the genuine benefit of local-first (capture works on a plane) without letting a merge
algorithm silently violate an accounting invariant. We do adopt Actual's **lexicographically-sortable
timestamps** and **universal tombstones** independently of the CRDT.

---

## 7. Modular monolith, not microservices

The five core modules run in one process with enforced boundaries:

- Each module owns its tables. No module reads another's tables directly.
- Cross-module calls go through a typed internal interface (`LedgerService`, `PortfolioService`, …).
- Enforcement is mechanical: **`dependency-cruiser`** rules in CI reject imports that cross a boundary
  except through the declared interface.

**Why:** the ledger and portfolio modules share transactions constantly; making that a network hop
buys distributed-transaction problems and buys nothing. The boundaries are real and enforced, so any
module can be extracted later when a scaling reason actually appears. The Python analytics service is
already separate because its reason *does* already exist (different runtime, different scaling).

Firefly is a monolith with no internal boundaries and pays for it with the Collector god-object
(Dossier 03 §6.3). Enforced boundaries are the difference.

---

## 8. Derived-value computation — the hardest problem

The central technical challenge is: **a user backdates a transaction to 2019; what must be recomputed?**

The three repos answer differently:

| Repo | Approach | Verdict |
|---|---|---|
| Actual | Reactive dependency DAG of named cells, persisted (Dossier 01 §4) | **Best.** Correct invalidation, incremental. |
| Firefly | On-demand SQL aggregation + a `period_statistics` cache | Simple, but recomputes far too much and the cache has no principled invalidation. |
| Paisa | Rebuild the entire SQLite cache from the journal | Correct by brute force; unusable at scale. |

**Our model — event-sourced projections with revision-keyed caching:**

1. Every ledger mutation appends to `ledger_events` (append-only, never updated).
2. Each account carries a monotonically increasing `revision`.
3. Derived values are **projections** keyed by `(scope, as_of_date, revision_vector)`. A cached value is
   valid iff its revision vector still matches.
4. A backdated write bumps the account revision, invalidating every projection for that account from
   the affected date forward — and *only* those.
5. Projections are computed lazily on read and warmed eagerly by a BullMQ job after writes.

This gives Actual's correctness with Postgres's durability, and — critically — it makes every derived
number **reproducible**: given an event log and an `as_of`, the same number comes out forever. That
property is what makes tax reporting and audit defensible, and it is what a backtest requires.

Detailed specification in `30-CALCULATIONS.md` §5.

---

## 9. API design

| Decision | Choice | Rationale |
|---|---|---|
| Internal client transport | tRPC | Types without codegen |
| Public API | REST + OpenAPI 3.1 | Third parties, and Firefly's API is the proof this domain suits REST |
| Live prices | **SSE**, not WebSocket | One-way server→client; SSE reconnects natively, traverses proxies, and needs no heartbeat protocol. Revisit for the tick-level quant phase, where WebSocket is correct. |
| Bulk operations | Explicit `POST /v1/transactions/bulk` | Never N+1 round trips for an import of 5,000 rows |
| Idempotency | Mandatory `Idempotency-Key` header on all mutating requests; stored 24h | Bank sync retries must not double-post |
| Concurrency | `If-Match` with row `version`; `409` on mismatch | |
| Pagination | Keyset (cursor) on `(date, id)`, never `OFFSET` | Registers are large and `OFFSET` degrades |
| Long-running work | `202 Accepted` + job id + status endpoint | Imports and backfills |
| Versioning | URL major (`/v1`), additive-only within a major | Firefly's `/v1` + `/v2` split is a warning |
| Errors | RFC 9457 Problem Details | |

---

## 10. Security and compliance

Driven directly by the myFinance findings (Dossier 05 §2.5), each of which becomes a requirement:

| Requirement | Implementation |
|---|---|
| No credential ever reaches the browser | Broker/bank tokens live server-side only, encrypted at rest; the client receives an opaque connection id |
| Explicit CORS allow-list | A fixed array. **Never** origin reflection, never `*`. Enforced by a unit test asserting a disallowed origin is rejected. |
| OAuth `state` + PKCE mandatory | Every provider flow. A missing `state` fails the callback. |
| Envelope encryption | Per-tenant DEK wrapped by a KMS CEK; broker tokens and account numbers encrypted at the column level |
| Authorization | Postgres row-level security keyed to `tenant_id`, plus an application policy layer for household sharing (owner / editor / viewer / accountant) |
| Audit | Append-only `audit_events` — actor, action, entity, before/after, IP, request id. Never updatable. |
| PII minimisation | Account numbers stored as last-4 plus an encrypted full value; never logged (Pino redaction) |
| Secret scanning | `gitleaks` in CI |
| Dependency audit | `pnpm audit` + Dependabot, failing the build on high severity |
| Security checks as tests | Every row of the security checklist is an executable test. myFinance's audit claimed CORS was restricted while the code reflected origins (Dossier 05 §2.5, Finding 1) — a document cannot catch that; a test can. |

**Regulatory note.** Read-only aggregation of a user's own financial data is a light-touch activity in
most jurisdictions. This changes materially the moment we (a) hold client funds, (b) place orders on a
user's behalf, or (c) give advice. `50-QUANT-ROADMAP.md` §6 flags where each line is crossed. Nothing
in Phases 1–4 crosses any of them.

---

## 11. Rejected architectures — recorded so they are not re-proposed

| Rejected | Why |
|---|---|
| CRDT/local-first as primary (Actual) | Per-column LWW breaks cross-row invariants (§6) |
| Full E2EE | Forecloses server-side valuation and analytics, the product's core value |
| Plain-text journal as source of truth (Paisa) | No concurrency, no constraints, fork-per-query, no write API |
| Shelling out to `ledger`/`beancount` | External binary dependency, output-format coupling |
| SQLite as primary store | No concurrent writes, no RLS, no partitioning |
| Microservices from day one | Distributed transactions across ledger and portfolio for no scaling benefit |
| Single-file client app (myFinance) | Untestable, unreviewable |
| Invariants enforced by repair jobs (Firefly) | 35 correction commands are 35 bugs that already shipped |
| GraphQL | Financial reads are a fixed set of well-known shapes; GraphQL's flexibility buys little and costs query-cost governance |
| Prisma | Blocks CTEs, window functions, `FOR UPDATE` — all required by the ledger |

---

## 12. Reading order for implementing agents

1. **`20-DOMAIN-MODEL.md`** — schema, enums, invariants. Build this first; nothing else is meaningful without it.
2. **`30-CALCULATIONS.md`** — money representation, every formula, the invariant registry, testing strategy.
3. **`40-MARKET-DATA.md`** — provider abstraction, ingestion, corporate actions.
4. **`50-QUANT-ROADMAP.md`** — the extensibility path; read before designing any market-data or order interface.
5. **`60-DELIVERY-PLAN.md`** — phase sequencing and acceptance criteria.

Research evidence for every claim is in `research/01-actual.md` … `research/06-unified-taxonomy.md`.

# Stock-Mania — Architecture and Plan of Record

> **Purpose.** The design reasoning for an end-to-end personal-finance, net-worth and
> portfolio-analytics platform, plus the live, checkbox-tracked plan for building it.
>
> **Audience.** AI coding agents and human engineers.

---

## How to read this

**Start at [`70-UPGRADE-PLAN.md`](70-UPGRADE-PLAN.md).** It is the plan of record: the only file that
says what is already done, and the only place progress is tracked. Read the progress table, find the
first unticked box in the earliest incomplete phase, and confirm that phase's gate before writing
anything.

The other three files are **reference, not instructions**. Open them when a plan item needs the
reasoning behind it:

| You need | Read |
|---|---|
| An invariant id (`L01`, `P04`, `Q02`, `B02`, `N01`, `I01`, `A03`…) | `30` §8 |
| A formula — XIRR, TWR, EMI, budget leftover, a risk metric | `30` §2–§7 |
| Money/precision rules and the testing strategy | `30` §1, §9 |
| The legality matrix, enum catalogue, or a worked posting example | `20` §2, §3.6, §5 |
| Corporate-action semantics, the 3-pass dedup matcher, provider endpoints | `40` §5, §6.5, §2 |
| Whether a market-data feed actually works (measured, not assumed) | `40` §2.5 |
| In-kind income, digital-gold XIRR conventions, benchmark replay | `30` §4.5 |

---

## Documents

| Doc | Contents |
|---|---|
| **[70-UPGRADE-PLAN.md](70-UPGRADE-PLAN.md)** | **The plan of record — start here.** The class-based rebuild: four class hierarchies (Transaction, Asset, TaxEngine, PriceProvider), the consolidated file layout, and 82 checkboxed work items across nine gated phases, each with a *Done when* condition. |
| **[20-DOMAIN-MODEL.md](20-DOMAIN-MODEL.md)** | Domain reasoning and the canonical schema: the enum catalogue, the legality matrix, lots, bitemporal prices, the sum-to-zero invariant, and worked examples for splits, transfers, equity buys and cross-currency purchases. |
| **[30-CALCULATIONS.md](30-CALCULATIONS.md)** | Every number the system reports, specified precisely enough to implement and test: money and precision, valuation, all five cost-basis methods, XIRR, TWR, ~30 metric formulas, loan mathematics, the tax engine, budget formulas, the **invariant registry**, and the testing strategy. |
| **[40-MARKET-DATA.md](40-MARKET-DATA.md)** | Provider landscape per asset class with concrete endpoints, the provider abstraction and its conformance suite, ingestion and golden-record strategy, **corporate actions**, broker connectivity, the **3-pass dedup matcher**, LLM-assisted ingestion done safely, and security requirements as executable tests. |

### Where the removed documents went

`10-SYSTEM-ARCHITECTURE`, `50-QUANT-ROADMAP`, `60-DELIVERY-PLAN` and the six `research/` dossiers were
removed once `70` became the plan of record. `10` and `60` actively contradicted decisions since taken
(they prescribe Postgres, Fastify, tRPC, a separate Python service and a Turborepo monorepo; we chose
libSQL and Next.js), `50` is summarised in Phase 8, and the dossiers were primary-source evidence with
no forward value.

They remain in git history and can be read or restored at any time:

```
git show 2aba024:_architecture/10-SYSTEM-ARCHITECTURE.md
git checkout 2aba024 -- _architecture/research/          # if ever needed again
```

**Consequence to expect:** the three surviving documents still carry ~65 citations of the form
"Dossier 04 §4.1" or "`10-SYSTEM-ARCHITECTURE.md` §8". Those references are intact history, not
mistakes — resolve them with the `git show` command above. Nothing in `70` depends on them.

---

## The decisions that define the current design

Superseding the original ten where they conflict. `70` is authoritative; this is the summary.

1. **One multi-commodity double-entry ledger.** A grocery purchase and an equity buy are the same
   object — a balanced set of postings. That is what lets budgeting and portfolio analytics share a
   spine.
2. **Everything is a class answering a small set of polymorphic questions.** `Transaction` exposes
   `postings()`, `lotEffects()`, `taxableEvents()`, `cashflows()`; `Asset` exposes `valueOn()`,
   `taxProfile()`, `quoteKey()`. Adding an asset class touches one file and no engine.
3. **Money is `Money` — bigint minor units.** Quantity and rates are separate types. No `number` on
   any money path, enforced by types, lint **and** a schema test. *(`30` §1)*
4. **Invariants are enforced in constructors,** not by callers remembering to validate. An unbalanced
   transaction cannot be constructed. *(`30` §8)*
5. **Cost basis and market value are independently derived numbers.** *(`20` §3.4)*
6. **Bitemporal prices (`as_of` vs `ingested_at`, keyed by provider).** Costs one column now; without
   it every future backtest has unrecoverable lookahead bias. *(`20` §3.8)*
7. **Corporate actions are replayable ledger transactions,** never in-place lot edits. *(`40` §5)*
8. **Two providers minimum per data need,** behind a capability-declaring interface with resilience in
   the base class and a conformance suite. *(`40` §1, §3)*
9. **Nothing is hard-deleted.** Corrections are reversals; every mutation is audited.
10. **Every derived number can name the rule or formula that produced it** — which is what makes a tax
    report defensible and a backtest honest.

**Deliberate departures from the original architecture:** libSQL instead of Postgres (so the balance
invariant lives in the domain classes rather than a deferred trigger), Next.js server actions instead
of Fastify + tRPC + OpenAPI, no separate Python analytics service, and no monorepo. Each is recorded
with its cost in `70` under *Decisions taken*.

---

## What we must build that no reference implementation provided

1. **Corporate actions** — splits, bonuses, mergers, and the retroactive lot adjustment they require.
2. **Risk analytics** — drawdown, volatility, Sharpe, Sortino, beta, alpha, correlation, VaR.
3. **Real loan mathematics** — amortisation schedules, payoff projection, avalanche vs snowball.
4. **Cost-basis methods beyond FIFO** — LIFO, average, HIFO, specific-identification.
5. **True time-weighted return** — required for any honest benchmark comparison.
6. **Derivatives and fixed income** — options, futures, bonds, G-secs. *(Phase 8.)*

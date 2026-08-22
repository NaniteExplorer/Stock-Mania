# Finance Platform — Architecture Documentation

> **Purpose.** A complete, evidence-backed architectural plan for an end-to-end personal finance,
> net-worth, and portfolio-analytics platform, derived from a forensic analysis of four open-source
> finance applications, and designed so a quantitative research and execution capability can be added
> later without re-architecting.
>
> **Audience.** AI coding agents and human engineers. Every claim about an existing system is cited to
> `repo/path.ext:LINE`. Every design decision states its alternatives and why they were rejected.

---

## How to read this

**If you are implementing:** read `20` → `30` → `60`, then start at `60` §10.

**If you are evaluating the design:** read `10`, then the "Judgement" section of each research dossier.

**If you are touching market data, instruments, or orders:** read `50` first. Several Phase-1
decisions exist solely to make Phase 5 possible, and they look arbitrary without that context.

---

## Architecture documents

| Doc | Contents |
|---|---|
| **[10-SYSTEM-ARCHITECTURE.md](10-SYSTEM-ARCHITECTURE.md)** | Product thesis, service topology, language and runtime choices, data stores, **the full library manifest**, the local-first decision, modular-monolith rationale, derived-value computation, API design, security, and a register of rejected architectures. |
| **[20-DOMAIN-MODEL.md](20-DOMAIN-MODEL.md)** | The canonical schema. Enum catalogue (16 account types, 23 asset classes, 18 transaction types, 10 corporate actions, 5 lot methods, +13 more), full DDL, the sum-to-zero enforcement trigger, the legality matrix, lots, bitemporal prices, worked examples, and a mapping table from each source repo's concepts to ours. |
| **[30-CALCULATIONS.md](30-CALCULATIONS.md)** | Money and precision standard, the `Money` value object, float prohibition, valuation, all five cost-basis methods, XIRR (with the three Paisa defects fixed), TWR, ~30 metric formulas, loan mathematics, the tax engine, budget formulas, a **50+ entry invariant registry**, and the testing strategy. |
| **[40-MARKET-DATA.md](40-MARKET-DATA.md)** | Provider landscape per asset class with concrete endpoints and costs, the provider abstraction and conformance suite, ingestion and golden-record strategy, **corporate actions** (absent from all four repos), bank/broker connectivity including India Account Aggregator, the 3-pass dedup matcher, LLM-assisted ingestion done safely, and security requirements as executable tests. |
| **[50-QUANT-ROADMAP.md](50-QUANT-ROADMAP.md)** | Honest tiering of "HFT", the five Phase-1 decisions that make the quant phase possible, tick-data storage thresholds, backtesting, the order and risk model, the Rust engine question, and regulatory boundaries. |
| **[60-DELIVERY-PLAN.md](60-DELIVERY-PLAN.md)** | Six phases with per-item acceptance criteria, cross-cutting standing requirements, the top-10 risk register, and the first ten work items in order. |

## Research dossiers

Primary-source analysis. Every architectural claim traces back to one of these.

| Doc | Subject |
|---|---|
| **[research/01-actual.md](research/01-actual.md)** | Actual Budget — schema, money representation, transfers, splits, **the spreadsheet dependency graph**, envelope formulas, the goal-template DSL, rules engine. |
| **[research/02-actual-sync-and-integrations.md](research/02-actual-sync-and-integrations.md)** | Actual — HLC timestamps, the merkle trie, **why per-column LWW is wrong for money**, GoCardless/SimpleFIN, the 48-adapter lesson, **the 3-pass import matcher**. |
| **[research/03-firefly-iii.md](research/03-firefly-iii.md)** | Firefly III — the balanced-journal model, 14 account types, the **source→destination legality matrix**, multi-currency, the 150-operator search DSL unified with rule triggers, and **35 correction commands mined as an invariant specification**. |
| **[research/04-paisa.md](research/04-paisa.md)** | Paisa — plain-text accounting, **the `Quantity`/`Amount`/`MarketAmount` posting**, XIRR (and its three defects), FIFO lot matching, the tax engine with CII indexation, the price-provider interface, and **all 11 upstream data URLs**. |
| **[research/05-myfinance.md](research/05-myfinance.md)** | myFinance — five Indian broker integrations, **the broadest asset-class coverage of the four**, LLM-based email ingestion, and five security findings **including one its own audit gets wrong**. |
| **[research/06-unified-taxonomy.md](research/06-unified-taxonomy.md)** | Cross-repo taxonomy: every account type, asset class, liability, transaction type, budget construct, tax construct, and metric across all four repos, with coverage matrices and the four defining gaps. |

---

## The analysed repositories

| Repo | Stack | LOC | Commit | One-line verdict |
|---|---|---|---|---|
| `actual/` | TypeScript monorepo | 298,200 | `625e18e20` | Best derived-value engine; **no investment model at all** |
| `firefly-iii/` | PHP / Laravel | 199,900 | `46728cb71e` | Best accounting rigour; invariants enforced by repair jobs, not the database |
| `paisa/` | Go + SvelteKit | 31,950 | `1a89224` | **Only repo that genuinely models investments**; single-point-of-failure data sources |
| `myFinance/` | Single-file HTML + Node | 13,250 | `d4bc9cc` | Weakest architecture; **broadest asset coverage** and the only broker integrations |

---

## The ten decisions that define this design

1. **One multi-commodity double-entry ledger.** A grocery purchase and an equity buy are the same
   object — a balanced set of postings. This is what lets budgeting and portfolio analytics share a
   spine. *(From Firefly's journals + Paisa's commodity postings.)*
2. **Sum-to-zero per currency, enforced by a deferred database constraint.** Firefly's 35 correction
   commands are 35 bugs that already shipped. *(`20` §3.5)*
3. **Money is `BIGINT` minor units; quantity is `NUMERIC(38,18)`; they are different types.** No repo
   separates these cleanly. Floats are banned by types, lint, **and** a schema test. *(`30` §1)*
4. **`Quantity` + `Amount` + derived `MarketAmount` on every posting.** Cost basis and market value are
   different numbers. The single most important idea imported from Paisa. *(`20` §3.4)*
5. **Bitemporal prices (`as_of` vs `ingested_at`).** Costs one column now; without it, every future
   backtest has unrecoverable lookahead bias. *(`20` §3.8, `50` §2)*
6. **Server-authoritative, not local-first.** Actual's per-column LWW silently breaks split and
   transfer invariants, and full E2EE would foreclose the server-side valuation that is the product's
   core value. *(`10` §6)*
7. **Event-sourced projections keyed by account revision.** Actual's dependency-graph correctness with
   Postgres durability — and the answer to backdated writes. *(`10` §8)*
8. **Two providers minimum per data need, behind a capability-declaring interface with a conformance
   suite.** Paisa depends on a hobbyist's personal domain for four data classes. *(`40` §1, §3)*
9. **Corporate actions as replayable ledger transactions.** Absent from all four repos; without it cost
   basis silently rots. *(`40` §5)*
10. **Every security requirement is an executable test.** myFinance's audit claims CORS is restricted
    while the code reflects origins. A document cannot catch that; a test can. *(`40` §8)*

---

## What none of the four repos provides, and we must build

1. **Corporate actions** — splits, bonuses, mergers, and the retroactive lot adjustment they require.
2. **Risk analytics** — drawdown, volatility, Sharpe, Sortino, beta, alpha, correlation, VaR.
3. **Derivatives and fixed income** — options, futures, bonds, G-secs.
4. **Real loan mathematics** — amortisation schedules, payoff projection, avalanche vs snowball.
5. **Cost-basis methods beyond FIFO** — LIFO, average, HIFO, specific-identification.
6. **True time-weighted return** — required for any honest benchmark comparison.

*(Full evidence: [research/06-unified-taxonomy.md](research/06-unified-taxonomy.md) §8.)*

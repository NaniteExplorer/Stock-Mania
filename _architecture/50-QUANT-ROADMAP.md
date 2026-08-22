# 50 — Quant and HFT Extensibility

> The stated future direction: evolve from portfolio tracking into a quantitative research platform and
> eventually toward automated / high-frequency execution.
> **Read this before designing any market-data, instrument, or order interface** — the decisions that
> make this possible are made in Phase 1, not Phase 5.

---

## 1. The honest framing

"HFT" spans three very different things, and conflating them is the most expensive mistake available:

| Tier | Latency budget | What it actually requires |
|---|---|---|
| **Systematic / algorithmic** | seconds to minutes | Everything in this document. Achievable on the architecture in `10-SYSTEM-ARCHITECTURE.md`. |
| **Low-latency** | 1–100 ms | Colocation, direct exchange feeds, a Rust/C++ engine, kernel bypass. A different product. |
| **True HFT** | < 100 µs | FPGA, colocated racks, exchange membership, a market-making licence. A different *company*. |

Retail broker APIs — Kite, Upstox, Angel One (Dossier 05 §2) — have **80–300 ms** round-trip latency
and per-second order rate limits. **No true HFT is reachable through them, at any level of engineering
effort.** The realistic and valuable target is systematic strategies with holding periods of minutes to
days, executed reliably.

This document plans for tier 1 in full, keeps tier 2 architecturally reachable, and explicitly scopes
tier 3 out.

---

## 2. What Phase 1 must get right

Five decisions made early are what determine whether the quant phase is an extension or a rewrite. All
five are already specified in the core documents:

| Decision | Where | Why it matters later |
|---|---|---|
| **Bitemporal prices** (`as_of` vs `ingested_at`) | `20-DOMAIN-MODEL.md` §3.8 | Backtesting without point-in-time data is lookahead bias. Unrecoverable if not designed in from the start. |
| **Instrument identity independent of provider** | `20-DOMAIN-MODEL.md` §3.2 | Research data and execution data come from different vendors; they must resolve to the same instrument. |
| **`metadata JSONB` per asset class** | `20-DOMAIN-MODEL.md` §3.2 | Options need strike/expiry/underlying; futures need contract month. Adding columns later means migrating live data. |
| **Event-sourced ledger** | `10-SYSTEM-ARCHITECTURE.md` §8 | A backtest is a replay. An event log makes paper trading and live trading the same code path. |
| **Provider abstraction with capabilities** | `40-MARKET-DATA.md` §3 | A tick provider is just another provider that declares `supportsIntraday`. |

**Lookahead bias is the one truly unrecoverable mistake.** If prices are overwritten in place — as all
four analysed repos do — then a backtest run today sees corrected data that was not available on the
simulated date, and every result is optimistic and worthless. The bitemporal schema is the whole
defence, and it costs one extra column and a wider primary key.

---

## 3. Tick data — when the storage decision changes

`10-SYSTEM-ARCHITECTURE.md` §4.1 chooses Postgres + TimescaleDB. That is correct up to roughly
**10⁹ rows**. Tick data breaks it:

| Granularity | Instruments | Rows/year | Store |
|---|---|---|---|
| Daily bars | 5,000 | 1.3 M | Postgres + Timescale |
| 1-minute bars | 5,000 | 490 M | Timescale with compression |
| 1-second bars | 500 | 3.2 B | **ClickHouse** |
| Full tick / L2 | 100 | 10 B+ | **ClickHouse** or ArcticDB on object storage |

**Trigger for migration:** when the `bars` hypertable exceeds ~500 M rows or p95 query latency on a
one-year window exceeds 2 s.

**Migration path, designed now so it is cheap later:** all price reads already go through
`QuoteRepository`. Adding a ClickHouse implementation behind that interface, routing by granularity, is
a contained change. Nothing above the repository layer knows which store answered.

Do **not** adopt ClickHouse in Phase 1. Two databases is a real operational cost, and daily bars for a
personal portfolio are three orders of magnitude below where it pays.

---

## 4. The research platform (Phase 4)

### 4.1 Feature store

```sql
CREATE TABLE features (
  instrument_id UUID NOT NULL,
  as_of         DATE NOT NULL,
  feature_set   TEXT NOT NULL,          -- 'technical_v1', 'fundamental_v2'
  values        JSONB NOT NULL,
  computed_at   TIMESTAMPTZ NOT NULL,   -- bitemporal, same discipline as quotes
  PRIMARY KEY (instrument_id, as_of, feature_set)
);
SELECT create_hypertable('features', 'as_of');
```

Features are **versioned and bitemporal for the same reason prices are**. A feature recomputed with a
better formula must not silently change the inputs of a backtest run last month.

### 4.2 Backtesting engine

Two engines, deliberately:

| Engine | Library | Use |
|---|---|---|
| **Vectorised** | `vectorbt` | Fast parameter sweeps and idea screening. Wrong about fills, and that is acceptable at this stage. |
| **Event-driven** | Custom, sharing the live execution code path | Realistic. Models latency, slippage, partial fills, and the actual broker rate limits. |

**The event-driven engine must be the same code as live trading**, differing only in the injected
`ExecutionVenue` (simulated vs real). Any divergence between backtest and live code is a source of
silent, expensive discrepancy.

Mandatory realism, because a backtest without these is a fiction:

- Fill at the **next** bar's open, never the signal bar's close.
- Slippage model per asset class, calibrated on realised fills once live data exists.
- Commission, STT, exchange charges, GST, stamp duty, SEBI turnover fees — **in India these
  materially exceed brokerage** and turn many apparently profitable strategies into losers.
- Realistic capital constraints and margin.
- Survivorship-bias-free universe: delisted instruments must remain in the historical universe.

### 4.3 Walk-forward validation

In-sample optimisation with out-of-sample validation, rolling forward. A single backtest over the full
history is overfitting with extra steps. The platform should make walk-forward the default and a
single-period backtest the exception.

---

## 5. Execution (Phase 5)

### 5.1 Order model

```sql
CREATE TABLE orders (
  id             UUID PRIMARY KEY,
  tenant_id      UUID NOT NULL,
  account_id     UUID NOT NULL,
  instrument_id  UUID NOT NULL,
  side           TEXT NOT NULL,        -- BUY | SELL
  order_type     TEXT NOT NULL,        -- MARKET | LIMIT | SL | SL_M
  quantity       NUMERIC(38,18) NOT NULL,
  limit_price    NUMERIC(38,18),
  trigger_price  NUMERIC(38,18),
  time_in_force  TEXT NOT NULL,        -- DAY | IOC | GTC
  status         TEXT NOT NULL,        -- PENDING|SUBMITTED|PARTIAL|FILLED|CANCELLED|REJECTED
  broker_order_id TEXT,
  strategy_id    UUID,
  idempotency_key TEXT NOT NULL,
  submitted_at   TIMESTAMPTZ,
  UNIQUE (tenant_id, idempotency_key)
);

CREATE TABLE fills (
  id           UUID PRIMARY KEY,
  order_id     UUID NOT NULL REFERENCES orders(id),
  quantity     NUMERIC(38,18) NOT NULL,
  price        NUMERIC(38,18) NOT NULL,
  fees_minor   BIGINT NOT NULL,
  filled_at    TIMESTAMPTZ NOT NULL,
  broker_fill_id TEXT
);
```

**A fill generates a ledger transaction** through the normal posting path — `BUY`/`SELL` with lot
creation or disposal. Execution does not get a private data model; it feeds the same ledger. This is
the payoff for having built a proper double-entry core: portfolio, tax, and P&L all work on live
trading with zero additional logic.

`idempotency_key` is unique per tenant. **Duplicate order submission is the single most expensive bug
class in trading systems** and the database must make it impossible.

### 5.2 Risk gate — non-negotiable

Every order passes a synchronous pre-trade check. It fails closed: if the risk service is unavailable,
no order is sent.

| Check | Rejects when |
|---|---|
| Position limit | Resulting position exceeds the per-instrument cap |
| Exposure limit | Sector or asset-class exposure exceeds the cap |
| Order size | Notional exceeds a percentage of average daily volume |
| Fat-finger | Quantity or price deviates > N σ from recent norms |
| Daily loss limit | Realised loss today exceeds the threshold → halt all strategies |
| Rate limit | Orders per minute per strategy |
| Kill switch | A manual global halt, honoured within one tick |
| Margin | Sufficient available margin |

### 5.3 The Rust engine

Introduced only when measured latency in the TypeScript path becomes the binding constraint — which,
given 80–300 ms broker round-trips, it will not be for a long time.

Scope when it arrives: tick ingestion, the order state machine, the risk gate, and strategy execution.
It talks to the same Postgres and publishes fills to the same event stream. The TypeScript services
keep owning the ledger, reporting, and UI.

Being explicit: **moving from 5 ms to 0.5 ms of internal processing is irrelevant when the broker adds
150 ms.** Rust here is about determinism, memory safety in a long-running process, and headroom — not
about beating anyone to a quote.

---

## 6. Regulatory boundaries

Each of these is a line that changes the legal character of the product. Named so they are crossed
deliberately.

| Capability | Consequence (India / SEBI) |
|---|---|
| Track your own portfolio | Unregulated |
| Read broker data via official APIs | Unregulated; governed by broker T&Cs |
| Backtest strategies for yourself | Unregulated |
| Place your own orders programmatically | Broker-approved API usage; some brokers require algo registration |
| **Publish or sell strategies / signals** | **Research Analyst or Investment Adviser registration** |
| **Manage others' money** | **Portfolio Manager registration** |
| **Automated order routing for others** | **Exchange algo approval, broker sponsorship** |

Phases 1–4 stay entirely in the unregulated band. Phase 5 for a **single user's own account** stays
within broker T&Cs. Anything multi-tenant with strategies crosses into regulated territory and needs
counsel before a line of code.

---

## 7. Phasing

| Phase | Delivers | Storage | Language |
|---|---|---|---|
| **1** | Ledger, accounts, transactions, import | Postgres | TypeScript |
| **2** | Portfolio, lots, valuation, prices | + TimescaleDB | TypeScript |
| **3** | Budgets, goals, loans, reports | — | TypeScript |
| **4** | Risk analytics, features, backtesting | + Parquet/Arrow | + Python |
| **5** | Paper trading, then live execution | + ClickHouse *if* tick data | + Rust *if* latency-bound |

**Rule: no phase may require re-architecting an earlier one.** The five Phase-1 decisions in §2 are
what buy that property, and they are the reason this document must be read before the schema is
finalised — not after.

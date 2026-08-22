# 20 — Canonical Domain Model

> The authoritative schema and enum catalogue. Build this before anything else.
> Evidence for every design choice is in `research/`. SQL dialect: PostgreSQL 16.

---

## 1. The central abstraction

```
Transaction  (one economic event; carries date, description, counterparty)
   └── Posting  (2..N rows; each binds ONE account and ONE commodity)
```

Adapted from Firefly's balanced-journal model (Dossier 03 §2.1) and Paisa's commodity-aware posting
(Dossier 04 §2.2). The unification that makes the whole system work:

> **A posting moves a `quantity` of a `commodity` into an `account`. If the commodity is a currency,
> `quantity` is money. If it is an instrument, `quantity` is units and `cost_amount` is what was paid.**

A grocery purchase and an equity buy are the same object:

```
2026-08-22  Groceries at BigBasket
  Assets:Bank:HDFC        -2,450.00 INR
  Expenses:Food            2,450.00 INR

2026-08-22  Buy 10 INFY
  Assets:Broker:Zerodha:INFY   10 INFY  @ cost 15,230.00 INR
  Assets:Broker:Zerodha:Cash          -15,230.00 INR
```

Both balance. The second one additionally creates a **lot**.

---

## 2. Enum catalogue

All enums are Postgres `TEXT` columns with `CHECK` constraints (not native `ENUM` types — altering a
native enum requires an exclusive lock; a `CHECK` can be swapped in a transaction).

### 2.1 `account_type` — 16 values

| Value | Side | Source |
|---|---|---|
| `ASSET_CASH` | Asset | Firefly `Cash account` |
| `ASSET_BANK` | Asset | Firefly `Asset account` |
| `ASSET_SAVINGS` | Asset | Firefly role `savingAsset` |
| `ASSET_BROKERAGE` | Asset | New — holds instrument positions |
| `ASSET_RETIREMENT` | Asset | New — EPF/PPF/NPS/401k |
| `ASSET_DEPOSIT` | Asset | New — FD/RD/post-office (myFinance, Dossier 05 §3) |
| `ASSET_PROPERTY` | Asset | New — real estate |
| `ASSET_OTHER` | Asset | Collectibles, insurance surrender value |
| `LIABILITY_CREDIT_CARD` | Liability | |
| `LIABILITY_LOAN` | Liability | Firefly `Loan` |
| `LIABILITY_MORTGAGE` | Liability | Firefly `Mortgage` |
| `LIABILITY_OTHER` | Liability | Firefly `Debt` |
| `INCOME` | Income | Firefly `Revenue account` |
| `EXPENSE` | Expense | Firefly `Expense account` |
| `EQUITY_OPENING` | Equity | Firefly `Initial balance account` |
| `EQUITY_ADJUSTMENT` | Equity | Firefly `Reconciliation` + `Liability credit` merged |

**Why pseudo-accounts** (`EQUITY_*`): they are the opposing leg for events that otherwise have only
one side — opening balances, reconciliation adjustments, liability increases. This is what makes
sum-to-zero hold *universally* with no exceptions, which is exactly where Firefly's model leaks
(Dossier 03 §5). Directly adopted from Dossier 03 §3.

Modifiers, as separate columns not types: `is_on_budget BOOLEAN` (Actual's key distinction),
`is_closed BOOLEAN`, `is_archived BOOLEAN`.

### 2.2 `asset_class` — 23 values

`CASH`, `EQUITY`, `ETF`, `INDEX`, `MUTUAL_FUND`, `BOND`, `GOVT_SECURITY`, `MONEY_MARKET`,
`FIXED_DEPOSIT`, `RECURRING_DEPOSIT`, `RETIREMENT_SCHEME`, `PRECIOUS_METAL`, `SOVEREIGN_GOLD_BOND`,
`COMMODITY`, `CRYPTO`, `REAL_ESTATE`, `REIT`, `INSURANCE`, `OPTION`, `FUTURE`, `SWAP`, `FX`, `OTHER`.

Compare Paisa's five (`mutualfund`, `nps`, `stock`, `metal`, `unknown` — Dossier 04 §3). The expansion
is driven by the coverage gaps in Dossier 06 §2 and by the quant roadmap (`OPTION`, `FUTURE`, `SWAP`).

### 2.3 `transaction_type` — 18 values

`WITHDRAWAL`, `DEPOSIT`, `TRANSFER`, `OPENING_BALANCE`, `RECONCILIATION`, `LIABILITY_CREDIT`,
`BUY`, `SELL`, `DIVIDEND`, `INTEREST`, `FEE`, `TAX`, `REFUND`, `FX_CONVERSION`,
`CORPORATE_ACTION`, `TRANSFER_IN_KIND`, `VALUATION_ADJUSTMENT`, `INVALID`.

`VALUATION_ADJUSTMENT` handles unpriceable assets (property, collectibles) where the user simply
asserts a new value; it posts the delta against `EQUITY_ADJUSTMENT` so the ledger stays balanced.

### 2.4 `corporate_action_type` — 10 values

`SPLIT`, `REVERSE_SPLIT`, `BONUS`, `RIGHTS`, `MERGER`, `DEMERGER`, `SPINOFF`, `DIVIDEND_CASH`,
`DIVIDEND_STOCK`, `RETURN_OF_CAPITAL`.

**Absent from all four repos** (Dossier 06 §8). Specified in `40-MARKET-DATA.md` §5.

### 2.5 `lot_method` — 5 values

`FIFO`, `LIFO`, `AVERAGE`, `HIFO`, `SPECIFIC_ID`.

Paisa implements FIFO only (Dossier 04 §4.2). Set per account, overridable per disposal.

### 2.6 Remaining enums

| Enum | Values |
|---|---|
| `gain_term` | `SHORT_TERM`, `LONG_TERM`, `EXEMPT`, `SLAB` |
| `interest_type` | `SIMPLE`, `COMPOUND`, `FLAT`, `REDUCING_BALANCE` |
| `compounding_frequency` | `DAILY`, `MONTHLY`, `QUARTERLY`, `HALF_YEARLY`, `ANNUALLY`, `AT_MATURITY` |
| `amortisation_method` | `EQUAL_INSTALMENT` (EMI), `EQUAL_PRINCIPAL`, `INTEREST_ONLY`, `BULLET`, `CUSTOM` |
| `budget_method` | `ENVELOPE`, `TRACKING`, `NONE` |
| `goal_type` | `SAVINGS_TARGET`, `DEBT_PAYOFF`, `RETIREMENT_SWR`, `EMERGENCY_FUND`, `PURCHASE` |
| `recurrence_frequency` | `DAILY`, `WEEKLY`, `FORTNIGHTLY`, `MONTHLY`, `NTH_DAY_OF_MONTH`, `QUARTERLY`, `HALF_YEARLY`, `YEARLY`, `CUSTOM_RRULE` |
| `weekend_handling` | `AS_IS`, `SKIP`, `PREVIOUS_BUSINESS_DAY`, `NEXT_BUSINESS_DAY` (from Firefly `RecurrenceRepetitionWeekend`) |
| `posting_status` | `PENDING`, `CLEARED`, `RECONCILED`, `VOID` |
| `quote_type` | `CLOSE`, `ADJUSTED_CLOSE`, `NAV`, `BID`, `ASK`, `MID`, `LAST`, `SETTLEMENT`, `MARK` |
| `price_source_type` | `PROVIDER`, `MANUAL`, `DERIVED`, `BROKER`, `CARRIED_FORWARD` |
| `connection_status` | `ACTIVE`, `EXPIRED`, `REVOKED`, `ERROR`, `PENDING_CONSENT` |
| `import_status` | `DRAFT`, `PARSED`, `MATCHED`, `CONFIRMED`, `REJECTED` |

---

## 3. Core schema

### 3.1 Identity and tenancy

```sql
CREATE TABLE tenants (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  base_currency CHAR(3) NOT NULL,          -- ISO 4217 reporting currency
  fiscal_year_start_month SMALLINT NOT NULL DEFAULT 1
      CHECK (fiscal_year_start_month BETWEEN 1 AND 12),
  timezone      TEXT NOT NULL DEFAULT 'UTC',
  locale        TEXT NOT NULL DEFAULT 'en-US',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at    TIMESTAMPTZ
);
```

`fiscal_year_start_month` is adopted from Paisa's `financial_year_starting_month` (Dossier 04 §2.4) —
India uses April, the UK uses April 6, the US uses January. Hard-coding January is a defect.

`users`, `memberships` (tenant ↔ user with `role IN ('OWNER','EDITOR','VIEWER','ACCOUNTANT')`).

**Row-level security is mandatory on every tenant-scoped table:**

```sql
ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON accounts
  USING (tenant_id = current_setting('app.tenant_id')::uuid);
```

### 3.2 Currencies and commodities

```sql
CREATE TABLE currencies (
  code      CHAR(3) PRIMARY KEY,           -- ISO 4217, or X-prefixed for crypto
  name      TEXT NOT NULL,
  symbol    TEXT,
  minor_unit SMALLINT NOT NULL CHECK (minor_unit BETWEEN 0 AND 18),
  is_crypto BOOLEAN NOT NULL DEFAULT false
);
```

`minor_unit` drives the integer scale for money (JPY 0, USD 2, BHD 3, BTC 8). Actual hard-codes a
default of 2 (Dossier 01 §3.1); making it per-currency data is strictly better.

```sql
CREATE TABLE instruments (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID,                      -- NULL = global/shared instrument
  symbol         TEXT NOT NULL,             -- canonical internal symbol
  name           TEXT NOT NULL,
  asset_class    TEXT NOT NULL REFERENCES asset_class_lk(value),
  currency       CHAR(3) NOT NULL REFERENCES currencies(code),
  isin           CHAR(12),
  figi           CHAR(12),
  cusip          CHAR(9),
  sedol          CHAR(7),
  exchange_mic   CHAR(4),                   -- ISO 10383
  exchange_ticker TEXT,
  quantity_scale SMALLINT NOT NULL DEFAULT 8,   -- decimals allowed on quantity
  lot_size       NUMERIC(38,18) DEFAULT 1,
  tax_category   TEXT,
  is_active      BOOLEAN NOT NULL DEFAULT true,
  metadata       JSONB NOT NULL DEFAULT '{}',   -- class-specific: strike, expiry, coupon, maturity
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, symbol)
);
CREATE UNIQUE INDEX ON instruments (isin) WHERE isin IS NOT NULL AND tenant_id IS NULL;
```

**Multiple identifier columns, deliberately.** Paisa's `Price{Provider, Code}` (Dossier 04 §3) binds an
instrument to one provider's identifier, so swapping providers invalidates user data. Carrying
ISIN/FIGI/CUSIP/SEDOL/MIC+ticker lets us resolve the same instrument across providers.

`metadata JSONB` carries class-specific fields — `{strike, expiry, option_type, underlying_id}` for
options, `{coupon_rate, maturity_date, face_value, day_count}` for bonds — with a Zod schema per
`asset_class` validating it at the application boundary.

### 3.3 Accounts

```sql
CREATE TABLE accounts (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id),
  parent_id      UUID REFERENCES accounts(id),
  name           TEXT NOT NULL,
  path           LTREE NOT NULL,             -- 'Assets.Broker.Zerodha'
  account_type   TEXT NOT NULL,
  currency       CHAR(3) NOT NULL REFERENCES currencies(code),
  institution_id UUID REFERENCES institutions(id),
  is_on_budget   BOOLEAN NOT NULL DEFAULT true,
  is_closed      BOOLEAN NOT NULL DEFAULT false,
  lot_method     TEXT NOT NULL DEFAULT 'FIFO',
  revision       BIGINT NOT NULL DEFAULT 0,  -- bumped on every posting; drives cache invalidation
  account_number_last4 TEXT,
  account_number_enc   BYTEA,                -- envelope-encrypted
  metadata       JSONB NOT NULL DEFAULT '{}',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at     TIMESTAMPTZ,
  UNIQUE (tenant_id, path)
);
CREATE INDEX ON accounts USING GIST (path);
```

`LTREE` gives Paisa's readable colon-paths (Dossier 04 §2.3) *and* real hierarchical queries
(`path <@ 'Assets.Broker'`), while `account_type` keeps the typing that Paisa's convention-only approach
lacks. Best of both.

`revision` is the cache-invalidation key described in `10-SYSTEM-ARCHITECTURE.md` §8.

### 3.4 Transactions and postings — the heart

```sql
CREATE TABLE transactions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL REFERENCES tenants(id),
  txn_type         TEXT NOT NULL,
  txn_date         DATE NOT NULL,            -- accounting date (date-only, NEVER a timestamp)
  settlement_date  DATE,
  description      TEXT NOT NULL DEFAULT '',
  counterparty_id  UUID REFERENCES counterparties(id),
  external_id      TEXT,                     -- provider's id; Actual's imported_id
  import_batch_id  UUID REFERENCES import_batches(id),
  is_forecast      BOOLEAN NOT NULL DEFAULT false,
  version          INTEGER NOT NULL DEFAULT 1,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at       TIMESTAMPTZ
);
CREATE UNIQUE INDEX ON transactions (tenant_id, external_id)
  WHERE external_id IS NOT NULL AND deleted_at IS NULL;

CREATE TABLE postings (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL,
  transaction_id UUID NOT NULL REFERENCES transactions(id) ON DELETE RESTRICT,
  account_id     UUID NOT NULL REFERENCES accounts(id),
  sequence       SMALLINT NOT NULL,

  -- MONEY: integer minor units, scale from currencies.minor_unit
  currency       CHAR(3) NOT NULL REFERENCES currencies(code),
  amount_minor   BIGINT NOT NULL,           -- signed; the sum-to-zero column

  -- COMMODITY: present only when this posting moves an instrument
  instrument_id  UUID REFERENCES instruments(id),
  quantity       NUMERIC(38,18),            -- signed units
  unit_cost      NUMERIC(38,18),            -- cost per unit in `currency`

  category_id    UUID REFERENCES categories(id),
  status         TEXT NOT NULL DEFAULT 'PENDING',
  memo           TEXT,
  deleted_at     TIMESTAMPTZ,

  CONSTRAINT commodity_coherent CHECK (
    (instrument_id IS NULL AND quantity IS NULL AND unit_cost IS NULL)
    OR
    (instrument_id IS NOT NULL AND quantity IS NOT NULL)
  ),
  CONSTRAINT no_category_on_transfer CHECK (
    NOT (category_id IS NOT NULL AND instrument_id IS NOT NULL)
  )
);
CREATE INDEX ON postings (account_id, transaction_id) WHERE deleted_at IS NULL;
CREATE INDEX ON postings (instrument_id) WHERE instrument_id IS NOT NULL;
```

**Design notes:**

- **`amount_minor BIGINT`.** Adopted from Actual (Dossier 01 §3.1), rejected Firefly's
  `decimal(32,12)` (Dossier 03 §2.3) because one type cannot serve both money and rates well. `BIGINT`
  holds ±9.2×10¹⁸ minor units — ample.
- **`quantity NUMERIC(38,18)`** — a *separate* type for a genuinely different quantity. Fractional
  shares, 8-decimal crypto, and gold in grams all fit. This is Paisa's `Quantity`/`Amount` split
  (Dossier 04 §2.2), which is the single most important idea we are importing.
- **`txn_date DATE`, not `TIMESTAMPTZ`.** A posting happens on a *day*, not an instant. Firefly had to
  retrofit this with `ConvertsDatesToUTC` and `CorrectsTimezoneInformation` (Dossier 03 §7). Event
  timestamps (`created_at`) are `TIMESTAMPTZ`; accounting dates are `DATE`. Never confuse them.
- **`ON DELETE RESTRICT`.** Postings are never cascaded away.

### 3.5 The sum-to-zero invariant — enforced, not repaired

The defining fix versus Firefly (Dossier 03 §2.2), where this is a maintenance command.

```sql
CREATE OR REPLACE FUNCTION assert_transaction_balanced() RETURNS TRIGGER AS $$
DECLARE unbalanced RECORD;
BEGIN
  FOR unbalanced IN
    SELECT p.currency, SUM(p.amount_minor) AS total
    FROM postings p
    WHERE p.transaction_id = COALESCE(NEW.transaction_id, OLD.transaction_id)
      AND p.deleted_at IS NULL
    GROUP BY p.currency
    HAVING SUM(p.amount_minor) <> 0
  LOOP
    RAISE EXCEPTION
      'Transaction % is unbalanced in %: sum = %',
      COALESCE(NEW.transaction_id, OLD.transaction_id),
      unbalanced.currency, unbalanced.total
      USING ERRCODE = 'check_violation';
  END LOOP;
  RETURN NULL;
END; $$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER postings_balanced
  AFTER INSERT OR UPDATE OR DELETE ON postings
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_transaction_balanced();
```

`DEFERRABLE INITIALLY DEFERRED` is essential — it lets a multi-posting transaction be inserted row by
row and checks only at `COMMIT`.

**Balance is per currency.** A cross-currency transaction balances in each currency separately, via an
explicit FX conversion posting pair through an `EQUITY_ADJUSTMENT` or FX account. This is precisely
what Firefly's `foreign_amount`-on-the-same-row model cannot do (Dossier 03 §5), and why its own repair
job has to special-case transfers.

### 3.6 Legality matrix

Adopted wholesale from Firefly `config/firefly.php:745` (Dossier 03 §4) and extended for investments.
Stored as **data**, not code:

```sql
CREATE TABLE txn_type_legality (
  txn_type          TEXT NOT NULL,
  source_type       TEXT NOT NULL,
  destination_type  TEXT NOT NULL,
  PRIMARY KEY (txn_type, source_type, destination_type)
);
```

Seeded with Firefly's matrix plus:

| txn_type | source | destination |
|---|---|---|
| `BUY` | `ASSET_BANK`, `ASSET_BROKERAGE` | `ASSET_BROKERAGE`, `ASSET_RETIREMENT` |
| `SELL` | `ASSET_BROKERAGE`, `ASSET_RETIREMENT` | `ASSET_BANK`, `ASSET_BROKERAGE` |
| `DIVIDEND` | `INCOME` | `ASSET_BANK`, `ASSET_BROKERAGE` |
| `INTEREST` | `INCOME` | `ASSET_BANK`, `ASSET_DEPOSIT` |
| `FEE` | `ASSET_*` | `EXPENSE` |
| `CORPORATE_ACTION` | `ASSET_BROKERAGE` | `ASSET_BROKERAGE`, `EQUITY_ADJUSTMENT` |
| `VALUATION_ADJUSTMENT` | `ASSET_PROPERTY`, `ASSET_OTHER` | `EQUITY_ADJUSTMENT` |

`EXPENSE` is never a valid source — Firefly's rule (`config/firefly.php:543`), preserved.

### 3.7 Lots — cost basis

```sql
CREATE TABLE lots (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL,
  account_id        UUID NOT NULL REFERENCES accounts(id),
  instrument_id     UUID NOT NULL REFERENCES instruments(id),
  open_posting_id   UUID NOT NULL REFERENCES postings(id),
  acquired_on       DATE NOT NULL,
  original_quantity NUMERIC(38,18) NOT NULL CHECK (original_quantity > 0),
  remaining_quantity NUMERIC(38,18) NOT NULL CHECK (remaining_quantity >= 0),
  cost_basis_minor  BIGINT NOT NULL,          -- total cost of original_quantity
  currency          CHAR(3) NOT NULL,
  is_closed         BOOLEAN GENERATED ALWAYS AS (remaining_quantity = 0) STORED,
  CONSTRAINT remaining_lte_original CHECK (remaining_quantity <= original_quantity)
);

CREATE TABLE lot_disposals (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lot_id           UUID NOT NULL REFERENCES lots(id),
  close_posting_id UUID NOT NULL REFERENCES postings(id),
  disposed_on      DATE NOT NULL,
  quantity         NUMERIC(38,18) NOT NULL CHECK (quantity > 0),
  proceeds_minor   BIGINT NOT NULL,
  cost_basis_minor BIGINT NOT NULL,           -- allocated portion of the lot's basis
  realised_gain_minor BIGINT GENERATED ALWAYS AS (proceeds_minor - cost_basis_minor) STORED,
  gain_term        TEXT NOT NULL,
  holding_days     INTEGER NOT NULL
);
```

**Materialised lots, not recomputed.** Paisa recomputes FIFO over full posting history on every call
(Dossier 04 §4.2) — correct but O(n) per query and impossible to audit. Persisting lots and disposals
makes cost basis reproducible, auditable, and cheap, and it is a prerequisite for `SPECIFIC_ID`, which
inherently requires a durable identity per lot.

Lot selection algorithms in `30-CALCULATIONS.md` §3.

### 3.8 Prices — bitemporal, TimescaleDB

```sql
CREATE TABLE quotes (
  instrument_id UUID NOT NULL REFERENCES instruments(id),
  as_of         DATE NOT NULL,               -- the date the price refers to
  quote_type    TEXT NOT NULL,
  price         NUMERIC(38,18) NOT NULL,
  currency      CHAR(3) NOT NULL,
  source_type   TEXT NOT NULL,
  provider_id   TEXT,
  ingested_at   TIMESTAMPTZ NOT NULL DEFAULT now(),   -- when WE learned it
  PRIMARY KEY (instrument_id, as_of, quote_type, provider_id)
);
SELECT create_hypertable('quotes', 'as_of', chunk_time_interval => INTERVAL '1 year');
```

**Bitemporality (`as_of` vs `ingested_at`) is not optional.** It is what lets us answer *"what did we
believe this position was worth on 2025-03-31, using the data we had then?"* — required for
reproducible tax reports and for honest backtests. Retroactive vendor corrections become new rows, not
overwrites. None of the four repos does this; all four overwrite prices in place.

`fx_rates` has the identical shape keyed by `(base, quote, as_of)`, with `user_rate` alongside
`provider_rate` — adopted from Firefly's `currency_exchange_rates` (Dossier 03 §5), because a
user-asserted rate matters for tax.

### 3.9 Remaining entities

| Table | Purpose | Notable design |
|---|---|---|
| `institutions` | Banks, brokers, fund houses | |
| `counterparties` | Payees/merchants | `learn_categories BOOLEAN` (from Actual's `payees.learn_categories`); optional `embedding vector(384)` for fuzzy merchant matching |
| `categories` | Budget categories | Tree via `LTREE`; `is_income BOOLEAN` |
| `budgets`, `budget_periods`, `budget_allocations` | Envelope + tracking | `carryover BOOLEAN` per category-period (Actual, Dossier 01 §4.1) |
| `budget_templates` | The goal-template DSL | Own column, **not** the notes field — fixing Actual's overload (Dossier 01 §4.3) |
| `goals` | Savings/retirement | `swr NUMERIC` for retirement (Paisa, Dossier 04 §2.4) |
| `loans` | Loan terms | `principal_minor`, `rate`, `interest_type`, `compounding_frequency`, `amortisation_method`, `term_months`, `start_date` — enough to *compute* a schedule, which no repo can (Dossier 06 §3) |
| `amortisation_schedule` | Generated rows | `period, due_date, opening_balance, principal, interest, closing_balance` |
| `corporate_actions` | Splits, dividends, mergers | See `40-MARKET-DATA.md` §5 |
| `rules`, `rule_conditions`, `rule_actions` | Automation | **Normalised into rows**, not JSON blobs — fixing Actual (Dossier 01 §6) so "which rules touch category X" is a query |
| `recurrences` | Schedules | First-class, **not** implemented as rules — fixing Actual (Dossier 01 §4.4). Supports RFC 5545 `RRULE` |
| `connections` | Bank/broker links | `access_token_enc BYTEA`, `consent_expires_at`, `status`. Never leaves the server (Dossier 05 §2.5) |
| `import_batches`, `import_rows` | Staging | Rows land in `DRAFT`, are matched, then confirmed. Nothing enters the ledger unconfirmed |
| `documents` | Attachments | Content-addressed by SHA-256 |
| `tax_events` | Realised gains | Derived from `lot_disposals`, snapshotted per fiscal year |
| `audit_events` | Append-only | `actor_id, action, entity_type, entity_id, before JSONB, after JSONB, ip, request_id, at`. No `UPDATE`/`DELETE` grant |
| `ledger_events` | Event source | Append-only mutation log driving projections (`10-SYSTEM-ARCHITECTURE.md` §8) |

---

## 4. Soft delete and audit

Every user-facing table carries `deleted_at TIMESTAMPTZ`. Nothing is hard-deleted — adopted from
Actual's universal `tombstone` (Dossier 01 §3.4). All reads go through views that filter it:

```sql
CREATE VIEW v_postings AS SELECT * FROM postings WHERE deleted_at IS NULL;
```

Application code queries `v_*` views; direct table access is reserved for the ledger module.

---

## 5. Worked examples

### 5.1 Split transaction

Actual uses parent/child rows (Dossier 01 §3.3); Firefly uses multiple journals per group
(Dossier 03 §2.1). **We need neither** — N postings in one transaction *is* a split:

```
2026-08-22  Costco
  Assets:Bank:HDFC   -8,400 INR
  Expenses:Food       5,200 INR
  Expenses:Household  2,100 INR
  Expenses:Fuel       1,100 INR
```

Balances. No parent/child bookkeeping, no `isParent`/`isChild` flags, no sum-to-parent validation code —
the sum-to-zero trigger already covers it. This is a strict simplification over both repos.

### 5.2 Transfer

```
2026-08-22  Transfer to savings
  Assets:Bank:HDFC     -50,000 INR
  Assets:Bank:Savings   50,000 INR
```

One transaction, two postings. **No `transferred_id` twin rows** (Actual, Dossier 01 §3.2), so a
half-transfer is structurally impossible.

### 5.3 Equity buy with brokerage

```
2026-08-22  Buy 10 INFY @ 1,520 + 3.20 fees
  Assets:Broker:Zerodha:Cash        -15,203.20 INR
  Assets:Broker:Zerodha  [INFY]      15,200.00 INR  qty +10, unit_cost 1520.00
  Expenses:Brokerage                      3.20 INR
```

Creates `lots(instrument=INFY, original_quantity=10, cost_basis_minor=1520000, acquired_on=2026-08-22)`.

**Fee treatment is a policy flag.** Capitalising the fee into basis (`unit_cost = 1520.32`) is correct
in most tax regimes; expensing it separately is shown above. Configurable per tenant; the default is
capitalise.

### 5.4 Cross-currency purchase

```
2026-08-22  Buy 5 AAPL @ USD 220, funded from an INR account
  Assets:Broker:IBKR:Cash   -1,100.00 USD
  Assets:Broker:IBKR [AAPL]  1,100.00 USD   qty +5, unit_cost 220.00
  -- funding leg, separate FX_CONVERSION transaction:
  Assets:Bank:HDFC        -92,400.00 INR
  Equity:FX                92,400.00 INR
  Equity:FX                -1,100.00 USD
  Assets:Broker:IBKR:Cash   1,100.00 USD
```

Each currency sums to zero independently. The FX rate implied (84.00) is recorded on the transaction
and reconciled against `fx_rates`. Contrast Firefly, where `foreign_amount` on the same row breaks the
uniform invariant (Dossier 03 §5).

---

## 6. Mapping from the source repos

For agents migrating data or cross-referencing:

| Their concept | Ours |
|---|---|
| Actual `transactions.amount` (INT) | `postings.amount_minor` |
| Actual `transferred_id` pair | One transaction, two postings |
| Actual `isParent`/`isChild` | N postings in one transaction |
| Actual `tombstone` | `deleted_at` |
| Actual `offbudget` | `accounts.is_on_budget` |
| Actual `description` (payee id) | `transactions.counterparty_id` |
| Actual `financial_id` | `transactions.external_id` |
| Firefly `TransactionGroup` | `transactions` (splits need no group) |
| Firefly `TransactionJournal` | `transactions` |
| Firefly `Transaction` (row) | `postings` |
| Firefly `foreign_amount` | A separate FX posting pair |
| Firefly `Initial balance account` | `EQUITY_OPENING` |
| Firefly `Reconciliation` + `Liability credit` | `EQUITY_ADJUSTMENT` |
| Firefly `account_meta.interest` | `loans.rate` |
| Paisa `Posting.Amount` | `postings.amount_minor` |
| Paisa `Posting.Quantity` | `postings.quantity` |
| Paisa `Posting.MarketAmount` | Derived: `quantity × quotes.price` |
| Paisa `Commodity` | `instruments` |
| Paisa `Commodity.TaxCategory` | `instruments.tax_category` |
| Paisa account path string | `accounts.path` (LTREE) |
| myFinance `mypf_fds` / `mypf_rds` | `ASSET_DEPOSIT` + `instruments.metadata` |
| myFinance `mypf_sgb` | `SOVEREIGN_GOLD_BOND` |
| myFinance `mypf_physical_gold` | `PRECIOUS_METAL` + duty/GST in `metadata` |

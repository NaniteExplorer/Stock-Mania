# Dossier 01 — Actual Budget

> Source: `actual/` @ commit `625e18e20` (2026-08-21). ~298,200 LOC (149.6K `.ts`, 135.6K `.tsx`).
> Monorepo: yarn workspaces + `lage`. Packages: `loot-core` (engine), `desktop-client`, `mobile-client`,
> `sync-server`, `crdt`, `api`, `cli`, `component-library`, `plugins-service`, `desktop-electron`.

## 1. Positioning

Actual is a **local-first envelope-budgeting** app. The entire engine (`loot-core`) runs *on the client*
against a local SQLite database; the server (`sync-server`) is a **dumb, zero-knowledge message relay**.
It is the reference implementation for offline-first personal finance.

**It is not an investment tracker.** There is no security, holding, lot, quantity, or price concept
anywhere in the schema (see §3.7). This is the single largest gap versus our requirements.

---

## 2. Data schema

Base schema: `packages/loot-core/src/server/sql/init.sql`, evolved by 100+ files in
`packages/loot-core/migrations/*.sql` (latest `1783004650757_schedule_sort_order.sql`).

### 2.1 Core tables (as created in `init.sql`)

| Table | Key columns | Notes |
|---|---|---|
| `accounts` | `id` TEXT PK, `account_id`, `name`, `balance_current`, `balance_available`, `balance_limit`, `mask`, `official_name`, `type`, `subtype`, `bank`, `offbudget` INT dflt 0, `closed` INT dflt 0, `tombstone` INT dflt 0 | `offbudget` is the on/off-budget switch. `bank` FK to `banks.id`. Balance columns are a bank-sync cache, **not** the source of truth. |
| `transactions` | `id` TEXT PK, `isParent`, `isChild`, `acct`, `category`, `amount` INT, `description` (= payee id), `notes`, `date` INT (`YYYYMMDD`), `financial_id`, `type`, `location`, `error`, `imported_description`, `starting_balance_flag`, `transferred_id`, `sort_order` REAL, `tombstone` | The one central table. `description` holds the **payee id** (legacy naming). `date` is an *integer* like `20260822`. |
| `categories` | `id` PK, `name`, `is_income`, `cat_group`, `sort_order` REAL, `tombstone` | |
| `category_groups` | `id` PK, `name` UNIQUE, `is_income`, `sort_order` REAL, `tombstone` | |
| `payees` | added in `1550601598648_payees.sql` | `transfer_acct` marks a payee as a transfer target. |
| `banks` | `id` PK, `bank_id`, `name`, `tombstone` | |
| `pending_transactions` | `id`, `acct`, `amount`, `description`, `date` | Bank-sync pending buffer. |
| `spreadsheet_cells` | `name` PK, `expr`, `cachedValue` | Persisted derived-value cache (see §4). |
| `messages_crdt` | `id` INTEGER PK, `timestamp` TEXT UNIQUE, `dataset`, `row`, `column`, `value` BLOB | **The sync log.** One row per field-level change. |
| `messages_clock` | `id` PK, `clock` TEXT | Serialized HLC + merkle trie. |
| `category_mapping` | `id`, `transferId` | Redirect map so deleted categories keep resolving. |
| `created_budgets` | `month` PK | |
| `__migrations__` | `id` INT PK | Migration ledger keyed by the filename timestamp. |

### 2.2 Tables added by migration (selected)

| Migration | Adds |
|---|---|
| `1597756566448_rules.sql` | `rules(id, stage, conditions, actions, tombstone)` — conditions/actions are **JSON blobs in TEXT**. |
| `1618975177358_schedules.sql` | `schedules(id, rule, active, completed, posts_transaction, tombstone)`, `schedules_next_date(...)`, `schedules_json_paths(schedule_id, payee, account, amount, date)`; `ALTER TABLE transactions ADD COLUMN schedule` |
| `1688749527273_transaction_filters.sql` | Saved filters |
| `1694438752000_add_goal_targets.sql` | Goal targets on categories |
| `1697046240000_add_reconciled.sql` | `transactions.reconciled` (distinct from `cleared`) |
| `1704572023730_add_account_sync_source.sql` | `accounts.account_sync_source` (`goCardless` or `simpleFin`) |
| `1707267033000_reports.sql` | `custom_reports`, `dashboard` |
| `1749799110000_add_tags.sql` | `tags` table (tags previously lived only inline in `notes`) |
| `1740506588539_add_last_reconciled_at.sql` | `accounts.last_reconciled_at` |
| `1780606215001_add_performance_indexes.sql` | Late-stage index tuning |

**Observation:** `1686139660866_remove_account_type.sql` is followed two days later by
`1688841238000_add_account_type.sql`. Actual's account "type" is weakly modelled and carries almost no
semantics; `offbudget` does the real work.

---

## 3. Domain mechanics

### 3.1 Money representation — integer minor units

`packages/loot-core/src/shared/util.ts:541`

```ts
export function amountToInteger(amount: Amount, decimalPlaces: number = 2): IntegerAmount {
  const multiplier = Math.pow(10, decimalPlaces);
  return Math.round(amount * multiplier);
}
export function integerToAmount(integerAmount: IntegerAmount, decimalPlaces: number = 2): Amount {
  const divisor = Math.pow(10, decimalPlaces);
  return integerAmount / divisor;
}
```

All persisted amounts are `INTEGER` minor units. Arithmetic happens on JS `number`, which is exact for
integers up to 2^53 (about 90 trillion cents) — **safe**. `decimalPlaces` is configurable, so
zero-decimal (JPY) and three-decimal currencies work. `Math.round` is the only rounding site — it is
half-away-from-zero for positives but half-toward-zero for negatives (`Math.round(-0.5) === -0`), a
subtle asymmetry.

**Verdict: adopt.** Integer minor units is the correct choice; we extend it with an explicit
scale-per-currency table rather than a default parameter.

### 3.2 Transfers — paired rows joined by `transferred_id`

A transfer is **two `transactions` rows**, one per account, each pointing at the other via
`transferred_id`, with the payee (`description`) set to a payee whose `transfer_acct` is the far account.
There is no third "transfer" entity. Keeping both legs consistent (amount negation, date, delete
cascade) is *application logic*, not a database constraint.

**Trade-off:** cheap to query per account (one row, no join), but every write path must remember to
maintain the twin. This is the classic source of "ghost half-transfers". Firefly's journal model
(Dossier 02) makes the inconsistency structurally impossible instead.

### 3.3 Splits — parent/child rows in the same table

`isParent=1` on the header row; `isChild=1` on each leg, joined by `parent_id`. The parent carries the
total; children carry categories. Children sum to the parent by convention, enforced in application
code. `transactions.error` stores a split-transaction error when they do not.

### 3.4 Soft delete — `tombstone`

Every user-facing table has `tombstone INTEGER DEFAULT 0`. Nothing is ever hard-deleted. This is
**required** by the CRDT: a delete must be a *value* that can be synced and ordered, not an absence.

### 3.5 Cleared vs reconciled vs locked

Three distinct states: `cleared` (bank shows it), `reconciled` (user matched it in a reconciliation
session, added 2023), and `accounts.last_reconciled_at`. Reconciled transactions are edit-locked in the UI.

### 3.6 Starting balance

`transactions.starting_balance_flag` marks the synthetic opening-balance transaction. Note this is a
*flag on an ordinary transaction*, not a dedicated account type — contrast Firefly's
`Initial balance account`.

### 3.7 Investments — NOT PRESENT

Definitive: no `securities`, `holdings`, `lots`, `quantity`, `price`, or `commodity` table or column
exists. An investment account can only be modelled as an off-budget account whose *cash balance* the
user manually adjusts. No cost basis, no unrealised P&L, no XIRR, no multi-currency valuation.

### 3.8 Liabilities — nominal only

A credit card is an ordinary account with a negative balance plus `balance_limit` (bank-sync populated).
No interest rate, no APR, no amortisation, no minimum payment. A mortgage is untrackable beyond
"an account with a negative number in it".

---

## 4. The spreadsheet engine — Actual's crown jewel

`packages/loot-core/src/server/spreadsheet/`, consumed by `packages/loot-core/src/server/budget/`.

Every derived budget value is a **named cell in a named sheet**, with a declared dependency list and a
`run` function. Sheets are named per month (`monthUtils.sheetForMonth`, e.g. `budget202608`). Cells are
either `createStatic` (user-entered) or `createDynamic` (computed). Cross-sheet references use
`sheetName!cellName` — which is how month-over-month rollover is expressed as a *dependency edge*
rather than an imperative loop.

Values are persisted in `spreadsheet_cells(name, expr, cachedValue)`, so a cold start does not
recompute the entire history.

**This is a hand-rolled incremental computation graph.** When a transaction changes, only
`sum-amount-<cat>` is invalidated, and the change propagates forward through the dependency DAG. This
is precisely the right answer to the "a backdated transaction invalidates everything after it" problem,
and it is the single most important idea to carry forward from this repo.

### 4.1 Envelope formulas (exact, from `server/budget/envelope.ts`)

Per-category carryover — `envelope.ts:48-64`:

```ts
sheet.get().createDynamic(sheetName, `leftover-${cat.id}`, {
  dependencies: [
    `budget-${cat.id}`, `sum-amount-${cat.id}`,
    `${prevSheetName}!carryover-${cat.id}`,
    `${prevSheetName}!leftover-${cat.id}`,
    `${prevSheetName}!leftover-pos-${cat.id}`,
  ],
  run: (budgeted, spent, prevCarryover, prevLeftover, prevLeftoverPos) =>
    safeNumber(number(budgeted) + number(spent)
      + (prevCarryover ? number(prevLeftover) : number(prevLeftoverPos))),
});
```

Because `spent` is stored **negative**, the formula is an addition. In plain terms:

```
leftover[c,m]     = budget[c,m] + spent[c,m]
                    + (carryover[c,m-1] ? leftover[c,m-1] : leftover_pos[c,m-1])
leftover_pos[c,m] = max(0, leftover[c,m])            # envelope.ts:66-71
```

`leftover_pos` is the mechanism for the default rule *"a positive balance rolls over; an overspend does
not — it is absorbed by next month's To Budget"*. Setting `carryover[c,m]` (the per-category
"rollover overspending" toggle) switches that category to propagating the negative too.

Overspend absorption — `envelope.ts:133-144`:

```
last_month_overspent[m] = SUM over categories c of:
                            carryover[c,m-1] ? 0 : min(0, leftover[c,m-1])
```

To Budget — `envelope.ts:193-208`:

```
to_budget[m] = available_funds[m] + last_month_overspent[m]
               + total_budgeted[m] - buffered_selected[m]
```

where `total_budgeted` is a **negated** sum (`envelope.ts:157`: `return -sumAmounts(...amounts)`), and
`buffered_selected` chooses between the user's manual "hold for next month" (`buffered`) and the
auto-computed `buffered-auto`.

### 4.2 Two budget modes

- `envelope.ts` — classic zero-sum envelope (YNAB style). Money must be assigned out of `to-budget`.
- `tracking.ts` — "report" budget. Compares actuals against a plan without the zero-sum constraint.

Both are built on the same spreadsheet primitives; they differ only in which cells they declare.

### 4.3 Goal templates — a real DSL

`server/budget/goal-template.pegjs` (Peggy grammar, compiled via `vite-plugin-peggy`). Users write
directives in a category's **notes field**, prefixed `#template` (optionally `#template-<priority>`)
or `#goal`.

| Type | Syntax | Semantics |
|---|---|---|
| `simple` | `#template 50` | Budget a flat amount each month |
| `by` | `#template 1200 by 2026-12` | Save to a target by a month, spread evenly |
| `spend` | `#template 1200 by 2026-12 spend from 2026-01` | Sinking fund: accumulate, then spend down |
| `periodic` | `#template 25 repeat every 2 weeks starting 2026-01-05` | Day/week/month/year periods |
| `percentage` | `#template 10% of previous Income` | Percent of (previous month's) income category |
| `schedule` | `#template schedule full Rent [increase 5%]` | Derive the amount from a linked schedule |
| `remainder` | `#template remainder 2` | Weighted share of whatever is left in To Budget |
| `average` | `#template average 3 months [decrease 10%]` | Trailing average of actual spend |
| `copy` | `#template copy from 3 months ago` | Copy a prior month's budget |
| `goal` | `#goal 5000` | A long-run target, not a monthly assignment |

Modifiers: `[increase N%]` / `[decrease N]` (percent or fixed).
Limits: `up to N`, `up to N per day`, `up to N per week starting <date>`, each optionally `hold`.
Priorities (`#template-1`, `#template-2`, …) control fill order when funds are scarce; `remainder`
always runs last.

**This is a genuinely excellent feature** — a declarative budgeting language stored in user-editable
text. Worth reimplementing, but with a proper field rather than overloading the notes field.

### 4.4 Schedules are implemented *as rules*

`schedules.rule` is an FK to a `rules` row. The schedule's payee/account/amount/date live inside that
rule's **conditions**, and `schedules_json_paths` records which condition index holds each field.
`schedules_next_date` caches the computed occurrence.

This is clever — one matching engine serves both auto-categorisation and "did this scheduled bill
arrive?" — but it badly overloads the rule concept and makes the schedule shape opaque to SQL.
**Do not copy this.** Model schedules as first-class recurrences that *emit* a matcher.

---

## 5. Rules engine

`packages/loot-core/src/server/rules/` plus `packages/loot-core/src/shared/rules.ts`.

### 5.1 Condition operators (`server/rules/condition.ts`)

`is`, `isNot`, `isapprox`, `isbetween`, `contains`, `doesNotContain`, `oneOf`, `notOneOf`,
`hasTags`, `hasAnyTag`, `gt`, `gte`, `lt`, `lte`, `matches` (regex), `onBudget`, `offBudget`.

`isapprox` is type-aware — for `date` it fuzzes by day/month/year granularity
(`condition.ts:301-305`); for `amount` it applies a tolerance band. This is what makes schedule
matching work against messy real bank data.

### 5.2 Fields and their types (`shared/rules.ts:62-89`)

| Field | Type | Disallowed ops |
|---|---|---|
| `imported_payee` | string | `hasTags`, `hasAnyTag` |
| `payee` | id | `onBudget`, `offBudget` |
| `payee_name` | string | — |
| `date` | date | — |
| `notes` | string | `oneOf`, `notOneOf` |
| `amount` | number | — |
| `category` | id | `onBudget`, `offBudget` (internal op `and`) |
| `category_group` | id | `onBudget`, `offBudget` (internal op `and`) |
| `account` | id | — |
| `cleared`, `reconciled`, `transfer`, `parent` | boolean | — |
| `saved` | saved | — (references a saved filter) |

`amount` is virtualised into `amount-inflow` / `amount-outflow` at the UI boundary
(`shared/rules.ts:126-134`) so users can reason in positive numbers.

### 5.3 Actions (`server/rules/action.ts`)

`set` (typed number/date/boolean/string, with **handlebars templating** for string targets —
`rules/handlebars-helpers.ts`), `set-split-amount` (methods `fixed-amount`, `fixed-percent`,
`formula`, remainder), `link-schedule`, `prepend-notes`, `append-notes`, `delete-transaction`.

`balanceOfFormula.ts` gives split actions access to account balances — a small embedded formula language.

### 5.4 Staging and indexing

`rules.stage` is one of `pre`, `null`, `post`, giving three ordered passes. `rule-indexer.ts` builds an
inverted index so N rules are not linearly scanned per transaction — important once a user has hundreds.

`payees.learn_categories` (migration `1737158400000`) drives automatic category learning from history.

---

## 6. Judgement

### Adopt

1. **Integer minor units** for money (§3.1).
2. **The spreadsheet dependency graph** for all derived values (§4) — the correct answer to incremental
   recomputation under backdated edits.
3. **Universal tombstones** (§3.4) — a prerequisite for any sync model.
4. **The goal-template DSL** (§4.3) — best-in-class declarative budgeting.
5. **Typed rule fields with per-field operator allow-lists** (§5.2) — makes an unsound rule
   unconstructible rather than merely invalid.
6. **`isapprox`** as a first-class fuzzy operator (§5.1).

### Reject

1. **`transferred_id` twin rows** (§3.2) — replace with balanced postings.
2. **Schedules-as-rules** (§4.4) — overloaded and SQL-opaque.
3. **JSON blobs in TEXT for rule conditions/actions** — unqueryable; we need "which rules touch
   category X".
4. **`description` meaning payee id** — gratuitous confusion.
5. **The absence of any instrument/holding/lot model** (§3.7) — the fundamental blocker for our use case.

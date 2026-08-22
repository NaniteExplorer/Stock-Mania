# Dossier 03 — Firefly III

> Source: `firefly-iii/` @ commit `46728cb71e` (2026-08-20). ~200,000 LOC (189.5K PHP).
> Laravel monolith. Blade + Vue frontend, MySQL/Postgres/SQLite, Laravel Passport for OAuth2.

## 1. Positioning

Firefly III is the **most rigorous accounting model** of the four repos: a genuine double-entry ledger
with 14 account types, 7 transaction types, an explicit legality matrix governing which account types
may participate in which transaction, and full multi-currency support.

It is also the strongest evidence for a central thesis of our design: **Firefly's double-entry
invariant is a convention enforced by periodic repair jobs, not by the database.** It ships 35
`Correction*` console commands whose entire job is to find and fix data that violates invariants the
schema permits. Every one of those commands is a specification of an invariant we should enforce at
write time instead.

**Gap versus our requirements:** no instruments, no holdings, no quantities, no prices, no cost basis.
An investment is an asset account with a number in it. Same fundamental blocker as Actual.

---

## 2. The double-entry core

### 2.1 Three-level hierarchy

```
TransactionGroup          -- a user-visible "transaction" (may be a split)
  └── TransactionJournal  -- one balanced economic event; carries date, type, currency, description
        └── Transaction   -- 2..N rows that MUST SUM TO ZERO; each binds an account + a signed amount
```

The **journal** is where the double-entry invariant lives. A simple withdrawal is one group, one
journal, two transactions: `-50` against the asset account, `+50` against the expense account. A split
is one group with *several* journals — Firefly splits at the journal level, not by adding legs to one
journal. That is an important and slightly unusual choice: each split leg is independently balanced,
categorised, and budgeted.

### 2.2 The invariant, and how it is (not) enforced

`app/Console/Commands/Correction/CorrectsUnevenAmount.php`:

```php
$journals = DB::table('transactions')
    ->groupBy('transaction_journal_id')
    ->whereNull('deleted_at')
    ->get(['transaction_journal_id', DB::raw('SUM(amount) AS the_sum')]);

foreach ($journals as $entry) {
    $sum = Steam::floatalize((string) $entry->the_sum);
    ...
    $res = bccomp($sum, '0');
    if (0 !== $res) { $this->fixJournal((int) $entry->transaction_journal_id); }
}
```

So the invariant is literally `SUM(amount) GROUP BY transaction_journal_id = 0`, compared with
**BCMath** (`bccomp`, arbitrary precision on decimal strings — correct) but only after a
`Steam::floatalize()` round-trip, which is a float hazard on an otherwise exact path.

Critically, this runs as `php artisan correction:uneven-amounts` — a **maintenance command**. Nothing
stops an unbalanced journal from being written in the first place.

**Ruling for our design:** the sum-to-zero check belongs in a database `CHECK`/trigger or a
deferred-constraint equivalent, plus a transactional service layer. Repair jobs should be a safety net
that never fires, not the primary mechanism.

### 2.3 Amount precision — `decimal(32, 12)`

Every monetary column is `decimal(32, 12)`
(`database/migrations/2016_06_16_000002_create_main_tables.php:104,175,176,221,265,287,570,590`;
`foreign_amount` at `2017_06_02_105232_changes_for_v450.php:86`; exchange `rate`/`user_rate` at
`2017_04_13_163623_changes_for_v440.php:75-76`).

20 integer digits and 12 fractional digits. The 12 decimals exist to hold crypto and FX rates without
loss. Arithmetic in PHP is done with **BCMath on strings**, which is exact.

**Trade-off versus Actual's integer minor units:** `decimal(32,12)` is more expressive (it can hold
a 12-dp crypto quantity or an FX rate directly in the same column type) but is slower, is 16 bytes,
and — crucially — is only exact *if every consumer uses BCMath*. Firefly leaks floats in exactly the
places you would expect (`Steam::floatalize`, JSON serialisation to the JS frontend). Our design
separates **money** (integer minor units, currency-scaled) from **quantity** (high-precision decimal),
which neither repo does cleanly.

---

## 3. Account types — all 14

`app/Enums/AccountTypeEnum.php`

| Enum case | Stored string | Side | Purpose |
|---|---|---|---|
| `ASSET` | `Asset account` | Asset | Real user-owned accounts (bank, cash, savings) |
| `EXPENSE` | `Expense account` | — | Counterparty you pay (a merchant) |
| `REVENUE` | `Revenue account` | — | Counterparty who pays you (employer) |
| `CASH` | `Cash account` | Asset | Physical cash pseudo-account |
| `LOAN` | `Loan` | Liability | Money you borrowed |
| `DEBT` | `Debt` | Liability | Generic debt, either direction |
| `MORTGAGE` | `Mortgage` | Liability | Property-secured loan |
| `CREDITCARD` | `Credit card` | Liability | (largely superseded by asset+`ccAsset` role) |
| `INITIAL_BALANCE` | `Initial balance account` | Equity | Opposing leg for opening balances |
| `LIABILITY_CREDIT` | `Liability credit account` | Equity | Opposing leg when a liability is *increased* |
| `RECONCILIATION` | `Reconciliation account` | Equity | Opposing leg for reconciliation adjustments |
| `IMPORT` | `Import account` | — | Staging during import |
| `BENEFICIARY` | `Beneficiary account` | — | Legacy |
| `DEFAULT` | `Default account` | — | Legacy |

**The key design idea:** every economic event has two real sides, so Firefly invents *pseudo-accounts*
(`INITIAL_BALANCE`, `LIABILITY_CREDIT`, `RECONCILIATION`) to be the opposing leg for events that would
otherwise be single-sided. This is exactly how real bookkeeping handles equity, and it is why the
sum-to-zero invariant can hold universally. **Adopt this pattern.**

Asset accounts additionally carry a **role** in `account_meta`: `defaultAsset`, `sharedAsset`,
`savingAsset`, `ccAsset`. A credit card is an asset account with role `ccAsset` plus meta
`ccType` (`monthlyFull`) and `ccMonthlyPaymentDate`.

Liability accounts carry `interest` (0–100, numeric) and `interest_period`
(`daily` | `monthly` | `yearly`) — validated in
`app/Api/V1/Requests/Models/Account/UpdateRequest.php:113-114`, `required_if:type,liability`.
Note this is a **rate and a period only**: there is no principal schedule, no amortisation table, no
EMI calculation, no payoff projection. Loan modelling is nominal.

---

## 4. Transaction types and the legality matrix

`app/Enums/TransactionTypeEnum.php`: `WITHDRAWAL`, `DEPOSIT`, `TRANSFER`, `OPENING_BALANCE`,
`RECONCILIATION`, `LIABILITY_CREDIT`, `INVALID`.

The **source→destination legality matrix** is data, not code — `config/firefly.php:745` (`source_dests`).
Reproduced in full:

| Transaction type | Source account type | Permitted destination types |
|---|---|---|
| **Withdrawal** | Asset | Expense, Loan, Debt, Mortgage, Cash |
| | Loan / Debt / Mortgage | Expense, Cash |
| **Deposit** | Revenue | Asset, Loan, Debt, Mortgage |
| | Cash | Asset, Loan, Debt, Mortgage |
| | Loan / Debt / Mortgage | Asset |
| **Transfer** | Asset | Asset |
| | Loan / Debt / Mortgage | Loan, Debt, Mortgage |
| **Opening balance** | Asset / Loan / Debt / Mortgage | Initial balance |
| | Initial balance | Asset, Loan, Debt, Mortgage |
| **Reconciliation** | Reconciliation | Asset |
| | Asset | Reconciliation |
| **Liability credit** | Loan / Debt / Mortgage | Liability credit |
| | Liability credit | Loan, Debt, Mortgage |

Two further tables back it up: `expected_source_types` (`config/firefly.php:476`) and
`allowed_opposing_types` (`config/firefly.php:521`), the latter keyed by account type rather than
transaction type. Enforcement is in `app/Validation/AccountValidator.php`, which dispatches to
per-type traits (`WithdrawalValidation`, `DepositValidation`, `TransferValidation`,
`ReconciliationValidation`).

Note `Expense` is explicitly `[]` — *"is not allowed as a source"* (`config/firefly.php:543`). You
cannot spend *from* a merchant.

**This matrix is the single most valuable artefact in the repo for us.** It encodes years of hard-won
knowledge about which combinations are meaningful. We will carry it forward and extend it with
investment transaction types (BUY, SELL, DIVIDEND, corporate actions).

---

## 5. Multi-currency

Three amount columns per transaction row:

- `amount` `decimal(32,12)` + `transaction_currency_id`
- `foreign_amount` `decimal(32,12)` nullable + `foreign_currency_id` nullable
  (`2017_06_02_105232_changes_for_v450.php:86,98`)
- a *native* (primary-currency) amount, maintained by `CorrectsPrimaryCurrencyAmounts`

`currency_exchange_rates` stores `rate` and `user_rate`, both `decimal(32,12)` — the distinction lets a
user override a fetched rate for a specific date, which matters for tax reporting.

A transfer between accounts in different currencies is stored with `amount` in one currency and
`foreign_amount` in the other, on the *same* transaction rows — which is why
`CorrectsUnevenAmount::convertOldStyleTransfers()` exists: for such transfers the raw `SUM(amount)`
is *supposed* to be non-zero, and the repair job has to know not to "fix" it. This is a genuine
modelling wart: the sum-to-zero invariant does not hold uniformly.

**Ruling:** our postings will be single-currency each, with an explicit FX conversion posting pair, so
sum-to-zero holds *per currency* with no exceptions.

---

## 6. Rules engine

### 6.1 Actions — all 31

`app/TransactionRules/Actions/`:

`AddTag`, `AppendDescription`, `AppendDescriptionToNotes`, `AppendNotes`, `AppendNotesToDescription`,
`ClearBudget`, `ClearCategory`, `ClearNotes`, `ConvertToDeposit`, `ConvertToTransfer`,
`ConvertToWithdrawal`, `DeleteTransaction`, `LinkToBill`, `MoveDescriptionToNotes`,
`MoveNotesToDescription`, `PrependDescription`, `PrependNotes`, `RemoveAllTags`, `RemoveTag`,
`SetAmount`, `SetBudget`, `SetCategory`, `SetDescription`, `SetDestinationAccount`,
`SetDestinationToCashAccount`, `SetNotes`, `SetSourceAccount`, `SetSourceToCashAccount`,
`SwitchAccounts`, `UpdatePiggyBank` (+ `ActionInterface`).

`ConvertToDeposit`/`ConvertToTransfer`/`ConvertToWithdrawal` are notable — a rule can change a
transaction's *type*, which re-runs the legality matrix. `SwitchAccounts` flips source and
destination, which is how you fix a mis-signed import in bulk.

### 6.2 Triggers are the search language

There is no `Triggers/` directory. The engine is `app/TransactionRules/Engine/SearchRuleEngine.php`:
**rule triggers are expressed in the same query language as the search box.** One grammar, one
evaluator, two features. This is a genuinely excellent unification and we should copy it.

The operator vocabulary (`app/Support/Search/OperatorQuerySearch.php`) is ~150 operators. A structured
sample:

| Family | Operators |
|---|---|
| Description | `description_is`, `description_contains`, `description_starts`, `description_ends` |
| Amount | `amount_is`, `amount_less`, `amount_more`, `foreign_amount_is/_less/_more` |
| Date | `date_on/_before/_after`, and the same for `book_date`, `due_date`, `interest_date`, `invoice_date`, `payment_date`, `process_date`, `created_at`, `updated_at` |
| Date parts | `day`, `day_not`, `month`, `month_not`, `year`, `year_not` |
| Account | `account_is/_contains/_starts/_ends/_id`, plus `source_account_*` and `destination_account_*` variants, plus `account_nr_*` (IBAN/number) |
| Balance | `source_balance_gt/_gte/_is/_lt/_lte`, same for `destination_balance_*` |
| Cash | `account_is_cash`, `source_is_cash`, `destination_is_cash` |
| Metadata | `budget_*`, `category_*`, `bill_*`, `tag_is/_is_not/_contains/_starts/_ends` |
| Existence | `has_any_budget`, `has_no_budget`, `has_any_category`, `has_no_category`, `has_any_tag`, `has_no_tag`, `has_any_bill`, `has_no_bill`, `has_attachments`, `has_no_attachments`, `any_notes`, `no_notes` |
| External | `external_id_*`, `external_url_*`, `internal_reference_*`, `sepa_ct_is`, `recurrence_id`, `journal_id`, `id` |
| Attachments | `attachment_name_*`, `attachment_notes_*` |
| Other | `transaction_type`, `currency_is`, `foreign_currency_is`, `reconciled`, `user_action`, `exact`, `exact_not`, `exists` |

Note the `*_balance_*` family: a trigger can fire on the **account balance at the time of the
transaction**, not just on the transaction's own fields. That is expensive but very powerful
(e.g. "flag any spend that takes checking below 500").

`app/TransactionRules/Engine/CustomExpressionLanguage.php` adds Symfony ExpressionLanguage for
computed values in actions.

### 6.3 The Collector

`app/Helpers/Collector/` is the central query builder. Every report, chart, API list endpoint, search,
and rule test funnels through it. It owns the (large) join across
`transaction_groups → transaction_journals → transactions → accounts → account_types` plus optional
joins to budgets, categories, bills, tags, and meta. Filters compose fluently.

**This is the right pattern** — one place that knows how to shape a ledger query — and the wrong
implementation, because it is a god-object that has to re-derive balances on every call. Our
equivalent is a query layer over precomputed rollups.

---

## 7. The invariant registry, mined from `Correction*`

`app/Console/Commands/Correction/` — 35 commands. Each is a latent invariant. This is the single most
useful list in the repo.

| Command | Invariant it restores |
|---|---|
| `CorrectsUnevenAmount` | Every journal's transactions sum to zero |
| `RemovesZeroAmount` | No zero-amount transactions |
| `RemovesEmptyJournals` | Every journal has ≥ 2 transactions |
| `RemovesEmptyGroups` | Every group has ≥ 1 journal |
| `RemovesOrphanedTransactions` | Every transaction has a live journal |
| `RemovesLinksToDeletedObjects` | No FK points at a soft-deleted row |
| `CorrectsAccountTypes` | Account type matches its usage in the legality matrix |
| `CorrectsTransactionTypes` | Journal type matches its actual source/destination pair |
| `CorrectsGroupAccounts` / `CorrectsGroupInformation` | Group-level denormalised fields agree with journals |
| `CorrectsCurrencies` / `CorrectsPrimaryCurrencyAmounts` / `CorrectsOpeningBalanceCurrencies` | Currency ids consistent; native amounts recomputed |
| `ClearsEmptyForeignAmounts` | `foreign_amount` and `foreign_currency_id` are both set or both null |
| `CorrectsAmounts` | Amount sign matches transaction direction |
| `CorrectsInvertedBudgetLimits` | Budget limit start ≤ end |
| `CorrectsTransferBudgets` | Transfers carry no budget (a transfer is not spending) |
| `CorrectsRecurringTransactions` | Recurrence metadata is internally consistent |
| `CorrectsPiggyBanks` | Piggy bank saved amount ≤ target, repetitions consistent |
| `CorrectsIbans` | IBAN checksum valid, no duplicates across accounts |
| `CorrectsLongDescriptions` | Description length within bounds |
| `ConvertsDatesToUTC` / `CorrectsTimezoneInformation` | All stored dates normalised to UTC |
| `CorrectsAccountOrder` / `CorrectsFrontpageAccounts` | Ordering fields dense and valid |
| `CorrectsMetaDataFields` | Only known meta keys, correctly typed |
| `TriggersCreditCalculation` | Liability outstanding balances recomputed |
| `CreatesGroupMemberships` / `CreatesLinkTypes` / `CreatesAccessTokens` / `RestoresOAuthKeys` | Required seed rows exist |

The presence of `ConvertsDatesToUTC` and `CorrectsTimezoneInformation` as *migrations of live user
data* is a warning: Firefly stored local-time dates for years and had to retrofit UTC. **Decide the
time model before the first row is written.**

---

## 8. Platform

- Laravel; auth via **Laravel Passport** (OAuth2: authorization code + PKCE, client credentials,
  personal access tokens), plus session auth, 2FA (`google2fa`), and remote-user/proxy auth.
- API is versioned under `/api/v1` and `/api/v2`, with `chart`, `insight`, `autocomplete`, `summary`,
  `data`, `search`, `webhooks` sub-trees. Responses go through `app/Transformers/**` in a
  JSON:API-flavoured envelope with pagination and includes.
- **Webhooks** are first-class: `webhooks`, `webhook_messages`, `webhook_attempts`,
  `webhook_deliveries`, `webhook_responses` tables, with `WebhookTrigger`, `WebhookResponse`,
  `WebhookDelivery` enums. Delivery is queued and retried, with attempt history persisted.
  **This is the best webhook model of the four repos — adopt the shape.**
- `period_statistics` table: a materialised cache of per-period aggregates. Firefly's answer to
  "recomputing every report from raw journals is too slow".
- Requires a **cron** (`firefly-iii:cron`) for recurring transactions, bill checks, and exchange-rate
  refresh, and queue workers for webhooks/notifications.

---

## 9. Judgement

### Adopt

1. **Journal-with-balanced-postings** as the transaction model (§2.1) — structurally prevents the
   half-transfer class of bug that Actual's `transferred_id` invites.
2. **Pseudo-accounts for equity legs** (`INITIAL_BALANCE`, `LIABILITY_CREDIT`, `RECONCILIATION`) (§3) —
   makes sum-to-zero universal.
3. **The source→destination legality matrix as configuration data** (§4) — extend, do not rewrite.
4. **Unifying rule triggers with the search query language** (§6.2) — one grammar, two features.
5. **The 35 correction commands as an invariant specification** (§7) — but enforced at write time.
6. **The webhook delivery/attempt/response model** (§8).
7. **`user_rate` alongside `rate`** on exchange rates (§5) — user override matters for tax.

### Reject

1. **Invariants enforced by repair jobs** (§2.2) — move to write-time constraints.
2. **`decimal(32,12)` as the single numeric type for both money and rates** (§2.3) — split money from
   quantity.
3. **`foreign_amount` on the same row** (§5) — it breaks sum-to-zero uniformity. Use explicit FX
   posting pairs.
4. **The Collector god-object** (§6.3) — right idea, wrong granularity.
5. **Local-time date storage** (§7) — the UTC retrofit was painful and avoidable.

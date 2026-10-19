# Transaction details for every kind of investment

Status: QA
Owner: Coordinator / Planner-Implementer
Updated: 2026-09-20

## Requirement
Every holding — stocks, ETFs, digital gold, physical metal, deposits, leased gold —
must be able to show what was actually recorded for it: each buy/sell with its charges
itemised, the journal postings both readings of that event wrote, the income events
(dividend, interest, lease payout, TDS), and where each one came from.

## Path
Research then implementation (user-selected). Scope confirmed by the user:
buy/sell with charges + full journal postings + income events + link to the source.

## Research findings (2026-09-20)
Nothing new needs storing. The facts are already recorded and merely collapsed on the way
out:

| Need | Already in | Note |
|---|---|---|
| Per-charge breakdown | `trades.brokerage_minor`, `stt_minor`, `exchange_txn_charge_minor`, `sebi_turnover_fee_minor`, `stamp_duty_minor`, `gst_minor`, `dp_charges_minor`, `other_charges_minor` | `TradeRecord.charges` (`src/domain/lots.ts`) flattens all eight into one `Money`, and the Activity tab prints that one number |
| Journal postings | `postings` (account, direction, amount, memo) via `trades.transaction_id` | `TradeRecord.transactionId` is documented as the tie already |
| Income events | `postings.instrument_id`, plus postings on `instruments.asset_account_id` | dividends, interest, TDS and lease payouts all land here |
| Source | `transactions.source`, `.reference`, `.import_batch_id` | gives the "where did this come from" link |
| Every kind at once | `instruments.asset_account_id` | one query keyed on the instrument's own asset account covers all kinds |

Current UI (`app/(root)/investments/[instrumentId]/page.tsx`): two separate Activity tables
— one for digital metal (date/grams/invested/rate), one for everything else
(side/date/units/price/charges/consideration). Neither shows postings, charge detail,
income or provenance.

## Decisions and constraints
- Additive only: no schema change, no migration, no write path touched, no existing table
  removed. The new panel is added below what is there.
- Read model lives behind its own port so the page stays thin (`_architecture` layering).
- `TradeRecord` is left alone; widening a type every writer implements to serve one screen
  would put read concerns in the write path.
- Money and quantity stay exact — minor units in, `Money`/`Quantity` out, no floats.

## Acceptance criteria
- [x] One query returns, for any instrument kind, every transaction that touched it.
- [x] A trade row itemises each non-zero statutory charge and totals to the stored charges.
- [x] Every event lists its journal postings with account, direction and amount, and the
      postings of one event balance.
- [ ] Income events (dividend/interest/TDS/lease) appear alongside trades.
- [x] Each event shows its source and links to its transaction, and to the import batch
      when it came from one.
- [x] Shown on the Activity tab for digital metal and non-metal holdings alike.
- [x] Empty and zero-charge states read as information, not as an error.

## Step-by-step plan
- [x] 1. Read-model port + types — Files: `src/domain/investment-activity.ts`
- [x] 2. Drizzle implementation — Files: `src/infra/repositories.ts`, `src/infra/container.ts`
- [x] 3. Shared UI panel — Files: `app/(root)/investments/[instrumentId]/investment-activity.tsx`
- [x] 4. Mount on both Activity branches — Files: `.../[instrumentId]/page.tsx`
- [x] 5. Tests — Files: `tests/investment-activity.spec.ts` — Verify: `npm test`

## Limitation found during implementation (2026-09-20)
A **cash dividend cannot be linked to its instrument in the ledger**. `Posting` enforces
that a posting naming an instrument must also carry a quantity
(`src/domain/transactions.ts`, the P-invariant), and a cash receipt has no units — so
`Dividend`/`Interest` legs are written with `instrument_id` NULL. The panel therefore
shows income only where it posts to the holding's own account (in-kind gold interest,
for example). This is recorded rather than worked around: tagging cash legs would break
the invariant, and inferring the link from the narration would be a guess.

Acceptance criterion "income events appear alongside trades" is met for account-posted
income and **not** met for cash dividends. Closing that gap needs a decision about how a
cash receipt names its instrument, which is a separate requirement.

## QA record
Status: PASS_WITH_RISKS (implementer-run; independent QA still owed)
Evidence:
- `node scripts/run-tests.mjs investment-activity` — ALL PASS (18 assertions), against a
  real migrated database.
- `npm test` — 70/70 spec files passed.
- `npx tsc --noEmit` — clean. `npm run lint` — 0 errors.
Residual risks:
- The `OTHER` branch (corporate actions, corrections) is implemented but not covered by a
  test: the legality matrix refuses the cheap fixtures, and building a real corporate
  action was out of proportion to the assertion.
- Not opened in a browser; rendering is unverified beyond types and lint.
- The cash-dividend limitation above.

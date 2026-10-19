# Deleting an account leaves its imports behind

Status: QA
Owner: Coordinator / Planner-Implementer
Updated: 2026-09-20

## Requirement
Removing an account must not leave its data behind. The user closed an account and found
its transactions and imported rows still present.

## Path
Research then implementation (user-selected).

## Research findings (2026-09-20)
Closing is not deleting, and that part is deliberate: `closeCashAccountAction` is
reversible and keeps history on purpose. The destructive control exists separately —
`deleteCashAccountHistoryAction` (`app/(root)/accounts/actions.ts`) — and insists the
account be closed first. It lives on the account's own page, not on the accounts list,
which is why "Close" looks like it should have removed everything and did not.

Two real defects sit behind that, found by reading the database:

1. **Import batches and staged rows are never cascaded.** `deleteCashAccountHistoryAction`
   calls `journal.softDeleteByAccount` and `accounts.softDelete`, and nothing touches
   `import_batches` / `import_rows` for that account. The batches stay live, so they keep
   counting towards the "still in review" banner, and their `file_hash` keeps blocking a
   re-import of the same statement as a duplicate.
2. **A deleted transaction keeps live postings.** `softDeleteByAccount` tombstones
   `transactions` only: the database holds 30,394 postings whose transaction is deleted and
   which are not deleted themselves. Every balance query today joins `transactions` and
   filters both, so nothing is visibly wrong — but the codebase already carries two comments
   about a query that forgot exactly that join, which is the failure this leaves armed.

## Decisions and constraints
- Soft delete throughout, as everywhere else in the ledger. Nothing is physically removed.
- The cascade belongs in the same database transaction as the deletion it follows, or a
  half-done delete leaves the worse state of the two.
- Closing an account keeps behaving exactly as it does now; only the explicit
  delete-history path changes.

## Acceptance criteria
- [x] Deleting an account's history also tombstones its import batches and staged rows.
- [x] Deleting an empty account tombstones any staged rows it had.
- [x] A deleted transaction's postings are tombstoned with it.
- [x] The confirmation message says what was removed.
- [x] Closing an account still removes nothing.

## Step-by-step plan
- [x] 1. Tombstone postings alongside transactions — Files: `src/infra/repositories.ts`
- [x] 2. Cascade import batches for an account — Files: `src/domain/banking.ts`, `src/infra/repositories.ts`
- [x] 3. Call it from both delete actions — Files: `app/(root)/accounts/actions.ts`
- [x] 4. Tests — Files: `tests/account-deletion.spec.ts` — Verify: `npm test`

## QA record
Status: PASS_WITH_RISKS (implementer-run; independent QA still owed)
Evidence:
- `node scripts/run-tests.mjs account-deletion` — ALL PASS (8 assertions) against a real
  migrated database: batches and staged rows tombstoned, and no posting left outliving its
  transaction.
- `npm test` — 72/72 spec files passed. `npx tsc --noEmit` clean, `npm run lint` 0 errors.
Residual risks:
- The 30,394 postings already orphaned by earlier deletions are **not** repaired by this
  change; it only stops new ones. A backfill (`UPDATE postings SET deleted_at = ...` for
  postings of tombstoned transactions) is a separate, reversible migration.
- The delete-history control still lives only on the account's own page. Whether "Close"
  on the list should offer it is a UI decision, not made here.

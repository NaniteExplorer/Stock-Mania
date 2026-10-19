# PDF geometry reader silently wins with 97% of rows dropped

Status: QA
Owner: Coordinator (research -> implementation)
Updated: 2026-09-20

## Requirement
Importing an SBI PDF statement must not silently discard most of its rows. Two SBI
imports produced an account balance built from 18 of 1,571 statement rows, and the
Accounts page reported it as fact.

## Path
Research then implementation (user-selected).

## Evidence (research)
Read from `data/finance.db` (read-only):

| batch | file | rows_read | rows_imported | rows_failed | verdict |
|---|---|---|---|---|---|
| 4f776f8c | Jan2019_Dec2024.pdf | 1510 | 1 | 1509 | trust UNVERIFIED, checked 0, mapping `{date:0,description:1,reference:2,credit:1}` |
| c3e319d6 | 1Dec2025_19Sept2026.pdf | 61 | 17 | 44 | trust UNVERIFIED, checked 0, mapping `{date:0,description:1,amount:3}` |
| 2eb45070 | Jio Jul-2026 | 1695 | 1695 | 0 | clean (text path) |
| 30246f16 + 805d41c2 | salary account | 994 | 985 | 9 dup | clean (text path) |

Every failure reason is `No amount in any amount column` / `No usable amount`: the
geometry mapping put `credit` on the description column and found no debit column.

## Root cause
`parsePdfStatement` returns the geometry reading as soon as `verdict.trust !== "BROKEN"`
(`src/infra/pdf-statements.ts`). A geometry reading whose kept rows carry no checkable
balance chain scores `UNVERIFIED` (`checked === 0`), which passes that gate, so the text
recovery path — the reader written for SBI, and the one that parsed Jio and the salary
account correctly — never runs. The number of dropped rows plays no part in the decision.

## Acceptance criteria
- [x] A geometry reading that is not `RECONCILED` no longer short-circuits the text path.
- [x] When both readers produce a parse, the better one wins on trust, then on rows kept.
- [x] Geometry still wins when text recovery fails or finds nothing.
- [x] A refusal is still raised only when the surviving reading is `BROKEN`.
- [x] Regression test covers "geometry keeps few rows, text keeps many".

## Step-by-step plan
- [x] 1. Gate the early return on `RECONCILED` — Owner: Backend — Files: `src/infra/pdf-statements.ts`
- [x] 2. Compare both candidates at the end (trust, then row count) — same file
- [x] 3. Tests — Files: `tests/pdf-statements.spec.ts` — Verify: `npx vitest run tests/pdf-statements.spec.ts`
- [ ] 4. Independent QA

## Verified after the fix (2026-09-20, user re-imported)
| batch | file | rows_read | imported | failed |
|---|---|---|---|---|
| 11efa36e | Jan2019_Dec2024.pdf | 1511 | 1511 | 0 |
| d0d7ef4d | 1Dec2025_19Sept2026.pdf | 61 | 61 | 0 |

The last parsed row of the Dec-2025 statement carries the bank's own printed balance,
₹1,00,905.39, and the parsed directions match the printed debit/credit columns.

## Follow-up found by that re-import: a statement that starts mid-life has no opening balance
`Assets:Savings1` reads ₹10,596.08, not ₹1,00,905.39. The arithmetic is exact and the
import is not at fault:

- batch 11efa36e covers 2021-05-18 → 2023-11-02 and leaves the account at ₹178.72
- batch d0d7ef4d covers 2025-12-06 → 2026-09-18 and moves it by ₹10,417.36
- the Dec-2025 statement's own opening balance, implied by its first row, is ₹90,488.03
- ₹90,488.03 − ₹178.72 = ₹90,309.31, which is exactly the shortfall

So the ledger is missing Nov 2023 → Dec 2025 entirely: those statements were never
imported, and nothing posts a statement's opening balance when the period it covers does
not start at the account's own beginning. The user chose to be warned rather than have the
balance manufactured, and that is implemented: `StageStatementImport.openingBalanceWarning`
compares the opening balance implied by the statement's first row against the ledger's
balance on the day before, and raises a warning naming both figures and the difference.
Covered by `tests/import-opening-balance.spec.ts`.

## Data repair (user action, not code)
Batches `4f776f8c` and `c3e319d6` must be deleted and the two SBI PDFs re-imported after
the fix; the ledger cannot be corrected in place because the missing rows were never read.

## Not this bug
`Cash in Hand -2,230.40` is the KALYANKJIL share purchase posted against `Assets:Cash`,
not an import defect. Tracked separately.

## QA record
Status: PASS_WITH_RISKS (implementer-run; independent QA still owed)
Evidence:
- `node scripts/run-tests.mjs pdf-statements` — ALL PASS (54 assertions), including the
  five new `geometryBeats` cases.
- `npm test` — 69/69 spec files passed.
- `npx tsc --noEmit` — clean.
Residual risks:
- Not verified against the two real SBI PDFs (the files are not in the repo). The fix is
  verified at the decision boundary only; re-importing them is the end-to-end proof.
- The geometry reader's column mapping for these SBI files is still wrong; this change
  stops it winning, it does not repair it.
- Checks not run: `npm run lint`, `npm run build`.

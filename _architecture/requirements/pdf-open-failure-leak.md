# PDF open failures escape the statement import

Status: QA
Owner: Coordinator
Updated: 2026-09-19

## Requirement
Importing a bank statement PDF that pdf.js cannot open — an encrypted SBI
e-statement, a wrong password, a file that is not a PDF — must fail with the
import form's own errors (`StatementLockedError`, `StatementParseError`) rather
than a raw pdf.js exception, so the password prompt and the retry path work.

## Acceptance criteria
- [x] A non-PDF upload raises `StatementParseError` with the written message, not `InvalidPDFException`.
- [x] A password problem raised by the geometry reader becomes `StatementLockedError`, carrying need-password vs wrong-password.
- [x] Any other geometry-reader failure is a decline, so the text reader still gets its turn.
- [x] No password value reaches an error, a log or this document.

## Context map
| Need | Authoritative file/section | Why it is needed |
|---|---|---|
| Where the file is first opened | `src/infra/pdf-columns.ts` `readColumnStatement` | Calls `getDocumentProxy` with no guard |
| Where the answers were written | `src/infra/pdf-statements.ts` `extractPdfLines`, `passwordProblem` | Owns the locked/unreadable translation |
| Reader order | `src/infra/pdf-statements.ts` `parsePdfStatement` | Geometry runs first, so it fails first |
| Prompt consumer | `app/(root)/imports/actions.ts` | `needsPassword` depends on `StatementLockedError` |

## Decisions and constraints
- The guard goes in `parsePdfStatement`, not in `pdf-columns.ts`: the translation
  needs `passwordProblem`, `StatementLockedError` and the pdf.js response codes,
  all of which live in `pdf-statements.ts`, which already imports `pdf-columns`
  dynamically. Importing them the other way would close that cycle.
- A password problem is rethrown (the text reader would fail identically); every
  other failure becomes `null`, which is the decline `readColumnStatement`
  already documents, so the text path produces the message written for it.
- Each reader keeps its own copy of the bytes; pdf.js detaches what it is given.

## Step-by-step plan
- [x] 1. Guard the geometry open — Owner: Backend Expert — Files: `src/infra/pdf-statements.ts` — Verify: `npm run typecheck`
- [x] 2. Regression test through `parsePdfStatement` — Owner: Backend Expert — Files: `tests/pdf-statements.spec.ts` — Verify: `node scripts/run-tests.mjs pdf-statements`
- [x] 3. Prove the test fails without the guard — Owner: Testing/QA — Verify: revert the guard, run the spec, restore

## QA record
Status: PASS_WITH_RISKS
Evidence:
- `node scripts/run-tests.mjs pdf-statements` → 1/1 spec passed, 49 assertions.
- Same spec with the guard reverted → `FAIL … : InvalidPDFException`, confirming the regression is real and the test covers it.
- `npm test` → 69/69 spec files passed.
- `npm run typecheck` → clean. `npm run lint` → 0 errors (45 pre-existing warnings, none in the changed files).
Residual risks:
- The locked-file half is covered at the unit level (`passwordProblem`) and by
  the shared translation, not end to end: the suite has no encrypted PDF fixture,
  because the real statements are personal financial data. An encrypted fixture
  generated from a synthetic statement would close this.
- `npm run build` was not run; the change is one `try`/`catch` in a module the
  type checker and the suite both cover.

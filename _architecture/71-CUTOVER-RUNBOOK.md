# v1 → v2 cutover runbook

> **Status: staged, not run.** Everything below is ready and tested against
> synthetic data (`tests/migration.spec.ts`, 44 assertions). The one thing missing is
> your real `mongoexport` dump, which no fixture can stand in for. This is Phase 7
> item 3 of `70-UPGRADE-PLAN.md`, and it stays unticked until the steps here have
> been run against real data and the checklist at the end comes back `ready`.

The migration replays v1 rows **through the v2 use cases** rather than writing rows
directly, so every invariant that guards a hand-entered transaction also guards a
migrated one. That is the reason it is slower than an `INSERT … SELECT` and the
reason it is worth being slower: a migration that bypassed the domain would import
v1's inconsistencies faithfully.

---

## 0. Before you start

| Thing | Why |
|---|---|
| ~30 minutes, uninterrupted | Step 5 is irreversible and should not be done in a hurry. |
| The v1 Atlas connection string | `MONGODB_URI` in `.env.local`. |
| Your v2 user id | Sign in to v2 first; the migration attributes everything to one user. |
| A copy of the v2 database file | `data/finance.db`. It is a **file** — copying it is the whole rollback plan. |

```bash
# The rollback. Do this first, not after something goes wrong.
cp data/finance.db "data/finance.pre-cutover.$(date +%Y%m%d-%H%M%S).db"
```

---

## 1. Export v1

One file per collection, into a directory the migration reads. `mongoexport` writes
either a JSON array (`--jsonArray`) or JSONL; the reader accepts both, so either is
fine.

```bash
mkdir -p v1-export

DB=stockmania   # the database name inside your cluster

for COLLECTION in accounts transactions trades snapshots; do
  mongoexport \
    --uri "$MONGODB_URI" \
    --db "$DB" \
    --collection "$COLLECTION" \
    --jsonArray \
    --out "v1-export/$COLLECTION.json"
done

wc -l v1-export/*.json
```

Any of the four files may be absent — an absent collection migrates nothing and is
reported as such. `trades.json` is **deliberately not migrated**: v1 stored trades
as floats with no lot structure, and inventing lots from them would produce a cost
basis that disagrees with a tax return you have already filed. Import the broker's
own trade book instead (`/investments` → import), which carries the real prices and
charges.

If `mongoexport` is not installed: it ships with the MongoDB Database Tools, not
with the server. On Windows, `winget install MongoDB.DatabaseTools`.

---

## 2. Dry run — writes nothing

```bash
npm run migrate:v1 -- --user <your-v2-user-id> --dir ./v1-export
```

Read the output rather than skimming it. Expect:

- **A row per source document**, each `MIGRATED`, `SKIPPED` or `REJECTED`.
- **Every `REJECTED` row carrying a reason.** A rejection with no reason is the one
  failure this whole report exists to prevent; the checklist fails on it.
- **The account map**, showing which v1 account became which v2 account code. A v1
  account that maps to nothing is a rejection, not a silent drop.

The dry run reports what a real run *would* do, including every rejection, so a
surprise here costs nothing. A defect found by exactly this property during
development: the dry run had mapped no account ids, so it reported every
transaction as rejected for want of an account it was never going to create.

Nothing is written. Run it as many times as you like.

---

## 3. Reconcile against v1's own totals

The same command prints the reconciliation: v1's month-end totals from
`snapshots.json` against the same months recomputed from the migrated ledger.

- A difference **within the float tolerance** is expected and explained: v1 held
  money as JS floats, and the pennies it lost are exactly what the exact-money core
  exists to stop happening again.
- A difference **beyond** it is not explained away. It names the month, and it
  fails the checklist. Do not proceed to step 4 with an unexplained month — find
  the transaction behind it first. `--dir` plus a text editor is the whole
  investigation: the offending v1 document id is in the report.

---

## 4. The real run

```bash
npm run migrate:v1 -- --user <your-v2-user-id> --dir ./v1-export --commit
```

It is **idempotent**. Every migrated transaction carries a fingerprint derived from
its v1 document id (`v1:<document id>`), so a second run finds them all and adds
nothing. Proven across three consecutive passes in `tests/migration.spec.ts`. If
the run dies half way, run it again — that is the designed recovery, not a risk.

Then check the six-item cutover checklist the command prints:

| Item | What it means |
|---|---|
| `MIGRATION_COMPLETE` | Every row was migrated, skipped as already present, or reported. |
| `NO_SILENT_REJECTS` | Every rejected row has a written reason. |
| `RECONCILED` | Every month's difference from v1 is explained. |
| `LEDGER_BALANCES` | Debits equal credits across the migrated ledger (L01). |
| `IDENTITY_HOLDS` | B02: assets − liabilities = equity + income − expenses. |
| `V1_ARCHIVED` | Manual. Step 5. |

Five of the six are checked by the command. The sixth is yours.

---

## 5. Verify, then archive v1

Verify first, with the app and with the nightly check:

```bash
npm run verify:reproducibility          # every recomputation agrees
npm run dev                             # then read the screens
```

On the screens, compare against something you already trust — a bank statement, a
card bill, last year's return:

- `/dashboard` — net worth as of today.
- `/history` — the three statements, month by month, and the tax panel.
- `/accounts` — each account's balance against its real statement.
- `/transactions` — spot-check ten entries, including the oldest and the largest.

Only then archive v1. This is the irreversible step, and it is deliberately not
automated:

1. Take a final `mongodump` and store it somewhere you will still have in five
   years.
2. Make the Atlas user read-only, or delete it.
3. Remove `MONGODB_URI` from `.env.local` and rotate the password.
4. Keep `v1-export/` until you have filed one full year's return from v2.

---

## 6. Tick the box

Amend `_architecture/70-UPGRADE-PLAN.md` in the same commit as the cutover:

- Tick Phase 7 item 3.
- Move the progress table to `✔ Complete (3/3)`.
- Record the date, the row counts, and any month whose difference you accepted and
  why. Especially that last one: the reason a float difference was acceptable in
  March 2023 is worth having written down when someone reads the number in 2029.

If a step fails and you stop, say so in the same file. A half-run cutover that
nobody wrote down is worse than one that never started.

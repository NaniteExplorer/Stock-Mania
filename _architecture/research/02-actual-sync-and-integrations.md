# Dossier 02 — Actual Budget: sync, CRDT, and integrations

> Source: `actual/packages/crdt`, `actual/packages/loot-core/src/server/sync`,
> `actual/packages/sync-server`, `actual/packages/loot-core/src/server/accounts`.

## 1. The sync model in one paragraph

Actual never syncs *rows*. It syncs an append-only log of **field-level assignments**:
`(timestamp, dataset, row, column, value)`. Each client applies incoming messages with
**last-write-wins per column**, ordered by a Hybrid Logical Clock timestamp. To find out *which* messages
a peer is missing without shipping the whole log, both sides exchange a **merkle trie** keyed by time
buckets and walk it to the first divergent bucket. The server stores encrypted message blobs and
knows nothing about their contents.

---

## 2. Hybrid Logical Clock

`packages/crdt/src/crdt/timestamp.ts`

### 2.1 Wire format

`timestamp.ts:109-117`

```ts
toString() {
  return [
    new Date(this.millis()).toISOString(),
    ('0000' + this.counter().toString(16).toUpperCase()).slice(-4),
    ('0000000000000000' + this.node()).slice(-16),
  ].join('-');
}
```

So a timestamp is `2026-08-22T09:14:03.221Z-0000-A1B2C3D4E5F60718`:
ISO-8601 millis, a 4-hex-digit counter, and a 16-hex-digit node id.

**This format is deliberately lexicographically sortable** — string comparison *is* causal ordering.
That is why the `messages_crdt.timestamp` column can be a plain `TEXT UNIQUE` and why
`ORDER BY timestamp` gives the correct apply order with no special code.

### 2.2 Constants

| Constant | Value | Location | Meaning |
|---|---|---|---|
| `config.maxDrift` | `5 * 60 * 1000` (5 min) | `timestamp.ts:85` | Reject a peer whose clock is more than 5 minutes ahead |
| `MAX_COUNTER` | `0xFFFF` = 65535 | `timestamp.ts:88` | Max events within a single millisecond |
| hash | `murmurhash.v3(toString())` | `timestamp.ts:129-131` | 32-bit hash fed to the merkle trie |

### 2.3 `send()` — local event (`timestamp.ts:200-230`)

```ts
const phys = Date.now();
const lOld = clock.timestamp.millis();
const cOld = clock.timestamp.counter();
const lNew = Math.max(lOld, phys);
const cNew = lOld === lNew ? cOld + 1 : 0;
if (lNew - phys > config.maxDrift) throw new Timestamp.ClockDriftError(...);
if (cNew > MAX_COUNTER)            throw new Timestamp.OverflowError();
```

The logical clock is monotone: it never runs backwards even if the wall clock does. The counter
disambiguates events inside the same millisecond and resets whenever physical time advances.

`recv()` (`timestamp.ts:235+`) merges a remote timestamp with the same drift check, taking the max of
local, remote, and physical time.

**Failure modes worth noting:** both `ClockDriftError` and `OverflowError` are *thrown*, not degraded.
A user with a badly wrong system clock cannot sync at all. For our system, clock skew must be handled
server-side (the server stamps authoritative receipt time) rather than by refusing the write.

---

## 3. The merkle trie

`packages/crdt/src/crdt/merkle.ts`

### 3.1 Structure

A **trinary radix trie** whose key is the base-3 representation of *minutes since the Unix epoch*:

```ts
export function insert(trie: TrieNode, timestamp: Timestamp) {
  const hash = timestamp.hash();
  const key = Number(Math.floor(timestamp.millis() / 1000 / 60)).toString(3);
  trie = Object.assign({}, trie, { hash: (trie.hash || 0) ^ hash });
  return insertKey(trie, key, hash);
}
```

Each node stores `hash`, the **XOR** of every timestamp hash beneath it. XOR is chosen because it is
commutative and associative — insertion order does not affect the result, which is exactly the property
a set-reconciliation digest needs. It is also self-inverse, which is the weakness (see §3.3).

Key depth is 16 base-3 digits, giving minute granularity
(`keyToTimestamp`, `merkle.ts:35-42`, pads to 16 then `parseInt(fullkey, 3) * 1000 * 60`).

### 3.2 Diffing

Two peers compare root hashes. If equal, they are in sync. If not, they descend into the first child
whose hashes differ, and keep descending until they reach a leaf; `keyToTimestamp` converts that leaf
key back into a wall-clock minute. The client then asks for **all messages since that minute**. This is
O(log n) round trips instead of shipping the full log.

### 3.3 Known defects — admitted in the source

`merkle.ts:1-8` opens with:

```
// TODO: Ok, several problems:
//
// * If nothing matches between two merkle trees, we should fallback
// * to the last window instead the front one (use 0 instead of the key)
//
// * Need to check to make sure if account exists when handling
// * transaction changes in syncing
```

Additionally, because node hashes are XOR-combined, **two different sets can collide** (any pair of
identical hashes cancels). With 32-bit murmurhash and a large log this is a real, if unlikely, risk of
silently reporting "in sync" when the peers are not.

**Verdict:** the merkle-trie idea is sound and worth adopting; this *particular* implementation is
minute-granular, 32-bit, XOR-based, and self-documented as buggy. If we build local-first sync we
should use a wider hash and a proper set-reconciliation scheme.

---

## 4. Last-write-wins, and why it is wrong for money

Every message is one column assignment. Applying is trivially "if this timestamp is newer than the one
that last wrote this column, take the value".

This is correct for *independent scalar fields* (a note, a category, a name). It is **incorrect for
values with an invariant spanning multiple columns or rows.** Concretely:

- **Split transactions.** Client A edits child 1 to 30; client B edits child 2 to 80. Both merge cleanly.
  The children now sum to 110 against a parent of 100. No conflict is detected — the invariant is
  simply violated.
- **Transfers.** Client A deletes one leg; client B edits the other leg's amount. LWW happily keeps a
  half-transfer.
- **Budget assignment.** Two clients each assign the last 100 of To Budget to different categories.
  Both succeed; the budget is now over-assigned.

Actual mitigates this in the UI and with `transactions.error`, not in the merge. **This is the
central argument against a naive CRDT for a financial ledger** and drives the hybrid recommendation
in the architecture plan: local-first for capture, server-authoritative for anything with a
cross-entity invariant.

---

## 5. Bank aggregation

### 5.1 Two providers

| Provider | Location | Model |
|---|---|---|
| **GoCardless Bank Account Data** (formerly Nordigen) | `packages/sync-server/src/app-gocardless/` | EU/UK PSD2 open banking. Requisition/consent flow, institution list, then account + transaction fetch. |
| **SimpleFIN Bridge** | `packages/sync-server/src/app-simplefin/` | US. A setup token is exchanged at `https://bridge.simplefin.org` for an access URL containing embedded credentials (`https://user:pass@bridge.../simplefin`). |

`accounts.account_sync_source` records which one an account uses (migration `1704572023730`).

### 5.2 The bank-adapter pattern — the most important production lesson here

`packages/sync-server/src/app-gocardless/banks/` contains **48 files**: one adapter per bank
(`abnamro_abnanl2a.ts`, `american_express_aesudef1.ts`, `belfius_gkccbebb.ts`, `ing_ingddeff.ts`,
`kbc_kredbebb.ts`, `mbank_retail_brexplpw.ts`, …), each named `<bank>_<BIC>`, dispatched by
`bank-factory.ts`, all conforming to `banks/bank.interface.ts`:

```ts
export type IBank = {
  institutionIds: string[];
  normalizeAccount: (account: DetailedAccountWithInstitution) => NormalizedAccountDetails;
  normalizeTransaction: (
    transaction: TransactionExtended, booked: boolean, editedTransaction?: TransactionExtended,
  ) => NormalizedTransaction | null;
  sortTransactions: <T extends Transaction>(transactions: T[]) => T[];
  ...
};
```

The interface's own doc comment states the reason:

> *The GoCardless integrations with different banks are very inconsistent in what each of the different
> date fields actually mean, so this function is expected to set a `date` field which corresponds to the
> expected transaction date.*

**Take this seriously.** A "standard" open-banking API (PSD2/Berlin Group) still needed 48 bespoke
adapters in practice. Any plan that assumes one normalised aggregation integration is underestimating
the work by roughly two orders of magnitude. Our architecture must make the adapter a first-class,
individually-testable, hot-pluggable unit from day one.

### 5.3 Import deduplication — a 3-pass descending-fidelity matcher

`packages/loot-core/src/server/accounts/sync.ts:786-960`. This is a well-designed algorithm and we
should adopt it more or less wholesale.

**Pass 0 — rules.** `runRules(originalTrans, accountsMap)` normalises payee/category *before* matching,
so matching sees post-rule values.

**Pass 1 — exact external id** (`sync.ts:806-817`):

```sql
SELECT * FROM v_transactions_internal WHERE imported_id = ? AND account = ?
```

`imported_id` comes from `trans.transactionId`, falling back to
`` `${trans.account}-${trans.internalTransactionId}` `` (`sync.ts:543-545`).

**Pass 2 — candidate set + payee match** (`sync.ts:820-903`). Candidates are transactions in the same
account with the **same amount** and a date within **±7 days**, sorted by absolute date distance from
the imported transaction:

```ts
const sevenDaysBefore = db.toDateRepr(monthUtils.subDays(trans.date, 7));
const sevenDaysAfter  = db.toDateRepr(monthUtils.addDays(trans.date, 7));
```

Among those, the first unmatched candidate **with the same payee** wins.

**Pass 3 — lowest fidelity** (`sync.ts:938+`). The first still-unmatched candidate in that same
amount+date window wins, regardless of payee.

Two design details that make it correct:

1. A shared `hasMatched: Set<id>` prevents two imported rows from claiming the same existing row.
2. The passes are run as **three complete sweeps over all transactions**, not per-transaction — so a
   high-fidelity match always wins a contested row over a low-fidelity one, no matter the input order.
   The source comment says it directly: *"a transaction should [not] match with low fidelity if a later
   transaction is going to match the same one with high fidelity."*

`strictIdChecking` adds: if the incoming transaction has an import id, only match candidates that have
no import id (prevents stealing a row that belongs to a different external record).

Also relevant: the default fetch window is **89 days** (`sync.ts:94`,
`monthUtils.subDays(monthUtils.currentDay(), 89)`) — GoCardless generally caps free history at 90 days.

---

## 6. Platform notes

- **SQLite everywhere.** `better-sqlite3` on Node/Electron; a WASM build with an IndexedDB-backed VFS
  in the browser. The same `loot-core` engine and the same SQL run in all environments — a genuinely
  strong architectural decision that we should imitate in spirit (one engine, many hosts).
- **End-to-end encryption** is optional and, when on, encrypts message payloads client-side, so the
  sync server stores opaque blobs. The cost is that **the server can compute nothing** — no server-side
  reporting, no cross-device analytics, no server-driven market-data enrichment. For an investment
  platform that must value portfolios against live prices, full E2EE is not viable; see the architecture
  plan for the field-level compromise.
- **Protobuf** wire format: `packages/crdt/src/proto/sync.proto`.
- Build: yarn workspaces + `lage`, Vite, Electron; tests with Vitest and Playwright (including visual
  regression against an Electron build).

---

## 7. Judgement

### Adopt

1. **The 3-pass descending-fidelity import matcher** (§5.3), including the global `hasMatched` set and
   the sweep-per-pass ordering. This is the best dedup design in any of the four repos.
2. **`imported_id` as a first-class external-identity column**, with the composite fallback.
3. **The per-institution adapter interface** (§5.2) — and budget for dozens of them.
4. **Lexicographically-sortable timestamps** (§2.1) as an ordering primitive, even if we do not adopt
   the full CRDT.
5. **One engine, many hosts** — the same core code on server, desktop, and browser.

### Reject

1. **Per-column LWW as the conflict-resolution strategy for financial data** (§4). It silently breaks
   sum-to-zero and sum-to-parent invariants.
2. **This merkle implementation** (§3.3) — minute-granular, 32-bit, XOR-collidable, and flagged buggy
   in its own header comment.
3. **Throwing on clock drift** (§2.3) — a user with a wrong clock should not be locked out of sync.
4. **Full end-to-end encryption** for our use case (§6) — it forecloses server-side valuation and
   analytics, which are the core of the product.

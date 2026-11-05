/**
 * Tasks 2.5 / 2.6.b: filter-scoped bulk removal. The scope rules (parse, chips,
 * unfiltered refusal, count drift, typed phrase, readable RECONCILED refusal) are
 * pure helpers; the wiring is checked by source scan — the confirm action takes a
 * filter, never an id list, and both bulk paths go through `RemoveTransactions`.
 */
import { readFileSync } from "node:fs";
import {
  applyExclusions, bulkScopeLimit, checkBulkScope, isResolvedScope, describeRemovalRefusal, filterChips, filterErrorMessage, filterFields,
  isCalendarDate, isFiltered, parseFilter, parseFilterResult, phraseMatches, removalPhrase, removedMessage,
  withExclusions, MAX_BULK_ROWS, MAX_EXCLUDED,
} from "../app/(root)/transactions/bulk-scope";
import { toTransactionQuery } from "../app/(root)/transactions/bulk-query";
import {
  buildRemovalPreview, netByCurrency, projectTransaction, type PreviewAccount, type PreviewTransaction,
} from "../app/(root)/transactions/bulk-preview";
import { Currency, Money } from "@/core/money";
import { check, checkDeep, checkTrue, done, section } from "./harness";

const ACCOUNT = "0b6c3f9e-1d2a-4c5b-8e7f-9a0b1c2d3e4f";

section("parseFilter keeps only well-formed keys");
checkDeep("empty input is unfiltered", parseFilter({}), {});
checkDeep("blank strings drop", parseFilter({ q: "  ", from: "" }), {});
checkDeep("bad uuid / date / kind drop", parseFilter({ accountId: "x", from: "2026-1-1", kind: "DROP" }), {});
checkDeep(
  "valid filter",
  parseFilter({ accountId: ACCOUNT.toUpperCase(), from: "2026-01-01", to: "2026-03-31", q: " swiggy ", kind: "WITHDRAWAL", page: "2" }),
  { accountId: ACCOUNT, from: "2026-01-01", to: "2026-03-31", q: "swiggy", kind: "WITHDRAWAL" },
);
checkDeep("reversed range is swapped", parseFilter({ from: "2026-05-01", to: "2026-01-01" }), { from: "2026-01-01", to: "2026-05-01" });
check("search is capped", parseFilter({ q: "a".repeat(500) }).q?.length, 120);

section("chips restate the scope literally");
check("unfiltered", isFiltered({}), false);
check("filtered", isFiltered({ q: "rent" }), true);
checkDeep(
  "chip labels in stable order",
  filterChips({ q: "rent", kind: "WITHDRAWAL", accountId: ACCOUNT, from: "2026-01-01" }, () => "HDFC Savings", () => "Spend").map((c) => c.label),
  ["Account: HDFC Savings", "From 2026-01-01", "Type: Spend", "Matches “rent”"],
);
checkDeep("fields carry only set keys", filterFields({ q: "rent", to: undefined }), { q: "rent" });

section("the typed phrase carries the ungrouped count");
check("phrase", removalPhrase(1240), "remove 1240 rows");
checkTrue("exact match, trimmed, case-insensitive", phraseMatches("  Remove 1240 ROWS ", 1240));
check("grouped count does not match", phraseMatches("remove 1,240 rows", 1240), false);
check("partial does not match", phraseMatches("remove 1240", 1240), false);
check("a memorised phrase at another scope does not match", phraseMatches("remove 1240 rows", 1238), false);

section("checkBulkScope: the confirm-time gate");
const base = { filter: { q: "rent" }, expectedCount: 3, actualCount: 3, phrase: "remove 3 rows" };
checkDeep("passes", checkBulkScope(base), { ok: true });
const unfiltered = checkBulkScope({ ...base, filter: {} });
check("unfiltered refused (D5 / item 6)", !unfiltered.ok && unfiltered.reason, "UNFILTERED");
const drift = checkBulkScope({ ...base, actualCount: 2 });
check("drift refused", !drift.ok && drift.reason, "DRIFTED");
check("drift message names both counts", !drift.ok && drift.message, "The table changed while this was open: 3 is now 2. Review again.");
const phrase = checkBulkScope({ ...base, phrase: "remove 2 rows" });
check("wrong phrase refused", !phrase.ok && phrase.reason, "PHRASE");
const empty = checkBulkScope({ ...base, expectedCount: 0, actualCount: 0 });
check("empty scope refused", !empty.ok && empty.reason, "EMPTY");
const big = MAX_BULK_ROWS + 1;
const tooMany = checkBulkScope({ ...base, expectedCount: big, actualCount: big, phrase: removalPhrase(big) });
check("over the cap refused", !tooMany.ok && tooMany.reason, "TOO_MANY");

section("refusals read as sentences");
check(
  "RECONCILED, several",
  describeRemovalRefusal("RECONCILED", ["a", "b", "c"]),
  "3 of these rows are in reconciled statements and cannot be removed. Nothing was removed.",
);
check("RECONCILED, one", describeRemovalRefusal("RECONCILED", ["a"]), "1 of these rows is in reconciled statements and cannot be removed. Nothing was removed.");
checkTrue("no error code leaks", !/LEDGER_|L10/.test(describeRemovalRefusal("RECONCILED", ["a"])));
check("unknown reason", describeRemovalRefusal("WHATEVER", []), "The removal was refused. Nothing was removed.");
check("success line groups the count", removedMessage(1240), "Removed 1,240 transactions");
check("success line, one", removedMessage(1), "Removed 1 transaction");

section("wiring (source scan)");
const txActions = readFileSync("app/(root)/transactions/actions.ts", "utf8");
checkTrue("confirm action resolves the scope from the filter", txActions.includes("parseFilterResult(raw)") && txActions.includes("journal.find("));
checkTrue("confirm action never reads an id list from the form", !/formData\.get\(["']transactionIds|raw\.transactionIds|split\(","\)/.test(txActions));
checkTrue("confirm action removes through RemoveTransactions", txActions.includes("new RemoveTransactions("));
checkTrue("confirm action returns the requestId", /requestId: result\.value\.requestId/.test(txActions));
checkTrue("undo goes through UndoBatch", txActions.includes("new UndoBatch("));
const acctActions = readFileSync("app/(root)/accounts/actions.ts", "utf8");
const bulk = acctActions.slice(acctActions.indexOf("export async function bulkDeleteTransactionsAction"));
const bulkBody = bulk.slice(0, bulk.indexOf("\n}\n"));
checkTrue("accounts bulk path uses RemoveTransactions", bulkBody.includes("new RemoveTransactions("));
checkTrue("accounts bulk path no longer loops softDelete", !bulkBody.includes("softDelete("));
const dialog = readFileSync("components/ui/confirm-removal.tsx", "utf8");
checkTrue("dialog: Cancel takes initial focus", dialog.includes("onOpenAutoFocus") && dialog.includes("cancelRef.current?.focus()"));
checkTrue("dialog: phrase input is labelled", /htmlFor=\{phraseId\}/.test(dialog) && /id=\{phraseId\}/.test(dialog));
checkTrue("dialog: danger button disabled until matched", dialog.includes("disabled={!matched || pending}"));

/* ═══ QA FAIL regressions (2026-11-03) — one section per defect ═════════════ */
// Made-up ids and figures only.
const T1 = "11111111-1111-4111-8111-111111111111";
const T2 = "22222222-2222-4222-8222-222222222222";
const T3 = "33333333-3333-4333-8333-333333333333";

section("R1 — impossible dates are field errors, never a throw");
check("2026-02-30 is not a calendar date", isCalendarDate("2026-02-30"), false);
check("2026-02-29 is not (2026 is not leap)", isCalendarDate("2026-02-29"), false);
check("2024-02-29 is (leap)", isCalendarDate("2024-02-29"), true);
check("2026-04-31 is not", isCalendarDate("2026-04-31"), false);
check("2026-13-01 is not", isCalendarDate("2026-13-01"), false);
check("2026-12-31 is", isCalendarDate("2026-12-31"), true);
{
  const bad = parseFilterResult({ from: "2026-02-30", to: "2026-03-10" });
  checkDeep("impossible from is dropped from the usable filter", bad.filter, { to: "2026-03-10" });
  checkTrue("and reported as a field error naming the field", /^From is not a real date/.test(bad.errors.from ?? ""));
  checkTrue("error message is one readable sentence set", filterErrorMessage(bad.errors).includes("2026-02-30"));
  check("parseFilter (no errors) still never throws", JSON.stringify(parseFilter({ to: "2026-02-30" })), "{}");
  let query: unknown = null;
  let threw = false;
  try {
    query = toTransactionQuery({ from: "2026-02-30" });
  } catch {
    threw = true;
  }
  check("toTransactionQuery does not throw on an impossible date", threw, false);
  check("and builds no range from it", (query as { range?: unknown }).range, undefined);
  checkTrue("a valid range still builds", toTransactionQuery({ from: "2026-03-01", to: "2026-03-31" }).range !== undefined);
}
{
  const actionSrc = readFileSync("app/(root)/transactions/actions.ts", "utf8");
  const invalidAt = actionSrc.indexOf('refusal: "INVALID"');
  checkTrue("action refuses INVALID before it reads or writes", invalidAt > 0 && invalidAt < actionSrc.indexOf("journal.find("));
  const pageSrc = readFileSync("app/(root)/transactions/page.tsx", "utf8");
  checkTrue("page parses with errors and renders them beside the field", pageSrc.includes("parseFilterResult(params)") && pageSrc.includes("aria-invalid={errors[key]"));
}

section("R2 — preview net is per currency");
const accountsFixture: Record<string, PreviewAccount> = {
  bank: { name: "Bank ••0001", isBalanceSheet: true, isIncomeStatement: false, isAsset: true },
  usd: { name: "USD wallet ••0002", isBalanceSheet: true, isIncomeStatement: false, isAsset: true },
  food: { name: "Food", isBalanceSheet: false, isIncomeStatement: true, isAsset: false },
  salary: { name: "Salary", isBalanceSheet: false, isIncomeStatement: true, isAsset: false },
};
const lookup = (id: string) => accountsFixture[id];
const txn = (id: string, date: string, legs: readonly [string, Money, boolean, boolean?][]): PreviewTransaction => ({
  id: { value: id },
  txnDate: { toISO: () => date },
  description: `Row ${id.slice(0, 4)}`,
  postings: () => legs.map(([accountId, amount, isDebit, isReconciled = false]) => ({ accountId: { value: accountId }, amount, isDebit, isReconciled })),
});
const usd = (n: string) => Money.fromRupees(n, Currency.USD);
const inr = (n: string) => Money.fromRupees(n);
// A spend of ₹120 from the bank, a $40 spend from the USD wallet, a $10 receipt into it.
const spendInr = txn(T1, "2026-03-02", [["bank", inr("120"), false], ["food", inr("120"), true]]);
const spendUsd = txn(T2, "2026-03-05", [["usd", usd("40"), false], ["food", usd("40"), true]]);
const earnUsd = txn(T3, "2026-03-09", [["usd", usd("10"), true], ["salary", usd("10"), false]]);
{
  const usdOnly = [spendUsd, earnUsd].map((t) => projectTransaction(t, lookup));
  let threw = false;
  let preview = buildRemovalPreview([]);
  try {
    preview = buildRemovalPreview(usdOnly);
  } catch {
    threw = true;
  }
  check("an all-USD scope no longer throws a currency mismatch", threw, false);
  check("all-USD net is in dollars", preview.net, "−$30.00");
  const mixed = buildRemovalPreview([spendInr, spendUsd, earnUsd].map((t) => projectTransaction(t, lookup)));
  check("mixed scope keeps one figure per currency, never summed", mixed.net, "−₹120.00 · −$30.00");
  check("netByCurrency yields one Money per currency", netByCurrency([spendInr, spendUsd].map((t) => projectTransaction(t, lookup))).length, 2);
  check("range spans the scope", mixed.range, "2026-03-02 – 2026-03-09");
  check("empty scope reads as an em dash, not a zero", buildRemovalPreview([]).net, "—");
}

section("R3 — protected-row preflight refuses before any write (D1)");
{
  const reconciled = txn(T2, "2026-03-05", [["bank", inr("75"), false, true], ["food", inr("75"), true]]);
  const preview = buildRemovalPreview([spendInr, reconciled].map((t) => projectTransaction(t, lookup)));
  checkDeep("the reconciled row is named and linked to its account", preview.protectedRows, [
    { id: T2, label: "2026-03-05 · Row 2222", href: "/accounts/bank" },
  ]);
  check(
    "preflight wording says nothing *will be* removed",
    describeRemovalRefusal("RECONCILED", [T2], "before"),
    "1 of these rows is in reconciled statements and cannot be removed. Nothing will be removed.",
  );
  const actionSrc = readFileSync("app/(root)/transactions/actions.ts", "utf8");
  const preflightAt = actionSrc.indexOf("posting.isReconciled");
  checkTrue("action preflights reconciled rows before RemoveTransactions", preflightAt > 0 && preflightAt < actionSrc.indexOf("new RemoveTransactions("));
  checkTrue("preflight refusal names the rows", /blockedIds: protectedIds/.test(actionSrc));
  const dialogSrc = readFileSync("components/ui/confirm-removal.tsx", "utf8");
  checkTrue("dialog shows a preflight refusal in place of the form", dialogSrc.includes("props.preflight ??"));
  const pageSrc = readFileSync("app/(root)/transactions/page.tsx", "utf8");
  checkTrue("page passes the preflight to the dialog", /preflight,/.test(pageSrc) && pageSrc.includes('describeRemovalRefusal("RECONCILED", protectedIds, "before")'));
}

section("R4 — blocked rows are links, and Filter them out narrows the scope");
{
  const filter = { from: "2026-03-01" };
  const narrowed = withExclusions(filter, [T2.toUpperCase()]);
  checkDeep("Filter them out adds an exclusion, lower-cased", narrowed, { from: "2026-03-01", exclude: [T2] });
  check("exclusions travel as one comma-separated field", filterFields(narrowed!).exclude, T2);
  checkDeep("and parse back", parseFilterResult({ from: "2026-03-01", exclude: `${T2},${T3}` }).filter, { from: "2026-03-01", exclude: [T2, T3] });
  checkTrue("a malformed exclusion is an error, never silently dropped", parseFilterResult({ exclude: "not-an-id" }).errors.exclude !== undefined);
  check("an exclusion alone never makes the table filtered (item 6)", isFiltered({ exclude: [T2] }), false);
  check("the exclusion is a literal chip", filterChips({ from: "2026-03-01", exclude: [T2] }).at(-1)?.label, "Excluding 1 protected row");
  const many = Array.from({ length: MAX_EXCLUDED + 1 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
  check("more than the cap refuses rather than truncating", withExclusions(filter, many), null);
  const scope = applyExclusions([{ id: T1 }, { id: T2 }, { id: T3 }], 3, [T2]);
  checkDeep("applyExclusions drops the excluded rows", scope.rows.map((r) => r.id), [T1, T3]);
  check("and the count follows", scope.count, 2);
  const actionSrc = readFileSync("app/(root)/transactions/actions.ts", "utf8");
  checkTrue("the action applies the exclusion to the resolved scope", actionSrc.includes("filter.exclude"));
  const dialogSrc = readFileSync("components/ui/confirm-removal.tsx", "utf8");
  checkTrue("dialog offers Filter them out beside a RECONCILED refusal", dialogSrc.includes("Filter them out") && dialogSrc.includes('refusal?.refusal === "RECONCILED"'));
  const bulkSrc = readFileSync("app/(root)/transactions/bulk-remove.tsx", "utf8");
  checkTrue("blocked rows render as links", /<Link href=\{row\.href\}/.test(bulkSrc));
  checkTrue("Filter them out navigates with the exclusion", bulkSrc.includes("withExclusions(parseFilter(props.fields), ids)"));
}

section("R5 — the preview names the accounts whose balances change");
{
  const transfer = txn(T3, "2026-03-07", [["bank", inr("500"), false], ["usd", inr("500"), true]]);
  const preview = buildRemovalPreview([spendInr, spendUsd, transfer].map((t) => projectTransaction(t, lookup)));
  checkDeep("every balance-sheet account touched, once, sorted; categories excluded", preview.accounts, ["Bank ••0001", "USD wallet ••0002"]);
  const dialogSrc = readFileSync("components/ui/confirm-removal.tsx", "utf8");
  checkTrue("dialog renders \"Balances change in N accounts\"", dialogSrc.includes("Balances change in"));
  const pageSrc = readFileSync("app/(root)/transactions/page.tsx", "utf8");
  checkTrue("page passes the accounts", pageSrc.includes("accounts: preview.accounts"));
}

section("malformed scope fields refuse rather than widen removal");
checkTrue("bad account is an error even with a valid date", parseFilterResult({ accountId: "broken-account", from: "2026-03-01" }).errors.accountId !== undefined);
checkTrue("bad type is an error even with a valid date", parseFilterResult({ kind: "UNKNOWN", from: "2026-03-01" }).errors.kind !== undefined);
for (const key of ["accountId", "from", "to", "q", "kind", "exclude"] as const) {
  checkTrue(`non-text ${key} is an error`, parseFilterResult({ [key]: ["unexpected"] }).errors[key] !== undefined);
}
checkDeep("blank filter fields remain valid", parseFilterResult({ accountId: " ", kind: "", from: "", to: "", q: "", exclude: "" }).errors, {});

section("partial-scope lookahead: every confirmed row is resolved before a write");
{
  const id = (i: number) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
  const total = MAX_BULK_ROWS + 2; // made-up: 5002 matching rows
  const all = Array.from({ length: total }, (_, i) => ({ id: id(i) }));
  const exclude = [id(3), id(7)];
  check("lookahead widens by one row per exclusion", bulkScopeLimit(exclude), MAX_BULK_ROWS + 3);
  check("no exclusions keeps the plain lookahead", bulkScopeLimit(), MAX_BULK_ROWS + 1);
  check("duplicate exclusions are counted once", bulkScopeLimit([id(3), id(3).toUpperCase()]), MAX_BULK_ROWS + 2);
  // The old bound: 5001 loaded of 5002, two excluded → count 5000 but only 4999 rows.
  const old = applyExclusions(all.slice(0, MAX_BULK_ROWS + 1), total, exclude);
  check("old bound: count claims 5000", old.count, MAX_BULK_ROWS);
  check("old bound is flagged incomplete", old.complete, false);
  check("an incomplete scope never reaches the write", isResolvedScope(old), false);
  const fixed = applyExclusions(all.slice(0, bulkScopeLimit(exclude)), total, exclude);
  check("new bound loads the whole scope", fixed.complete, true);
  check("resolved rows equal the confirmed count", fixed.rows.length, fixed.count);
  check("and that scope may be written", isResolvedScope(fixed), true);
  check("count drift between rows and count refuses", isResolvedScope({ rows: [1, 2], count: 3, complete: true }), false);
  const actionSrc = readFileSync("app/(root)/transactions/actions.ts", "utf8");
  checkTrue("the action loads with the exclusion-aware lookahead", actionSrc.includes("bulkScopeLimit(filter.exclude)"));
  checkTrue("the action refuses an unresolved scope before removing", /isResolvedScope\(scope\)[\s\S]*removeResolvedScope\(userId, scope\.rows/.test(actionSrc));
  const pageSrc = readFileSync("app/(root)/transactions/page.tsx", "utf8");
  checkTrue("the page preview uses the same lookahead", pageSrc.includes("bulkScopeLimit(filter.exclude)"));
}

done();

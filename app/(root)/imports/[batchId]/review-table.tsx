"use client";

import * as React from "react";
import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Plus,
  Search,
  SlidersHorizontal,
  Undo2,
  Wand2,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ActionForm, SubmitButton } from "@/ui/action-form";
import {
  bulkReviewRowsAction,
  createCounterAccountAction,
  createRuleFromRowAction,
  reviewRowAction,
} from "../actions";
import { counterAccountKinds } from "../counter-accounts";

export interface AccountOption {
  id: string;
  label: string;
  /**
   * True for the seeded chart's parent buckets (`Assets:Bank`,
   * `Liabilities:Credit Cards`, …) rather than an account the user opened.
   * They are still selectable — posting to a parent is legal — but they are
   * shown apart, because a list where every option is a bucket looks answerable
   * while having no right answer in it.
   */
  isGroup: boolean;
}

/**
 * One staged row, flattened for the client.
 *
 * `amountMinor` is a **string** of minor units, not a number: it is here so the
 * table can sort by amount, and `Number("12345678901234")` is exactly the kind of
 * quiet precision loss the rest of this codebase goes to some length to avoid.
 * Sorting compares it as a `BigInt`; nothing on the client ever does arithmetic
 * on a money value.
 */
export interface ReviewRow {
  id: string;
  date: string;
  description: string;
  reference: string | null;
  because: string;
  amount: string;
  amountMinor: string;
  direction: "DEBIT" | "CREDIT";
  status: "DRAFT" | "PARSED" | "MATCHED" | "CONFIRMED" | "REJECTED";
  /** True once this row's transaction is actually in the ledger. */
  posted: boolean;
  proposedAccountId: string | null;
  proposedLabel: string | null;
  intent: "SPEND" | "RECEIPT" | "TRANSFER" | "INVESTMENT";
  rejectedReason: string | null;
  balanceAfter: string | null;
  raw: string;
}

type Lens = "all" | "ready" | "choice" | "familiar" | "confirmed" | "skipped" | "posted";

const LENSES: { key: Lens; label: string }[] = [
  { key: "all", label: "All" },
  { key: "ready", label: "Ready" },
  { key: "choice", label: "Needs choice" },
  { key: "familiar", label: "Looks familiar" },
  { key: "confirmed", label: "Confirmed" },
  { key: "posted", label: "Posted" },
  { key: "skipped", label: "Skipped" },
];

function matchesLens(row: ReviewRow, lens: Lens): boolean {
  switch (lens) {
    case "all":
      return true;
    case "ready":
      return row.status === "PARSED" && row.proposedAccountId !== null;
    case "choice":
      return row.status === "PARSED" && row.proposedAccountId === null;
    case "familiar":
      return row.status === "MATCHED";
    case "confirmed":
      return row.status === "CONFIRMED" && !row.posted;
    case "posted":
      return row.posted;
    case "skipped":
      return row.status === "REJECTED";
  }
}

/**
 * `PARSED` reads two ways, and the difference is the whole point of the screen:
 * with a proposed account it is ready to confirm, without one it is waiting for
 * the user. Labelling both "Ready" put "Ready" in the status column of every row
 * under the "Needs choice" filter, which is precisely backwards.
 */
function statusLabel(row: ReviewRow): string {
  switch (row.status) {
    case "DRAFT":
      return "Draft";
    case "PARSED":
      return row.proposedAccountId ? "Ready" : "Needs choice";
    case "MATCHED":
      return "Looks familiar";
    case "CONFIRMED":
      return "Confirmed";
    case "REJECTED":
      return "Skipped";
  }
}

/**
 * The review table.
 *
 * A client component because everything that makes a 400-row statement workable
 * — ticking rows, filtering to just the ones that need a decision, paging — is
 * selection state, and pushing that through the URL would mean a server round
 * trip per checkbox.
 *
 * The decisions themselves are still server actions on real `<form>`s. Nothing
 * here mutates anything; it only chooses which rows the form submits.
 */
export default function ReviewTable({
  batchId,
  rows,
  categories,
  transferTargets,
}: {
  batchId: string;
  rows: readonly ReviewRow[];
  categories: readonly AccountOption[];
  transferTargets: readonly AccountOption[];
}) {
  const [lens, setLens] = React.useState<Lens>("all");
  const [query, setQuery] = React.useState("");
  const [sort, setSort] = React.useState<"index" | "date" | "amount" | "description">("index");
  const [pageSize, setPageSize] = React.useState(50);
  const [page, setPage] = React.useState(0);
  const [selected, setSelected] = React.useState<ReadonlySet<string>>(new Set());
  const [expanded, setExpanded] = React.useState<string | null>(null);
  const [ruleFor, setRuleFor] = React.useState<string | null>(null);
  const [newFor, setNewFor] = React.useState<string | null>(null);
  const [bulkAccount, setBulkAccount] = React.useState("");

  const filtered = React.useMemo(() => {
    const needle = query.trim().toLowerCase();
    const kept = rows.filter((row) => {
      if (!matchesLens(row, lens)) return false;
      if (!needle) return true;
      return (
        row.description.toLowerCase().includes(needle) ||
        (row.reference?.toLowerCase().includes(needle) ?? false) ||
        (row.proposedLabel?.toLowerCase().includes(needle) ?? false)
      );
    });

    if (sort === "index") return kept;
    return [...kept].sort((a, b) => {
      if (sort === "date") return a.date.localeCompare(b.date);
      if (sort === "description") return a.description.localeCompare(b.description);
      const left = BigInt(a.amountMinor);
      const right = BigInt(b.amountMinor);
      return left === right ? 0 : left > right ? -1 : 1;
    });
  }, [rows, lens, query, sort]);

  // A filter change can strand the viewer on page 9 of a 2-page result.
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, pageCount - 1);
  const visible = filtered.slice(safePage * pageSize, safePage * pageSize + pageSize);

  // Selecting a row then filtering it away would silently include it in the next
  // bulk action, so the selection is always intersected with what is on screen.
  const selectable = React.useMemo(
    () => filtered.filter((row) => !row.posted).map((row) => row.id),
    [filtered],
  );
  const selectableSet = React.useMemo(() => new Set(selectable), [selectable]);
  const effective = React.useMemo(
    () => selectable.filter((id) => selected.has(id)),
    [selectable, selected],
  );

  const allSelected = selectable.length > 0 && effective.length === selectable.length;
  const someSelected = effective.length > 0 && !allSelected;

  function toggleRow(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(selectable));
  }

  const counts = React.useMemo(() => {
    const tally = {} as Record<Lens, number>;
    for (const { key } of LENSES) tally[key] = rows.filter((row) => matchesLens(row, key)).length;
    return tally;
  }, [rows]);

  // Accounts the user actually opened, as opposed to the seeded chart's buckets.
  // Zero of these is the whole reason a transfer row can look unanswerable.
  const ownTransferTargets = React.useMemo(
    () => transferTargets.filter((option) => !option.isGroup).length,
    [transferTargets],
  );

  return (
    <>
      {/* ── Why the transfer rows are stuck ─────────────────────────────── */}
      {counts.choice > 0 && ownTransferTargets === 0 && (
        <div className="mb-4 rounded-2xl border border-amber-500/30 bg-amber-500/5 px-4 py-3">
          <p className="text-sm font-medium text-amber-300">
            {counts.choice} row{counts.choice === 1 ? "" : "s"} need the *other* account, and you
            have not opened one yet.
          </p>
          <p className="mt-1 text-xs text-gray-400">
            These are transfers and investments — money that moved between two accounts you own, so
            neither side is a spending category. The only account you have is the one this statement
            came from, and a transfer to itself is not a transfer. Two ways forward: use{" "}
            <span className="text-gray-300">The other account is not in the list</span> on a row to
            open the missing account and confirm in one step, or pick{" "}
            <span className="text-gray-300">Treat as a category</span> if the money really did leave
            your accounts.
          </p>
        </div>
      )}

      {/* ── Lenses, search, sort ───────────────────────────────────────── */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1 rounded-full border border-gray-600 bg-gray-800/60 p-1">
          {LENSES.map((option) => (
            <button
              key={option.key}
              type="button"
              onClick={() => {
                setLens(option.key);
                setPage(0);
              }}
              className={cn(
                "rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
                lens === option.key
                  ? "bg-brand-500/20 text-brand-300"
                  : "text-gray-400 hover:text-gray-200",
              )}
              aria-pressed={lens === option.key}
            >
              {option.label}
              <span className="tnum ml-1.5 text-gray-500">{counts[option.key]}</span>
            </button>
          ))}
        </div>

        <div className="relative min-w-52 flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500"
            aria-hidden
          />
          <input
            type="search"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setPage(0);
            }}
            placeholder="Search narration, reference or category"
            aria-label="Search staged rows"
            className="form-input h-10 w-full pl-9 text-xs"
          />
        </div>

        <select
          className="form-input h-10 py-1 text-xs"
          value={sort}
          onChange={(event) => setSort(event.target.value as typeof sort)}
          aria-label="Sort rows"
        >
          <option value="index">File order</option>
          <option value="date">Date</option>
          <option value="amount">Amount, largest first</option>
          <option value="description">Narration A–Z</option>
        </select>

        <select
          className="form-input h-10 py-1 text-xs"
          value={pageSize}
          onChange={(event) => {
            setPageSize(Number(event.target.value));
            setPage(0);
          }}
          aria-label="Rows per page"
        >
          {[25, 50, 100, 250].map((size) => (
            <option key={size} value={size}>
              {size} per page
            </option>
          ))}
        </select>
      </div>

      {/* ── Bulk bar ───────────────────────────────────────────────────── */}
      {effective.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-2xl border border-brand-500/30 bg-brand-500/5 px-4 py-3">
          <SlidersHorizontal className="h-4 w-4 text-brand-300" aria-hidden />
          <p className="text-xs font-medium text-gray-200">
            {effective.length} row{effective.length === 1 ? "" : "s"} selected
          </p>

          <select
            className="form-input h-9 py-1 text-xs"
            value={bulkAccount}
            onChange={(event) => setBulkAccount(event.target.value)}
            aria-label="Category to apply to the selected rows"
          >
            <option value="">Keep each row&rsquo;s own category</option>
            <optgroup label="Categories">
              {categories.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </optgroup>
            <optgroup label="Move to / from one of your accounts">
              {transferTargets
                .filter((option) => !option.isGroup)
                .map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
            </optgroup>
            <optgroup label="Chart groups (not a real account)">
              {transferTargets
                .filter((option) => option.isGroup)
                .map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
            </optgroup>
          </select>

          <BulkButton
            batchId={batchId}
            rowIds={effective}
            decision="CONFIRM"
            accountId={bulkAccount}
            icon={<Check aria-hidden />}
            label={bulkAccount ? "Recategorise & confirm" : "Confirm selected"}
            onDone={() => setSelected(new Set())}
          />
          <BulkButton
            batchId={batchId}
            rowIds={effective}
            decision="REJECT"
            icon={<X aria-hidden />}
            label="Skip selected"
            onDone={() => setSelected(new Set())}
          />
          <BulkButton
            batchId={batchId}
            rowIds={effective}
            decision="RESET"
            icon={<Undo2 aria-hidden />}
            label="Reopen selected"
            confirmSpec={{
              title: `Reopen ${effective.length} row(s)?`,
              body: "Their decisions are cleared and they go back to waiting for review. Rows already posted to the ledger are left alone.",
              confirmLabel: "Reopen them",
            }}
            onDone={() => setSelected(new Set())}
          />

          <button
            type="button"
            className="ml-auto text-xs text-gray-400 underline-offset-2 hover:underline"
            onClick={() => setSelected(new Set())}
          >
            Clear selection
          </button>
        </div>
      )}

      {/* ── Table ──────────────────────────────────────────────────────── */}
      <section className="panel p-0">
        <div className="table-scroll">
          <table className="w-full text-sm">
            <caption className="sr-only">
              Staged rows with date, narration, proposed category, amount and status
            </caption>
            <thead>
              <tr className="border-b border-gray-600">
                <th scope="col" className="px-4 py-3 text-left">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-brand-500"
                    checked={allSelected}
                    ref={(node) => {
                      if (node) node.indeterminate = someSelected;
                    }}
                    onChange={toggleAll}
                    disabled={selectable.length === 0}
                    aria-label={`Select all ${selectable.length} rows in this view`}
                  />
                </th>
                <th scope="col" className="metric-label px-4 py-3 text-left">Date</th>
                <th scope="col" className="metric-label px-4 py-3 text-left">Narration</th>
                <th scope="col" className="metric-label px-4 py-3 text-left">Category</th>
                <th scope="col" className="metric-label px-4 py-3 text-right">Amount</th>
                <th scope="col" className="metric-label px-4 py-3 text-left">Status</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => {
                const decided = row.status === "CONFIRMED" || row.status === "REJECTED";
                // The categoriser's intent decides which list is offered *first*,
                // not which list is offered. It is a guess made from narration —
                // "UPI/P2M/IndMoney" reads as an investment, but for someone
                // without an IndMoney account it is simply money going out — and
                // the review screen exists to let a guess be overruled. Showing
                // only one list turned a wrong guess into a dead end.
                const transfersFirst = row.intent === "TRANSFER" || row.intent === "INVESTMENT";
                const isOpen = expanded === row.id;

                return (
                  <React.Fragment key={row.id}>
                    <tr
                      className={cn(
                        "border-b border-gray-600/50 align-top",
                        selectableSet.has(row.id) && selected.has(row.id) && "bg-brand-500/5",
                      )}
                    >
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          className="h-4 w-4 accent-brand-500"
                          checked={selected.has(row.id)}
                          onChange={() => toggleRow(row.id)}
                          disabled={row.posted}
                          aria-label={`Select ${row.description}`}
                        />
                      </td>
                      <td className="tnum px-4 py-3 text-gray-400">{row.date}</td>
                      <td className="px-4 py-3">
                        <button
                          type="button"
                          onClick={() => setExpanded(isOpen ? null : row.id)}
                          className="flex items-start gap-1.5 text-left"
                          aria-expanded={isOpen}
                        >
                          <ChevronDown
                            className={cn(
                              "mt-1 h-3.5 w-3.5 shrink-0 text-gray-500 transition-transform",
                              isOpen && "rotate-180",
                            )}
                            aria-hidden
                          />
                          <span>
                            <span className="block font-medium text-gray-100">{row.description}</span>
                            <span className="mt-0.5 block max-w-md text-xs text-gray-500">
                              {row.because}
                            </span>
                          </span>
                        </button>
                      </td>
                      <td className="px-4 py-3">
                        {row.posted ? (
                          <span className="text-gray-400">{row.proposedLabel ?? "—"}</span>
                        ) : decided ? (
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-gray-400">{row.proposedLabel ?? "—"}</span>
                            <ActionForm
                              action={reviewRowAction}
                              fields={{ batchId, rowId: row.id, decision: "RESET" }}
                              className="inline"
                            >
                              <SubmitButton icon={<Undo2 aria-hidden />} className="h-8 px-2.5 text-xs">
                                Reopen
                              </SubmitButton>
                            </ActionForm>
                          </div>
                        ) : (
                          <ActionForm
                            action={reviewRowAction}
                            fields={{ batchId, rowId: row.id }}
                            className="flex flex-wrap items-center gap-2"
                          >
                            <>
                              <AccountSelect
                                label={`Account or category for ${row.description}`}
                                defaultValue={row.proposedAccountId ?? ""}
                                transferTargets={transferTargets}
                                categories={categories}
                                transfersFirst={transfersFirst}
                              />
                              <SubmitButton
                                name="decision"
                                value="CONFIRM"
                                className="h-9 px-3 text-xs"
                              >
                                Confirm
                              </SubmitButton>
                              <SubmitButton
                                name="decision"
                                value="REJECT"
                                className="h-9 px-3 text-xs"
                              >
                                Skip
                              </SubmitButton>
                            </>
                          </ActionForm>
                        )}

                        {!row.posted && !decided && transfersFirst && (
                          newFor === row.id ? (
                            <div className="mt-2 rounded-xl border border-gray-600 bg-gray-900/40 p-3">
                              <NewAccountForm
                                batchId={batchId}
                                row={row}
                                onDone={() => setNewFor(null)}
                              />
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setNewFor(row.id)}
                              className="mt-2 text-xs text-brand-400 underline-offset-2 hover:underline"
                            >
                              <Plus className="mr-1 inline h-3 w-3" aria-hidden />
                              The other account is not in the list
                            </button>
                          )
                        )}
                      </td>
                      <td
                        className={cn(
                          "tnum px-4 py-3 text-right font-medium",
                          row.direction === "DEBIT" ? "text-red-400" : "text-green-400",
                        )}
                      >
                        {row.direction === "DEBIT" ? "−" : "+"}
                        {row.amount}
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-xs text-gray-400">
                          {statusLabel(row)}
                          {row.posted ? " · posted" : ""}
                        </span>
                        {row.rejectedReason && (
                          <p className="text-xs text-gray-500">{row.rejectedReason}</p>
                        )}
                      </td>
                    </tr>

                    {isOpen && (
                      <tr className="border-b border-gray-600/50 bg-gray-800/40">
                        <td />
                        <td colSpan={5} className="px-4 py-4">
                          <dl className="grid gap-x-6 gap-y-2 text-xs sm:grid-cols-2 lg:grid-cols-4">
                            <Detail label="Bank reference" value={row.reference ?? "—"} />
                            <Detail label="Balance after" value={row.balanceAfter ?? "—"} />
                            <Detail label="Direction" value={row.direction === "DEBIT" ? "Money out" : "Money in"} />
                            <Detail label="Intent" value={row.intent} />
                          </dl>

                          <p className="metric-label mt-4">The line as your bank wrote it</p>
                          <pre className="mt-1 overflow-x-auto rounded-lg border border-gray-600 bg-gray-900/60 p-3 text-xs text-gray-400">
                            {row.raw}
                          </pre>

                          {ruleFor === row.id ? (
                            <div className="mt-4 rounded-xl border border-gray-600 bg-gray-900/40 p-4">
                              <RuleForm
                                batchId={batchId}
                                row={row}
                                categories={categories}
                                onDone={() => setRuleFor(null)}
                              />
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setRuleFor(row.id)}
                              className="ghost-btn mt-4 h-9 px-3 text-xs"
                            >
                              <Wand2 className="h-3.5 w-3.5" aria-hidden />
                              Make a rule from this row
                            </button>
                          )}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>

        {filtered.length === 0 && (
          <p className="px-5 py-10 text-center text-sm text-gray-500">
            No rows match this filter.
          </p>
        )}

        {/* ── Pagination ───────────────────────────────────────────────── */}
        {filtered.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-600 px-5 py-3">
            <p className="text-xs text-gray-500">
              Showing{" "}
              <span className="tnum text-gray-300">
                {safePage * pageSize + 1}–{Math.min(filtered.length, (safePage + 1) * pageSize)}
              </span>{" "}
              of <span className="tnum text-gray-300">{filtered.length}</span>
              {filtered.length !== rows.length && ` (of ${rows.length} in the file)`}
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="ghost-btn h-9 px-3 text-xs"
                onClick={() => setPage(safePage - 1)}
                disabled={safePage === 0}
              >
                <ChevronLeft className="h-3.5 w-3.5" aria-hidden />
                Previous
              </button>
              <span className="tnum text-xs text-gray-400">
                {safePage + 1} / {pageCount}
              </span>
              <button
                type="button"
                className="ghost-btn h-9 px-3 text-xs"
                onClick={() => setPage(safePage + 1)}
                disabled={safePage >= pageCount - 1}
              >
                Next
                <ChevronRight className="h-3.5 w-3.5" aria-hidden />
              </button>
            </div>
          </div>
        )}
      </section>
    </>
  );
}

/**
 * The one dropdown, holding both halves of the answer.
 *
 * A staged row is either a movement between two of your accounts or a category
 * of spending, and which one it is is a *guess* until the user says. Offering
 * only the guessed half is what left 96 transfer rows unanswerable: the only
 * cash account their owner had was the account being imported, which is
 * correctly excluded from its own transfer list, so every remaining option was a
 * chart bucket.
 */
function AccountSelect({
  label,
  defaultValue,
  transferTargets,
  categories,
  transfersFirst,
}: {
  label: string;
  defaultValue: string;
  transferTargets: readonly AccountOption[];
  categories: readonly AccountOption[];
  transfersFirst: boolean;
}) {
  const own = transferTargets.filter((option) => !option.isGroup);
  const buckets = transferTargets.filter((option) => option.isGroup);

  const transfers = (
    <React.Fragment key="transfers">
      {own.length > 0 && (
        <optgroup label="Move to / from one of your accounts">
          {own.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </optgroup>
      )}
      {buckets.length > 0 && (
        <optgroup label="Chart groups (not a real account)">
          {buckets.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </optgroup>
      )}
    </React.Fragment>
  );

  const spending = (
    <optgroup key="categories" label="Treat as a category">
      {categories.map((option) => (
        <option key={option.id} value={option.id}>
          {option.label}
        </option>
      ))}
    </optgroup>
  );

  return (
    <select
      name="accountId"
      className="form-input h-9 min-w-52 py-1 text-xs"
      defaultValue={defaultValue}
      aria-label={label}
    >
      <option value="">Choose…</option>
      {transfersFirst ? [transfers, spending] : [spending, transfers]}
    </select>
  );
}

/**
 * Opens the counter-account this row needs, without leaving the review.
 *
 * The name is prefilled from the narration because the narration is where it
 * came from: `UPI/P2M/.../IndMoney /Accoun/Kotak Mahindra Bank` is the user
 * telling you, in their bank's words, that an IndMoney account exists.
 */
function NewAccountForm({
  batchId,
  row,
  onDone,
}: {
  batchId: string;
  row: ReviewRow;
  onDone: () => void;
}) {
  const suggestion = React.useMemo(() => guessAccountName(row.description), [row.description]);

  return (
    <ActionForm
      action={createCounterAccountAction}
      fields={{ batchId, rowId: row.id, confirmRow: "1" }}
      className="grid gap-2 sm:grid-cols-3"
      onResult={(state) => {
        if (state.ok) onDone();
      }}
    >
      <>
        <label className="block">
          <span className="metric-label">Account name</span>
          <input
            name="name"
            className="form-input mt-1 h-9 w-full py-1 text-xs"
            defaultValue={suggestion}
            required
            maxLength={120}
          />
        </label>

        <label className="block">
          <span className="metric-label">Kind</span>
          <select
            name="kind"
            className="form-input mt-1 h-9 w-full py-1 text-xs"
            defaultValue={row.intent === "INVESTMENT" ? "BROKERAGE" : "BANK"}
          >
            {counterAccountKinds.map((kind) => (
              <option key={kind.value} value={kind.value}>
                {kind.label}
              </option>
            ))}
          </select>
        </label>

        <div className="flex items-end gap-2">
          <SubmitButton icon={<Plus aria-hidden />} className="h-9 px-3 text-xs">
            Create &amp; confirm
          </SubmitButton>
          <button type="button" className="text-xs text-gray-400 hover:underline" onClick={onDone}>
            Cancel
          </button>
        </div>
      </>
    </ActionForm>
  );
}

/**
 * A usable account name out of a bank narration.
 *
 * Bank references are noise (`UPI`, `P2A`, `517362116631`), so digits-only and
 * known protocol tokens are dropped and the longest remaining word wins.
 */
function guessAccountName(description: string): string {
  const NOISE = new Set(["UPI", "P2A", "P2M", "NEFT", "IMPS", "RTGS", "REF", "SELF", "ACCOUN"]);
  const words = description
    .split(/[^A-Za-z]+/)
    .filter((word) => word.length >= 3 && !NOISE.has(word.toUpperCase()))
    .sort((a, b) => b.length - a.length);
  return words[0] ?? description.slice(0, 24);
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="metric-label">{label}</dt>
      <dd className="mt-0.5 text-gray-300">{value}</dd>
    </div>
  );
}

function BulkButton({
  batchId,
  rowIds,
  decision,
  accountId,
  icon,
  label,
  confirmSpec,
  onDone,
}: {
  batchId: string;
  rowIds: readonly string[];
  decision: "CONFIRM" | "REJECT" | "RESET";
  accountId?: string;
  icon: React.ReactNode;
  label: string;
  confirmSpec?: { title: string; body: string; confirmLabel: string };
  onDone: () => void;
}) {
  return (
    <ActionForm
      action={bulkReviewRowsAction}
      fields={{ batchId, decision, accountId: accountId || undefined }}
      confirm={confirmSpec}
      className="inline"
      onResult={(state) => {
        if (state.ok) onDone();
      }}
    >
      <>
        {rowIds.map((id) => (
          <input key={id} type="hidden" name="rowId" value={id} />
        ))}
        <SubmitButton icon={icon} className="h-9 px-3 text-xs">
          {label}
        </SubmitButton>
      </>
    </ActionForm>
  );
}

/**
 * "This narration always means groceries" — captured as a rule.
 *
 * The pattern defaults to the longest run of letters in the narration rather
 * than the whole line, because a bank narration usually carries a reference
 * number that will never repeat: seeding the field with
 * `UPI/DR/402913/SWIGGY/...` would create a rule that matches exactly one
 * transaction, forever.
 */
function RuleForm({
  batchId,
  row,
  categories,
  onDone,
}: {
  batchId: string;
  row: ReviewRow;
  categories: readonly AccountOption[];
  onDone: () => void;
}) {
  const suggestion = React.useMemo(() => guessPattern(row.description), [row.description]);

  return (
    <ActionForm
      action={createRuleFromRowAction}
      fields={{ batchId }}
      className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
      onResult={(state) => {
        if (state.ok) onDone();
      }}
    >
      <>
        <label className="block">
          <span className="metric-label">When the narration</span>
          <select name="matchType" className="form-input mt-1 h-9 w-full py-1 text-xs" defaultValue="CONTAINS">
            <option value="CONTAINS">contains</option>
            <option value="STARTS_WITH">starts with</option>
            <option value="EXACT">is exactly</option>
          </select>
        </label>

        <label className="block">
          <span className="metric-label">This text</span>
          <input
            name="pattern"
            className="form-input mt-1 h-9 w-full py-1 text-xs"
            defaultValue={suggestion}
            required
            minLength={2}
            maxLength={120}
          />
        </label>

        <label className="block">
          <span className="metric-label">Post it to</span>
          <select
            name="accountId"
            className="form-input mt-1 h-9 w-full py-1 text-xs"
            defaultValue={row.proposedAccountId ?? ""}
            required
          >
            <option value="">Choose a category…</option>
            {categories.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="metric-label">Applies to</span>
          <select
            name="appliesTo"
            className="form-input mt-1 h-9 w-full py-1 text-xs"
            defaultValue={row.direction}
          >
            <option value="ANY">Money in or out</option>
            <option value="DEBIT">Money out only</option>
            <option value="CREDIT">Money in only</option>
          </select>
        </label>

        <div className="flex items-center gap-2 sm:col-span-2 lg:col-span-4">
          <SubmitButton icon={<Wand2 aria-hidden />} className="h-9 px-3 text-xs">
            Save rule
          </SubmitButton>
          <button type="button" className="text-xs text-gray-400 hover:underline" onClick={onDone}>
            Cancel
          </button>
          <p className="text-xs text-gray-500">
            Applies to future imports. This row keeps whatever you choose above.
          </p>
        </div>
      </>
    </ActionForm>
  );
}

function guessPattern(description: string): string {
  const words = description
    .split(/[^A-Za-z]+/)
    .filter((word) => word.length >= 4)
    .sort((a, b) => b.length - a.length);
  return words[0] ?? description.slice(0, 24);
}

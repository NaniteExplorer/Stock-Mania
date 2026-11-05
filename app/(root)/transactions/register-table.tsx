"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "../../../components/ui/table";
import { useTableKeyboard } from "../../../components/ui/use-table-keyboard";
import { Input } from "../../../components/ui/input";
import { cn } from "../../../lib/utils";
import BulkRemove, { useRemovalUndo, type BulkRemoveProps } from "./bulk-remove";
import SingleRemove, { type SingleRemoveRow } from "./single-remove";
import { REGISTER_REDO, REGISTER_REFUSALS, registerTableRows, registerUndo, removeRoute } from "./register-keyboard";

/**
 * One row of the register, already formatted.
 *
 * Money arrives as a **string**, not a `Money` and not a number. `Money` is a
 * class and cannot cross the server/client boundary, and a number would put a
 * float on the wire — so the server formats it (`ui/format.ts`) and the client
 * only positions it.
 */
export interface RegisterRow {
  id: string;
  date: string;
  description: string;
  kind: string;
  account: string;
  category: string;
  amount: string;
  /** Which way the money moved, for the sign and the colour. */
  direction: "IN" | "OUT" | "NEUTRAL";
  /** The account screen the row lives on, which `Enter` opens; null when unknown. */
  href: string | null;
  /** Any posting reconciled against a statement (L10): `E` and `Del` refuse it. */
  reconciled: boolean;
}

const BINDINGS: readonly (readonly [string, string])[] = [
  ["↑ ↓ · Home End", "Move the row cursor"],
  ["Space · Shift+↑ ↓", "Select the row · extend the selection"],
  ["Ctrl+A", "Select every row in view"],
  ["Del", "Remove the cursor row, or with every row selected: remove all matching (asks first)"],
  ["Enter", "Open the row's account"],
  ["Ctrl+Z", "Undo the removal in the banner"],
  ["/", "Filter this page"],
  ["Esc", "Clear the selection, then leave the table"],
];

/**
 * The register: the §7.1 bulk bar, the page-local filter and the keyboard grid
 * (DESIGN §6.1, task 2.8.b).
 *
 * The table is one tab stop (`useTableKeyboard`). Every destructive key routes to the
 * screen's two existing mutation paths only: `Del` over the whole view opens the
 * remove-all dialog, `Ctrl+Z` is the banner's undo. Anything else is refused aloud.
 *
 * Filtering this page happens here rather than on the server on purpose: the page of
 * rows is already in the client, and a round trip per keystroke would make the one
 * interaction this screen exists for feel slow.
 */
export default function RegisterTable({
  rows,
  bulk,
  serverFiltered,
  empty,
}: {
  rows: readonly RegisterRow[];
  bulk: Omit<BulkRemoveProps, "open" | "onOpenChange">;
  /** The URL filter is set, so `Ctrl+A` selects the filter scope (§7 item 6). */
  serverFiltered: boolean;
  /** Rendered instead of the table when the page has no rows; the bulk bar stays. */
  empty: React.ReactNode;
}) {
  const router = useRouter();
  const [query, setQuery] = React.useState("");
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [singleRow, setSingleRow] = React.useState<SingleRemoveRow | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [help, setHelp] = React.useState(false);
  const filterRef = React.useRef<HTMLInputElement>(null);
  const gridRef = React.useRef<HTMLTableElement>(null);
  const { banner, undo } = useRemovalUndo();

  const filtered = React.useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle === "") return rows;
    return rows.filter((row) =>
      `${row.description} ${row.category} ${row.account}`.toLowerCase().includes(needle),
    );
  }, [rows, query]);
  const keyRows = React.useMemo(() => registerTableRows(filtered), [filtered]);
  const pageFilterActive = query.trim() !== "";

  // A refusal the screen (not the model) makes: announced and toasted, like the model's.
  const refuse = React.useCallback((reason: string) => {
    setNotice(reason);
    toast(reason);
  }, []);

  const keyboard = useTableKeyboard({
    idPrefix: "register",
    rows: keyRows,
    filtered: serverFiltered && !pageFilterActive,
    scopeCount: bulk.count,
    undo: registerUndo(banner),
    redo: REGISTER_REDO,
    hasFilterField: true,
    onEdit: () => refuse(REGISTER_REFUSALS.editOnAccount),
    onRemove: (ids) => {
      const route = removeRoute({
        ids,
        selectedCount: keyboard.selected.length,
        visibleCount: filtered.length,
        pageFilterActive,
      });
      if (route.kind === "dialog") setDialogOpen(true);
      else if (route.kind === "single") {
        const row = filtered.find((r) => r.id === route.id);
        if (row) {
          const sign = row.direction === "OUT" ? "−" : row.direction === "IN" ? "+" : "";
          setSingleRow({ id: row.id, label: `${row.date} · ${row.description}`, net: `${sign}${row.amount}`, date: row.date });
        }
      } else refuse(route.reason);
    },
    onUndo: () => {
      if (banner) undo(banner.requestId);
    },
    onOpen: (id) => {
      const href = filtered.find((row) => row.id === id)?.href;
      if (href) router.push(href);
    },
    onFocusFilter: () => filterRef.current?.focus(),
    onHelp: () => setHelp((open) => !open),
    onRefuse: (_verb, reason) => toast(reason),
  });

  const onGridKeyDown = (event: React.KeyboardEvent<HTMLTableElement>) => {
    setNotice(null);
    keyboard.gridProps.onKeyDown(event);
  };
  const selected = new Set(keyboard.selected);

  return (
    <div className="space-y-3">
      <BulkRemove
        {...bulk}
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
        }}
      />
      <SingleRemove
        row={singleRow}
        onClose={() => {
          setSingleRow(null);
          gridRef.current?.focus();
        }}
      />

      {rows.length === 0 ? (
        empty
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Input
              ref={filterRef}
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Filter this page — merchant, category or account"
              aria-label="Filter transactions"
              className="w-full md:w-96"
            />
            <p className="text-xs text-(--fg-muted)">
              {filtered.length} of {rows.length} shown
              {selected.size > 0 && ` · ${selected.size} selected`} · ↑ ↓ move, Space select, ? all keys
            </p>
          </div>

          {help && (
            <section aria-label="Keyboard bindings for the register" className="rounded-2xl border border-(--border) px-4 py-3">
              <dl className="grid gap-x-4 gap-y-1 text-xs md:grid-cols-[auto_1fr]">
                {BINDINGS.map(([keys, effect]) => (
                  <React.Fragment key={keys}>
                    <dt className="tnum text-(--fg)">{keys}</dt>
                    <dd className="text-(--fg-secondary)">{effect}</dd>
                  </React.Fragment>
                ))}
              </dl>
              <button type="button" className="mt-2 text-xs text-(--fg-secondary) hover:underline" onClick={() => { setHelp(false); gridRef.current?.focus(); }}>
                Close
              </button>
            </section>
          )}

          <span className="sr-only" {...keyboard.liveRegionProps}>{notice ?? keyboard.announcement}</span>

          {filtered.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-(--fg-muted)">Nothing matches “{query}”.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table
                ref={gridRef}
                {...keyboard.gridProps}
                onKeyDown={onGridKeyDown}
                aria-label="Transaction register"
                className="focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
              >
                <TableCaption className="sr-only">
                  Transaction register: date, narration, category, account and amount. Arrow keys move, Space selects, ? lists every key.
                </TableCaption>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-28">Date</TableHead>
                    <TableHead>Narration</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Account</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((row, index) => (
                    <TableRow
                      key={row.id}
                      {...keyboard.rowProps(keyRows[index], index)}
                      data-state={selected.has(row.id) ? "selected" : undefined}
                      className="data-[cursor=true]:bg-(--bg-hover)/40"
                    >
                      <TableCell><span className="tnum text-(--fg-secondary)">{row.date}</span></TableCell>
                      <TableCell>
                        <div className="min-w-0">
                          <p className="truncate font-medium text-(--fg)">{row.description}</p>
                          <p className="truncate text-xs text-(--fg-muted)">{row.kind}{row.reconciled && " · Reconciled"}</p>
                        </div>
                      </TableCell>
                      <TableCell><span className="text-(--fg-secondary)">{row.category}</span></TableCell>
                      <TableCell><span className="text-(--fg-secondary)">{row.account}</span></TableCell>
                      <TableCell className="text-right">
                        <span
                          className={cn(
                            "tnum",
                            row.direction === "IN" && "text-(--gain)",
                            row.direction === "OUT" && "text-(--loss)",
                            row.direction === "NEUTRAL" && "text-(--fg-secondary)",
                          )}
                        >
                          {row.direction === "OUT" ? "−" : row.direction === "IN" ? "+" : ""}
                          {row.amount}
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

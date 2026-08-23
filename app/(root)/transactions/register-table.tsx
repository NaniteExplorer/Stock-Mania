"use client";

import * as React from "react";
import { DataTable, type Column } from "@/ui/data-table";
import { cn } from "@/lib/utils";

/**
 * One row of the register, already formatted.
 *
 * Money arrives as a **string**, not a `Money` and not a number. `Money` is a
 * class and cannot cross the server/client boundary, and a number would put a
 * float on the wire — so the server formats it (`ui/format.ts`) and the client
 * only positions it. That constraint is why this file exists at all: `DataTable`
 * needs `render` functions, and those cannot be passed from a Server Component.
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
}

const COLUMNS: readonly Column<RegisterRow>[] = [
  { id: "date", header: "Date", width: "7rem", render: (row) => <span className="tnum text-gray-400">{row.date}</span> },
  {
    id: "narration",
    header: "Narration",
    render: (row) => (
      <div className="min-w-0">
        <p className="truncate font-medium text-gray-100">{row.description}</p>
        <p className="truncate text-xs text-gray-500">{row.kind}</p>
      </div>
    ),
  },
  { id: "category", header: "Category", render: (row) => <span className="text-gray-400">{row.category}</span> },
  { id: "account", header: "Account", render: (row) => <span className="text-gray-400">{row.account}</span> },
  {
    id: "amount",
    header: "Amount",
    numeric: true,
    render: (row) => (
      <span
        className={cn(
          "tnum",
          row.direction === "IN" && "text-green-500",
          row.direction === "OUT" && "text-red-500",
          row.direction === "NEUTRAL" && "text-gray-300",
        )}
      >
        {row.direction === "OUT" ? "−" : row.direction === "IN" ? "+" : ""}
        {row.amount}
      </span>
    ),
  },
];

/**
 * The register.
 *
 * Filtering happens here rather than on the server on purpose: the whole page of
 * rows is already in the client, and a round trip per keystroke would make the
 * one interaction this screen exists for feel slow. Anything that needs more
 * rows than a page uses the date range, which is a server concern.
 */
export default function RegisterTable({ rows }: { rows: readonly RegisterRow[] }) {
  const [query, setQuery] = React.useState("");

  const filtered = React.useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle === "") return rows;
    return rows.filter((row) =>
      `${row.description} ${row.category} ${row.account}`.toLowerCase().includes(needle),
    );
  }, [rows, query]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Filter this page — merchant, category or account"
          aria-label="Filter transactions"
          className="form-input w-full md:w-96"
        />
        <p className="text-xs text-gray-500">
          {filtered.length} of {rows.length} shown · ↑ ↓ to move, Home / End to jump
        </p>
      </div>

      <DataTable
        columns={COLUMNS}
        rows={filtered}
        rowKey={(row) => row.id}
        caption="Transaction register: date, narration, category, account and amount"
        empty={
          <p className="px-4 py-10 text-center text-sm text-gray-500">
            Nothing matches “{query}”.
          </p>
        }
      />
    </div>
  );
}

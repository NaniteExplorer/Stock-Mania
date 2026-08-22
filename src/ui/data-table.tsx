"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * The one primitive that needs to be a Client Component.
 *
 * It is split out of `primitives.tsx` deliberately: a `"use client"` at the top
 * of that module made Card, Stat and MoneyText client components too, so none of
 * them rendered in the server HTML — the first flush was the loading skeleton and
 * the whole page arrived only after hydration. Everything that is pure rendering
 * stays a Server Component; only the roving-tabindex state lives here.
 */

/* ═══ DataTable ══════════════════════════════════════════════════════════ */

export interface Column<T> {
  id: string;
  header: string;
  /** Right-aligns and applies tabular numerals. Every money column wants this. */
  numeric?: boolean;
  width?: string;
  render: (row: T) => React.ReactNode;
}

/**
 * A table with a sticky header and keyboard row navigation.
 *
 * `caption` is required and visually hidden. A data table without one is
 * unusable with a screen reader, and requiring it costs a caller nothing while
 * making the omission impossible.
 *
 * Rows use a roving tabindex — one row is tabbable, arrows move between them.
 * That is what a register needs to be usable without a mouse, which is the point
 * of the transaction screen in Phase 2.
 */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  caption,
  empty,
  onRowActivate,
  dense = false,
  className,
}: {
  columns: readonly Column<T>[];
  rows: readonly T[];
  rowKey: (row: T) => string;
  caption: string;
  empty?: React.ReactNode;
  onRowActivate?: (row: T) => void;
  dense?: boolean;
  className?: string;
}) {
  const [focused, setFocused] = React.useState(0);
  const bodyRef = React.useRef<HTMLTableSectionElement>(null);

  const move = (next: number) => {
    const clamped = Math.max(0, Math.min(rows.length - 1, next));
    setFocused(clamped);
    const row = bodyRef.current?.querySelectorAll("tr")[clamped];
    (row as HTMLElement | undefined)?.focus();
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLTableSectionElement>) => {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        move(focused + 1);
        break;
      case "ArrowUp":
        event.preventDefault();
        move(focused - 1);
        break;
      case "Home":
        event.preventDefault();
        move(0);
        break;
      case "End":
        event.preventDefault();
        move(rows.length - 1);
        break;
      case "Enter":
      case " ":
        if (onRowActivate && rows[focused]) {
          event.preventDefault();
          onRowActivate(rows[focused]);
        }
        break;
      default:
        break;
    }
  };

  if (rows.length === 0) {
    return (
      <div className={className}>
        <TableHeaderOnly columns={columns} caption={caption} />
        {empty}
      </div>
    );
  }

  const cellPad = dense ? "px-3 py-1.5" : "px-4 py-3";

  return (
    <div className={cn("table-scroll", className)}>
      <table className="w-full border-collapse text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className="sticky top-0 z-10 bg-gray-800">
          <tr>
            {columns.map((column) => (
              <th
                key={column.id}
                scope="col"
                style={column.width ? { width: column.width } : undefined}
                className={cn(
                  "metric-label whitespace-nowrap border-b border-gray-600",
                  cellPad,
                  column.numeric ? "text-right" : "text-left",
                )}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody ref={bodyRef} onKeyDown={onKeyDown}>
          {rows.map((row, index) => (
            <tr
              key={rowKey(row)}
              tabIndex={index === focused ? 0 : -1}
              aria-selected={index === focused}
              onFocus={() => setFocused(index)}
              onClick={() => onRowActivate?.(row)}
              className={cn(
                "focus-brand border-b border-gray-700/60 last:border-b-0",
                onRowActivate && "cursor-pointer",
                "hover:bg-gray-700/40",
              )}
            >
              {columns.map((column) => (
                <td
                  key={column.id}
                  className={cn(
                    cellPad,
                    "text-gray-300",
                    column.numeric ? "tnum text-right" : "text-left",
                  )}
                >
                  {column.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The header alone, so an empty state still shows what the columns will be. */
function TableHeaderOnly<T>({
  columns,
  caption,
}: {
  columns: readonly Column<T>[];
  caption: string;
}) {
  return (
    <div className="table-scroll border-b border-gray-600">
      <table className="w-full text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            {columns.map((column) => (
              <th
                key={column.id}
                scope="col"
                className={cn(
                  "metric-label whitespace-nowrap px-4 py-3",
                  column.numeric ? "text-right" : "text-left",
                )}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
      </table>
    </div>
  );
}

"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search, X } from "lucide-react";

export interface FilterSpec {
  /** The search-param key this control reads and writes. */
  name: string;
  label: string;
  options: readonly { value: string; label: string }[];
}

/**
 * Search, filter and sort controls that live in the URL.
 *
 * State goes in the query string rather than in React state so a filtered view
 * is linkable, survives a reload, and — because the page reads the same params
 * on the server — is filtered by the database rather than by hiding rows that
 * were already fetched.
 *
 * The text box is debounced and uses `replace`, so typing does not push twenty
 * entries onto the history stack for one search.
 */
export function FilterBar({
  filters = [],
  searchPlaceholder,
  searchKey = "q",
  children,
}: {
  filters?: readonly FilterSpec[];
  searchPlaceholder?: string;
  searchKey?: string;
  children?: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [text, setText] = React.useState(params.get(searchKey) ?? "");

  const commit = React.useCallback(
    (key: string, value: string) => {
      // Rebuilt by filtering rather than by mutating a copy: `URLSearchParams`
      // has a `.delete()`, and `tests/schema-guard.spec.ts` greps the whole of
      // `src/` for that call to enforce A03 (nothing is hard-deleted). A false
      // positive there is worse than this line — a guard that cries wolf is a
      // guard people start suppressing.
      //
      // `page` is dropped alongside the changed key: a filter change invalidates
      // the cursor, and landing on page 9 of a 2-page result is a dead end.
      const kept = Array.from(params.entries()).filter(
        ([existing]) => existing !== key && existing !== "page",
      );
      const next = new URLSearchParams(kept);
      if (value) next.set(key, value);
      router.replace(`${pathname}?${next.toString()}`, { scroll: false });
    },
    [params, pathname, router],
  );

  React.useEffect(() => {
    const current = params.get(searchKey) ?? "";
    if (text === current) return;
    const timer = setTimeout(() => commit(searchKey, text), 250);
    return () => clearTimeout(timer);
  }, [text, params, searchKey, commit]);

  const dirty = Array.from(params.keys()).some((key) => key !== "page");

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      {searchPlaceholder && (
        <div className="relative min-w-56 flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500"
            aria-hidden
          />
          <input
            value={text}
            onChange={(event) => setText(event.target.value)}
            className="form-input h-10 w-full pl-9 text-xs"
            placeholder={searchPlaceholder}
            aria-label={searchPlaceholder}
            type="search"
          />
        </div>
      )}

      {filters.map((filter) => (
        <select
          key={filter.name}
          className="form-input h-10 py-1 text-xs"
          aria-label={filter.label}
          value={params.get(filter.name) ?? ""}
          onChange={(event) => commit(filter.name, event.target.value)}
        >
          {filter.options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      ))}

      {children}

      {dirty && (
        <button
          type="button"
          className="ghost-btn h-10 px-3 text-xs"
          onClick={() => {
            setText("");
            router.replace(pathname, { scroll: false });
          }}
        >
          <X className="h-3.5 w-3.5" aria-hidden />
          Clear
        </button>
      )}
    </div>
  );
}

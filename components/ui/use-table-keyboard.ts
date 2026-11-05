"use client";

import * as React from "react";
import {
  applyTableCommand,
  CONTROL_ACTIVATION_KEYS,
  dispatchTableKey,
  isRowControlTarget,
  isTextEntryTarget,
  type KeyTarget,
  type TableCommand,
  type TableCursorState,
  type TableKeyState,
  type TableRow,
  type TableVerb,
} from "./table-keyboard";

/**
 * Applies the DESIGN §6.1 keyboard model to one table (task 2.8.b).
 *
 * The table is one tab stop (`role="grid"`, `tabIndex=0`); the cursor is
 * `aria-activedescendant`, distinct from selection. Cursor and selection live here;
 * every verb that leaves the table (edit, remove, undo, redo, open, filter, help) is
 * forwarded to the caller, which owns the server action and the §7.1 dialog.
 *
 * Every refusal is put in `announcement` (render it in `liveRegionProps`) **and** passed
 * to `onRefuse`, which the caller wires to a toast — the key never silently does nothing.
 */
export interface TableKeyboardOptions {
  /** Unique prefix for row element ids (`aria-activedescendant`). */
  idPrefix?: string;
  rows: readonly TableRow[];
  filtered: boolean;
  scopeCount?: number;
  undo: TableKeyState["undo"];
  redo: TableKeyState["redo"];
  hasFilterField?: boolean;
  /** Controlled selection, when the caller already owns it (e.g. checkbox column). */
  selected?: readonly string[];
  onSelectedChange?: (ids: readonly string[]) => void;
  onEdit?: (id: string) => void;
  /** `mode: "bulk"` opens the §7.1 dialog; `"single"` removes with an undo toast. */
  onRemove?: (ids: readonly string[], mode: "single" | "bulk") => void;
  onUndo?: () => void;
  onRedo?: () => void;
  onOpen?: (id: string) => void;
  onFocusFilter?: () => void;
  onHelp?: () => void;
  onRefuse?: (verb: TableVerb, reason: string) => void;
}

const EXTERNAL: ReadonlySet<TableCommand["type"]> = new Set(["edit", "remove", "undo", "redo", "open", "focusFilter", "help", "blur"]);

export function useTableKeyboard(options: TableKeyboardOptions) {
  const generated = React.useId();
  const prefix = options.idPrefix ?? `tk${generated.replace(/[^\w-]/g, "")}`;
  const [inner, setInner] = React.useState<TableCursorState>({ cursor: null, selected: [], anchor: null });
  const [announcement, setAnnouncement] = React.useState("");
  const controlled = options.selected !== undefined;
  const selected = controlled ? options.selected! : inner.selected;
  // The cursor index survives a shrinking row set by clamping, never by pointing past the end.
  const cursor = inner.cursor == null || options.rows.length === 0 ? null : Math.min(inner.cursor, options.rows.length - 1);

  const latest = React.useRef(options);
  React.useEffect(() => { latest.current = options; });

  const rowId = React.useCallback((id: string) => `${prefix}-row-${id}`, [prefix]);

  const onKeyDown = React.useCallback((event: React.KeyboardEvent<HTMLElement>) => {
    // A control inside a row keeps its own activation keys: Space and Enter press the
    // focused button or follow the link; they do not select or open the row (Batch 5).
    if (CONTROL_ACTIVATION_KEYS.has(event.key) && isRowControlTarget(event.target as unknown as KeyTarget, event.currentTarget)) return;
    const o = latest.current;
    const state: TableKeyState = {
      rows: o.rows,
      cursor,
      selected,
      anchor: inner.anchor,
      filtered: o.filtered,
      scopeCount: o.scopeCount,
      undo: o.undo,
      redo: o.redo,
      hasFilterField: !!o.hasFilterField,
    };
    const result = dispatchTableKey(
      { key: event.key, ctrlKey: event.ctrlKey, metaKey: event.metaKey, shiftKey: event.shiftKey, altKey: event.altKey, isComposing: event.nativeEvent.isComposing },
      isTextEntryTarget(event.target as unknown as KeyTarget),
      state,
    );
    if (result.kind === "pass") return;
    event.preventDefault();
    if (result.kind === "refuse") {
      setAnnouncement(result.reason);
      o.onRefuse?.(result.verb, result.reason);
      return;
    }
    const { command } = result;
    setAnnouncement(result.announce ?? "");
    if (EXTERNAL.has(command.type)) {
      switch (command.type) {
        case "edit": o.onEdit?.(command.id); break;
        case "remove": o.onRemove?.(command.ids, command.mode); break;
        case "undo": o.onUndo?.(); break;
        case "redo": o.onRedo?.(); break;
        case "open": o.onOpen?.(command.id); break;
        case "focusFilter": o.onFocusFilter?.(); break;
        case "help": o.onHelp?.(); break;
        case "blur": (event.currentTarget as HTMLElement).blur(); break;
      }
      return;
    }
    const next = applyTableCommand(o.rows, { cursor, selected, anchor: inner.anchor }, command);
    setInner(next);
    if (next.selected !== selected) o.onSelectedChange?.(next.selected);
    if (next.cursor != null) {
      const row = o.rows[next.cursor];
      if (row) document.getElementById(rowId(row.id))?.scrollIntoView({ block: "nearest" });
    }
  }, [cursor, selected, inner.anchor, rowId]);

  const cursorRow = cursor == null ? undefined : options.rows[cursor];
  return {
    cursor,
    selected,
    announcement,
    rowId,
    /** Spread on the table element. */
    gridProps: {
      role: "grid" as const,
      tabIndex: 0,
      "aria-multiselectable": true as const,
      "aria-activedescendant": cursorRow ? rowId(cursorRow.id) : undefined,
      onKeyDown,
    },
    /** Spread on each row element. */
    rowProps: (row: TableRow, index: number) => ({
      id: rowId(row.id),
      role: "row" as const,
      "aria-selected": row.heading || row.mutationClass === "C" ? undefined : selected.includes(row.id),
      "data-cursor": index === cursor || undefined,
    }),
    /** Spread on one visually hidden element per table; refusals land here. */
    liveRegionProps: { "aria-live": "polite" as const, role: "status" as const, children: announcement },
  };
}

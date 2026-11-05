/**
 * The table keyboard model (DESIGN §6.1, tasks 2.8.s / 2.8.b).
 *
 * Pure: plain data in, a decision out. No DOM, no React. `useTableKeyboard` reads the
 * event, calls `dispatchTableKey`, and applies the result with `applyTableCommand`, so
 * every binding is testable in Node and the hook stays a thin adapter.
 *
 * A key either is not a table binding ("pass", the browser keeps it), is a legal verb
 * ("command"), or is a binding that cannot act right now ("refuse", with the reason the
 * owner reads and hears). A refusal never changes state.
 */

/** Mutation class (ARCHITECTURE §10): A ledger, B reference data, C system-derived. */
export type MutationClass = "A" | "B" | "C";

export interface TableRow {
  readonly id: string;
  /** Short name used when a refusal names the row, e.g. "12 Oct · Swiggy". */
  readonly label: string;
  readonly mutationClass: MutationClass;
  /** Set when the row is under an L10 reconciliation, e.g. "30 Sep". */
  readonly reconciledThrough?: string;
  /** A group heading inside the table: the cursor may rest on it, nothing acts on it. */
  readonly heading?: boolean;
  /** Whether `Enter` has a detail view to open. */
  readonly hasDetail?: boolean;
}

/** Undo / redo availability, as the server reports it (`RedoBatch.state` et al.). */
export type VerbAvailability =
  | { readonly available: true }
  | { readonly available: false; readonly reason: string };

export interface TableKeyState {
  readonly rows: readonly TableRow[];
  /** Index of the cursor row, or null before the table has been entered. */
  readonly cursor: number | null;
  /** Selected row ids. */
  readonly selected: readonly string[];
  /** Anchor for Shift+Up/Down range extension; the cursor row when selection started. */
  readonly anchor?: number | null;
  /** True when a filter narrows the table (§7 item 6). */
  readonly filtered: boolean;
  /** Rows matched by the filter, which may exceed the loaded page. */
  readonly scopeCount?: number;
  readonly undo: VerbAvailability;
  readonly redo: VerbAvailability;
  readonly hasFilterField: boolean;
}

/** The parts of a KeyboardEvent the model reads. */
export interface KeyInput {
  readonly key: string;
  readonly ctrlKey?: boolean;
  readonly metaKey?: boolean;
  readonly shiftKey?: boolean;
  readonly altKey?: boolean;
  readonly isComposing?: boolean;
}

/** The parts of an event target the guard reads. Structural, so tests need no DOM. */
export interface KeyTarget {
  readonly tagName?: string;
  readonly isContentEditable?: boolean;
  readonly type?: string;
  readonly closest?: (selector: string) => unknown;
}

export type TableCommand =
  | { readonly type: "cursor"; readonly index: number }
  | { readonly type: "toggle"; readonly id: string }
  | { readonly type: "extend"; readonly index: number }
  | { readonly type: "selectAll"; readonly ids: readonly string[]; readonly scope: "filter" | "page" }
  | { readonly type: "clearSelection" }
  | { readonly type: "blur" }
  | { readonly type: "open"; readonly id: string }
  | { readonly type: "edit"; readonly id: string }
  | { readonly type: "remove"; readonly ids: readonly string[]; readonly mode: "single" | "bulk" }
  | { readonly type: "undo" }
  | { readonly type: "redo" }
  | { readonly type: "focusFilter" }
  | { readonly type: "help" };

export type TableDispatch =
  | { readonly kind: "pass" }
  | { readonly kind: "command"; readonly command: TableCommand; readonly announce?: string }
  | { readonly kind: "refuse"; readonly verb: TableVerb; readonly reason: string };

export type TableVerb = "select" | "edit" | "remove" | "undo" | "redo";

/** Every refusal string the model can produce, so copy changes happen in one place. */
export const TABLE_REFUSALS = Object.freeze({
  systemRow: "System row — not selectable",
  headingRow: "Heading row — not selectable",
  noRow: "No row is selected",
  editSystem: "System data is recalculated, not edited",
  editMany: "Edit one row at a time",
  nothingToUndo: "Nothing to undo",
  nothingToRedo: "Nothing to redo",
});

/** Destructive verbs: the guard exists for these. */
export const DESTRUCTIVE_COMMANDS: ReadonlySet<TableCommand["type"]> = new Set(["edit", "remove", "undo", "redo"]);

const PASS: TableDispatch = { kind: "pass" };
const NON_TEXT_INPUTS = new Set(["checkbox", "radio", "button", "submit", "reset", "range", "color", "file", "image"]);
const PALETTE = "[cmdk-root], [data-command-palette]";

/**
 * The text-input guard. True when the event target is somewhere the owner types: a text
 * field, a select, an editable region or the command palette. Checked on the target at
 * keydown, so a field inside a table row is guarded too.
 */
export function isTextEntryTarget(target: KeyTarget | null | undefined): boolean {
  if (!target) return false;
  if (target.isContentEditable) return true;
  const tag = (target.tagName ?? "").toUpperCase();
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag === "INPUT") return !NON_TEXT_INPUTS.has((target.type ?? "text").toLowerCase());
  return Boolean(target.closest?.(PALETTE));
}

/** Controls that own their own Space / Enter activation. */
export const ROW_CONTROL_SELECTOR =
  'button, a[href], input, select, textarea, summary, [role="button"], [role="link"], [role="checkbox"], [role="menuitem"], [role="switch"], [contenteditable="true"]';

/** Keys a focused control inside a row activates itself; the table must not take them. */
export const CONTROL_ACTIVATION_KEYS: ReadonlySet<string> = new Set([" ", "Spacebar", "Enter"]);

/**
 * True when the keydown came from an interactive control inside the table (a row's
 * button, link or input), i.e. the target, or an ancestor below the table, is one.
 * `grid` is the element the handler is on; the table itself never counts (Batch 5).
 */
export function isRowControlTarget(target: KeyTarget | null | undefined, grid: unknown): boolean {
  if (!target || target === grid) return false;
  const control = target.closest?.(ROW_CONTROL_SELECTOR);
  return !!control && control !== grid;
}

const reconciledReason = (rows: readonly TableRow[]) =>
  rows.length === 1
    ? `Reconciled to ${rows[0].reconciledThrough} — unreconcile first`
    : `Reconciled — unreconcile first: ${rows.map((row) => `${row.label} (to ${row.reconciledThrough})`).join(", ")}`;

const named = (rows: readonly TableRow[]) => rows.map((row) => row.label).join(", ");

/** The rows a verb acts on: the selection when one exists, otherwise the cursor row. */
export function verbTargets(state: TableKeyState): readonly TableRow[] {
  if (state.selected.length > 0) {
    const ids = new Set(state.selected);
    return state.rows.filter((row) => ids.has(row.id));
  }
  const row = state.cursor == null ? undefined : state.rows[state.cursor];
  return row && !row.heading ? [row] : [];
}

const selectable = (row: TableRow | undefined) => !!row && !row.heading && row.mutationClass !== "C";

function editVerb(state: TableKeyState): TableDispatch {
  const targets = verbTargets(state);
  if (targets.length === 0) return { kind: "refuse", verb: "edit", reason: TABLE_REFUSALS.noRow };
  if (targets.length > 1) return { kind: "refuse", verb: "edit", reason: TABLE_REFUSALS.editMany };
  const [row] = targets;
  if (row.mutationClass === "C") return { kind: "refuse", verb: "edit", reason: TABLE_REFUSALS.editSystem };
  if (row.reconciledThrough) return { kind: "refuse", verb: "edit", reason: reconciledReason([row]) };
  return { kind: "command", command: { type: "edit", id: row.id } };
}

function removeVerb(state: TableKeyState): TableDispatch {
  const targets = verbTargets(state);
  if (targets.length === 0) return { kind: "refuse", verb: "remove", reason: TABLE_REFUSALS.noRow };
  const system = targets.filter((row) => row.mutationClass === "C");
  if (system.length > 0) {
    return { kind: "refuse", verb: "remove", reason: `System data is recalculated, not removed: ${named(system)}` };
  }
  // D1: a protected row in scope refuses the whole verb, naming the rows. Nothing is removed.
  const reconciled = targets.filter((row) => row.reconciledThrough);
  if (reconciled.length > 0) return { kind: "refuse", verb: "remove", reason: reconciledReason(reconciled) };
  return {
    kind: "command",
    command: { type: "remove", ids: targets.map((row) => row.id), mode: targets.length === 1 ? "single" : "bulk" },
  };
}

function historyVerb(verb: "undo" | "redo", availability: VerbAvailability): TableDispatch {
  if (availability.available) return { kind: "command", command: { type: verb } };
  const fallback = verb === "undo" ? TABLE_REFUSALS.nothingToUndo : TABLE_REFUSALS.nothingToRedo;
  return { kind: "refuse", verb, reason: availability.reason.trim() || fallback };
}

/**
 * Decide what a key does to a table. `inTextField` is `isTextEntryTarget(event.target)`;
 * passing it separately keeps the model free of the event object.
 */
export function dispatchTableKey(input: KeyInput, inTextField: boolean, state: TableKeyState): TableDispatch {
  // The guard comes first: a field owns every key, Ctrl+Z / Ctrl+A included (§6.1).
  if (inTextField || input.isComposing) return PASS;
  // Alt is never a binding: Indian-language input methods claim it.
  if (input.altKey) return PASS;

  const mod = !!(input.ctrlKey || input.metaKey);
  const shift = !!input.shiftKey;
  const key = input.key;
  const letter = key.length === 1 ? key.toLowerCase() : "";
  const last = state.rows.length - 1;

  if (mod) {
    if (letter === "a" && !shift) return selectAll(state);
    if (letter === "z" && !shift) return historyVerb("undo", state.undo);
    if ((letter === "y" && !shift) || (letter === "z" && shift)) return historyVerb("redo", state.redo);
    return PASS; // Ctrl+K and everything else belongs to the shell or the browser.
  }

  switch (key) {
    case "ArrowDown":
    case "ArrowUp": {
      if (last < 0) return PASS;
      const from = state.cursor ?? (key === "ArrowDown" ? -1 : last + 1);
      const index = Math.max(0, Math.min(last, from + (key === "ArrowDown" ? 1 : -1)));
      // At the edge the cursor stays: handled (the page must not scroll), but silent.
      return { kind: "command", command: shift ? { type: "extend", index } : { type: "cursor", index } };
    }
    case "Home":
    case "End":
      if (last < 0 || shift) return PASS;
      return { kind: "command", command: { type: "cursor", index: key === "Home" ? 0 : last } };
    case " ":
    case "Spacebar": {
      if (shift) return PASS;
      const row = state.cursor == null ? undefined : state.rows[state.cursor];
      if (!row) return { kind: "refuse", verb: "select", reason: TABLE_REFUSALS.noRow };
      if (row.heading) return { kind: "refuse", verb: "select", reason: TABLE_REFUSALS.headingRow };
      if (row.mutationClass === "C") return { kind: "refuse", verb: "select", reason: TABLE_REFUSALS.systemRow };
      return { kind: "command", command: { type: "toggle", id: row.id } };
    }
    case "Escape":
      return { kind: "command", command: state.selected.length > 0 ? { type: "clearSelection" } : { type: "blur" } };
    case "Enter": {
      if (shift) return PASS;
      const row = state.cursor == null ? undefined : state.rows[state.cursor];
      // No detail view: nothing happens and nothing is announced (§6.1).
      return row && row.hasDetail && !row.heading ? { kind: "command", command: { type: "open", id: row.id } } : PASS;
    }
    case "Delete":
      if (shift) return PASS;
      return removeVerb(state);
    case "/":
      return state.hasFilterField ? { kind: "command", command: { type: "focusFilter" } } : PASS;
    case "?":
      return { kind: "command", command: { type: "help" } };
  }
  if (letter === "e" && !shift) return editVerb(state);
  return PASS;
}

function selectAll(state: TableKeyState): TableDispatch {
  const ids = state.rows.filter(selectable).map((row) => row.id);
  if (state.filtered) {
    const count = state.scopeCount ?? ids.length;
    return {
      kind: "command",
      command: { type: "selectAll", ids, scope: "filter" },
      announce: `Selected all ${count.toLocaleString("en-IN")} in this filter`,
    };
  }
  return {
    kind: "command",
    command: { type: "selectAll", ids, scope: "page" },
    announce: `Selected ${ids.length.toLocaleString("en-IN")} on this page — filter to select more`,
  };
}

/** The part of the state the hook owns. */
export interface TableCursorState {
  readonly cursor: number | null;
  readonly selected: readonly string[];
  readonly anchor: number | null;
}

/**
 * Apply a command to the cursor/selection state. Commands that act outside the table
 * (edit, remove, undo, redo, open, focusFilter, help, blur) leave it unchanged; the hook
 * forwards them to the caller.
 */
export function applyTableCommand(rows: readonly TableRow[], state: TableCursorState, command: TableCommand): TableCursorState {
  switch (command.type) {
    case "cursor":
      return { ...state, cursor: command.index, anchor: command.index };
    case "toggle": {
      const has = state.selected.includes(command.id);
      return { ...state, selected: has ? state.selected.filter((id) => id !== command.id) : [...state.selected, command.id], anchor: state.cursor };
    }
    case "extend": {
      const anchor = state.anchor ?? state.cursor ?? command.index;
      const [lo, hi] = anchor <= command.index ? [anchor, command.index] : [command.index, anchor];
      const range = rows.slice(lo, hi + 1).filter(selectable).map((row) => row.id);
      const selected = [...state.selected.filter((id) => !range.includes(id)), ...range];
      return { cursor: command.index, anchor, selected };
    }
    case "selectAll":
      return { ...state, selected: [...command.ids] };
    case "clearSelection":
      return { ...state, selected: [], anchor: state.cursor };
    default:
      return state;
  }
}

import { readFileSync } from "node:fs";
import { createElement as h } from "react";
import { renderToStaticMarkup as render } from "react-dom/server.browser";
import {
  DESTRUCTIVE_COMMANDS,
  TABLE_REFUSALS,
  applyTableCommand,
  dispatchTableKey,
  isTextEntryTarget,
  type KeyInput,
  type TableDispatch,
  type TableKeyState,
  type TableRow,
} from "../components/ui/table-keyboard";
import { useTableKeyboard } from "../components/ui/use-table-keyboard";
import { check, checkDeep, checkTrue, done, section } from "./harness";

const rows: TableRow[] = [
  { id: "h1", label: "October", mutationClass: "A", heading: true },
  { id: "a1", label: "12 Oct · Swiggy", mutationClass: "A", hasDetail: true },
  { id: "a2", label: "14 Oct · Rent", mutationClass: "A", reconciledThrough: "30 Sep" },
  { id: "c1", label: "Interest accrual", mutationClass: "C" },
  { id: "b1", label: "Category: Food", mutationClass: "B" },
];
const base: TableKeyState = {
  rows, cursor: 1, selected: [], anchor: 1, filtered: true, scopeCount: 1240,
  undo: { available: true }, redo: { available: true }, hasFilterField: true,
};
const at = (cursor: number | null, extra: Partial<TableKeyState> = {}): TableKeyState => ({ ...base, cursor, ...extra });
const key = (k: string, mods: Omit<KeyInput, "key"> = {}): KeyInput => ({ key: k, ...mods });
const run = (k: KeyInput, state: TableKeyState = base, field = false) => dispatchTableKey(k, field, state);
const cmd = (d: TableDispatch) => (d.kind === "command" ? d.command : null);
const reason = (d: TableDispatch) => (d.kind === "refuse" ? d.reason : `(${d.kind})`);

section("text-input guard — targets");
const el = (tagName: string, extra: Record<string, unknown> = {}) => ({ tagName, closest: () => null, ...extra });
checkTrue("text input is guarded", isTextEntryTarget(el("INPUT", { type: "text" })));
checkTrue("input with no type is guarded", isTextEntryTarget(el("INPUT")));
for (const type of ["search", "number", "date", "email", "password"]) checkTrue(`${type} input is guarded`, isTextEntryTarget(el("INPUT", { type })));
checkTrue("textarea is guarded", isTextEntryTarget(el("TEXTAREA")));
checkTrue("select is guarded", isTextEntryTarget(el("SELECT")));
checkTrue("contenteditable is guarded", isTextEntryTarget(el("DIV", { isContentEditable: true })));
checkTrue("inside the command palette is guarded", isTextEntryTarget(el("DIV", { closest: (s: string) => (s.includes("cmdk-root") ? {} : null) })));
for (const type of ["checkbox", "radio", "button", "submit"]) check(`${type} input is not a text field`, isTextEntryTarget(el("INPUT", { type })), false);
check("the grid itself is not a text field", isTextEntryTarget(el("DIV")), false);
check("no target is not a text field", isTextEntryTarget(null), false);

section("text-input guard — no binding reaches a table from a field");
const everyKey: KeyInput[] = [];
for (const k of ["ArrowUp", "ArrowDown", "Home", "End", " ", "Escape", "Enter", "Delete", "/", "?", "e", "E", "a", "z", "Z", "y", "k"]) {
  for (const ctrlKey of [false, true]) for (const shiftKey of [false, true]) everyKey.push(key(k, { ctrlKey, shiftKey }));
}
const states = [at(null), at(1), at(2), at(3), at(1, { selected: ["a1", "b1"] }), at(1, { filtered: false }), at(null, { rows: [] })];
let leaks = 0;
for (const state of states) for (const input of everyKey) if (run(input, state, true).kind !== "pass") leaks += 1;
check("every key × modifier × state passes through from a field", leaks, 0);
let destructiveOutsideField = 0;
for (const state of states) for (const input of everyKey) {
  const c = cmd(run(input, state, true));
  if (c && DESTRUCTIVE_COMMANDS.has(c.type)) destructiveOutsideField += 1;
}
check("no destructive verb from a field, by enumeration", destructiveOutsideField, 0);
check("IME composition passes", run(key("Delete", { isComposing: true })).kind, "pass");
check("Alt never binds (Indian-language IMEs)", run(key("e", { altKey: true })).kind, "pass");
check("Alt+Delete never binds", run(key("Delete", { altKey: true })).kind, "pass");

section("Up / Down / Home / End — the cursor");
checkDeep("Down moves one row", cmd(run(key("ArrowDown"))), { type: "cursor", index: 2 });
checkDeep("Up moves one row", cmd(run(key("ArrowUp"))), { type: "cursor", index: 0 });
checkDeep("Down at the last row stays (no wrap)", cmd(run(key("ArrowDown"), at(4))), { type: "cursor", index: 4 });
checkDeep("Up at the first row stays (no wrap)", cmd(run(key("ArrowUp"), at(0))), { type: "cursor", index: 0 });
check("edge is silent: no announcement", (run(key("ArrowDown"), at(4)) as { announce?: string }).announce, undefined);
checkDeep("Down with no cursor lands on the first row", cmd(run(key("ArrowDown"), at(null))), { type: "cursor", index: 0 });
checkDeep("Up with no cursor lands on the last row", cmd(run(key("ArrowUp"), at(null))), { type: "cursor", index: 4 });
checkDeep("Home", cmd(run(key("Home"))), { type: "cursor", index: 0 });
checkDeep("End", cmd(run(key("End"))), { type: "cursor", index: 4 });
check("arrows on an empty table pass", run(key("ArrowDown"), at(null, { rows: [] })).kind, "pass");
checkDeep("Shift+Down extends", cmd(run(key("ArrowDown", { shiftKey: true }))), { type: "extend", index: 2 });

section("Space — selection");
checkDeep("Space toggles the cursor row", cmd(run(key(" "))), { type: "toggle", id: "a1" });
check("Space on a class C row is refused", reason(run(key(" "), at(3))), TABLE_REFUSALS.systemRow);
check("Space on a heading is refused", reason(run(key(" "), at(0))), TABLE_REFUSALS.headingRow);
check("Space with no cursor is refused", reason(run(key(" "), at(null))), TABLE_REFUSALS.noRow);

section("Ctrl+A — select all in scope (§7 item 6)");
const filteredAll = run(key("a", { ctrlKey: true }));
checkDeep("filtered: selects every selectable loaded row", cmd(filteredAll), { type: "selectAll", ids: ["a1", "a2", "b1"], scope: "filter" });
check("filtered: announces the filter count", (filteredAll as { announce?: string }).announce, "Selected all 1,240 in this filter");
const pageAll = run(key("a", { ctrlKey: true }), at(1, { filtered: false }));
check("unfiltered: page scope only", (cmd(pageAll) as { scope: string }).scope, "page");
check("unfiltered: announces the page and how to get more", (pageAll as { announce?: string }).announce, "Selected 3 on this page — filter to select more");
check("Meta+A behaves as Ctrl+A", (cmd(run(key("a", { metaKey: true }))) as { type: string }).type, "selectAll");

section("Esc, Enter, /, ?");
checkDeep("Esc clears a selection", cmd(run(key("Escape"), at(1, { selected: ["a1"] }))), { type: "clearSelection" });
checkDeep("Esc with nothing selected blurs", cmd(run(key("Escape"))), { type: "blur" });
checkDeep("Enter opens the detail", cmd(run(key("Enter"))), { type: "open", id: "a1" });
check("Enter with no detail does nothing, unannounced", run(key("Enter"), at(4)).kind, "pass");
checkDeep("/ focuses the filter", cmd(run(key("/"))), { type: "focusFilter" });
check("/ with no filter field does nothing", run(key("/"), at(1, { hasFilterField: false })).kind, "pass");
checkDeep("? opens the help sheet", cmd(run(key("?", { shiftKey: true }))), { type: "help" });
check("Ctrl+K is left to the shell (palette)", run(key("k", { ctrlKey: true })).kind, "pass");

section("E — edit");
checkDeep("E edits the cursor row", cmd(run(key("e"))), { type: "edit", id: "a1" });
checkDeep("caps-lock E edits too", cmd(run(key("E"))), { type: "edit", id: "a1" });
check("Shift+E is not a binding", run(key("E", { shiftKey: true })).kind, "pass");
check("class C refused", reason(run(key("e"), at(3))), TABLE_REFUSALS.editSystem);
check("reconciled refused, naming the date", reason(run(key("e"), at(2))), "Reconciled to 30 Sep — unreconcile first");
check("several selected refused", reason(run(key("e"), at(1, { selected: ["a1", "b1"] }))), TABLE_REFUSALS.editMany);
checkDeep("one selected edits the selection, not the cursor", cmd(run(key("e"), at(4, { selected: ["a1"] }))), { type: "edit", id: "a1" });
check("E on a heading with nothing selected is refused", reason(run(key("e"), at(0))), TABLE_REFUSALS.noRow);

section("Del — remove");
checkDeep("one row: single remove (undo toast)", cmd(run(key("Delete"))), { type: "remove", ids: ["a1"], mode: "single" });
checkDeep("several: bulk (§7.1 dialog)", cmd(run(key("Delete"), at(1, { selected: ["a1", "b1"] }))), { type: "remove", ids: ["a1", "b1"], mode: "bulk" });
check("class C in selection refused, naming it", reason(run(key("Delete"), at(1, { selected: ["a1", "c1"] }))), "System data is recalculated, not removed: Interest accrual");
check("reconciled in selection refused, naming it (D1)", reason(run(key("Delete"), at(1, { selected: ["a1", "a2"] }))), "Reconciled to 30 Sep — unreconcile first");
const twoReconciled = [...rows, { id: "a3", label: "2 Sep · EMI", mutationClass: "A" as const, reconciledThrough: "31 Aug" }];
check("several reconciled are all named", reason(run(key("Delete"), at(1, { rows: twoReconciled, selected: ["a2", "a3", "a1"] }))),
  "Reconciled — unreconcile first: 14 Oct · Rent (to 30 Sep), 2 Sep · EMI (to 31 Aug)");
check("nothing to remove is refused, not silent", reason(run(key("Delete"), at(null))), TABLE_REFUSALS.noRow);
check("Backspace is not Del", run(key("Backspace")).kind, "pass");

section("Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z — undo and redo");
checkDeep("Ctrl+Z undoes", cmd(run(key("z", { ctrlKey: true }))), { type: "undo" });
checkDeep("Ctrl+Y redoes", cmd(run(key("y", { ctrlKey: true }))), { type: "redo" });
checkDeep("Ctrl+Shift+Z redoes", cmd(run(key("Z", { ctrlKey: true, shiftKey: true }))), { type: "redo" });
checkDeep("Meta+Z undoes", cmd(run(key("z", { metaKey: true }))), { type: "undo" });
const invalidated = "A newer change touches the transactions that were undone, so redo is no longer available.";
check("redo refusal carries the server's reason verbatim", reason(run(key("y", { ctrlKey: true }), at(1, { redo: { available: false, reason: invalidated } }))), invalidated);
check("undo refusal carries the §9e reason", reason(run(key("z", { ctrlKey: true }), at(1, { undo: { available: false, reason: "Closed on 27 Nov" } }))), "Closed on 27 Nov");
check("blank undo reason falls back", reason(run(key("z", { ctrlKey: true }), at(1, { undo: { available: false, reason: " " } }))), TABLE_REFUSALS.nothingToUndo);
check("blank redo reason falls back", reason(run(key("y", { ctrlKey: true }), at(1, { redo: { available: false, reason: "" } }))), TABLE_REFUSALS.nothingToRedo);
check("refusal names the verb", (run(key("y", { ctrlKey: true }), at(1, { redo: { available: false, reason: "x" } })) as { verb: string }).verb, "redo");

section("applyTableCommand — the hook's reducer");
const s0 = { cursor: 1, selected: [] as string[], anchor: 1 };
checkDeep("cursor moves and re-anchors", applyTableCommand(rows, s0, { type: "cursor", index: 3 }), { cursor: 3, selected: [], anchor: 3 });
checkDeep("toggle adds", applyTableCommand(rows, s0, { type: "toggle", id: "a1" }).selected, ["a1"]);
checkDeep("toggle removes", applyTableCommand(rows, { ...s0, selected: ["a1"] }, { type: "toggle", id: "a1" }).selected, []);
checkDeep("extend selects selectable rows passed over", applyTableCommand(rows, s0, { type: "extend", index: 4 }), { cursor: 4, anchor: 1, selected: ["a1", "a2", "b1"] });
checkDeep("extend never selects a heading or class C", applyTableCommand(rows, { cursor: 0, selected: [], anchor: 0 }, { type: "extend", index: 3 }).selected, ["a1", "a2"]);
checkDeep("selectAll replaces", applyTableCommand(rows, { ...s0, selected: ["x"] }, { type: "selectAll", ids: ["a1"], scope: "page" }).selected, ["a1"]);
checkDeep("clearSelection empties", applyTableCommand(rows, { ...s0, selected: ["a1"] }, { type: "clearSelection" }).selected, []);
const untouched = { ...s0, selected: ["a1"] };
for (const command of [{ type: "edit", id: "a1" }, { type: "remove", ids: ["a1"], mode: "single" }, { type: "undo" }, { type: "redo" }] as const) {
  checkTrue(`${command.type} leaves cursor state to the caller`, applyTableCommand(rows, untouched, command) === untouched);
}

section("useTableKeyboard — grid markup");
function Grid() {
  const kb = useTableKeyboard({ idPrefix: "t", rows, filtered: false, undo: { available: true }, redo: { available: false, reason: "Nothing to redo" }, selected: ["a1"] });
  return h("div", kb.gridProps, ...rows.map((row, i) => h("div", { key: row.id, ...kb.rowProps(row, i) }, row.label)), h("p", kb.liveRegionProps));
}
const markup = render(h(Grid));
checkTrue("table is one tab stop", markup.includes('role="grid"') && markup.includes('tabindex="0"'));
checkTrue("grid is multi-selectable", markup.includes('aria-multiselectable="true"'));
checkTrue("no active descendant before entry", !markup.includes("aria-activedescendant"));
checkTrue("rows carry ids for aria-activedescendant", markup.includes('id="t-row-a1"'));
checkTrue("selected row is aria-selected", markup.includes('id="t-row-a1" role="row" aria-selected="true"'));
checkTrue("unselected row is aria-selected=false", markup.includes('id="t-row-b1" role="row" aria-selected="false"'));
checkTrue("heading and class C rows are not selectable", !/id="t-row-(h1|c1)"[^>]*aria-selected/.test(markup));
checkTrue("one polite live region", (markup.match(/aria-live="polite"/g) ?? []).length === 1);

section("useTableKeyboard — wiring");
const hook = readFileSync("components/ui/use-table-keyboard.ts", "utf8");
checkTrue("hook is a client module", hook.startsWith('"use client"'));
checkTrue("guard is read from the event target", hook.includes("isTextEntryTarget(event.target"));
checkTrue("unhandled keys are left to the browser", /if \(result\.kind === "pass"\) return;\s*event\.preventDefault\(\);/.test(hook));
checkTrue("refusals are announced and toasted", /setAnnouncement\(result\.reason\);\s*o\.onRefuse\?\.\(result\.verb, result\.reason\)/.test(hook));
checkTrue("IME composition is read", hook.includes("nativeEvent.isComposing"));
done();

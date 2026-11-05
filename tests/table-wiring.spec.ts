/**
 * Task 2.8.b wiring: the DESIGN §6.1 keyboard model applied to the two real tables,
 * the transactions register and the Activity list. The routing of every destructive key
 * is a pure function and is tested here against the model; the components are checked by
 * render (Activity) and source scan (both) — no new mutation path, no `title=`.
 */
import { readFileSync } from "node:fs";
import { createElement as h } from "react";
import { renderToStaticMarkup as render } from "react-dom/server.browser";
import {
  CONTROL_ACTIVATION_KEYS, TABLE_REFUSALS, dispatchTableKey, isRowControlTarget, isTextEntryTarget, type KeyInput, type TableKeyState,
} from "../components/ui/table-keyboard";
import {
  RECONCILED_THROUGH, REGISTER_REDO, REGISTER_REFUSALS, registerTableRows, registerUndo, removeRoute,
} from "../app/(root)/transactions/register-keyboard";
import { ACTIVITY_KEY_REFUSALS, activityTableRows, dayRowId, redoTarget, undoTarget } from "../app/(root)/activity/activity-keyboard";
import type { ActivityDayView, ActivityRowView } from "../app/(root)/activity/activity-model";
import { ActivityScreen } from "../app/(root)/activity/activity-view";
import { check, checkDeep, checkTrue, done, section } from "./harness";

// Made-up rows only.
const register = registerTableRows([
  { id: "r1", date: "2026-03-02", description: "Grocer", href: "/accounts/a1", reconciled: false },
  { id: "r2", date: "2026-03-04", description: "Rent", href: "/accounts/a1", reconciled: true },
  { id: "r3", date: "2026-03-09", description: "Cafe", href: null, reconciled: false },
]);
const state = (extra: Partial<TableKeyState> = {}): TableKeyState => ({
  rows: register, cursor: 0, selected: [], anchor: 0, filtered: true, scopeCount: 3,
  undo: registerUndo(null), redo: REGISTER_REDO, hasFilterField: true, ...extra,
});
const key = (k: string, mods: Omit<KeyInput, "key"> = {}): KeyInput => ({ key: k, ...mods });

section("register rows for the model");
checkDeep("rows are class A, reconciled rows carry the honest 'through'", register.map((r) => [r.id, r.mutationClass, r.reconciledThrough ?? null, r.hasDetail]), [
  ["r1", "A", null, true],
  ["r2", "A", RECONCILED_THROUGH, true],
  ["r3", "A", null, false],
]);
check("label names the row by date and narration", register[0].label, "2026-03-02 · Grocer");

section("text-input guard: no destructive verb from a field");
for (const target of [
  { tagName: "INPUT", type: "search" },
  { tagName: "INPUT", type: "date" },
  { tagName: "TEXTAREA" },
  { tagName: "SELECT" },
  { tagName: "DIV", isContentEditable: true },
]) {
  const inField = isTextEntryTarget(target);
  checkTrue(`${target.tagName}${"type" in target ? `[${target.type}]` : ""} is a field`, inField);
  for (const k of [key("Delete"), key("e"), key("z", { ctrlKey: true }), key("y", { ctrlKey: true })]) {
    check(`  ${k.ctrlKey ? "Ctrl+" : ""}${k.key} passes through`, dispatchTableKey(k, inField, state({ undo: { available: true } })).kind, "pass");
  }
}
check("a selection checkbox is not a field", isTextEntryTarget({ tagName: "INPUT", type: "checkbox" }), false);

section("register: E and Del refuse illegal rows exactly as §6.1");
checkDeep("E on a reconciled row", dispatchTableKey(key("e"), false, state({ cursor: 1 })), {
  kind: "refuse", verb: "edit", reason: "Reconciled to its statement — unreconcile first",
});
checkDeep("Del on a reconciled row names it (D1)", dispatchTableKey(key("Delete"), false, state({ selected: ["r1", "r2"] })), {
  kind: "refuse", verb: "remove", reason: "Reconciled to its statement — unreconcile first",
});
checkDeep("Del with no row", dispatchTableKey(key("Delete"), false, state({ rows: [], cursor: null })), {
  kind: "refuse", verb: "remove", reason: TABLE_REFUSALS.noRow,
});
check("E on a clean row reaches the screen, which has no edit flow", dispatchTableKey(key("e"), false, state()).kind, "command");
check("…and the screen's refusal points at the account", REGISTER_REFUSALS.editOnAccount, "Edit from the row's account: Enter opens it");

section("register: Del routes only to the §7.1 dialog");
checkDeep("every visible row selected opens the dialog", removeRoute({ ids: ["r1", "r3"], selectedCount: 2, visibleCount: 2, pageFilterActive: false }), { kind: "dialog" });
checkDeep("Batch 5: the cursor row with no selection opens the one-row dialog", removeRoute({ ids: ["r1"], selectedCount: 0, visibleCount: 3, pageFilterActive: false }), {
  kind: "single", id: "r1",
});
checkDeep("Batch 5: the one-row route ignores the page-local filter (scope is one id)", removeRoute({ ids: ["r3"], selectedCount: 0, visibleCount: 1, pageFilterActive: true }), {
  kind: "single", id: "r3",
});
checkDeep("Batch 5: Del on a clean cursor row reaches the screen as a single removal", dispatchTableKey(key("Delete"), false, state()), {
  kind: "command", command: { type: "remove", ids: ["r1"], mode: "single" },
});
checkDeep("Batch 5: Del on a reconciled cursor row is still refused by the model", dispatchTableKey(key("Delete"), false, state({ cursor: 1 })).kind, "refuse");
checkDeep("a partial selection is refused", removeRoute({ ids: ["r1"], selectedCount: 1, visibleCount: 3, pageFilterActive: false }), {
  kind: "refuse", reason: REGISTER_REFUSALS.removeByFilter,
});
checkDeep("the page-local filter hiding rows is refused", removeRoute({ ids: ["r1"], selectedCount: 1, visibleCount: 1, pageFilterActive: true }), {
  kind: "refuse", reason: REGISTER_REFUSALS.clearPageFilter,
});
check("Ctrl+A on a filtered register selects the filter scope", dispatchTableKey(key("a", { ctrlKey: true }), false, state()).kind, "command");

section("Batch 5: row controls keep Space / Enter");
const gridEl = { tagName: "TABLE" };
const inRow = (tagName: string, matches: boolean) => ({ tagName, closest: () => (matches ? { tagName } : null) });
checkTrue("a button inside a row is a row control", isRowControlTarget(inRow("BUTTON", true), gridEl));
checkTrue("a link inside a row is a row control", isRowControlTarget(inRow("A", true), gridEl));
checkTrue("a span inside a button is a row control (ancestor)", isRowControlTarget({ tagName: "SPAN", closest: () => ({ tagName: "BUTTON" }) }, gridEl));
check("the grid itself is not", isRowControlTarget(gridEl, gridEl), false);
check("a plain cell is not", isRowControlTarget(inRow("TD", false), gridEl), false);
check("closest resolving to the grid is not", isRowControlTarget({ tagName: "TD", closest: () => gridEl }, gridEl), false);
check("no target is not", isRowControlTarget(null, gridEl), false);
checkDeep("activation keys are Space and Enter only", [...CONTROL_ACTIVATION_KEYS].sort(), [" ", "Enter", "Spacebar"]);

section("register: Ctrl+Z / Ctrl+Y");
checkDeep("no banner: Ctrl+Z refuses 'Nothing to undo'", dispatchTableKey(key("z", { ctrlKey: true }), false, state()), {
  kind: "refuse", verb: "undo", reason: TABLE_REFUSALS.nothingToUndo,
});
checkDeep("banner present: Ctrl+Z is the banner's undo", dispatchTableKey(key("z", { ctrlKey: true }), false, state({ undo: registerUndo({ requestId: "q1" }) })), {
  kind: "command", command: { type: "undo" },
});
checkDeep("Ctrl+Y: no redo path on this screen", dispatchTableKey(key("y", { ctrlKey: true }), false, state()), {
  kind: "refuse", verb: "redo", reason: TABLE_REFUSALS.nothingToRedo,
});

section("activity: rows, undo and redo targets");
const verb = (available: boolean, reason = "") => (available ? { available: true as const } : { available: false as const, reason });
const row = (requestId: string, classLabel: "Ledger" | "Reference", undo: ReturnType<typeof verb>, redo: ReturnType<typeof verb>): ActivityRowView => ({
  requestId, time: "10:00", what: `Change ${requestId}`, who: "You", classLabel, records: "1 record", undo, redo,
});
const REDO_REASON = "Ledger changes redo one step only.";
const days: ActivityDayView[] = [
  { heading: "Today", rows: [row("p1", "Reference", verb(false, "Reference changes cannot be undone here yet."), verb(false, REDO_REASON)), row("t1", "Ledger", verb(true), verb(false, REDO_REASON))] },
  { heading: "Yesterday", rows: [row("t0", "Ledger", verb(true), verb(true))] },
];
const activityRows = activityTableRows(days);
checkDeep("day headings become heading rows in order", activityRows.map((r) => [r.id, !!r.heading, r.mutationClass]), [
  [dayRowId("Today"), true, "A"], ["p1", false, "B"], ["t1", false, "A"], [dayRowId("Yesterday"), true, "A"], ["t0", false, "A"],
]);
checkDeep("Ctrl+Z targets the newest undoable row", undoTarget(days), { availability: { available: true }, requestId: "t1" });
checkDeep("Ctrl+Y targets the one redoable row (D3)", redoTarget(days, null), { availability: { available: true }, requestId: "t0" });
const blocked: ActivityDayView[] = [{ heading: "Today", rows: [row("t9", "Ledger", verb(false, "That change is more than 30 days old."), verb(false, REDO_REASON))] }];
checkDeep("no undoable row: the newest row's reason, verbatim", dispatchTableKey(key("z", { ctrlKey: true }), false, {
  rows: activityTableRows(blocked), cursor: null, selected: [], filtered: false, undo: undoTarget(blocked).availability, redo: redoTarget(blocked, null).availability, hasFilterField: false,
}), { kind: "refuse", verb: "undo", reason: "That change is more than 30 days old." });
checkDeep("redo invalidated: the INVALIDATED notice wins", redoTarget(blocked, "A later change touched these records.").availability, {
  available: false, reason: "A later change touched these records.",
});
checkDeep("no redo, no notice: the row's REDO_CURSOR text", redoTarget(blocked, null).availability, { available: false, reason: REDO_REASON });
checkDeep("Space on a day heading is refused", dispatchTableKey(key(" "), false, {
  rows: activityRows, cursor: 0, selected: [], filtered: false, undo: verb(true), redo: verb(true), hasFilterField: false,
}), { kind: "refuse", verb: "select", reason: TABLE_REFUSALS.headingRow });
checkTrue("E and Del refusals name what to do instead", ACTIVITY_KEY_REFUSALS.remove.includes("Ctrl+Z") && ACTIVITY_KEY_REFUSALS.edit.length > 0);

section("activity: one grid, rendered");
const html = render(h(ActivityScreen, {
  view: { days, total: 3, windowNote: "Changes from the last 30 days.", redoNotice: null },
  actions: (id: string) => h("span", { "data-verb": id }, "verbs"),
}));
check("exactly one grid", (html.match(/role="grid"/g) ?? []).length, 1);
checkTrue("the grid is the one tab stop", /<table[^>]*role="grid"[^>]*tabindex="0"|<table[^>]*tabindex="0"[^>]*role="grid"/.test(html));
checkTrue("columns per §9e", ["Time", "What happened", "Class", "Records", "Undo / Redo"].every((c) => html.includes(`>${c}</th>`)));
checkTrue("day headings are rows of the grid", html.includes(`id="activity-row-${dayRowId("Today")}" role="row"`));
checkTrue("request rows are selectable rows", html.includes('id="activity-row-t1" role="row" aria-selected="false"'));
checkTrue("heading rows carry no aria-selected", !new RegExp(`id="activity-row-${dayRowId("Today")}"[^>]*aria-selected`).test(html));
checkTrue("every row keeps its verbs", ["p1", "t1", "t0"].every((id) => html.includes(`data-verb="${id}"`)));
checkTrue("a polite live region for refusals", html.includes('aria-live="polite"'));

section("source: no new mutation path, no title=, KPIs explained by InfoButton");
const src = (path: string) => readFileSync(path, "utf8");
const registerSrc = src("app/(root)/transactions/register-table.tsx");
const bulkSrc = src("app/(root)/transactions/bulk-remove.tsx");
const gridSrc = src("app/(root)/activity/activity-grid.tsx");
const rowSrc = src("app/(root)/activity/row-actions.tsx");
const pageSrc = src("app/(root)/transactions/page.tsx");
checkTrue("register uses the shared hook", registerSrc.includes("useTableKeyboard("));
checkTrue("register imports no server action itself", !/from "\.\/actions"/.test(registerSrc));
const singleSrc = src("app/(root)/transactions/single-remove.tsx");
const actionsSrc = src("app/(root)/transactions/actions.ts");
checkTrue("register Del on one row opens the one-row dialog", registerSrc.includes('route.kind === "single"') && registerSrc.includes("<SingleRemove"));
checkDeep("one-row dialog imports only the per-row action", /import \{([^}]*)\} from "\.\/actions"/.exec(singleSrc)?.[1].split(",").map((s) => s.trim()).filter(Boolean),
  ["removeTransactionAction", "type BulkRemovalState"]);
checkTrue("one-row dialog reuses ConfirmRemoval and the banner", singleSrc.includes("<ConfirmRemoval") && singleSrc.includes("writeBanner(next)"));
checkTrue("per-row and bulk actions share one removal path", (actionsSrc.match(/return removeResolvedScope\(/g) ?? []).length === 2 && (actionsSrc.match(/new RemoveTransactions\(/g) ?? []).length === 1);
checkTrue("the hook leaves row-control Space/Enter alone", src("components/ui/use-table-keyboard.ts").includes("isRowControlTarget(event.target"));
checkTrue("register Del opens the existing dialog", registerSrc.includes('route.kind === "dialog") setDialogOpen(true)'));
checkTrue("register Ctrl+Z is the banner's undo", registerSrc.includes("undo(banner.requestId)"));
checkDeep("bulk bar imports only the two existing actions", /import \{([^}]*)\} from "\.\/actions"/.exec(bulkSrc)?.[1].split(",").map((s) => s.trim()).filter(Boolean),
  ["removeMatchingTransactionsAction", "undoBulkRemovalAction", "type BulkRemovalState"]);
checkTrue("activity grid uses the shared hook and imports no action", gridSrc.includes("useTableKeyboard(") && !gridSrc.includes("./actions"));
checkDeep("row verbs import only the two existing actions", /import \{([^}]*)\} from "\.\/actions"/.exec(rowSrc)?.[1].split(",").map((s) => s.trim()), ["redoActivityAction", "undoActivityAction"]);
checkTrue("keyboard undo opens the inline confirmation, never a direct undo", rowSrc.includes("showConfirm = undo.available && (confirming || keyed)"));
checkTrue("activity drops its own Space/Enter workaround (the hook owns it)", !gridSrc.includes('event.target !== event.currentTarget'));
for (const [name, text] of [["register-table", registerSrc], ["single-remove", singleSrc], ["bulk-remove", bulkSrc], ["activity-grid", gridSrc], ["row-actions", rowSrc], ["page", pageSrc]] as const) {
  checkTrue(`${name}: no title= on a DOM element`, !/<[a-z][\w-]*\s[^>]*\btitle=/.test(text));
}
const kpis = pageSrc.match(/<Kpi [^>]*?\/>/gs) ?? [];
check("register has four KPIs", kpis.length, 4);
checkTrue("every register KPI carries an info explanation", kpis.every((k) => /\binfo="[^"]{20,}"/.test(k)));

done();

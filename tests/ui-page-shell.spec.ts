import { createElement as h, Fragment, type ReactNode } from "react";
import { renderToStaticMarkup as render } from "react-dom/server.browser";
import { readFileSync } from "node:fs";
import { Page, Section, Panel, Columns, Masthead, MastFigure, KpiStrip, Kpi, ChartPanel, type ChartPanelState } from "../components/ui/page-shell";
import { compact, percentage, rupee, signed, unknown } from "../src/core/format";
import { Money } from "../src/core/money";
import { Percentage } from "../src/core/numeric";
import { Table, TableBody, TableRow, TableCell } from "../components/ui/table";
import { Button } from "../components/ui/button";
import { check, checkTrue, done, section, throws } from "./harness";

section("server page composition preserves semantic content");
const body = render(h(Page, null, h(Section, { heading: "Holdings", actions: h("a", { href: "/investments/new" }, "Add holding") }), h(Panel, { title: "Current holdings", description: "All posted positions", children: "No hidden client dependency" })));
check("one h2 for each named section", (body.match(/<h2/g) ?? []).length, 2);
checkTrue("section action remains a real link", body.includes('href="/investments/new"'));
checkTrue("panel description and body are preserved", body.includes("All posted positions") && body.includes("No hidden client dependency"));
checkTrue("plain heading text is escaped", render(h(Section, { heading: "<script>" })).includes("&lt;script&gt;"));
const table = h(Table, { "aria-label": "Positions" }, h(TableBody, null, h(TableRow, null, h(TableCell, null, "Stock"))));
const flush = render(h(Panel, { title: "Positions", flush: true, children: table }));
checkTrue("flush panel retains semantic table", flush.includes('<table data-slot="table"') && flush.includes('aria-label="Positions"'));
checkTrue("table is not nested in another table", (flush.match(/<table\b/g) ?? []).length === 1);
// @ts-expect-error Invalid native body must also be rejected by the runtime guard.
throws("flush refuses arbitrary body masquerading as table", () => render(h(Panel, { title: "Wrong", flush: true, children: h("div", null, "Wrong") })), "library Table");
const columns = render(h(Columns, { children: [h("div", { key: "a" }, "First"), h("div", { key: "b" }, "Second")] }));
checkTrue("two-column content retains reading order", columns.indexOf("First") < columns.indexOf("Second"));

section("composition inherits the binding After source");
const css = readFileSync("components/ui/page-shell.module.css", "utf8");
for (const token of ["gap:var(--gap-screen)", "padding-top:var(--gap-screen)", "border-radius:var(--r-4)", "padding:var(--pad-panel)", "padding:var(--pad-panel-h)", "max-width:74ch", "background:var(--border-subtle)", "grid-template-columns:1fr 1fr", "gap:32px", "max-width:760px"]) checkTrue(token, css.includes(token));
checkTrue("server-safe source", !readFileSync("components/ui/page-shell.tsx", "utf8").includes('"use client"'));
section("hero and KPI figures keep their meaning and semantic structure");
const figure = rupee(Money.fromRupees("1234.50"));
const masthead = render(h(Masthead, { title: "Net worth", hero: figure, side: h("a", { href: "/accounts" }, "View accounts") }));
check("masthead owns one page heading", (masthead.match(/<h1\b/g) ?? []).length, 1);
checkTrue("hero preserves the exact formatter text content", masthead.replace(/<[^>]*>/g, "").includes(figure));
checkTrue("masthead retains its side navigation", masthead.includes('href="/accounts"'));
const unavailable = render(h(Masthead, { title: "Net worth", hero: unknown("A closing quote is missing") }));
checkTrue("unknown hero renders its actual reason", unavailable.includes("A closing quote is missing"));
checkTrue("unknown hero is an inline figure, never a table cell or zero", unavailable.includes("—") && !unavailable.includes("<td") && !unavailable.includes("₹0"));
const strip = render(h(KpiStrip, null, h(Kpi, { label: "Available cash", value: figure, detail: "Posted today" }), h(Kpi, { label: "Debt ratio", value: unknown("Income has not been measured") })));
checkTrue("KPI strip associates labels and values in a definition list", strip.includes("<dl") && (strip.match(/<dt\b/g) ?? []).length === 2 && (strip.match(/<dd\b/g) ?? []).length === 3);
checkTrue("unknown KPI remains keyboard reachable with explanation", strip.includes('tabindex="0"') && strip.includes("Income has not been measured") && strip.includes("aria-describedby="));
checkTrue("KPI unknown does not introduce invalid table markup", !strip.includes("<td"));
const twoUnknowns = render(h(KpiStrip, null, h(Kpi, { label: "First", value: unknown("First missing observation") }), h(Kpi, { label: "Second", value: unknown("Second missing observation") })));
const describedBy = [...twoUnknowns.matchAll(/aria-describedby="([^"]+)"/g)].map((match) => match[1]);
checkTrue("independent unknown figures have independent reason IDs", describedBy.length === 2 && describedBy[0] !== describedBy[1]);

section("hero, KPI and mast side figures share exact styled figure parts");
for (const value of [rupee(Money.fromRupees("0")), rupee(Money.fromRupees("-1234.50")), signed(Money.fromRupees("42.50")), compact(Money.fromRupees("123456")), compact(Money.fromRupees("10000000")), percentage(Percentage.of("-12.5"))]) {
  for (const output of [render(h(Masthead, { title: "Value", hero: value })), render(h(Kpi, { label: "Value", value })), render(h(MastFigure, { label: "Value", value }))]) {
    checkTrue(`${value} keeps exactly the formatter text`, output.replace(/<[^>]*>/g, "").includes(value));
    if (value.includes("₹")) checkTrue(`${value} currency is a separate inline span`, /<span[^>]*>₹<\/span>/.test(output));
    if (value.endsWith("L")) checkTrue("lakh unit is a separate inline span", /<span[^>]*>L<\/span>/.test(output));
    if (value.endsWith("Cr")) checkTrue("crore unit is a separate inline span", /<span[^>]*>Cr<\/span>/.test(output));
    if (value.endsWith("%")) checkTrue("percentage unit is a separate inline span", /<span[^>]*>%<\/span>/.test(output));
  }
}
const side = render(h(Masthead, { title: "Cash", side: h(MastFigure, { label: "Available today", value: figure }) }));
checkTrue("mast side figure retains its label and formatted value", side.includes("Available today") && side.replace(/<[^>]*>/g, "").includes(figure));
const unknownSide = render(h(MastFigure, { label: "Debt", value: unknown("No debt schedule has been measured") }));
checkTrue("mast side unknown shares the accessible reason", unknownSide.includes("No debt schedule has been measured") && unknownSide.includes('aria-describedby="') && unknownSide.includes('tabindex="0"'));
checkTrue("mast side unknown is inline and never a zero", !unknownSide.includes("<td") && !unknownSide.includes("₹0"));
for (const token of ["font-size:.6em", "font-size:.56em", "letter-spacing:.04em", "margin-left:.1em", "gap:3px", "font-size:16px;line-height:22px;font-weight:var(--fw-kpi)"]) checkTrue(`figure scale ${token}`, css.includes(token));

section("charts expose every data state and a text alternative");
const summary = "The series compares posted net worth over the last year.";
const visual = h("svg", { "aria-hidden": true, id: "chart-data" }, h("path", { d: "M0 1L2 3" }));
const states: readonly ChartPanelState[] = [
  { kind: "ready", children: visual },
  { kind: "loading" },
  { kind: "empty", reason: "No statements have been posted", action: h("a", { href: "/imports" }, "Import a statement") },
  { kind: "error", reason: "The stored series could not be read", recovery: h("a", { href: "/dashboard" }, "Retry the page") },
  { kind: "unknown", value: unknown("No quote exists at the start date") },
  { kind: "refused", reason: "The observation window is too short" },
  { kind: "stale", reason: "The last available quote is over a week old", children: visual },
];
for (const state of states) {
  const chart = render(h(ChartPanel, { title: "Net worth history", summary, state }));
  checkTrue(`${state.kind} keeps a semantic figure and its text alternative`, chart.includes("<figure") && chart.includes("<figcaption") && chart.includes(summary));
  checkTrue(`${state.kind} is explicitly distinguishable`, chart.includes(`data-state="${state.kind}"`));
  check(`${state.kind} only draws observations when usable`, chart.includes('id="chart-data"'), state.kind === "ready" || state.kind === "stale");
  if ("reason" in state) checkTrue(`${state.kind} names its cause`, chart.includes(state.reason));
  if (state.kind === "empty") checkTrue("empty offers a native path to add observations", chart.includes('href="/imports"'));
  if (state.kind === "error") checkTrue("error offers a native recovery path", chart.includes('href="/dashboard"'));
  if (state.kind === "loading") checkTrue("loading exposes busy and status semantics", chart.includes('aria-busy="true"') && chart.includes('role="status"') && !chart.includes('data-slot="spinner"'));
  if (state.kind === "stale") checkTrue("stale warns while preserving current observations", chart.includes('data-tone="warning"'));
}
throws("a chart cannot omit its meaningful summary", () => render(h(ChartPanel, { title: "Wrong", summary: " ", state: { kind: "loading" } })), "specific chart summary");
throws("refusal cannot omit the cause", () => render(h(ChartPanel, { title: "Wrong", summary, state: { kind: "refused", reason: " " } })), "specific reason");
throws("empty cannot omit the path to add data", () => render(h(ChartPanel, { title: "Wrong", summary, state: { kind: "empty", reason: "No data", action: null } })), "action");
throws("error cannot omit recovery", () => render(h(ChartPanel, { title: "Wrong", summary, state: { kind: "error", reason: "Read failed", recovery: null } })), "recovery");
const absentRecoveries: readonly ReactNode[] = [false, true, "", " \n\t", [], [null, false, " "], h(Fragment, null), h(Fragment, null, h(Fragment, null, false, " ", []))];
for (const [index, absent] of absentRecoveries.entries()) {
  throws(`empty rejects nonrendering action ${index}`, () => render(h(ChartPanel, { title: "Wrong", summary, state: { kind: "empty", reason: "No observations", action: absent } })), "action");
  throws(`error rejects nonrendering recovery ${index}`, () => render(h(ChartPanel, { title: "Wrong", summary, state: { kind: "error", reason: "Read failed", recovery: absent } })), "recovery");
}
function* absentRecovery() { yield false; yield null; yield ""; }
for (const [index, recovery] of [new Set<React.ReactNode>(), new Set<React.ReactNode>([false, null, ""]), absentRecovery()].entries()) {
  throws(`empty refuses unsupported iterable recovery ${index}`, () => render(h(ChartPanel, { title: "Series", summary, state: { kind: "empty", reason: "No observations", action: recovery } })), "action");
  throws(`error refuses unsupported iterable recovery ${index}`, () => render(h(ChartPanel, { title: "Series", summary, state: { kind: "error", reason: "Read failed", recovery } })), "recovery");
}
for (const [index, recovery] of [h("a", { href: "/imports" }, "Add observations"), h(Button, { type: "button" }, "Retry"), h(Fragment, null, false, [h("a", { href: "/imports", key: "retry" }, "Retry import")])].entries()) {
  const empty = render(h(ChartPanel, { title: "Series", summary, state: { kind: "empty", reason: "No observations", action: recovery } }));
  const failed = render(h(ChartPanel, { title: "Series", summary, state: { kind: "error", reason: "Read failed", recovery } }));
  checkTrue(`empty retains valid recovery ${index}`, /<(?:a|button)\b/.test(empty));
  checkTrue(`error retains valid recovery ${index}`, /<(?:a|button)\b/.test(failed));
}
for (const token of ["border:var(--hero-bd)", "font-size:var(--fs-hero)", "grid-template-columns:var(--kpi-cols)", "border-top:var(--kpi-rule)", "border:var(--kpi-bd)", "padding:var(--kpi-pad)"]) checkTrue(token, css.includes(token));

section("figure glyph typography follows the context-specific source contract");
for (const rule of [
  ".currency,.unit{color:var(--fg-muted);font-weight:400}",
  ".hero .currency{font-size:.46em;margin-right:.1em;letter-spacing:0}",
  ".hero .unit{font-size:.40em;letter-spacing:.06em;margin-left:.12em}",
  ".kpiValue .currency{font-size:.6em}",
  ".kpiValue .unit{font-size:.56em;letter-spacing:.04em;margin-left:.1em}",
]) checkTrue(rule, css.includes(rule));
checkTrue("side figures inherit glyph size without a global size override", !/(?:^|\})\s*\.(?:currency|unit)\{[^}]*font-size/.test(css));

if (false) {
  // @ts-expect-error Arbitrary strings cannot masquerade as formatted hero figures.
  h(Masthead, { title: "Wrong", hero: "₹123" });
  // @ts-expect-error KPI values must come from a formatter or unknown(reason).
  h(Kpi, { label: "Wrong", value: 123 });
  // @ts-expect-error Mast side figures have the same formatter-only value contract.
  h(MastFigure, { label: "Wrong", value: "₹123" });
  // @ts-expect-error A chart cannot be constructed without its text alternative.
  h(ChartPanel, { title: "Wrong", state: { kind: "loading" } });
}

done();

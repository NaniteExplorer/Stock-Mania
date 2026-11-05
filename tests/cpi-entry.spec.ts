/**
 * Owner CPI entry screen (/settings/cpi, net-worth-age-chart.md § "CPI series"):
 * pure model, rendered states, form accessibility, action wiring, nav and the
 * link from the chart's refusal. Made-up index figures.
 */
import { createElement as h } from "react";
import { renderToStaticMarkup as render } from "react-dom/server.browser";
import { existsSync, readFileSync } from "node:fs";
import { cpiPoint } from "@/domain/cpi-series";
import { NAV_ITEMS } from "@/ui/nav";
import { baseFor, buildCpiRows, cpiMonthLabel, editValues } from "../app/(root)/settings/cpi/cpi-model";
import { CpiView } from "../app/(root)/settings/cpi/cpi-view";
import CpiForm from "../app/(root)/settings/cpi/cpi-form";
import { check, checkDeep, checkTrue, done, section } from "./harness";

const p = (month: string, index: string) => cpiPoint({ month, base: month < "2026-01" ? "2012" : "2024", index, source: "Test fixture" });
const points = [p("2025-11", "111.25"), p("2026-02", "101.5"), p("2025-12", "112")];
const noop = async () => ({ ok: true, message: "" });

section("model");
check("month label", cpiMonthLabel("2026-02"), "Feb 2026");
check("base before the break", baseFor("2025-12"), "2012");
check("base from the break", baseFor("2026-01"), "2024");
check("no base for a malformed month", baseFor("2026-13"), null);
checkDeep("rows newest first", buildCpiRows(points).map((r) => r.month), ["2026-02", "2025-12", "2025-11"]);
check("index formatted exactly", buildCpiRows(points)[2]!.index, "111.25");
checkDeep("edit prefill", editValues(points, "2025-12"), { month: "2025-12", index: "112", source: "Test fixture" });
check("edit of an unknown month is ignored", editValues(points, "2020-01"), null);

section("view states");
const form = h(CpiForm, { action: noop, initial: null });
const empty = render(h(CpiView, { state: { kind: "empty" }, form, remove: () => null, editing: null }));
checkTrue("empty state explains why it matters", empty.includes("No CPI recorded yet"));
checkTrue("empty state still offers the form", empty.includes('id="cpi-entry"'));
const ready = render(h(CpiView, { state: { kind: "ready", rows: buildCpiRows(points) }, form, remove: (r: { month: string }) => h("span", { "data-remove": r.month }), editing: null }));
checkTrue("ready lists every month", ["Feb 2026", "Dec 2025", "Nov 2025"].every((m) => ready.includes(m)));
checkTrue("each row has an edit link", ready.includes('href="/settings/cpi?edit=2025-12#cpi-entry"'));
checkTrue("each row has a remove control", ready.includes('data-remove="2025-11"'));
const editing = render(h(CpiView, { state: { kind: "ready", rows: buildCpiRows(points) }, form, remove: () => null, editing: "2025-12" }));
checkTrue("editing offers a cancel link", editing.includes("Cancel editing"));
checkTrue("loading.tsx exists", existsSync("app/(root)/settings/cpi/loading.tsx"));
checkTrue("error.tsx offers Retry", readFileSync("app/(root)/settings/cpi/error.tsx", "utf8").includes("Retry"));

section("form");
const blank = render(form);
checkTrue("month, index and source are labelled inputs", ['for="month"', 'for="index"', 'for="source"'].every((s) => blank.includes(s)));
checkTrue("base is shown, derived not typed", blank.includes("Set from the month") && !blank.includes('name="base"'));
const prefilled = render(h(CpiForm, { action: noop, initial: { month: "2026-02", index: "101.5", source: "MoSPI" } }));
checkTrue("prefill shows the derived base", prefilled.includes("2024 = 100"));
checkTrue("prefill carries the index", prefilled.includes('value="101.5"'));
checkTrue("edit button reads Save changes", prefilled.includes("Save changes"));

section("actions and wiring");
const actions = readFileSync("app/(root)/settings/cpi/actions.ts", "utf8");
checkTrue("record goes through RecordCpiPoint", actions.includes("record.execute"));
checkTrue("remove goes through RemoveCpiPoint", actions.includes("remove.execute"));
checkTrue("base derived server-side from the month", actions.includes("base: expectedBase(month)"));
checkTrue("owner from the session, not the form", !actions.includes('formData.get("userId")'));
checkTrue("nav lists /settings/cpi", NAV_ITEMS.some((i) => i.href === "/settings/cpi"));
checkTrue("chart refusal links to the entry screen", readFileSync("app/(root)/dashboard/net-worth-age-view.tsx", "utf8").includes('href="/settings/cpi"'));

done();

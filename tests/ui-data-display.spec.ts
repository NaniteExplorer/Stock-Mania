import { createElement as h } from "react";
import { renderToStaticMarkup as render } from "react-dom/server.browser";
import { readFileSync } from "node:fs";
import { Table, TableHeader, TableBody, TableFooter, TableRow, TableHead, TableCaption } from "../components/ui/table";
import { FigureCell, UnknownCell, UnknownFigure, TextCell, BadgeCell, ActionCell } from "../components/ui/data-cell";
import { unknown } from "../src/core/format";
import { Money } from "../src/core/money";
import { Percentage } from "../src/core/numeric";
import { checkTrue, done, section, throws } from "./harness";

section("semantic composition and forwarded native attributes");
const markup = render(h(Table, { density:"compact", "aria-label":"Holdings" },
  h(TableCaption, null, "Current holdings"),
  h(TableHeader, null, h(TableRow, null, h(TableHead, { "aria-sort":"ascending" }, "Value"))),
  h(TableBody, null, h(TableRow, { id:"selected-row" },
    h(TextCell, { secondary:"Account A" }, "Holding"),
    h(FigureCell, { value:Money.fromRupees("-9007199254740993.01") }),
    h(UnknownCell, { reason:"No market quote for this date", reasonId:"quote-missing" }),
    h(BadgeCell, null, "Unpriced"), h(ActionCell, null, h("button", { type:"button" }, "Open")))),
  h(TableFooter, null, h(TableRow, null, h(FigureCell, { value:Money.zero(), colSpan:5 })))));
for (const [label, pattern] of [
  ["native table", '<table data-slot="table" data-density="compact"'],
  ["accessible table name", 'aria-label="Holdings"'], ["caption", '<caption'],
  ["native sections", '<thead'], ["body", '<tbody'], ["footer", '<tfoot'],
  ["column scope", 'scope="col"'], ["sort forwarded", 'aria-sort="ascending"'],
  ["exact huge debit", '−₹9,00,71,99,25,47,40,993.01'],
  ["unknown keyboard target", 'tabindex="0"'], ["unknown description link", 'aria-describedby="quote-missing"'],
  ["specific visible reason node", 'id="quote-missing"'], ["reason text", 'No market quote for this date'],
  ["zero remains a figure", '₹0.00'], ["native colspan", 'colSpan="5"'],
  ["composed action button", '<button type="button">Open</button>'],
] as const) checkTrue(label, markup.includes(pattern));

section("typed formatting and unavailable validation");
checkTrue("percentage", render(h(FigureCell, { kind:"percentage", value:Percentage.of("-1.235") })).includes("−1.24%"));
checkTrue("compact", render(h(FigureCell, { value:Money.fromRupees("4872999.99"), format:"compact" })).includes("₹48.72L"));
checkTrue("signed", render(h(FigureCell, { value:Money.fromRupees("1.01"), format:"signed" })).includes("+₹1.01"));
throws("unknown must explain why", () => render(h(UnknownCell, { reason:" ", reasonId:"x" })), "specific reason");
throws("unknown must have a description id", () => render(h(UnknownCell, { reason:"No quote", reasonId:" " })), "reasonId");

section("inline unknown shares the cell disclosure without table-only markup");
const inline = render(h(UnknownFigure, { value:unknown("No exchange rate for this date"), reasonId:"inline-rate", id:"hero-unknown" }));
checkTrue("inline unknown is span content", inline.startsWith("<span") && !/<t[dh]\b/.test(inline));
checkTrue("inline unknown contains an em dash rather than a fake zero", inline.includes("—") && !inline.includes("₹0"));
checkTrue("inline keyboard target links the specific reason", inline.includes('tabindex="0"') && inline.includes('aria-describedby="inline-rate"') && inline.includes('id="inline-rate"'));
checkTrue("inline unknown forwards native attributes", inline.includes('id="hero-unknown"'));
checkTrue("inline reason remains discoverable text", inline.includes("No exchange rate for this date"));
const generated = render(h("div", null, h(UnknownFigure, { value:unknown("First missing quote") }), h(UnknownFigure, { value:unknown("Second missing quote") })));
const generatedIds = [...generated.matchAll(/aria-describedby="([^"]+)"/g)].map((match) => match[1]);
checkTrue("generated description ids are unique", generatedIds.length === 2 && new Set(generatedIds).size === 2);
checkTrue("each generated id describes a real reason", generatedIds.every((id) => generated.includes(`id="${id}"`)));
const wrapped = render(h(UnknownCell, { reason:"No exchange rate for this date", reasonId:"inline-rate" }));
checkTrue("unknown cell uses the exact same inline disclosure", wrapped.includes(inline.replace(' id="hero-unknown"', "")));
throws("inline unknown refuses an empty supplied id", () => render(h(UnknownFigure, { value:unknown("No quote"), reasonId:" " })), "reasonId");
throws("inline structural unknown still requires a reason", () => render(h(UnknownFigure, { value:{ kind:"unknown", reason:" " } })), "specific reason");

section("both-theme CSS contracts and keyboard disclosure");
const css = readFileSync("components/ui/data-display.module.css", "utf8");
for (const [label, value] of [
  ["default row token", "height:var(--row-h)"], ["compact control scale", "--row-h:var(--h-md)"],
  ["exact mono figures", "font-family:var(--fig-face)"], ["tabular slashed zero", "font-variant-numeric:var(--fig-vn)"],
  ["right alignment", "text-align:right"], ["focus disclosure", ".unknownGroup:focus-within .reason"],
  ["hover disclosure", ".unknownGroup:hover .reason"], ["dotted absence", "text-decoration:underline dotted"],
  ["focus accent", "outline:2px solid var(--accent)"], ["motion preference", "prefers-reduced-motion:reduce"],
] as const) checkTrue(label, css.includes(value));
checkTrue("no raw palette colors", !/#[\da-f]{3,8}\b/i.test(css));
checkTrue("no title-only disclosure", !markup.includes("title="));
checkTrue("reason is escaped", render(h(UnknownCell, { reason:"<script>x</script>", reasonId:"escape" })).includes("&lt;script&gt;"));

section("badge geometry stays at the canonical passive badge size");
const canonical = readFileSync("_design/control-bench/index.html", "utf8");
const canonicalBadge = /\.bdg\{([^}]+)\}/.exec(canonical)?.[1] ?? "";
const badge = /\.badge\s*\{([^}]+)\}/.exec(css)?.[1] ?? "";
for (const property of ["height", "padding"] as const) {
  const declaration = new RegExp(`(?:^|;)\\s*${property}:([^;]+)`);
  const expected = declaration.exec(canonicalBadge)?.[1]?.trim();
  checkTrue(`canonical badge ${property} is defined`, expected != null);
  checkTrue(`badge ${property} matches canonical geometry`, declaration.exec(badge)?.[1]?.trim() === expected);
}
checkTrue("badge height includes its border instead of adding two pixels", badge.includes("box-sizing:border-box"));
done();

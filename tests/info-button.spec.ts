import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { createElement as h } from "react";
import { renderToStaticMarkup as render } from "react-dom/server.browser";
import { InfoButton } from "../components/ui/info-button";
import { Kpi, KpiStrip } from "../components/ui/page-shell";
import { rupee } from "../src/core/format";
import { Money } from "../src/core/money";
import { check, checkTrue, done, section, throws } from "./harness";

const explanation = "Cash and bank balances, minus anything due within 30 days";

section("D.6 — the explanation is a focusable button, not a title on an <i>");
const markup = render(h(InfoButton, { label: "Liquid", explanation }));
checkTrue("renders a native button", /<button type="button"/.test(markup));
checkTrue("button has an accessible name", markup.includes('aria-label="About Liquid"'));
checkTrue("button is a popover trigger (dialog)", markup.includes('aria-haspopup="dialog"'));
checkTrue("collapsed by default", markup.includes('aria-expanded="false"'));
checkTrue("Radix state hook present for styling", markup.includes('data-state="closed"'));
checkTrue("no title attribute anywhere", !/\stitle=/.test(markup));
checkTrue("no <i> element", !/<i[\s>]/.test(markup));
checkTrue("no tabindex hack; a native button is focusable", !markup.includes("tabindex"));
checkTrue("glyph is decorative", /<span[^>]*aria-hidden="true"[^>]*>i<\/span>/.test(markup));
const describedBy = /aria-describedby="([^"]+)"/.exec(markup)?.[1];
checkTrue("explanation is the button's description", !!describedBy && markup.includes(`id="${describedBy}"`));
checkTrue("description carries the explanation text", markup.includes(`>${explanation}</span>`));
throws("refuses a blank explanation", () => render(h(InfoButton, { label: "Liquid", explanation: " " })), "specific explanation");
throws("refuses a blank label", () => render(h(InfoButton, { label: "", explanation })), "label");
check("text is escaped", render(h(InfoButton, { label: "<b>", explanation: "<script>" })).includes("&lt;script&gt;"), true);

section("D.6 — keyboard reach and dismissal come from the Radix popover");
const source = readFileSync("components/ui/info-button.tsx", "utf8");
checkTrue("client module", source.startsWith('"use client"'));
checkTrue("uses the Radix popover (Esc dismisses, focus returns)", source.includes('import { Popover as Primitive } from "radix-ui"') && source.includes("<Primitive.Trigger asChild>"));
checkTrue("popover content is named", /<Primitive\.Content[^>]*aria-label=\{name\}/.test(source));
checkTrue("popover wears the library popover surface", source.includes("feedback.popover"));
checkTrue("content is portalled out of the KPI's overflow", source.includes("<Primitive.Portal>"));

section("D.6 — geometry: 24px hit target, 16px marker (§1.1, §1.1b)");
const css = readFileSync("components/ui/info-button.module.css", "utf8");
checkTrue("button height is --h-xs", /\.infoButton\s*\{[^}]*height: var\(--h-xs\)/.test(css));
checkTrue("button radius follows height (--r-2)", /\.infoButton\s*\{[^}]*border-radius: var\(--r-2\)/.test(css));
checkTrue("focus ring is 2px accent", /\.infoButton:focus-visible\s*\{[^}]*outline: 2px solid var\(--accent\)/.test(css));
checkTrue("glyph is the --mk-sm marker", /\.infoGlyph\s*\{[^}]*width: var\(--mk-sm\);[^}]*height: var\(--mk-sm\)/.test(css));
checkTrue("glyph never takes focus styling", !/\.infoGlyph[^{]*:focus/.test(css));
checkTrue("reduced motion collapses transitions", /prefers-reduced-motion: reduce[\s\S]*transition-duration: 1ms/.test(css));
checkTrue("no raw hex", !/#[\da-f]{3,8}\b/i.test(css));
// Both files together, so the module classes bind to their JSX roles (button vs marker).
const conformance = spawnSync("node", ["scripts/ui-conformance.mjs", "components/ui/info-button.tsx", "components/ui/info-button.module.css"], { encoding: "utf8" });
check("ui-conformance on the new files", `${conformance.status} ${conformance.stdout.trim()}`, "0 UI conformance: PASS (0 violation(s))");

section("D.6 — Kpi carries the explanation through the button");
const kpi = render(h(KpiStrip, null, h(Kpi, { label: "Liquid", value: rupee(Money.fromRupees("142560")), info: explanation })));
checkTrue("KPI label owns the button", /<dt[^>]*>Liquid<button type="button"[^>]*aria-label="About Liquid"/.test(kpi));
checkTrue("KPI has no title attribute", !/\stitle=/.test(kpi));
checkTrue("no info prop, no button", !render(h(Kpi, { label: "Liquid", value: rupee(Money.fromRupees("1")) })).includes("<button"));

section("D.6 — no KPI explanation left in a title on an <i> in shipped code");
const offenders: string[] = [];
const walk = (dir: string) => {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path);
    // info-button.tsx names the old pattern in its doc comment; its markup is asserted above.
    else if (/\.tsx$/.test(name) && name !== "info-button.tsx" && /<i\b[^>]*\stitle=|info-i/.test(readFileSync(path, "utf8"))) offenders.push(path);
  }
};
walk("app");
walk("components");
check("app/ and components/ have no info-i or <i title>", offenders.join(", ") || "none", "none");
done();

import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type * as ReactTypes from "react";
import { check, checkTrue, done, section } from "./harness";

// The suite's domain runner does not process CSS Modules. Bundle the real controls
// with a class-name-only loader, then use one Node React instance for hooks + SSR.
const require = createRequire(import.meta.url);
const { build } = require("esbuild") as typeof import("esbuild");
await build({ stdin: { contents: 'export * from "./components/ui/button"; export * from "./components/ui/input"; export * from "./components/ui/select"; export * from "./components/ui/segmented-control"; export * from "./components/ui/checkbox"; export * from "./components/ui/radio"; export * from "./components/ui/switch"; export * from "./components/ui/chip";', resolveDir: process.cwd(), loader: "tsx" },
  outfile: "tmp/ui-controls-fixture.cjs", bundle: true, platform: "node", format: "cjs", packages: "external", jsx: "automatic",
  plugins: [{ name: "css-modules-contract", setup(build) {
    build.onLoad({ filter: /\.module\.css$/ }, (args) => {
      const names = [...readFileSync(args.path, "utf8").matchAll(/\.([A-Za-z][\w-]*)/g)].map((match) => match[1]);
      return { loader: "js", contents: `export default ${JSON.stringify(Object.fromEntries(names.map((name) => [name, name])))}` };
    });
  } }], logLevel: "silent" });
const React = require("react") as typeof ReactTypes;
const { renderToStaticMarkup } = require("react-dom/server") as typeof import("react-dom/server");
const ui = require(resolve("tmp/ui-controls-fixture.cjs")) as typeof import("../components/ui/button") & typeof import("../components/ui/input") & typeof import("../components/ui/select") & typeof import("../components/ui/segmented-control") & typeof import("../components/ui/checkbox") & typeof import("../components/ui/radio") & typeof import("../components/ui/switch") & typeof import("../components/ui/chip");
const h = React.createElement;

section("button variants, sizes and native semantics");
for (const variant of ["default", "outline", "secondary", "ghost", "destructive", "link"] as const) {
  const markup = renderToStaticMarkup(h(ui.Button, { variant, type: "submit", name: "save", value: "yes" }, "Save"));
  checkTrue(`${variant} preserves native submit payload`, markup.includes('type="submit"') && markup.includes('name="save"') && markup.includes('value="yes"'));
  checkTrue(`${variant} stays a native button`, markup.startsWith("<button") && markup.includes('data-variant="' + variant + '"'));
}
for (const size of ["default", "xs", "sm", "lg", "icon", "icon-xs", "icon-sm", "icon-lg"] as const) {
  checkTrue(`${size} remains supported`, renderToStaticMarkup(h(ui.Button, { size }, "Run")).includes(`data-size="${size}"`));
}
const busy = renderToStaticMarkup(h(ui.Button, { loading: true }, "Save changes"));
checkTrue("loading is busy and natively disabled", busy.includes('aria-busy="true"') && busy.includes('disabled=""'));
checkTrue("loading retains the label for width", busy.includes("Save changes") && busy.includes('data-loading="true"'));
const busyId = /aria-labelledby="([^"]+)"/.exec(busy)?.[1];
checkTrue("loading accessible name references retained hidden label", !!busyId && busy.includes(`id="${busyId}"`));
const labeled = renderToStaticMarkup(h(ui.Button, { loading: true, "aria-label": "Save account" }, "Save"));
checkTrue("explicit accessible name survives", labeled.includes('aria-label="Save account"') && !labeled.includes("aria-labelledby"));
const slotted = renderToStaticMarkup(h(ui.Button, { asChild: true, disabled: true }, h("a", { href: "/accounts" }, "Accounts")));
checkTrue("asChild preserves the anchor", slotted.startsWith('<a href="/accounts"'));
checkTrue("disabled slotted anchor has no tab stop", slotted.includes('aria-disabled="true"') && slotted.includes('tabindex="-1"'));
checkTrue("disabled attribute is not put on a link", !slotted.includes(' disabled=""'));

section("input keeps native form and state contracts");
const readonly = renderToStaticMarkup(h(ui.Input, { id: "code", name: "code", defaultValue: "rule-2025", readOnly: true, "aria-describedby": "why" }));
checkTrue("readonly remains selectable form data", readonly.includes('readOnly=""') && !readonly.includes('disabled=""') && readonly.includes('name="code"'));
checkTrue("description remains associated", readonly.includes('aria-describedby="why"'));
const invalid = renderToStaticMarkup(h(ui.Input, { type: "number", required: true, min: "0", "aria-invalid": true, disabled: true }));
checkTrue("validation constraints remain native", invalid.includes('type="number"') && invalid.includes('required=""') && invalid.includes('min="0"'));
checkTrue("invalid and disabled remain distinct states", invalid.includes('aria-invalid="true"') && invalid.includes('disabled=""'));

section("select delegates keyboard and selection semantics to Radix");
const select = renderToStaticMarkup(h(ui.Select, { defaultValue: "bank" }, h(ui.SelectTrigger, { "aria-label": "Account", size: "sm" }, h(ui.SelectValue, { placeholder: "Choose" }))));
checkTrue("trigger is an accessible combobox", select.includes('role="combobox"') && select.includes('aria-label="Account"'));
checkTrue("trigger tracks collapsed state", select.includes('aria-expanded="false"'));
checkTrue("trigger uses the canonical icon grid", select.includes('viewBox="0 0 16 16"') && select.includes('stroke-width="1.3"'));
for (const key of ["Select", "SelectContent", "SelectGroup", "SelectItem", "SelectLabel", "SelectScrollDownButton", "SelectScrollUpButton", "SelectSeparator", "SelectTrigger", "SelectValue"] as const) {
  check(`public ${key} export retained`, typeof ui[key], "function");
}

section("segmented control uses native buttons and explicit pressed state");
const segments = renderToStaticMarkup(h(ui.SegmentedControl, { "aria-label": "Period", value: "month", onValueChange() {}, variant: "flush", options: [{ value: "month", label: "Monthly" }, { value: "year", label: "Yearly", disabled: true }] }));
checkTrue("group carries its accessible label", segments.includes('role="group"') && segments.includes('aria-label="Period"'));
checkTrue("selected segment is pressed", segments.includes('aria-pressed="true">Monthly'));
checkTrue("other segment is unpressed and disabled", segments.includes('disabled="" aria-pressed="false">Yearly'));
check("segments never submit forms", (segments.match(/type="button"/g) ?? []).length, 2);

section("marker controls keep their hit target and accessible name on the full row");
const mixed = renderToStaticMarkup(h(ui.Checkbox, { label: "All accounts", description: "Some accounts are selected", indeterminate: true, name: "accounts" }));
checkTrue("checkbox keeps native input and form name", mixed.includes('type="checkbox"') && mixed.includes('name="accounts"'));
checkTrue("mixed state is available on first render", mixed.includes('aria-checked="mixed"') && mixed.includes('data-indeterminate="true"'));
const mixedLabelId = /aria-labelledby="([^"]+)"/.exec(mixed)?.[1];
const mixedDescriptionId = /aria-describedby="([^"]+)"/.exec(mixed)?.[1];
checkTrue("checkbox names the label, not the marker", !!mixedLabelId && mixed.includes(`id="${mixedLabelId}">All accounts`));
checkTrue("checkbox description has its own association", !!mixedDescriptionId && mixed.includes(`id="${mixedDescriptionId}"`));
checkTrue("markers are hidden from assistive technology", mixed.includes('class="checkboxMarker" aria-hidden="true"'));
checkTrue("markers never take focus", !/<span[^>]*tabindex/.test(mixed));
const radio = renderToStaticMarkup(h(ui.Radio, { label: "Monthly", name: "schedule", value: "monthly", defaultChecked: true }));
checkTrue("radio grouping and checked state remain native", radio.includes('type="radio"') && radio.includes('name="schedule"') && radio.includes('checked=""') && radio.includes('value="monthly"'));
const toggle = renderToStaticMarkup(h(ui.Switch, { label: "Accounting parentheses", disabled: true, defaultChecked: true }));
checkTrue("switch uses native checkbox with switch role", toggle.includes('type="checkbox" role="switch"'));
checkTrue("switch preserves disabled and checked states", toggle.includes('disabled=""') && toggle.includes('checked=""'));
checkTrue("switch marker is decorative", toggle.includes('class="switchMarker" aria-hidden="true"'));
const chip = renderToStaticMarkup(h(ui.Chip, { onRemove() {}, children: "Gold" }));
checkTrue("whole chip is a named native dismiss button", chip.startsWith("<button") && chip.includes('aria-label="Remove Gold"') && chip.includes('type="button"'));
check("chip has one focus target, no nested dismiss control", (chip.match(/<button/g) ?? []).length, 1);

section("CSS geometry, focus, motion and unavailable states");
const css = readFileSync("components/ui/controls.module.css", "utf8");
checkTrue("no raw hex colours or transition-all", !/#[\da-f]{3,8}\b|transition\s*:\s*all/i.test(css));
checkTrue("default button32 and forms36 use token heights", css.includes("--control-height:var(--h-md)") && css.includes("height:var(--h-lg)"));
checkTrue("mobile target40 is explicit", css.includes("min-height:var(--h-xl)"));
checkTrue("loading hides layout-retained children", css.includes('.button[data-loading="true"] > * { visibility:hidden; }'));
checkTrue("readonly uses dashed border and secondary ink", /\.input\[readonly\][^{]*\{[^}]*border-style:dashed[^}]*color:var\(--fg-secondary\)/.test(css));
checkTrue("focus offset for inputs is1px", css.includes("outline-offset:1px"));
checkTrue("selected flush segment removes both seams", css.includes('button[aria-pressed="true"] + button { box-shadow:none; }'));
checkTrue("reduced motion uses static dotted spinner", css.includes("prefers-reduced-motion:reduce") && css.includes("animation:none; border-top-color:currentColor; border-style:dotted"));
checkTrue("checkbox/radio marker uses its separate closed scale", css.includes("width:var(--mk-sm); height:var(--mk-sm)"));
checkTrue("row focus ring surrounds the hit target", css.includes(".choice:has(.choiceInput:focus-visible)"));
checkTrue("native input fills row instead of shrinking to marker", css.includes("inset:0; width:100%; height:100%"));
checkTrue("switch dimensions use decomposed marker tokens", css.includes("width:var(--mk-track-width); height:var(--mk-track-height)"));
checkTrue("chip corrects artifact22 to scale24", /\.chip \{[^}]*height:var\(--h-xs\)/.test(css));
checkTrue("select option radius follows its32px target", /\.selectItem \{[^}]*min-height:var\(--h-md\)[^}]*border-radius:var\(--r-2\)/.test(css));
done();

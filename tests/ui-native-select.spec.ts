import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import type * as ReactTypes from "react";
import { check, checkTrue, done } from "./harness";

const require = createRequire(import.meta.url);
const { build } = require("esbuild") as typeof import("esbuild");
await build({
  entryPoints: ["components/ui/native-select.tsx"], outfile: "tmp/ui-native-select-fixture.cjs",
  bundle: true, platform: "node", format: "cjs", packages: "external", jsx: "automatic",
  plugins: [{ name: "css-modules-contract", setup(build) {
    build.onLoad({ filter: /\.module\.css$/ }, () => ({ loader: "js", contents: 'export default { select: "select" };' }));
  } }], logLevel: "silent",
});
const React = require("react") as typeof ReactTypes;
const { renderToStaticMarkup } = require("react-dom/server") as typeof import("react-dom/server");
const { NativeSelect } = require("../tmp/ui-native-select-fixture.cjs") as {
  NativeSelect: (props: ReactTypes.ComponentProps<"select">) => ReactTypes.ReactElement<ReactTypes.ComponentProps<"select">>;
};
const h = React.createElement;
const options = [h("option", { key: "empty", value: "" }, "Choose"), h("option", { key: "inr", value: "INR" }, "Rupee"), h("option", { key: "usd", value: "USD" }, "Dollar")];

const form = renderToStaticMarkup(h("form", { id: "payment", action: "/save", method: "post" },
  h("label", { htmlFor: "currency" }, "Currency"),
  h(NativeSelect, { id: "currency", name: "currency", form: "payment", required: true, defaultValue: "USD", className: "custom" }, options)));
check("one native select participates in the form", (form.match(/<select\b/g) ?? []).length, 1);
checkTrue("native payload name and external form association survive", form.includes('name="currency"') && form.includes('form="payment"'));
checkTrue("required reaches browser constraint validation", form.includes('required=""'));
checkTrue("server output selects the default payload before hydration", /<option value="USD" selected="">Dollar<\/option>/.test(form));
checkTrue("label points to native control", form.includes('for="currency"') && form.includes('id="currency"'));
checkTrue("caller class composes with library styling", /class="[^"]*custom"/.test(form));
// 2026-11-05 owner decision: a custom dropdown replaces the OS popup; the native select stays as the form payload.
checkTrue("custom combobox trigger, no type=hidden substitute", /role="combobox"/.test(form) && !/type="hidden"/.test(form));

const multi = renderToStaticMarkup(h(NativeSelect, { multiple: true, size: 3, name: "currencies", defaultValue: ["INR", "USD"], "aria-label": "Currencies" }, options));
checkTrue("multiple and native size pass through", multi.includes('multiple=""') && multi.includes('size="3"'));
check("both default selections are present in server markup", (multi.match(/selected=""/g) ?? []).length, 2);
checkTrue("accessible name survives without a custom widget", multi.includes('aria-label="Currencies"'));

const unavailable = renderToStaticMarkup(h(NativeSelect, { disabled: true, name: "locked", "aria-label": "Locked currency", "aria-invalid": true, "aria-describedby": "currency-error" }, options));
checkTrue("disabled is native, not merely an ARIA imitation", unavailable.includes('disabled=""'));
checkTrue("invalid and explanatory relationship reach the native target", unavailable.includes('aria-invalid="true"') && unavailable.includes('aria-describedby="currency-error"'));

const ref = React.createRef<HTMLSelectElement>();
const onChange: ReactTypes.ChangeEventHandler<HTMLSelectElement> = () => {};
const element = NativeSelect({ ref, onChange, name: "client-compatible" });
checkTrue("React native ref is preserved for client consumers", element.props.ref === ref);
checkTrue("native event handler is preserved for client consumers", element.props.onChange === onChange);
const source = readFileSync("components/ui/native-select.tsx", "utf8");
checkTrue("server-safe source has no client directive or client dependency", !/["']use client["']|from ["'](?:radix-ui|.*hooks.*)["']/.test(source));
const css = readFileSync("components/ui/native-select.module.css", "utf8");
checkTrue("browser keeps its own native arrow", !/appearance\s*:|background-image\s*:/.test(css));
done();

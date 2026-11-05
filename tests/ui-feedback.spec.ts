import { readFileSync } from "node:fs";
import { createElement as h } from "react";
import { renderToStaticMarkup as render } from "react-dom/server.browser";
import { Banner } from "../components/ui/banner";
import { Skeleton } from "../components/ui/skeleton";
import { Spinner } from "../components/ui/spinner";
import { check, checkTrue, done, section } from "./harness";

section("loading is announced once and reduced motion stays visible");
for (const size of [14, 16, 20] as const) {
  const markup = render(h(Spinner, { size, label: "Saving changes" }));
  checkTrue(`spinner ${size} announces status`, markup.includes('role="status"') && markup.includes('aria-label="Saving changes"'));
  checkTrue(`spinner ${size} identifies busy state`, markup.includes('aria-busy="true"'));
  checkTrue(`spinner ${size} uses supported geometry`, markup.includes(`data-size="${size}"`));
}
const skeleton = render(h(Skeleton, { className: "account-name", id: "placeholder" }));
checkTrue("placeholder is decorative", skeleton.includes('aria-hidden="true"'));
checkTrue("placeholder preserves composition hooks", skeleton.includes('id="placeholder"') && skeleton.includes("account-name"));

section("persistent notices keep meaning and caller semantics");
for (const tone of ["info", "warning", "error", "success"] as const) {
  const markup = render(h(Banner, { tone, title: "Statement coverage", role: "status" }, "Import an earlier statement."));
  checkTrue(`${tone} conveys explicit copy`, markup.includes("Statement coverage") && markup.includes("Import an earlier statement."));
  checkTrue(`${tone} preserves explicit live status`, markup.includes('role="status"'));
  checkTrue(`${tone} tone does not replace text`, markup.includes(`data-tone="${tone}"`));
  checkTrue(`${tone} icon is decorative`, markup.includes('aria-hidden="true"'));
}
checkTrue("persistent notices do not announce on every mount by default",
  !render(h(Banner, { title: "Coverage" })).includes('role="'));
checkTrue("notice text is escaped", render(h(Banner, { title: "<script>" })).includes("&lt;script&gt;"));

section("motion and palette contracts");
const css = readFileSync("components/ui/feedback.module.css", "utf8");
checkTrue("no raw hex palette", !/#[a-f\d]{3,8}\b/i.test(css));
checkTrue("reduced motion has a static dotted spinner", /prefers-reduced-motion: reduce[\s\S]*\.spinner\s*\{[^}]*animation: none;[^}]*border-style: dotted/.test(css));
checkTrue("skeleton uses both canonical grounds", css.includes("var(--skel-a), var(--skel-b), var(--skel-a)"));
checkTrue("skeleton stops under reduced motion", /prefers-reduced-motion: reduce[\s\S]*\.skeleton\s*\{[^}]*background: var\(--skel-a\)/.test(css));
checkTrue("success remains distinct from money gain", css.includes(".toastSuccess { border-left-color: var(--accent)") && !css.includes("var(--gain)"));
checkTrue("menu separator is inset exactly nine pixels", /\.menuSeparator\s*\{[^}]*margin: 4px 9px/.test(css));
checkTrue("menu keyboard focus stays inside row", /\.menuItem\[data-highlighted\]\s*\{[^}]*outline-offset: -2px/.test(css));
checkTrue("checked menu markers do not push their label", /\.menuCheckIndicator\s*\{[^}]*position: absolute;[^}]*right: 9px/.test(css));
checkTrue("checked menu labels reserve marker space", css.includes(".menuItem:has(> .menuCheckIndicator) { padding-right: 32px; }"));
checkTrue("no opacity animation or generic transition", !/transition\s*:\s*(all|opacity)|transition-opacity/.test(css));
for (const component of ["dialog", "popover", "dropdown-menu", "tooltip"]) {
  const source = readFileSync(`components/ui/${component}.tsx`, "utf8");
  checkTrue(`${component} retains Radix interaction primitive`, source.includes("Primitive."));
  checkTrue(`${component} has no library icon or legacy fade animation`, !source.includes("lucide") && !source.includes("fade-in") && !source.includes("transition-opacity"));
}
const sonner = readFileSync("components/ui/sonner.tsx", "utf8");
checkTrue("toasts follow system theme", sonner.includes('theme="system"'));
check("no external icon library in feedback", sonner.includes("lucide"), false);
done();

import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { check, checkDeep, checkTrue, done, section } from "./harness";

type Source = { path: string; source: string };
type Diagnostic = { path: string; line: number; rule: string; message: string };
const { analyzeSources, checkPaths } = await import(pathToFileURL(resolve("scripts/ui-conformance.mjs")).href) as {
  analyzeSources: (files: Source[]) => Diagnostic[];
  checkPaths: (paths?: string[], cwd?: string) => Diagnostic[];
};
const css = (source: string): Source => ({ path: "fixture/ui.module.css", source });
const jsx = (source: string): Source => ({ path: "fixture/ui.tsx", source });
function rejects(label: string, files: Source[], rule: string) {
  const found = analyzeSources(files);
  checkTrue(label, found.some((item) => item.rule === rule));
  checkTrue(`${label} has actionable diagnostics`, found.every((item) => item.path.startsWith("fixture/") && item.line >= 1 && !!item.message));
}
function accepts(label: string, files: Source[]) { checkDeep(label, analyzeSources(files), []); }
const binding = 'import styles from "./ui.module.css";';

section("colour rules inspect syntax without reading comments or SVG coordinates as colours");
rejects("CSS raw colour", [css(".panel { color: #aabbcc; }")], "raw-hex");
rejects("JSX colour", [jsx('<svg fill="#fff" />')], "raw-hex");
rejects("inline style colour", [jsx('<div style={{ background: "#12345678" }} />')], "raw-hex");
rejects("style-object alias cannot hide raw hex", [jsx('const bad = { color:"#fff" }; <span style={bad} />')], "raw-hex");
rejects("utility raw colour", [jsx('<button className="bg-[#123]" />')], "raw-hex");
accepts("semantic colours, comments and SVG paths", [css("/* #fff */ .panel { color: var(--fg); }"), jsx('<svg><path d="M1-3 2-4" /></svg>')]);

section("native, Radix and module-bound hit targets obey height and radius ranks");
rejects("utility height composes with inline radius", [jsx('<button className="h-8" style={{borderRadius:"var(--r-3)"}} />')], "radius-height");
rejects("utility radius composes with inline height", [jsx('<button className="rounded-[4px]" style={{height:"var(--h-md)"}} />')], "radius-height");
rejects("module height composes with utility radius", [css(".control{height:var(--h-md)}"), jsx(`${binding}<button className={cn(styles.control,"rounded-[4px]")} />`)], "radius-height");
rejects("global tag height composes with utility radius", [css("button{height:var(--h-md)}"), jsx('<button className="rounded-[4px]" />')], "radius-height");
accepts("utility and inline geometry can form a conforming target", [jsx('<button className="h-8" style={{borderRadius:"var(--r-2)"}} />')]);
accepts("inline height overrides a utility without changing radius rank", [jsx('<button className="h-8" style={{height:"var(--h-lg)",borderRadius:"var(--r-3)"}} />')]);
rejects("max-height constrains the effective radius rank", [css("button{height:var(--h-lg);max-height:var(--h-md);border-radius:var(--r-3)}")], "radius-height");
rejects("inline radius composes with stylesheet target height", [css("button{height:var(--h-md)}"), jsx('<button style={{borderRadius:"var(--r-3)"}} />')], "radius-height");
rejects("inline radius composes with a single module class", [css(".control{height:var(--h-md)}"), jsx(`${binding}<button className={styles.control} style={{borderRadius:"var(--r-3)"}} />`)], "radius-height");
accepts("minimum height wins over a conflicting maximum as CSS requires", [css("button{height:var(--h-md);min-height:var(--h-lg);max-height:var(--h-md);border-radius:var(--r-3)}")]);
accepts("conforming inline geometry composes with the base stylesheet", [css("button{height:var(--h-md);border-radius:var(--r-2)}"), jsx('<button style={{height:"var(--h-lg)",borderRadius:"var(--r-3)"}} />')]);
rejects("off-scale native height", [css("button { height: 31px; }")], "control-height");
rejects("off-scale inline height", [jsx('<input style={{ height: 23 }} />')], "control-height");
rejects("style-object alias cannot hide target height", [jsx('const bad = { height:22 }; <button style={bad} />')], "control-height");
rejects("style-object spreads and constant chains are inspected", [jsx('const size = 22; const base={height:size}; const style={...base}; <button style={style} />')], "control-height");
rejects("root alias cannot hide target height", [css(":root{--bad:22px} button{height:var(--bad)}")], "control-height");
rejects("unresolved alias is not silently treated as conforming", [css("button{height:var(--unknown)}")], "control-height");
rejects("off-scale fallback is not silently treated as conforming", [css("button{height:var(--unknown,22px)}")], "control-height");
rejects("global CSS class binds ordinary JSX class", [{ path:"fixture/ui.css", source:".control {height:22px;}" }, jsx('import "./ui.css"; <button className="control" />')], "control-height");
rejects("arithmetic cannot create an exception", [css("button { height: calc(16px + 6px); }")], "control-height");
rejects("Tailwind off-scale target", [jsx('<button className="h-5 rounded-sm" />')], "control-height");
rejects("utility identifier cannot hide target height", [jsx('const classes = "h-5"; <button className={classes} />')], "control-height");
rejects("32px target has small-control radius", [css("button { height: var(--h-md); border-radius: var(--r-3); }")], "radius-height");
rejects("36px target has form-control radius", [css("input { height: var(--h-lg); border-radius: var(--r-2); }")], "radius-height");
rejects("CSS-module Radix item is a hit target", [jsx(`${binding}<Primitive.Item className={styles.option} />`), css(".option { min-height:var(--h-md); border-radius:var(--r-1); }")], "radius-height");
rejects("combined classes cannot separate height from invalid radius", [jsx(`${binding}<button className={cn(styles.target, styles.rounding)} />`), css(".target { height:var(--h-md); } .rounding { border-radius:var(--r-3); }")], "radius-height");
rejects("combined class cascade follows stylesheet order rather than JSX order", [jsx(`${binding}<button className={cn(styles.small, styles.large)} />`), css(".large {height:var(--h-lg);border-radius:var(--r-3)} .small {height:var(--h-md)}")], "radius-height");
rejects("combined class cascade respects selector specificity", [jsx(`${binding}<button className={cn(styles.large, styles.small)} />`), css("button.small {height:var(--h-md)} .large {height:var(--h-lg);border-radius:var(--r-3)}")], "radius-height");
rejects("important geometry outranks later and more-specific classes", [jsx(`${binding}<button className={cn(styles.small, styles.large)} />`), css(".small {height:var(--h-md)!important} button.large {height:var(--h-lg);border-radius:var(--r-3)}")], "radius-height");
accepts("important valid geometry does not falsely fail later override", [jsx(`${binding}<button className={cn(styles.large, styles.small)} />`), css(".large {height:var(--h-lg)!important;border-radius:var(--r-3)} .small {height:var(--h-md)}")]);
accepts("hashed module selector does not bind a plain global class", [css(".control {height:22px;}"), jsx('<button className="control" />')]);
rejects("module class through helper retains ownership", [jsx(`${binding}const base = styles.control; <button className={cn(base)} />`), css(".control { height:22px; }")], "control-height");
rejects("variant overrides retain height/radius pairing", [jsx(`${binding}<button className={styles.control} />`), css(".control { --height:var(--h-md); --radius:var(--r-2); height:var(--height); border-radius:var(--radius); } .control[data-size=lg] { --height:var(--h-lg); }")], "radius-height");
accepts("closed scale and state variant", [jsx(`${binding}<button className={styles.control} />`), css(".control { height:var(--h-md); border-radius:var(--r-2); } .control:hover { background:var(--bg-hover); } @media(pointer:coarse) { .control { min-height:var(--h-xl); border-radius:var(--r-3); } }")]);
accepts("decorative and structural dimensions are not target sizes", [css(".badge { height:20px; } .spinner { width:16px; height:16px; }"), jsx('<button className="h-8 rounded-[3px] [&_svg]:size-4"><svg /></button>')]);

section("markers cannot acquire interaction or accessible names");
rejects("marker tokens cannot size a button", [css("button { height:var(--mk-sm); }")], "marker-control-height");
rejects("control tokens cannot size a marker", [css(".mark { width:var(--mk-sm); height:var(--h-md); }")], "height-marker");
rejects("undeclared marker rank", [css(".mark { width:var(--mk-new); }")], "marker-scale");
rejects("third global marker rank", [css(":root { --mk-medium:20px; }")], "marker-scale");
rejects("existing marker value cannot be redefined", [css(":root { --mk-sm:20px; }")], "marker-scale");
accepts("closed marker definition values", [css(":root { --mk-sm:16px; --mk-track-width:32px; --mk-track-height:18px; }")]);
rejects("focusable marker", [jsx(`${binding}<span className={styles.mark} tabIndex={0} />`), css(".mark { width:var(--mk-sm); height:var(--mk-sm); }")], "focusable-marker");
rejects("marker cannot own an accessible name", [jsx(`${binding}<span className={styles.mark} aria-label="Selected" />`), css(".mark { width:var(--mk-sm); height:var(--mk-sm); }")], "focusable-marker");
rejects("inline marker cannot own a name", [jsx('<span aria-label="Selected" style={{height:"var(--mk-sm)"}} />')], "focusable-marker");
rejects("utility marker cannot own a name", [jsx('<span aria-label="Selected" className="size-[var(--mk-sm)]" />')], "focusable-marker");
rejects("utility marker cannot borrow a height token", [jsx('<span className="w-[var(--mk-sm)] h-[var(--h-md)]" />')], "height-marker");
accepts("decorative marker inside a full hit target", [jsx(`${binding}<button className={styles.control}><span className={styles.mark} aria-hidden="true" />Select</button>`), css(".control { height:var(--h-md); border-radius:var(--r-2); } .mark { height:var(--mk-sm); width:var(--mk-sm); }")]);

section("display minus differs from arithmetic and prose");
rejects("ASCII minus in a display figure", [jsx('<span>-1,23,456.00</span>')], "figure-minus");
rejects("ASCII currency minus", [jsx('<Figure value="-₹4,350.00" label="-Rs 4,350.00" />')], "figure-minus");
rejects("template minus expression", [jsx('const sign = "-"; <span>{`${sign}${amount}`}</span>')], "figure-minus");
rejects("unknown uses em dash", [jsx('<span>{"-"}</span>')], "figure-minus");
accepts("minus glyph, subtraction and hyphenated prose", [jsx('<><span>−₹4,350.00</span><span>—</span><span>{a - b}</span><span>Read-only</span><svg><path d="M1-3 2-4" /></svg></>')]);

section("motion checks transition properties and the actual keyframe declarations");
for (const property of ["opacity", "width", "height", "filter", "all"]) {
  rejects(`${property} is not an animated property`, [css(`.control { transition:${property} 100ms; }`)], "animated-property");
}
rejects("keyframe opacity is forbidden", [css("@keyframes pulse { to { opacity:.5; } }")], "animated-property");
rejects("forbidden motion utility", [jsx('<span className="animate-pulse" />')], "animated-property");
accepts("permitted state motion and spinner transform", [css(".control { transition:background-color var(--t-fast),border-color var(--t-fast),color var(--t-fast),box-shadow var(--t-fast),transform var(--t-fast); } @keyframes spin { to { transform:rotate(360deg); } }")]);

section("deterministic diagnostics and real CLI exit codes");
const fixture = [css("button {\n height:22px;\n color:#fff;\n}"), jsx('<span>-3</span>')];
checkDeep("input ordering cannot change diagnostics", analyzeSources(fixture), analyzeSources([...fixture].reverse()));
checkTrue("CSS diagnostic preserves source line", analyzeSources(fixture).some((item) => item.rule === "control-height" && item.line === 2));
const directory = mkdtempSync(join(tmpdir(), "stock-mania-ui-"));
try {
  mkdirSync(join(directory, "nested"));
  writeFileSync(join(directory, "nested", "control.css"), "button {height:22px}");
  checkTrue("recursive explicit path detects violation", checkPaths(["nested"], directory).some((item) => item.rule === "control-height"));
  const failed = spawnSync(process.execPath, ["scripts/ui-conformance.mjs", directory], { encoding: "utf8" });
  check("violating CLI exits nonzero", failed.status, 1);
  checkTrue("CLI supplies rule and location", failed.stderr.includes("control-height") && failed.stderr.includes("control.css:1"));
  writeFileSync(join(directory, "nested", "control.css"), "button {height:var(--h-md);border-radius:var(--r-2)}");
  checkTrue("conforming CLI passes", execFileSync(process.execPath, ["scripts/ui-conformance.mjs", directory], { encoding: "utf8" }).includes("PASS (0 violation(s))"));
} finally {
  if (!resolve(directory).startsWith(resolve(tmpdir()) + sep)) throw new Error("Temporary fixture escaped its named directory");
  rmSync(directory, { recursive: true, force: true });
}
checkDeep("the entire shipped UI library conforms without a baseline", checkPaths(["components/ui"]), []);
done();

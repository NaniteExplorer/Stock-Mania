import { readFileSync } from "node:fs";
import { check, checkTrue, done, section } from "./harness";

const css = readFileSync("app/globals.css", "utf8");
const bench = readFileSync("_design/control-bench/index.html", "utf8");
const elevation = readFileSync("_design/elevation-pass/index.html", "utf8");
const withoutComments = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, "");
const normalize = (value: string): string => value.trim().replace(/\s+/g, " ");

function block(source: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const found = new RegExp(`${escaped}\\s*\\{([^{}]*)\\}`).exec(withoutComments(source));
  if (!found) throw new Error(`Missing CSS block: ${selector}`);
  return found[1]!;
}

function declarations(body: string): Record<string, string> {
  return Object.fromEntries(
    [...withoutComments(body).matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map(
      ([, name, value]) => [name!, normalize(value!)],
    ),
  );
}

function containsContract(label: string, actual: Record<string, string>, expected: Record<string, string>): void {
  for (const [name, value] of Object.entries(expected)) check(`${label} ${name}`, actual[name], value);
}

const root = declarations(block(css, ":root"));
const neutral = declarations(
  [...withoutComments(bench).matchAll(/:root\s*\{([^{}]*)\}/g)].find(
    (match) => match[1]!.includes("--n-0:"),
  )![1]!,
);
const light = declarations(block(css, ":root, .tf-light"));
const dark = declarations(block(css, ':root[data-theme="dark"], :root.dark:not([data-theme="light"]):not(.tf-light), .tf-dark'));
const systemDark = declarations(block(css, ':root:not([data-theme="light"]):not(.tf-light)'));
const referenceLight = declarations(block(bench, ":root,.tf-light"));
const referenceDark = declarations(block(bench, ':root[data-theme="dark"],.tf-dark'));
const referencePage = declarations(block(elevation, '.stage[data-mode="after"]'));

section("the complete canonical token contract survives transcription");
checkTrue("the neutral ramp/control/font reference is nonempty", Object.keys(neutral).length > 30);
check("the semantic reference covers all 53 palette tokens", Object.keys(referenceLight).length, 53);
checkTrue("the page scale reference covers the complete After block", Object.keys(referencePage).length > 30);
containsContract("neutral/control", root, {
  ...neutral,
  "--sans": `var(--font-inter),${neutral["--sans"]}`,
  "--mono": `var(--font-plex-mono),${neutral["--mono"]}`,
});
containsContract("page After", root, referencePage);
containsContract("light", light, { ...referenceLight, "--c-other": "#7C8896" });
containsContract("explicit dark", dark, referenceDark);
containsContract("system dark", systemDark, referenceDark);
check("D.5 is the only overridden light reference value", Object.keys(referenceLight).filter((name) => light[name] !== referenceLight[name]).join(","), "--c-other");
checkTrue("light explicitly declares its native colour scheme", block(css, ":root, .tf-light").includes("color-scheme:light"));
checkTrue("dark explicitly declares its native colour scheme", block(css, ':root[data-theme="dark"], :root.dark:not([data-theme="light"]):not(.tf-light), .tf-dark').includes("color-scheme:dark"));

// Independent WCAG relative luminance calculation; do not trust prose ratios.
function luminance(hex: string): number {
  const channels = hex.replace("#", "").match(/../g)!.map((pair) => {
    const srgb = parseInt(pair, 16) / 255;
    return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
  });
  return channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722;
}
function contrast(a: string, b: string): number {
  const first = luminance(a);
  const second = luminance(b);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

section("all five corrections are measured against their actual grounds");
for (const [theme, tokens] of [["light", light], ["dark", dark]] as const) {
  for (const background of ["--bg-surface", "--bg-raised", "--bg-canvas"]) {
    const borderRatio = contrast(tokens["--border-control"]!, tokens[background]!);
    checkTrue(`${theme} control boundaries on ${background} meet 3:1 (${borderRatio.toFixed(2)})`, borderRatio >= 3);
  }
  const disabled = contrast(tokens["--fg-disabled"]!, tokens["--bg-surface"]!);
  check(`${theme} disabled measured ratio`, disabled.toFixed(2), theme === "light" ? "3.61" : "3.14");
  const other = contrast(tokens["--c-other"]!, tokens["--bg-surface"]!);
  checkTrue(`${theme} Other chart slice meets 3:1 (${other.toFixed(2)})`, other >= 3);
  for (const foreground of ["--fg", "--fg-secondary", "--fg-muted"]) {
    for (const background of ["--bg-surface", "--bg-subtle"]) {
      const ratio = contrast(tokens[foreground]!, tokens[background]!);
      checkTrue(`${theme} ${foreground} on ${background} meets 4.5:1 (${ratio.toFixed(2)})`, ratio >= 4.5);
    }
  }
}
check("light control correction measured", contrast(light["--border-control"]!, light["--bg-surface"]!).toFixed(2), "3.42");
check("dark control correction measured", contrast(dark["--border-control"]!, dark["--bg-surface"]!).toFixed(2), "3.54");
check("dark decorative panel border measured (not a control boundary)", contrast(dark["--border"]!, dark["--bg-surface"]!).toFixed(2), "1.60");
check("light subtle caption correction measured", contrast(light["--fg-muted"]!, light["--bg-subtle"]!).toFixed(2), "4.61");
check("light Other correction measured", contrast(light["--c-other"]!, light["--bg-surface"]!).toFixed(2), "3.61");

section("legacy consumers use semantic aliases without losing their import");
const aliases = declarations(block(css, ":root, .tf-light, .tf-dark"));
function resolve(name: string, tokens: Record<string, string>, depth = 0): string {
  if (depth > 10) throw new Error(`Alias cycle: ${name}`);
  const value = tokens[name];
  if (!value) throw new Error(`Missing alias/token: ${name}`);
  const reference = /^var\((--[\w-]+)\)$/.exec(value);
  return reference ? resolve(reference[1]!, tokens, depth + 1) : value;
}
checkTrue("legacy styles remain imported before the new contract", css.indexOf('@import "../src/ui/tokens.css";') < css.indexOf("--n-0:"));
for (const [theme, tokens] of [["light", light], ["dark", dark]] as const) {
  const all = { ...root, ...tokens, ...aliases };
  for (const [old, canonical] of [
    ["--background", "--bg-canvas"], ["--foreground", "--fg"],
    ["--card", "--bg-surface"], ["--popover", "--bg-raised"],
    ["--input", "--border-control"], ["--primary", "--accent"],
    ["--primary-foreground", "--accent-on"], ["--gray-900", "--bg-canvas"],
    ["--gray-800", "--bg-surface"], ["--gray-500", "--fg-muted"],
    ["--pos", "--gain"], ["--neg", "--loss"], ["--chart-1", "--c1"],
  ]) check(`${theme} ${old} follows ${canonical}`, resolve(old!, all), resolve(canonical!, all));
}

section("reduced motion and all required corrections remain explicit");
const reduced = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
checkTrue("reduced-motion mode exists", reduced.startsWith("@media (prefers-reduced-motion: reduce)"));
checkTrue("transition tokens collapse to 1ms", /--t-fast:\s*1ms;\s*--t:\s*1ms;/.test(reduced));
checkTrue("both pseudo elements receive duration reduction", reduced.includes("*, *::before, *::after"));
checkTrue("transition duration collapses to 1ms", /transition-duration:\s*1ms\s*!important/.test(reduced));
checkTrue("animation duration collapses to 1ms", /animation-duration:\s*1ms\s*!important/.test(reduced));
checkTrue("both canonical spinner forms stop", /\.btn\.loading::after, \.spin2\s*\{\s*animation:\s*none\s*!important;/.test(reduced));
checkTrue("static spinner rings become dotted", reduced.includes("border-style: dotted"));
for (const correction of ["1. border-control", "2. dark border", "3. light bg-subtle", "4. fg-disabled", "5. c-other"]) checkTrue(`${correction} has provenance comment`, css.includes(correction));

section("DESIGN 1.1b marker geometry is separate from hit targets");
for (const [name, value] of [["--mk-sm", "16px"], ["--mk-track-width", "32px"], ["--mk-track-height", "18px"]]) {
  check(`${name} is the binding painted-marker size`, declarations(block(css, ":root"))[name!], value);
}
checkTrue("chip target retains scale minimum24", css.includes("--h-xs:24px"));

done();

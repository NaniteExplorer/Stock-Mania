/**
 * Task D.1.b acceptance: the local Banking Console mirror carries the corrected token
 * set (DESIGN.md §1.2). `--border-control` is present and drawn on controls, nothing
 * references the retired `--border-strong`, and no text/control token is below its
 * WCAG floor (4.5:1 text, 3:1 non-text) in either theme.
 */
import { readFileSync } from "node:fs";
import { check, done, section } from "./harness";

const html = readFileSync("_design/banking-console/index.html", "utf8");

function block(selector: string): Record<string, string> {
  const start = html.indexOf(selector);
  if (start < 0) throw new Error(`missing ${selector}`);
  const body = html.slice(html.indexOf("{", start + selector.length - 1) + 1, html.indexOf("}", start));
  const tokens: Record<string, string> = {};
  for (const m of body.matchAll(/--([a-z0-9-]+)\s*:\s*([^;]+);/g)) tokens[m[1]] = m[2].trim();
  return tokens;
}

function lum(hex: string): number {
  const n = hex.replace("#", "");
  const c = [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16) / 255);
  const [r, g, b] = c.map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const ratio = (a: string, b: string) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

const themes = {
  light: block(":root,.tf-light{"),
  "dark (media)": block(':root:not([data-theme="light"]){'),
  "dark (attr)": block(':root[data-theme="dark"],.tf-dark{'),
};

// [foreground, background, floor]
const pairs: Array<[string, string, number]> = [
  ...["fg", "fg-secondary", "fg-muted", "accent", "gain", "loss", "warn", "info", "flat"].flatMap(
    (fg): Array<[string, string, number]> =>
      ["bg-surface", "bg-canvas", "bg-subtle"].map((bg): [string, string, number] => [fg, bg, 4.5]),
  ),
  ["accent-on", "accent", 4.5],
  ["loss-on", "loss", 4.5],
  ["tip-fg", "tip-bg", 4.5],
  ...["border-control", "fg-disabled", "c1", "c2", "c3", "c4", "c5", "c6"].flatMap(
    (fg): Array<[string, string, number]> =>
      ["bg-surface", "bg-canvas"].map((bg): [string, string, number] => [fg, bg, 3]),
  ),
];

section("structure");
check("no reference to retired --border-strong", !html.includes("--border-strong"), true);
check("controls draw var(--border-control)", (html.match(/var\(--border-control\)/g) ?? []).length >= 7, true);
check("dark blocks agree", JSON.stringify(themes["dark (media)"]) === JSON.stringify(themes["dark (attr)"]), true);

for (const [name, t] of Object.entries(themes)) {
  section(`theme ${name}`);
  check("--border-control present", /^#[0-9A-Fa-f]{6}$/.test(t["border-control"] ?? ""), true);
  for (const [fg, bg, floor] of pairs) {
    const r = ratio(t[fg], t[bg]);
    check(`${fg} on ${bg} ${r.toFixed(2)}:1 >= ${floor}`, r >= floor, true);
  }
}

done();

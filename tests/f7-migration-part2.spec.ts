/**
 * F.7 part 2 — source scan of the investments, history, imports and transactions
 * routes. No screen carries its own styling: no inline `style=`, no raw hex, no raw
 * Tailwind palette colour (every colour is a design token, `x-(--token)`), no
 * arbitrary-value colour, and no route-local stylesheet.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { checkDeep, checkTrue, done, section } from "./harness";

const ROUTES = ["investments", "history", "imports", "transactions"].map((route) => join("app", "(root)", route));
const walk = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
  const path = join(dir, name);
  return statSync(path).isDirectory() ? walk(path) : [path];
});
const files = ROUTES.flatMap(walk);
const sources = files.filter((file) => /\.tsx?$/.test(file)).map((path) => ({ path, source: readFileSync(path, "utf8") }));
const offenders = (pattern: RegExp) => sources.filter(({ source }) => pattern.test(source)).map(({ path }) => path);

section("scope");
checkTrue("the four routes have sources to scan", sources.length > 40);

section("no screen carries its own styling");
checkDeep("no inline style= attribute", offenders(/\bstyle=\{/), []);
checkDeep("no raw hex colour", offenders(/#[\da-fA-F]{3,8}\b(?![\w-])/), []);
checkDeep(
  "no raw Tailwind palette colour",
  offenders(/\b(?:text|bg|border|ring|fill|stroke|divide|outline|placeholder|from|via|to|shadow|accent|decoration)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|white|black)(?:-\d{2,3})?\b/),
  [],
);
checkDeep("no arbitrary-value colour (rgb/hsl/hex in brackets)", offenders(/-\[(?:#|rgb|hsl|oklch)/), []);
checkDeep(
  "no legacy global class (panel, metric-label, form-input, pill, table-scroll)",
  offenders(/className=(?:"|\{`|\{[^}]*["'`])[^"'`]*\b(?:panel|metric-label|form-input|pill|table-scroll)\b/),
  [],
);
const PRIMITIVE_GAPS = new Set(["MoneyText", "Pill", "Stat", "Field"]);
const primitiveImports = sources.flatMap(({ path, source }) =>
  [...source.matchAll(/import\s*\{([^}]*)\}\s*from\s*["']@\/ui\/primitives["']/g)]
    .flatMap((m) => m[1].split(",").map((n) => n.trim()).filter(Boolean))
    .filter((name) => !PRIMITIVE_GAPS.has(name))
    .map((name) => `${path}: ${name}`));
checkDeep("@/ui/primitives only for recorded library gaps (MoneyText, Pill, Stat, Field)", primitiveImports, []);
checkDeep("no route-local stylesheet", files.filter((file) => file.endsWith(".css")), []);

done();

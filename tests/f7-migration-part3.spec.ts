/**
 * F.7 part 3 — source scan of the dashboard route and the shared primitives
 * (`src/ui/primitives.tsx`, `src/ui/action-form.tsx`). No screen carries its own styling: no inline `style=`, no raw hex, no raw
 * Tailwind palette colour (every colour is a design token, `x-(--token)`), no
 * arbitrary-value colour, and no route-local stylesheet.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { checkDeep, checkTrue, done, section } from "./harness";

const ROOTS = [join("app", "(root)", "dashboard")];
const SHARED = [join("src", "ui", "primitives.tsx"), join("src", "ui", "action-form.tsx")];
const walk = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
  const path = join(dir, name);
  return statSync(path).isDirectory() ? walk(path) : [path];
});
const files = [...ROOTS.flatMap(walk), ...SHARED];
const sources = files.filter((file) => /\.tsx?$/.test(file)).map((path) => ({ path, source: readFileSync(path, "utf8") }));
const offenders = (pattern: RegExp) => sources.filter(({ source }) => pattern.test(source)).map(({ path }) => path);

section("scope");
checkTrue("dashboard and primitives have sources to scan", sources.length >= 6);
checkTrue("brand-* palette is gone", sources.every(({ source }) => !/\b(?:text|bg|border|ring|fill|stroke)-brand-\d/.test(source)));

section("no screen carries its own styling");
checkDeep("no inline style= attribute", offenders(/\bstyle=\{/), []);
checkDeep("no raw hex colour", offenders(/#[\da-fA-F]{3,8}\b(?![\w-])/), []);
checkDeep(
  "no raw Tailwind palette colour",
  offenders(/\b(?:text|bg|border|ring|fill|stroke|divide|outline|placeholder|from|via|to|shadow|accent|decoration)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|white|black)(?:-\d{2,3})?\b/),
  [],
);
checkDeep("no arbitrary-value colour (rgb/hsl/hex in brackets)", offenders(/-\[(?:#|rgb|hsl|oklch)/), []);

section("library gaps closed: screens compose components/ui, not legacy primitives");
const routeSources = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
  const path = join(dir, name);
  return statSync(path).isDirectory() ? routeSources(path) : /\.tsx?$/.test(name) ? [path] : [];
});
const OWNED_ELSEWHERE = /[\\/](?:assets|settings|cards)[\\/]/;
checkDeep(
  "no @/ui/primitives import under app/(root) (assets, settings, cards owned elsewhere)",
  routeSources(join("app", "(root)")).filter((path) => !OWNED_ELSEWHERE.test(path) && /from "@\/ui\/primitives"/.test(readFileSync(path, "utf8"))),
  [],
);

done();

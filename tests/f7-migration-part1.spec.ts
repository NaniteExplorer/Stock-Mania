/**
 * F.7 part 1 — source scan of the accounts, budgets, cards, deposits, loans,
 * liabilities and platforms routes (TASKS.md F.7, DESIGN.md §9b).
 *
 * The rule set matches `f7-migration-part2.spec.ts`, so both halves of F.7 hold the
 * same definition of "no screen carries its own styling": no inline `style=`, no raw
 * hex, no raw Tailwind palette colour (every colour is a design token, `x-(--token)`,
 * including the legacy `brand-*` scale), no arbitrary-value colour, and no
 * route-local stylesheet. Dynamic geometry (a bar's width, a marker's position) is
 * drawn with SVG attributes rather than inline style.
 *
 * Source-level, like the other screen specs: these are server pages that read the
 * database, and this runner has no DOM.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { checkDeep, checkTrue, done, section } from "./harness";

const ROUTES = ["accounts", "budgets", "cards", "deposits", "loans", "liabilities", "platforms"].map((route) => join("app", "(root)", route));
const walk = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
  const path = join(dir, name);
  return statSync(path).isDirectory() ? walk(path) : [path];
});
const files = ROUTES.flatMap(walk);
const sources = files.filter((file) => /\.tsx?$/.test(file)).map((path) => ({ path, source: readFileSync(path, "utf8") }));
const offenders = (pattern: RegExp) => sources.filter(({ source }) => pattern.test(source)).map(({ path }) => path);

section("scope");
checkTrue("every route folder has sources to scan", ROUTES.every((route) => sources.some(({ path }) => path.startsWith(route))));
checkTrue("the seven routes have sources to scan", sources.length > 30);

section("no screen carries its own styling");
checkDeep("no inline style= attribute", offenders(/\bstyle=\{/), []);
checkDeep("no raw hex colour", offenders(/#[\da-fA-F]{3,8}\b(?![\w-])/), []);
checkDeep(
  "no raw Tailwind palette colour",
  offenders(/\b(?:text|bg|border|ring|fill|stroke|divide|outline|placeholder|from|via|to|shadow|accent|decoration)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|white|black|brand)(?:-\d{2,3})?\b/),
  [],
);
checkDeep("no arbitrary-value colour (rgb/hsl/hex in brackets)", offenders(/-\[(?:#|rgb|hsl|oklch)/), []);
checkDeep("no route-local stylesheet", files.filter((file) => file.endsWith(".css")), []);

section("screens compose the library shells, not legacy globals (Recompose A)");
// Legacy global classes from app/globals.css that the §9b shells replace:
// `panel` -> Panel, `metric-label` -> Kpi / TableHead, `table-scroll` -> flush Panel + Table,
// and the hand-rolled control classes -> Input / NativeSelect / Button.
const classTokens = (source: string) =>
  [...source.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)].flatMap((match) => (match[1] ?? match[2]).split(/\s+/));
const legacy = (name: string) => sources.filter(({ source }) => classTokens(source).includes(name)).map(({ path }) => path);
for (const name of ["panel", "metric-label", "table-scroll", "stat-tile", "form-input", "form-label", "btn-glow", "ghost-btn", "pill", "tnum"]) {
  checkDeep(`no legacy global class "${name}"`, legacy(name), []);
}
// `Field` stays: components/ui has no label+hint+error wiring equivalent yet.
const primitiveImports = sources.flatMap(({ path, source }) =>
  [...source.matchAll(/import\s*\{([^}]*)\}\s*from\s*"@\/ui\/primitives"/g)].flatMap((match) =>
    match[1].split(",").map((name) => name.trim()).filter((name) => name && name !== "Field").map((name) => `${path}: ${name}`),
  ),
);
checkDeep("no @/ui/primitives import with a library equivalent (only Field)", primitiveImports, []);
checkDeep("no raw <table>/<th>/<td> outside the gap notice", offenders(/<(?:table|th|td)\b/).filter((path) => !path.endsWith("gap-notice-view.tsx")), []);
for (const page of ["accounts/page.tsx", "accounts/[accountId]/page.tsx", "budgets/page.tsx", "cards/page.tsx", "cards/[accountId]/page.tsx", "deposits/page.tsx", "loans/page.tsx", "loans/[accountId]/page.tsx", "loans/payoff/page.tsx", "platforms/page.tsx"]) {
  const source = readFileSync(join("app", "(root)", page), "utf8");
  checkTrue(`${page}: renders inside Page with a Masthead`, source.includes("<PageShell>") && source.includes("<Masthead"));
}

section("dynamic geometry is drawn, not styled");
for (const path of ["cards/[accountId]/cycle-timeline.tsx", "deposits/maturity-ladder.tsx"]) {
  const source = readFileSync(join("app", "(root)", path), "utf8");
  checkTrue(`${path}: bar width is an SVG attribute`, /<rect[^>]*\bwidth=\{/.test(source));
}

done();

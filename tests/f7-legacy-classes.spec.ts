/**
 * F.7 — no screen carries its own styling. Source scan of every route file under
 * app/(root): the legacy global classes `panel`, `metric-label`, `form-input` and
 * `pill` are banned; screens compose components/ui shells (Page, Masthead, Panel,
 * Table, Field/Input, StatusBadge) instead.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { checkDeep, checkTrue, done, section } from "./harness";

const ROOT = join("app", "(root)");
const walk = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
  const path = join(dir, name);
  return statSync(path).isDirectory() ? walk(path) : /\.tsx?$/.test(name) ? [path] : [];
});
const sources = walk(ROOT).map((path) => ({ path, source: readFileSync(path, "utf8") }));

/** Any className string or template literal that contains a banned class token. */
const LEGACY = /className=(?:"[^"]*|\{`[^`]*|\{[^}]*["'`][^"'`]*)(?<![\w-])(panel|metric-label|form-input|pill)(?![\w-])/;

section("scope");
checkTrue("app/(root) has route sources to scan", sources.length > 50);

section("no legacy global classes under app/(root)");
for (const name of ["panel", "metric-label", "form-input", "pill"]) {
  const pattern = new RegExp(LEGACY.source.replace("(panel|metric-label|form-input|pill)", name));
  checkDeep(`no "${name}" class`, sources.filter(({ source }) => pattern.test(source)).map(({ path }) => path), []);
}

done();

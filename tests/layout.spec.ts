import { readdirSync, existsSync, statSync } from "node:fs";

/**
 * Guards the file layout itself.
 *
 * The `src/app/` name is a trap. Next.js ignores `src/app/` **only while a root
 * `app/` directory exists** — see
 * node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/src-folder.md.
 * So `src/app/*.usecases.ts` is safe today, but two edits would break it silently
 * rather than loudly:
 *
 *   1. adding `src/app/page.tsx` creates a route file Next never reads, so the
 *      code looks alive and is dead;
 *   2. deleting or renaming the root `app/` promotes `src/app/` to the router,
 *      and every real route 404s.
 *
 * Both directions are asserted here because neither fails a typecheck, a lint or
 * a build.
 */

let failures = 0;
const check = (label: string, actual: unknown, expected: unknown) => {
  const ok = String(actual) === String(expected);
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}: ${actual}${ok ? "" : ` (expected ${expected})`}`);
};

console.log("-- the src/app trap --");

// 1. Root app/ must exist, or src/app/ becomes the router.
check("root app/layout.tsx exists", existsSync("app/layout.tsx"), true);
check("root app/ is a directory", statSync("app").isDirectory(), true);

// 2. src/app/ holds use cases only — never a route file.
const ROUTE_FILES = new Set([
  "page.tsx", "page.ts", "layout.tsx", "layout.ts", "route.ts", "route.tsx",
  "loading.tsx", "error.tsx", "not-found.tsx", "template.tsx", "default.tsx",
]);
const appDir = "src/app";
const entries = existsSync(appDir) ? readdirSync(appDir) : [];
const routeLike = entries.filter((f) => ROUTE_FILES.has(f));
check("src/app/ contains no Next route files", routeLike.join(",") || "none", "none");

const nonUseCase = entries.filter(
  (f) => statSync(`${appDir}/${f}`).isFile() && !f.endsWith(".usecases.ts"),
);
check("src/app/ contains only *.usecases.ts", nonUseCase.join(",") || "none", "none");

console.log("-- the consolidated layout --");

// The plan of record lands at one file per concept. These are the files the
// dependency rules in ARCHITECTURE.md §3 are written against.
for (const f of ["src/core/kernel.ts", "src/core/money.ts", "src/core/numeric.ts", "src/core/time.ts"]) {
  check(`${f} exists`, existsSync(f), true);
}
check("src/shared/ is gone", existsSync("src/shared"), false);
check("src/modules/ is gone", existsSync("src/modules"), false);
check("src/db/ is gone", existsSync("src/db"), false);

console.log("-- the dependency arrow --");

// domain/ must never import a driver or the framework. This is the one rule
// whose violation is invisible until something needs to run domain code in a
// test without a database.
import { readFileSync } from "node:fs";
const FORBIDDEN_IN_DOMAIN = ["drizzle-orm", "next/", "@/infra/", "@/app/", "server-only"];
for (const file of readdirSync("src/domain")) {
  const src = readFileSync(`src/domain/${file}`, "utf8");
  const imports = [...src.matchAll(/^import[^;]*from\s+"([^"]+)";/gm)].map((m) => m[1]);
  const bad = imports.filter((i) => FORBIDDEN_IN_DOMAIN.some((f) => i.startsWith(f)));
  check(`domain/${file} imports no driver or framework`, bad.join(",") || "none", "none");
}

// app/ (use cases) may know domain and core, never infra.
for (const file of readdirSync("src/app")) {
  const src = readFileSync(`src/app/${file}`, "utf8");
  const imports = [...src.matchAll(/^import[^;]*from\s+"([^"]+)";/gm)].map((m) => m[1]);
  const bad = imports.filter((i) => i.startsWith("@/infra/") || i.startsWith("drizzle-orm"));
  check(`app/${file} does not import infra`, bad.join(",") || "none", "none");
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);

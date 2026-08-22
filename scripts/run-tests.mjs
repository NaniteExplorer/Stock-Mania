/**
 * Minimal test runner.
 *
 * Bundles each `tests/*.spec.ts` with esbuild (already present as a drizzle-kit
 * dependency) and runs it in Node. No Jest, no Vitest, no config — the specs are
 * plain scripts that print PASS/FAIL lines and exit non-zero on failure.
 *
 * That is a deliberate trade-off while the redesign is in progress: it costs zero
 * extra dependencies and runs the real domain code against a real libSQL file. If
 * the suite outgrows it, swap in Vitest — the spec files need no changes beyond
 * their assertion helper.
 *
 *   node scripts/run-tests.mjs            # all specs
 *   node scripts/run-tests.mjs ledger     # specs whose name contains "ledger"
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync } from "node:fs";

const filter = process.argv[2] ?? "";
const specs = readdirSync("tests")
  .filter((file) => file.endsWith(".spec.ts"))
  .filter((file) => file.includes(filter))
  .sort();

if (specs.length === 0) {
  console.error(`No specs matched "${filter}"`);
  process.exit(1);
}

mkdirSync("tmp", { recursive: true });

let failed = 0;
for (const spec of specs) {
  const out = `tmp/${spec.replace(/\.ts$/, ".mjs")}`;
  console.log(`\n${"=".repeat(70)}\n${spec}\n${"=".repeat(70)}`);
  try {
    execFileSync(
      "npx",
      [
        "esbuild",
        `tests/${spec}`,
        "--bundle",
        "--platform=node",
        "--format=esm",
        "--target=node20",
        `--outfile=${out}`,
        "--log-level=error",
        "--alias:@=./src",
        // Native bindings must stay external or esbuild inlines the wrong loader.
        "--external:@libsql/client",
      ],
      { stdio: "inherit", shell: process.platform === "win32" },
    );
    execFileSync("node", [out], { stdio: "inherit" });
  } catch {
    failed += 1;
  }
}

console.log(
  `\n${"=".repeat(70)}\n${specs.length - failed}/${specs.length} spec file(s) passed`,
);
process.exit(failed === 0 ? 0 : 1);

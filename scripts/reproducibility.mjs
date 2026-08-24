/**
 * Runs the nightly reproducibility check.
 *
 * Bundles `reproducibility-entry.ts` with esbuild and runs it, exactly as
 * `db:seed` and `migrate:v1` do — the check is TypeScript because it runs the
 * domain's own recomputation, and a second implementation in SQL would be a
 * second set of rules to keep in step.
 *
 *   npm run verify:reproducibility
 *   npm run verify:reproducibility -- --as-of 2026-03-31
 *
 * Exit 0: every recomputation agreed. Exit 1: a difference. Exit 2: it could not
 * run at all — which is not the same thing and must not read as a pass.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";

mkdirSync("tmp", { recursive: true });

const out = "tmp/reproducibility.mjs";
execFileSync(
  "npx",
  [
    "esbuild",
    "scripts/reproducibility-entry.ts",
    "--bundle",
    "--platform=node",
    "--format=esm",
    "--target=node20",
    `--outfile=${out}`,
    "--log-level=error",
    "--alias:@=./src",
    "--external:@libsql/client",
    "--external:dotenv",
  ],
  { stdio: "inherit", shell: process.platform === "win32" },
);

execFileSync("node", [out, ...process.argv.slice(2)], { stdio: "inherit" });

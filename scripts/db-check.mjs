/**
 * Runs the schema drift check.
 *
 * Replaced a standalone MongoDB connectivity probe that imported `mongoose` — a
 * package that left `package.json` in Phase 6, so the script could no longer run
 * at all. What it checks now is the thing that actually breaks: a database whose
 * migrations are behind the code.
 *
 *   npm run db:check
 */
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";

mkdirSync("tmp", { recursive: true });

const out = "tmp/db-check.mjs";
execFileSync(
  "npx",
  [
    "esbuild",
    "scripts/db-check-entry.ts",
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

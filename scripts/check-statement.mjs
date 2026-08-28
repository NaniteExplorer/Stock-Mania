/**
 * Reconciles a statement file against the totals the bank printed on it.
 *
 * Bundles `check-statement-entry.ts` with esbuild and runs it, exactly as
 * `db:seed` and `verify:reproducibility` do.
 *
 *   npm run check:statement -- "path/to/statement.pdf"
 *
 * Exit 0: every row read and the running balance reconciles. Exit 1: something
 * was dropped or the balance stopped agreeing — look before importing.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";

mkdirSync("tmp", { recursive: true });

const out = "tmp/check-statement.mjs";
execFileSync(
  "npx",
  [
    "esbuild",
    "scripts/check-statement-entry.ts",
    "--bundle",
    "--platform=node",
    "--format=esm",
    "--target=node20",
    `--outfile=${out}`,
    "--log-level=error",
    "--alias:@=./src",
    "--external:@libsql/client",
    // pdf.js and ExcelJS are loaded on demand by the parser and must stay
    // external, or esbuild inlines a copy with the wrong worker loader.
    "--external:unpdf",
    "--external:exceljs",
  ],
  { stdio: "inherit", shell: process.platform === "win32" },
);

execFileSync("node", [out, ...process.argv.slice(2)], { stdio: "inherit" });

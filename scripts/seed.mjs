/**
 * Applies the reference-data seeds.
 *
 * Separate from `db:migrate` on purpose: the migration creates the shape, and
 * this fills the tables the domain reads at runtime — the legality matrix, the
 * CII table, the broker charge rates. Both are idempotent, so
 * `npm run db:migrate && npm run db:seed` is safe to repeat.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";

mkdirSync("tmp", { recursive: true });

const out = "tmp/seed.mjs";
execFileSync(
  "npx",
  [
    "esbuild",
    "scripts/seed-entry.ts",
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
execFileSync("node", [out], { stdio: "inherit" });

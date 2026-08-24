/**
 * Runs the v1 migration.
 *
 * Bundles `migrate-v1-entry.ts` with esbuild and runs it, exactly as `db:seed`
 * does — the script is TypeScript because it uses the domain's own use cases, and
 * replaying real data through anything less would be a second implementation of
 * the rules.
 *
 *   npm run migrate:v1 -- --user <id> --dir ./v1-export            # dry run
 *   npm run migrate:v1 -- --user <id> --dir ./v1-export --commit   # write
 */
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";

mkdirSync("tmp", { recursive: true });

const out = "tmp/migrate-v1.mjs";
execFileSync(
  "npx",
  [
    "esbuild",
    "scripts/migrate-v1-entry.ts",
    "--bundle",
    "--platform=node",
    "--format=esm",
    "--target=node20",
    `--outfile=${out}`,
    "--log-level=error",
    "--alias:@=./src",
    "--external:@libsql/client",
  ],
  { stdio: "inherit" },
);

execFileSync("node", [out, ...process.argv.slice(2)], { stdio: "inherit" });

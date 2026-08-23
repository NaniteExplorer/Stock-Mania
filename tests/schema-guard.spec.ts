import { readdirSync, readFileSync, statSync } from "node:fs";
import { check, checkDeep, section, done } from "./harness";

/**
 * Source-level guards for the invariants a schema cannot express.
 *
 * A03 says nothing is hard-deleted and A01 says the audit log has no update or
 * delete path. Neither is checkable by reading the schema — both are properties
 * of the *code*, and both fail silently: a stray `.delete()` works perfectly and
 * loses history.
 */

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = `${dir}/${entry}`;
    if (statSync(path).isDirectory()) {
      out.push(...sourceFiles(path));
    } else if (path.endsWith(".ts") || path.endsWith(".tsx")) {
      out.push(path);
    }
  }
  return out;
}

const files = sourceFiles("src");
const read = (path: string) => readFileSync(path, "utf8");

/** Comments are prose, not code — a mention of `.delete()` in a doc block is fine. */
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

section("A03 — nothing is hard-deleted");

/*
 * Two legitimate exceptions, and both are narrow:
 *
 *   unit-of-work.ts   deletes from `projection_cache`, which is a cache. Every
 *                     row is derivable from the journal, so dropping one loses
 *                     nothing and tombstoning it would mean filtering it out of
 *                     every lookup forever.
 *
 * Anything else deleting rows is a bug, not a style choice.
 */
const DELETE_ALLOWED: Readonly<Record<string, readonly string[]>> = {
  "src/infra/unit-of-work.ts": ["projectionCache"],
};

const offenders: string[] = [];
for (const path of files) {
  const code = stripComments(read(path));
  const deletes = [...code.matchAll(/\.delete\(\s*(\w+)?\s*\)/g)].map((m) => m[1] ?? "(unknown)");
  const rawSql = /DELETE\s+FROM/i.test(code);
  const allowed = DELETE_ALLOWED[path.replace(/\\/g, "/")] ?? [];
  for (const table of deletes) {
    if (!allowed.includes(table)) offenders.push(`${path}: .delete(${table})`);
  }
  if (rawSql) offenders.push(`${path}: raw DELETE FROM`);
}
checkDeep("no source file hard-deletes a user-facing row", offenders, []);

section("A01 — the audit trail and event log have no mutation path");

/*
 * An audit event that can be updated is not evidence. This looks for an update or
 * delete aimed at either log; the tables are append-only by construction, and
 * this is what keeps them that way as the code grows.
 */
const logOffenders: string[] = [];
for (const path of files) {
  const code = stripComments(read(path));
  for (const table of ["auditEvents", "ledgerEvents"]) {
    if (new RegExp(`\\.update\\(\\s*${table}\\s*\\)`).test(code)) {
      logOffenders.push(`${path}: .update(${table})`);
    }
    if (new RegExp(`\\.delete\\(\\s*${table}\\s*\\)`).test(code)) {
      logOffenders.push(`${path}: .delete(${table})`);
    }
  }
}
checkDeep("neither log is ever updated or deleted from", logOffenders, []);

section("the audit write is not optional");

// If AuditWriter were an optional collaborator, the first path in a hurry would
// omit it — so the unit of work writes the row, the audit event and the ledger
// event as one operation.
const uow = read("src/infra/unit-of-work.ts");
check("UnitOfWork.mutate writes an audit event", uow.includes("insert(auditEvents)"), true);
check("and a ledger event", uow.includes("insert(ledgerEvents)"), true);
check("and bumps revisions", uow.includes("bumpRevisions"), true);
check("and invalidates projections", uow.includes("invalidateProjections"), true);

section("the domain layer stays free of the driver and the framework");

// Restated here as well as in layout.spec.ts because this is the rule most likely
// to be broken by a well-meaning import that also happens to typecheck.
const FORBIDDEN = ["drizzle-orm", "next/", "@/infra/", "@/app/", "server-only", "react"];
const leaks: string[] = [];
for (const path of files.filter((f) => f.replace(/\\/g, "/").startsWith("src/domain/"))) {
  const imports = [...read(path).matchAll(/^import[^;]*from\s+"([^"]+)";/gm)].map((m) => m[1]);
  for (const specifier of imports) {
    if (FORBIDDEN.some((f) => specifier.startsWith(f))) leaks.push(`${path} -> ${specifier}`);
  }
}
checkDeep("domain/ imports only core/ and domain/", leaks, []);

section("a tombstoned row is invisible to reads");

/*
 * Soft delete is only worth anything if the reads honour it. A `deletedAt` column
 * that nothing filters on is worse than a hard delete: the row is still returned,
 * still counted, still summed into a total, and it now *looks* deleted in the UI.
 */
const repoSource = stripComments(read("src/infra/repositories.ts"));

/** Plain substring counting — no regex, so no escaping to get wrong. */
const occurrences = (haystack: string, needle: string): number =>
  haystack.split(needle).length - 1;

for (const table of ["ledgerAccounts", "journalEntries"] as const) {
  const scopedNeedle = "eq(" + table + ".userId, userId.value)";
  const guardedNeedle = scopedNeedle + ", isNull(" + table + ".deletedAt)";
  const scoped = occurrences(repoSource, scopedNeedle);
  const guarded = occurrences(repoSource, guardedNeedle);

  /*
   * The unguarded remainder are the writers, which must reach the very rows a
   * read hides: for accounts, `softDelete` tombstones one and `restore`
   * un-tombstones one; for entries, `softDelete` and `softDeleteByImportBatch`.
   *
   * This count found a real miss on its first run — `earliestPostedOn` was
   * reading unfiltered, so a tombstoned entry could still set the start of the
   * net-worth timeline. That is the kind of leak a `deletedAt` column invites.
   */
  const writers = 2;
  check("every scoped " + table + " read filters tombstones", scoped - guarded, writers);
  check("and " + table + " has guarded reads at all", guarded > 0, true);
}

section("money never crosses the driver boundary as a float");

// The schema stores minor units as INTEGER; a repository that wrote a decimal
// string or a float would typecheck and corrupt quietly.
const repositories = read("src/infra/repositories.ts");
check(
  "repositories never call toApproximateNumber on a money path",
  stripComments(repositories).includes("toApproximateNumber"),
  false,
);
check(
  "and never parseFloat",
  stripComments(repositories).includes("parseFloat"),
  false,
);

done();

/**
 * Reconcile a statement file against the totals the bank printed on it.
 *
 * Run this before importing anything large. A statement parser can be wrong in a
 * way that no per-row inspection reveals: an earlier draft of the PDF reader lost
 * exactly one transaction per page, and every row it *did* produce was perfect —
 * right dates, right amounts, plausible balances. What gave it away was counting
 * the file and comparing with the summary line at the bottom.
 *
 *   npm run check:statement -- "path/to/statement.pdf"
 *
 * It reads only; nothing is imported and no database is touched.
 */
import { readFile } from "node:fs/promises";
import { basename } from "node:path";

import { Money } from "@/core/money";
import { checkBalanceContinuity, parseStatementFile } from "@/infra/statements";
import type { StatementRow } from "@/infra/statements";

const path = process.argv[2];
if (!path) {
  console.error('Usage: npm run check:statement -- "path/to/statement.pdf"');
  process.exit(1);
}

const file = new File([await readFile(path)], basename(path));
const parsed = await parseStatementFile(file);
const rows = [...parsed.rows].sort((a, b) => a.rowIndex - b.rowIndex);

if (rows.length === 0) {
  console.error("No transactions were read from that file.");
  process.exit(1);
}

const total = (list: readonly StatementRow[]) =>
  list.reduce((sum, row) => sum.plus(row.amount), Money.zero(parsed.currency));

const debits = rows.filter((row) => row.direction === "DEBIT");
const credits = rows.filter((row) => row.direction === "CREDIT");
const continuity = checkBalanceContinuity(rows);
const closing = [...rows].reverse().find((row) => row.balanceAfter !== null)?.balanceAfter;

const money = (amount: Money) => amount.toDecimalString().padStart(16);

console.log(`\n${basename(path)}`);
console.log(`  layout        ${parsed.layout}  dates read as ${parsed.dateOrder}`);
/*
 * The verdict, and the column map behind it. Printed together because the map is
 * the answer to the only useful follow-up question a BROKEN verdict provokes:
 * which column did it read as what?
 */
const mapped = Object.entries(parsed.verdict.mapping)
  .sort((a, b) => a[1] - b[1])
  .map(([role, index]) => `${index}:${role}`)
  .join(" ");
console.log(`  verdict       ${parsed.verdict.trust}  (${parsed.verdict.checked} rows testable)`);
console.log(`  columns       ${mapped === "" ? "none reported" : mapped}`);
/*
 * The bank's own totals, against the rows read. ABSENT is not a failure - many
 * statements print no control figures - but it is the difference between "these
 * rows agree with each other" and "these are all the rows", so it is worth
 * seeing on every run rather than only when it disagrees.
 */
console.log(
  `  controls      ${parsed.verdict.controls.status}` +
    (parsed.verdict.controls.detail ? `  ${parsed.verdict.controls.detail}` : ""),
);
console.log(`  period        ${rows[0].date.toISO()} → ${rows[rows.length - 1].date.toISO()}`);
console.log(`  transactions  ${rows.length}`);
console.log(`  withdrawals   ${String(debits.length).padStart(5)} ${money(total(debits))}`);
console.log(`  deposits      ${String(credits.length).padStart(5)} ${money(total(credits))}`);
console.log(`  closing       ${closing ? money(closing) : "        not printed"}`);

/*
 * The two numbers that decide whether this file is safe to import. Unreadable
 * rows are transactions the ledger will simply not contain; a balance break means
 * the running balance stopped agreeing with the movements, which is how a
 * misread column or a dropped row shows itself.
 */
console.log(`\n  unreadable rows   ${parsed.problems.length}`);
console.log(`  balance breaks    ${continuity.breaks.length}`);

for (const problem of parsed.problems.slice(0, 10)) {
  console.log(`    ! ${problem.reason}: ${problem.raw.slice(0, 100)}`);
}
if (parsed.problems.length > 10) {
  console.log(`    … and ${parsed.problems.length - 10} more`);
}
for (const seam of continuity.breaks.slice(0, 10)) {
  console.log(
    `    ~ row ${seam.rowIndex}: printed ${seam.printed.toDecimalString()}, ` +
      `movements imply ${seam.expected.toDecimalString()}`,
  );
}

const clean = parsed.problems.length === 0 && continuity.breaks.length === 0;
console.log(
  clean
    ? "\n  Every row read, and the running balance reconciles to the last rupee.\n"
    : "\n  Compare the counts above with the summary printed on the statement before importing.\n",
);
process.exit(clean ? 0 : 1);

import { Money } from "@/core/money";
import { Percentage } from "@/core/numeric";
import { CalendarDate } from "@/core/time";
import { Count, Days, Ordinal, SortKey } from "@/core/units";
import { AccountId } from "@/domain/accounts";
import { DuplicateMatcher, fingerprintOf, reconcile, type ImportBatchRecord, type ImportRepository, type ImportVerdict, type MatchableRow, type MatchTarget, type StagedRow, type StatementMovement, type StoredBudget } from "@/domain/banking";
import { check, checkTrue, done } from "./harness";

const day = CalendarDate.parse("2026-01-10");
const row: MatchableRow = { key: "row", date: day, amount: Money.fromRupees("100.00"), direction: "DEBIT", externalId: null };
const target: MatchTarget = { transactionId: "tx", date: day.plusDays(7), amount: row.amount, direction: row.direction, externalId: null };
check("default seven-day window retains the inclusive edge", new DuplicateMatcher().match([row], [target])[0].pass, Ordinal(3));
check("explicit calendar window retains the same matching behavior", new DuplicateMatcher({ windowDays: Days(7) }).match([row], [target])[0].matchedTransactionId, "tx");
check("shorter calendar window excludes the next day", new DuplicateMatcher({ windowDays: Days(6) }).match([row], [target])[0].pass, null);
check("zero-day calendar window accepts the same day", new DuplicateMatcher({ windowDays: Days(0) }).match([row], [{ ...target, date: day }])[0].pass, Ordinal(3));
check("zero-day calendar window rejects another day", new DuplicateMatcher({ windowDays: Days(0) }).match([row], [target])[0].pass, null);
check("pinned match remains first pass", new DuplicateMatcher().match([{ ...row, ruleMatchedTransactionId: "tx" }], [target])[0].pass, Ordinal(1));
check("external-id match remains second pass", new DuplicateMatcher().match([{ ...row, externalId: "bank-id" }], [{ ...target, externalId: "bank-id" }])[0].pass, Ordinal(2));

const fingerprintInput = { accountId: AccountId.from("00000000-0000-4000-8000-000000000001"), date: day, amount: row.amount, direction: row.direction, description: "CARD SHOP", occurrence: Ordinal(0) };
checkTrue("occurrence ordinal remains part of exact fingerprint", fingerprintOf(fingerprintInput) !== fingerprintOf({ ...fingerprintInput, occurrence: Ordinal(1) }));
const report = reconcile({ statementClosing: row.amount, ledgerClosing: row.amount, asOf: day, unmatchedStatementRows: Count(2), unexplainedTransactions: Count(1) });
check("reconciliation still compares exact balances", report.difference.minor, 0n);
check("unmatched counts still produce both explanations", report.findings.length, 2);
checkTrue("unmatched row count remains visible", report.findings[0].includes("2 statement row(s)"));

// Compile-only probes: domain boundaries carry their actual units, not raw numbers.
if (false) {
  const movementIndex: StatementMovement["rowIndex"] = Ordinal(0);
  const stagedOccurrence: StagedRow["occurrence"] = Ordinal(1);
  const checkedRows: ImportVerdict["checked"] = Count(2);
  const mapping: ImportVerdict["mapping"] = { amount: Ordinal(2) };
  const rowsRead: ImportBatchRecord["rowsRead"] = Count(3);
  const deleted: Awaited<ReturnType<ImportRepository["softDeleteBatchesForAccount"]>> = Count(1);
  const threshold: StoredBudget["warnAtPercent"] = Percentage.of("80");
  // @ts-expect-error A raw row index is not a source-column/row ordinal.
  const badIndex: StatementMovement["rowIndex"] = 0;
  // @ts-expect-error A raw row count is not a measured Count.
  const badChecked: ImportVerdict["checked"] = 2;
  // @ts-expect-error Matching windows count calendar days, not observations.
  new DuplicateMatcher({ windowDays: Count(7) });
  // @ts-expect-error User thresholds are percentages, not unlabelled numbers.
  const badThreshold: StoredBudget["warnAtPercent"] = 80;
  void [movementIndex, stagedOccurrence, checkedRows, mapping, rowsRead, deleted, threshold, badIndex, badChecked, badThreshold];
}
checkTrue("signed built-in priorities preserve their ordering", SortKey(-100) < SortKey(0));
if (false) {
  // @ts-expect-error Rule ordering requires a validated signed SortKey.
  const rawPriority: import("@/domain/banking").KeywordRule["priority"] = -100;
  void rawPriority;
}
done();

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { CheckCheck, Sparkles, Trash2, Undo2, Upload } from "lucide-react";
import { AccountType, DEFAULT_CHART } from "@/domain/accounts";
import { Card, PageHeader, Pill, Stat } from "@/ui/primitives";
import { formatMoney } from "@/ui/format";
import { checkBalanceContinuity } from "@/infra/statements";
import { ActionForm, SubmitButton } from "@/ui/action-form";
import { currentUserId, services } from "@/infra/container";
import {
  confirmUnmatchedAction,
  eraseUndoneBatchAction,
  postBatchAction,
  smartReviewAction,
  undoBatchAction,
} from "../actions";
import ReviewTable, { type AccountOption, type ReviewRow } from "./review-table";

export const metadata: Metadata = { title: "Review import" };

/**
 * The review step — invariant I01 made visible.
 *
 * Every row on this page is staged, not posted. A row is `PARSED` (ready, with a
 * proposed category), `MATCHED` (we think you already have it, with the reason),
 * `CONFIRMED` (you said yes) or `REJECTED` (you said no). Only `CONFIRMED` rows
 * can be posted, and the "Post" button is the only thing that posts them.
 *
 * The rows are projected to plain strings here and handed to a client table,
 * which owns selection, filtering and paging. That split is deliberate: the
 * decisions stay server actions on real forms, and only the question of *which*
 * rows a form submits is answered on the client.
 */
export default async function Page({ params }: { params: Promise<{ batchId: string }> }) {
  await connection();

  const { batchId } = await params;
  const userId = await currentUserId();
  const { repositories } = services();

  const batch = await repositories.imports.findBatch(userId, batchId);
  if (!batch) notFound();

  const [rows, accounts] = await Promise.all([
    repositories.imports.listRows(userId, batchId),
    repositories.accounts.list(userId, { includeClosed: true }),
  ]);

  const byId = new Map(accounts.map((account) => [account.id.value, account]));
  const intoAccount = batch.accountId ? byId.get(batch.accountId.value) : undefined;

  const categories: AccountOption[] = accounts
    .filter((account) => account.type.isIncomeStatement && !account.isClosed)
    .map((account) => ({ id: account.id.value, label: account.code.toString(), isGroup: false }))
    .sort((a, b) => a.label.localeCompare(b.label));

  /*
   * Which balance-sheet accounts are real, and which are the seeded chart's
   * buckets.
   *
   * `Assets:Bank` and `Liabilities:Credit Cards` are shipped with every user's
   * chart; they are parents, and the accounts screen hides them for that reason.
   * Offering them here without saying what they are is how a review screen ends
   * up looking answerable while having no correct answer: a user whose only cash
   * account is the one being imported sees a full dropdown of things that are
   * all wrong.
   */
  /*
   * Recomputed on read rather than stored at staging: the staged rows keep the
   * printed balance, so the answer is always the answer for the rows that are
   * actually there — including after a row has been edited in review.
   */
  const continuity = checkBalanceContinuity([...rows].sort((a, b) => a.rowIndex - b.rowIndex));
  const printedClosing =
    [...rows]
      .sort((a, b) => b.rowIndex - a.rowIndex)
      .find((row) => row.balanceAfter !== null)?.balanceAfter ?? null;

  const SEEDED_CODES = new Set(DEFAULT_CHART.map((seed) => seed.code));

  // The statement's own account is excluded: a transfer needs two sides, and
  // "HDFC Savings → HDFC Savings" is not one of them.
  const transferTargets: AccountOption[] = accounts
    .filter(
      (account) =>
        account.type.isBalanceSheet &&
        account.type !== AccountType.EQUITY &&
        !account.isClosed &&
        !(batch.accountId && account.id.equals(batch.accountId)),
    )
    .map((account) => ({
      id: account.id.value,
      label: account.code.toString(),
      isGroup: SEEDED_CODES.has(account.code.toString()),
    }))
    .sort((a, b) => a.label.localeCompare(b.label));

  const reviewRows: ReviewRow[] = rows.map((row) => ({
    id: row.id,
    date: row.date.toISO(),
    description: row.description,
    reference: row.reference,
    because: row.because,
    amount: formatMoney(row.amount),
    amountMinor: row.amount.minor.toString(),
    direction: row.direction,
    status: row.status,
    posted: row.status === "CONFIRMED" && row.matchedTransactionId !== null,
    proposedAccountId: row.proposedAccountId?.value ?? null,
    proposedLabel: row.proposedAccountId
      ? (byId.get(row.proposedAccountId.value)?.code.toString() ?? null)
      : null,
    intent: row.intent,
    rejectedReason: row.rejectedReason,
    balanceAfter: row.balanceAfter ? formatMoney(row.balanceAfter) : null,
    raw: row.raw,
  }));

  const counts = {
    ready: reviewRows.filter((row) => row.status === "PARSED" && row.proposedAccountId).length,
    needsChoice: reviewRows.filter((row) => row.status === "PARSED" && !row.proposedAccountId).length,
    flagged: reviewRows.filter((row) => row.status === "MATCHED").length,
    confirmed: reviewRows.filter((row) => row.status === "CONFIRMED" && !row.posted).length,
    posted: reviewRows.filter((row) => row.posted).length,
    rejected: reviewRows.filter((row) => row.status === "REJECTED").length,
  };

  return (
    <>
      <PageHeader
        title={batch.fileName}
        subtitle={
          intoAccount
            ? `Into ${intoAccount.displayName}. Nothing here is in the ledger yet — confirm what is real, skip what you already have, then post.`
            : "Nothing here is in the ledger yet. Confirm what is real, skip what you already have, then post."
        }
        badge={<Pill tone="brand">{STATUS_LABELS[batch.status]}</Pill>}
        action={
          <Link href="/imports" className="ghost-btn h-10 px-4 text-xs">
            All imports
          </Link>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-6">
        <Stat label="Ready" value={<span className="tnum">{counts.ready}</span>} hint="Categorised, unconfirmed" />
        <Stat label="Needs choice" value={<span className="tnum">{counts.needsChoice}</span>} hint="Pick an account" />
        <Stat label="Look familiar" value={<span className="tnum">{counts.flagged}</span>} hint="Possible duplicates" />
        <Stat label="Confirmed" value={<span className="tnum">{counts.confirmed}</span>} hint="Waiting to post" />
        <Stat label="Posted" value={<span className="tnum">{counts.posted}</span>} hint="In the ledger" />
        <Stat label="Skipped" value={<span className="tnum">{counts.rejected}</span>} hint="Kept as evidence" />
      </div>

      {/*
        * The statement checks its own arithmetic.
        *
        * Every row carries the balance the bank printed after it, so each one can
        * be tested against the row before it plus the movement on it. It is the
        * cheapest possible proof that the debit and credit columns were read the
        * right way round — swap them and every row after the first fails — and it
        * only works because the amounts are exact integers.
        *
        * This check has existed and been tested since Phase 2 and nothing called
        * it, so the answer was computed by the specs and never shown to anyone.
        */}
      {continuity.checked > 0 && (
        <Card
          className="mb-6"
          title={
            continuity.breaks.length === 0
              ? "The statement agrees with itself"
              : `${continuity.breaks.length} row(s) break the running balance`
          }
          subtitle={
            continuity.breaks.length === 0
              ? `${continuity.checked} rows checked against the balance the bank printed beside them. Every debit and credit was read the right way round.`
              : "The bank's own printed balance does not follow from the row above it plus this row's amount. Either a column was read the wrong way round, or the file has a gap in it."
          }
        >
          {continuity.breaks.length === 0 && printedClosing ? (
            <p className="text-sm text-gray-400">
              Closing balance on the file:{" "}
              <span className="tnum text-gray-100">{formatMoney(printedClosing)}</span>. When every
              row is posted, the account should read exactly this.
            </p>
          ) : (
            <ul className="space-y-2 text-sm">
              {continuity.breaks.slice(0, 10).map((brk) => (
                <li key={brk.rowIndex} className="text-gray-300">
                  Line <span className="tnum">{brk.rowIndex}</span> — printed{" "}
                  <span className="tnum text-gray-100">{formatMoney(brk.printed)}</span>, expected{" "}
                  <span className="tnum text-gray-100">{formatMoney(brk.expected)}</span> (off by{" "}
                  <span className="tnum text-amber-500">
                    {formatMoney(brk.printed.minus(brk.expected))}
                  </span>
                  )
                </li>
              ))}
              {continuity.breaks.length > 10 && (
                <li className="text-xs text-gray-500">
                  and {continuity.breaks.length - 10} more.
                </li>
              )}
            </ul>
          )}
        </Card>
      )}

      {/*
        * A statement that printed no running balance.
        *
        * The old card simply did not render, which read as "nothing to say" when
        * the truth is the opposite: this import is exactly as trustworthy as the
        * column detection, and nothing here can check it. Silence and success
        * look identical, so the absence has to be stated.
        */}
      {continuity.checked === 0 && (
        <Card
          className="mb-6"
          title="This statement cannot check itself"
          subtitle="The file printed no running balance, so there is nothing to test the reading against. The rows may well be right — but nothing here proves it, and a statement that cannot be checked should not look the same as one that passed."
        />
      )}

      {/*
        * How the file was read, and — if it was overridden — why it was allowed
        * in. Both are the sort of thing a person needs months later, when the
        * question is "where did this figure come from?"
        */}
      {batch.diagnostics && (
        <>
          {Object.keys(batch.diagnostics.verdict.mapping).length > 0 && (
            <p className="mb-6 -mt-3 text-xs text-gray-500">
              Columns read as:{" "}
              {Object.entries(batch.diagnostics.verdict.mapping)
                .sort((a, b) => a[1] - b[1])
                .map(([role, index]) => `${index} → ${role}`)
                .join(", ")}
              .
            </p>
          )}
          {/*
            * The bank's own totals. Worth a line even when they agree, because
            * "the rows are consistent with each other" and "the bank agrees
            * these are all the rows" are different claims, and only the second
            * one can notice a transaction nobody read.
            */}
          {batch.diagnostics.verdict.controls.status === "MATCHED" && (
            <p className="mb-6 -mt-3 text-xs text-gray-500">
              Checked against the totals the bank printed on the statement, and they agree.
            </p>
          )}
          {batch.diagnostics.verdict.controls.status === "MISMATCHED" && (
            <Card
              className="mb-6"
              title="This does not match the bank's own totals"
              subtitle={batch.diagnostics.verdict.controls.detail ?? undefined}
            />
          )}

          {/*
            * Warnings are about the statement's place among the others, not its
            * arithmetic: the wrong account, a period already imported, a stretch
            * of time no statement covers. None of them makes a figure wrong on
            * its own, and every one of them can make the balance sheet wrong.
            */}
          {batch.diagnostics.warnings.length > 0 && (
            <Card className="mb-6" title="Worth checking before you post this">
              <ul className="list-disc space-y-1 pl-5 text-sm text-gray-600">
                {batch.diagnostics.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </Card>
          )}

          {batch.diagnostics.override && (
            <Card
              className="mb-6"
              title="Imported over a failed balance check"
              subtitle={`Someone chose to import this statement even though it does not agree with its own printed balance. Their reason: "${batch.diagnostics.override.reason}"`}
            />
          )}
        </>
      )}

      <Card className="mb-6">
        <div className="flex flex-wrap items-center gap-3">
          <ActionForm action={confirmUnmatchedAction} fields={{ batchId }}>
            <SubmitButton
              icon={<CheckCheck aria-hidden />}
              className="h-10 px-4 text-xs"
              disabled={counts.ready === 0}
            >
              Confirm {counts.ready} categorised rows
            </SubmitButton>
          </ActionForm>

          <ActionForm action={smartReviewAction} fields={{ batchId }}>
            <SubmitButton
              icon={<Sparkles aria-hidden />}
              className="h-10 px-4 text-xs"
              disabled={counts.ready + counts.needsChoice === 0}
            >
              Smart review {counts.ready + counts.needsChoice} rows
            </SubmitButton>
          </ActionForm>

          <ActionForm
            action={postBatchAction}
            fields={{ batchId }}
            confirm={{
              title: `Post ${counts.confirmed} row(s) to the ledger?`,
              body: "These become real transactions and will move your balances. You can still undo the whole import afterwards.",
              confirmLabel: "Post them",
            }}
          >
            <SubmitButton
              tone="primary"
              className="h-10 px-5 text-xs"
              disabled={counts.confirmed === 0}
            >
              Post {counts.confirmed} to the ledger
            </SubmitButton>
          </ActionForm>

          <div className="ml-auto flex flex-wrap items-center gap-3">
            <ActionForm
              action={undoBatchAction}
              fields={{ batchId }}
              confirm={{
                title: "Undo this import?",
                body: `All ${counts.posted} transaction(s) this import posted are reversed, and the file can be imported again. The staged rows and their evidence are kept.`,
                confirmLabel: "Undo the import",
                tone: "danger",
              }}
            >
              <SubmitButton
                icon={<Undo2 aria-hidden />}
                className="h-10 px-4 text-xs"
                disabled={counts.posted === 0}
              >
                Undo this import
              </SubmitButton>
            </ActionForm>

            {batch.status === "UNDONE" && (
              <ActionForm
                action={eraseUndoneBatchAction}
                fields={{ batchId }}
                confirm={{
                  title: "Erase this import from the history?",
                  body: "The batch and its staged rows are hidden. Nothing in the ledger changes — this import was already undone.",
                  confirmLabel: "Erase it",
                  tone: "danger",
                }}
              >
                <SubmitButton icon={<Trash2 aria-hidden />} tone="danger" className="h-10 px-4 text-xs">
                  Erase
                </SubmitButton>
              </ActionForm>
            )}
          </div>
        </div>
      </Card>

      {reviewRows.length === 0 ? (
        <Card>
          <p className="py-6 text-center text-sm text-gray-500">
            <Upload className="mx-auto mb-2 h-5 w-5 text-gray-600" aria-hidden />
            No rows were staged from this file.
          </p>
        </Card>
      ) : (
        <ReviewTable
          batchId={batchId}
          rows={reviewRows}
          categories={categories}
          transferTargets={transferTargets}
        />
      )}

      {batch.diagnostics && batch.diagnostics.problems.length > 0 ? (
        <Card
          className="mt-6"
          title={`${batch.diagnostics.problems.length} line(s) could not be read`}
          subtitle="Listed rather than counted: a line the parser could not read is a transaction your ledger will simply not contain, and a number alone gives you no way to find out which."
        >
          <ul className="space-y-2 text-sm">
            {batch.diagnostics.problems.slice(0, 25).map((problem) => (
              <li key={problem.rowIndex} className="text-gray-300">
                <span className="tnum text-gray-500">Line {problem.rowIndex}</span>{" "}
                &mdash; {problem.reason}
                <pre className="mt-1 overflow-x-auto rounded-lg bg-black/30 p-2 text-xs text-gray-400">
                  {problem.raw}
                </pre>
              </li>
            ))}
          </ul>
          {batch.diagnostics.problems.length > 25 && (
            <p className="mt-2 text-xs text-gray-500">
              &hellip; and {batch.diagnostics.problems.length - 25} more.
            </p>
          )}
        </Card>
      ) : (
        batch.rowsFailed > 0 && (
          <p className="mt-3 text-xs text-gray-500">
            {batch.rowsFailed} line(s) of the file could not be read and were not staged. This
            import predates the change that records which lines, and why.
          </p>
        )
      )}
    </>
  );
}

const STATUS_LABELS: Record<string, string> = {
  COMPLETED: "Posted",
  PARTIAL: "Awaiting review",
  FAILED: "Failed",
  UNDONE: "Undone",
};

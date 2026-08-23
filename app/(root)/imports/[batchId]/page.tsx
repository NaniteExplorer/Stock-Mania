import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { AccountType } from "@/domain/accounts";
import { Card, MoneyText, PageHeader, Pill, Stat } from "@/ui/primitives";
import { currentUserId, services } from "@/infra/container";
import { confirmUnmatchedAction, postBatchAction, reviewRowAction, undoBatchAction } from "../actions";

export const metadata: Metadata = { title: "Review import" };

/**
 * The review step — invariant I01 made visible.
 *
 * Every row on this page is staged, not posted. A row is `PARSED` (ready, with a
 * proposed category), `MATCHED` (we think you already have it, with the reason),
 * `CONFIRMED` (you said yes) or `REJECTED` (you said no). Only `CONFIRMED` rows
 * can be posted, and the "Post" button is the only thing that posts them.
 *
 * The proposed category is a `<select>` of the user's own income and expense
 * accounts rather than free text, and changing it before confirming is the whole
 * mechanism by which a wrong keyword rule gets corrected without editing a rule.
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
    repositories.accounts.list(userId),
  ]);

  const byId = new Map(accounts.map((account) => [account.id.value, account]));
  const categories = accounts
    .filter((account) => account.type.isIncomeStatement)
    .map((account) => ({ id: account.id.value, label: account.code.toString() }));
  const transferTargets = accounts
    .filter((account) => account.type.isBalanceSheet && account.type !== AccountType.EQUITY)
    .map((account) => ({ id: account.id.value, label: account.code.toString() }));

  const counts = {
    ready: rows.filter((row) => row.status === "PARSED").length,
    flagged: rows.filter((row) => row.status === "MATCHED").length,
    confirmed: rows.filter((row) => row.status === "CONFIRMED" && !row.matchedTransactionId).length,
    posted: rows.filter((row) => row.status === "CONFIRMED" && row.matchedTransactionId).length,
    rejected: rows.filter((row) => row.status === "REJECTED").length,
  };

  return (
    <>
      <PageHeader
        title={batch.fileName}
        subtitle="Nothing here is in the ledger yet. Confirm what is real, reject what you already have, then post."
        badge={<Pill tone="brand">{STATUS_LABELS[batch.status]}</Pill>}
        action={
          <Link href="/imports" className="ghost-btn h-10 px-4 text-xs">
            All imports
          </Link>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="Ready" value={<span className="tnum">{counts.ready}</span>} hint="Categorised, unconfirmed" />
        <Stat label="Look familiar" value={<span className="tnum">{counts.flagged}</span>} hint="Possible duplicates" />
        <Stat label="Confirmed" value={<span className="tnum">{counts.confirmed}</span>} hint="Waiting to post" />
        <Stat label="Posted" value={<span className="tnum">{counts.posted}</span>} hint="In the ledger" />
        <Stat label="Rejected" value={<span className="tnum">{counts.rejected}</span>} hint="Kept as evidence" />
      </div>

      <Card className="mb-6">
        <div className="flex flex-wrap items-center gap-3">
          <form action={confirmUnmatchedAction}>
            <input type="hidden" name="batchId" value={batchId} />
            <button type="submit" className="ghost-btn h-10 px-4 text-xs" disabled={counts.ready === 0}>
              Confirm the {counts.ready} unflagged rows
            </button>
          </form>

          <form action={postBatchAction}>
            <input type="hidden" name="batchId" value={batchId} />
            <button type="submit" className="btn-glow h-10 px-5 text-xs" disabled={counts.confirmed === 0}>
              Post {counts.confirmed} to the ledger
            </button>
          </form>

          <form action={undoBatchAction} className="ml-auto">
            <input type="hidden" name="batchId" value={batchId} />
            <button type="submit" className="ghost-btn h-10 px-4 text-xs" disabled={counts.posted === 0}>
              Undo this import
            </button>
          </form>
        </div>
      </Card>

      <section className="panel p-0">
        <div className="table-scroll">
          <table className="w-full text-sm">
            <caption className="sr-only">
              Staged rows with date, narration, proposed category, amount and status
            </caption>
            <thead>
              <tr className="border-b border-gray-600">
                <th scope="col" className="metric-label px-4 py-3 text-left">Date</th>
                <th scope="col" className="metric-label px-4 py-3 text-left">Narration</th>
                <th scope="col" className="metric-label px-4 py-3 text-left">Category</th>
                <th scope="col" className="metric-label px-4 py-3 text-right">Amount</th>
                <th scope="col" className="metric-label px-4 py-3 text-left">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const decided = row.status === "CONFIRMED" || row.status === "REJECTED";
                const options = row.intent === "SPEND" || row.intent === "RECEIPT" ? categories : transferTargets;
                return (
                  <tr key={row.id} className="border-b border-gray-600/50 align-top last:border-0">
                    <td className="tnum px-4 py-3 text-gray-400">{row.date.toISO()}</td>
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-100">{row.description}</p>
                      <p className="mt-0.5 max-w-md text-xs text-gray-500">{row.because}</p>
                    </td>
                    <td className="px-4 py-3">
                      {decided ? (
                        <span className="text-gray-400">
                          {row.proposedAccountId
                            ? (byId.get(row.proposedAccountId.value)?.code.toString() ?? "—")
                            : "—"}
                        </span>
                      ) : (
                        <form action={reviewRowAction} className="flex flex-wrap items-center gap-2">
                          <input type="hidden" name="batchId" value={batchId} />
                          <input type="hidden" name="rowId" value={row.id} />
                          <select
                            name="accountId"
                            className="form-input h-9 py-1 text-xs"
                            defaultValue={row.proposedAccountId?.value ?? ""}
                            aria-label={`Category for ${row.description}`}
                          >
                            <option value="">Choose…</option>
                            {options.map((option) => (
                              <option key={option.id} value={option.id}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                          <button
                            type="submit"
                            name="decision"
                            value="CONFIRM"
                            className="ghost-btn h-9 px-3 text-xs"
                          >
                            Confirm
                          </button>
                          <button
                            type="submit"
                            name="decision"
                            value="REJECT"
                            className="ghost-btn h-9 px-3 text-xs"
                          >
                            Skip
                          </button>
                        </form>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <MoneyText
                        value={row.amount}
                        tone={row.direction === "DEBIT" ? "neg" : "pos"}
                      />
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-xs text-gray-400">
                        {ROW_STATUS_LABELS[row.status]}
                        {row.status === "CONFIRMED" && row.matchedTransactionId ? " · posted" : ""}
                      </span>
                      {row.rejectedReason && (
                        <p className="text-xs text-gray-500">{row.rejectedReason}</p>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {batch.rowsFailed > 0 && (
        <p className="mt-3 text-xs text-gray-500">
          {batch.rowsFailed} line(s) of the file could not be read and were not staged. They are
          counted here rather than dropped silently.
        </p>
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

const ROW_STATUS_LABELS: Record<string, string> = {
  DRAFT: "Draft",
  PARSED: "Ready",
  MATCHED: "Looks familiar",
  CONFIRMED: "Confirmed",
  REJECTED: "Skipped",
};

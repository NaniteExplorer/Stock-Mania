import type { Metadata } from "next";
import Link from "next/link";
import { CheckCheck, Trash2, Undo2, Upload } from "lucide-react";
import { connection } from "next/server";
import { CashAsset } from "@/domain/assets";
import { Card, EmptyState, PageHeader, Pill } from "@/ui/primitives";
import { ActionForm, SubmitButton } from "@/ui/action-form";
import { FilterBar } from "@/ui/filter-bar";
import { currentUserId, ensureSeeded, services } from "@/infra/container";
import {
  eraseUndoneBatchAction,
  smartReviewAndPostAction,
  undoBatchAction,
} from "./actions";
import UploadForm, { type AccountOption } from "./upload-form";

export const metadata: Metadata = { title: "Import" };

const HISTORY_LIMIT = 100;

/**
 * The import wizard, step one — and the history of every batch.
 *
 * The history is not decoration: an import is undoable, and "which upload added
 * these 200 rows?" has to be answerable months later. Each batch shows what it
 * read, what it posted, what it thought was already present — and, now, which
 * account it went into, which was the one column that made the question
 * answerable at a glance and was missing.
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; account?: string; status?: string }>;
}) {
  await connection();

  const filters = await searchParams;
  const userId = await currentUserId();
  await ensureSeeded(userId);

  const { repositories } = services();
  const [accounts, batches] = await Promise.all([
    repositories.accounts.list(userId, { includeClosed: true }),
    repositories.imports.listBatches(userId, HISTORY_LIMIT),
  ]);

  const byId = new Map(accounts.map((account) => [account.id.value, account]));

  const pendingByBatch = new Map(
    await Promise.all(
      batches.map(async (batch) => {
        const rows = await repositories.imports.listRows(userId, batch.id);
        const pending = rows.filter(
          (row) => row.status === "PARSED" || (row.status === "CONFIRMED" && !row.matchedTransactionId),
        ).length;
        return [batch.id, pending] as const;
      }),
    ),
  );

  const GROUP_CODES = new Set(["Assets:Bank", "Assets:Cash", "Assets:Wallets"]);
  const cashAccounts = accounts.filter(
    (account) => CashAsset.classify(account) !== null && !GROUP_CODES.has(account.code.toString()),
  );

  const options: AccountOption[] = cashAccounts
    .filter((account) => !account.isClosed)
    .map((account) => ({
      id: account.id.value,
      label: account.institution
        ? `${account.displayName} — ${account.institution}`
        : account.displayName,
    }));

  const needle = (filters.q ?? "").trim().toLowerCase();
  const visible = batches.filter((batch) => {
    if (filters.status && batch.status !== filters.status) return false;
    if (filters.account && batch.accountId?.value !== filters.account) return false;
    if (needle && !batch.fileName.toLowerCase().includes(needle)) return false;
    return true;
  });

  return (
    <>
      <PageHeader
        title="Import a statement"
        subtitle="Rows are parsed into exact amounts, categorised by your keyword rules, checked against what you already have — and then wait for you."
        badge={<Pill tone="brand">Phase 2</Pill>}
      />

      <Card
        title="Upload"
        subtitle="Four layers of duplicate detection run before anything is offered: the same file, the same row, the same bank reference, and looks-the-same-within-a-week."
        className="mb-6"
      >
        {options.length === 0 ? (
          <EmptyState
            icon={Upload}
            title="Open an account first"
            body="A statement belongs to an account, so there has to be one to import into."
            action={
              <Link href="/accounts" className="ghost-btn h-10 px-4 text-xs">
                Open an account
              </Link>
            }
          />
        ) : (
          <UploadForm accounts={options} />
        )}
      </Card>

      <section className="panel p-0">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-600 px-5 py-4">
          <h2 className="text-sm font-semibold text-gray-100">Past imports</h2>
          <p className="text-xs text-gray-500">
            Every one of these can be undone. Showing the most recent {HISTORY_LIMIT}.
          </p>
        </div>

        {batches.length === 0 ? (
          <EmptyState icon={Upload} title="Nothing imported yet" body="Your first upload will appear here." />
        ) : (
          <>
            <div className="px-5 pt-4">
              <FilterBar
                searchPlaceholder="Search by file name"
                filters={[
                  {
                    name: "status",
                    label: "Status",
                    options: [
                      { value: "", label: "Any status" },
                      { value: "PARTIAL", label: "Awaiting review" },
                      { value: "COMPLETED", label: "Posted" },
                      { value: "UNDONE", label: "Undone" },
                      { value: "FAILED", label: "Failed" },
                    ],
                  },
                  {
                    name: "account",
                    label: "Account",
                    options: [
                      { value: "", label: "Any account" },
                      ...cashAccounts.map((account) => ({
                        value: account.id.value,
                        label: account.displayName,
                      })),
                    ],
                  },
                ]}
              />
            </div>

            <div className="table-scroll">
              <table className="w-full text-sm">
                <caption className="sr-only">Past imports with account, row counts and status</caption>
                <thead>
                  <tr className="border-b border-gray-600">
                    <th scope="col" className="metric-label px-4 py-3 text-left">File</th>
                    <th scope="col" className="metric-label px-4 py-3 text-left">Account</th>
                    <th scope="col" className="metric-label px-4 py-3 text-left">Status</th>
                    <th scope="col" className="metric-label px-4 py-3 text-right">Read</th>
                    <th scope="col" className="metric-label px-4 py-3 text-right">Posted</th>
                    <th scope="col" className="metric-label px-4 py-3 text-right">Duplicates</th>
                    <th scope="col" className="metric-label px-4 py-3 text-right">Unreadable</th>
                    <th scope="col" className="metric-label px-4 py-3 text-right">Remaining</th>
                    <th scope="col" className="metric-label px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((batch) => {
                    const remaining = pendingByBatch.get(batch.id) ?? 0;
                    const account = batch.accountId ? byId.get(batch.accountId.value) : undefined;
                    const canBulkReview = batch.status === "PARTIAL" && remaining > 0;
                    const canUndo = batch.rowsImported > 0 && batch.status !== "UNDONE";
                    const canErase = batch.status === "UNDONE";

                    return (
                      <tr key={batch.id} className="border-b border-gray-600/50 last:border-0">
                        <td className="px-4 py-3">
                          <Link
                            href={`/imports/${batch.id}`}
                            className="font-medium text-gray-100 hover:text-brand-400"
                          >
                            {batch.fileName}
                          </Link>
                        </td>
                        <td className="px-4 py-3 text-gray-400">
                          {account ? (
                            <Link
                              href={`/accounts/${account.id.value}`}
                              className="hover:text-brand-400"
                            >
                              {account.displayName}
                            </Link>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="px-4 py-3 text-gray-400">{STATUS_LABELS[batch.status]}</td>
                        <td className="tnum px-4 py-3 text-right text-gray-400">{batch.rowsRead}</td>
                        <td className="tnum px-4 py-3 text-right text-gray-300">{batch.rowsImported}</td>
                        <td className="tnum px-4 py-3 text-right text-gray-400">{batch.rowsDuplicate}</td>
                        <td className="tnum px-4 py-3 text-right text-gray-400">{batch.rowsFailed}</td>
                        <td className="tnum px-4 py-3 text-right text-gray-300">{remaining}</td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap justify-end gap-2">
                            {canBulkReview && (
                              <ActionForm
                                action={smartReviewAndPostAction}
                                fields={{ batchId: batch.id }}
                                confirm={{
                                  title: "Review and post the rest?",
                                  body: `Every row this import can categorise on its own is confirmed and posted to the ledger. Anything it is unsure about is left for you. You can undo the whole import afterwards.`,
                                  confirmLabel: "Review and post",
                                }}
                              >
                                <SubmitButton icon={<CheckCheck aria-hidden />} className="h-9 px-3 text-xs">
                                  Review all &amp; post
                                </SubmitButton>
                              </ActionForm>
                            )}

                            {canUndo && (
                              <ActionForm
                                action={undoBatchAction}
                                fields={{ batchId: batch.id }}
                                confirm={{
                                  title: "Undo this import?",
                                  body: `All ${batch.rowsImported} transaction(s) it posted are reversed, and the file becomes importable again.`,
                                  confirmLabel: "Undo the import",
                                  tone: "danger",
                                }}
                              >
                                <SubmitButton icon={<Undo2 aria-hidden />} className="h-9 px-3 text-xs">
                                  Undo
                                </SubmitButton>
                              </ActionForm>
                            )}

                            {canErase && (
                              <ActionForm
                                action={eraseUndoneBatchAction}
                                fields={{ batchId: batch.id }}
                                confirm={{
                                  title: "Erase this import from the history?",
                                  body: "The batch and its staged rows are hidden. Nothing in the ledger changes — this import was already undone.",
                                  confirmLabel: "Erase it",
                                  tone: "danger",
                                }}
                              >
                                <SubmitButton icon={<Trash2 aria-hidden />} tone="danger" className="h-9 px-3 text-xs">
                                  Erase
                                </SubmitButton>
                              </ActionForm>
                            )}

                            <Link href={`/imports/${batch.id}`} className="ghost-btn h-9 px-3 text-xs">
                              Open
                            </Link>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {visible.length === 0 && (
              <p className="px-5 py-10 text-center text-sm text-gray-500">
                No imports match this filter.
              </p>
            )}
          </>
        )}
      </section>
    </>
  );
}

const STATUS_LABELS: Record<string, string> = {
  COMPLETED: "Posted",
  PARTIAL: "Awaiting review",
  FAILED: "Failed",
  UNDONE: "Undone",
};

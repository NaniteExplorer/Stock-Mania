import type { Metadata } from "next";
import Link from "next/link";
import { CheckCheck, Trash2, Undo2 } from "lucide-react";
import { connection } from "next/server";
import { CashAsset } from "@/domain/assets";
import { Masthead, Page as PageShell, Panel } from "../../../components/ui/page-shell";
import { Table, TableBody, TableCaption, TableHead, TableHeader, TableRow } from "../../../components/ui/table";
import { ActionCell, TextCell } from "../../../components/ui/data-cell";
import { Banner } from "../../../components/ui/banner";
import { Button } from "../../../components/ui/button";
import { ActionForm, SubmitButton } from "@/ui/action-form";
import { FilterBar } from "@/ui/filter-bar";
import { InstitutionMark } from "@/ui/provider-picker";
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
      institution: account.institution,
    }));

  const needle = (filters.q ?? "").trim().toLowerCase();
  const visible = batches.filter((batch) => {
    if (filters.status && batch.status !== filters.status) return false;
    if (filters.account && batch.accountId?.value !== filters.account) return false;
    if (needle && !batch.fileName.toLowerCase().includes(needle)) return false;
    return true;
  });

  return (
    <PageShell>
      <Masthead title="Import a statement" />
      <p className="text-sm text-(--fg-secondary)">
        Rows are parsed into exact amounts, categorised by your keyword rules, checked against what you already have — and then wait for you.{" "}
        <span className="text-(--fg-muted)">Phase 2</span>
      </p>

      <Panel
        title="Upload"
        description="Four layers of duplicate detection run before anything is offered: the same file, the same row, the same bank reference, and looks-the-same-within-a-week."
      >
        {options.length === 0 ? (
          <Banner title="Open an account first">
            <p>A statement belongs to an account, so there has to be one to import into.</p>
            <Button asChild variant="outline" size="sm">
              <Link href="/accounts">Open an account</Link>
            </Button>
          </Banner>
        ) : (
          <UploadForm accounts={options} />
        )}
      </Panel>

      <Panel
        title="Past imports"
        description={`Every one of these can be undone. Showing the most recent ${HISTORY_LIMIT}.`}
      >
        {batches.length === 0 ? (
          <Banner title="Nothing imported yet"><p>Your first upload will appear here.</p></Banner>
        ) : (
          <>
            <div>
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

            <Table aria-label="Past imports">
                <TableCaption className="sr-only">Past imports with account, row counts and status</TableCaption>
                <TableHeader>
                  <TableRow>
                    <TableHead>File</TableHead>
                    <TableHead>Account</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Read</TableHead>
                    <TableHead className="text-right">Posted</TableHead>
                    <TableHead className="text-right">Duplicates</TableHead>
                    <TableHead className="text-right">Unreadable</TableHead>
                    <TableHead className="text-right">Remaining</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visible.map((batch) => {
                    const remaining = pendingByBatch.get(batch.id) ?? 0;
                    const account = batch.accountId ? byId.get(batch.accountId.value) : undefined;
                    const canBulkReview = batch.status === "PARTIAL" && remaining > 0;
                    const canUndo = batch.rowsImported > 0 && batch.status !== "UNDONE";
                    const canErase = batch.status === "UNDONE";

                    return (
                      <TableRow key={batch.id}>
                        <TextCell>
                          <Link
                            href={`/imports/${batch.id}`}
                            className="font-medium text-(--fg) hover:text-brand-400"
                          >
                            {batch.fileName}
                          </Link>
                        </TextCell>
                        <TextCell>
                          {account ? (
                            <Link
                              href={`/accounts/${account.id.value}`}
                              className="inline-flex items-center gap-2 hover:text-brand-400"
                            >
                              <InstitutionMark institution={account.institution} />
                              {account.displayName}
                            </Link>
                          ) : (
                            "—"
                          )}
                        </TextCell>
                        <TextCell>{STATUS_LABELS[batch.status]}</TextCell>
                        <TextCell className="tnum text-right">{batch.rowsRead}</TextCell>
                        <TextCell className="tnum text-right">{batch.rowsImported}</TextCell>
                        <TextCell className="tnum text-right">{batch.rowsDuplicate}</TextCell>
                        <TextCell className="tnum text-right">{batch.rowsFailed}</TextCell>
                        <TextCell className="tnum text-right">{remaining}</TextCell>
                        <ActionCell>
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
                        </ActionCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
            </Table>

            {visible.length === 0 && (
              <p className="px-5 py-10 text-center text-sm text-(--fg-muted)">
                No imports match this filter.
              </p>
            )}
          </>
        )}
      </Panel>
    </PageShell>
  );
}

const STATUS_LABELS: Record<string, string> = {
  COMPLETED: "Posted",
  PARTIAL: "Awaiting review",
  FAILED: "Failed",
  UNDONE: "Undone",
};

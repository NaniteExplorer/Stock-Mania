import type { Metadata } from "next";
import Link from "next/link";
import { Upload } from "lucide-react";
import { connection } from "next/server";
import { CashAsset } from "@/domain/assets";
import { Card, EmptyState, PageHeader, Pill } from "@/ui/primitives";
import { currentUserId, ensureSeeded, services } from "@/infra/container";
import UploadForm, { type AccountOption } from "./upload-form";

export const metadata: Metadata = { title: "Import" };

/**
 * The import wizard, step one — and the history of every batch.
 *
 * The history is not decoration: an import is undoable, and "which upload added
 * these 200 rows?" has to be answerable months later. Each batch shows what it
 * read, what it posted and what it thought was already present.
 */
export default async function Page() {
  await connection();

  const userId = await currentUserId();
  await ensureSeeded(userId);

  const { repositories } = services();
  const [accounts, batches] = await Promise.all([
    repositories.accounts.list(userId),
    repositories.imports.listBatches(userId, 20),
  ]);

  const options: AccountOption[] = accounts
    .filter((account) => CashAsset.classify(account) !== null)
    .map((account) => ({
      id: account.id.value,
      label: account.institution
        ? `${account.displayName} — ${account.institution}`
        : account.displayName,
    }));

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
        <div className="flex items-center justify-between border-b border-gray-600 px-5 py-4">
          <h2 className="text-sm font-semibold text-gray-100">Past imports</h2>
          <p className="text-xs text-gray-500">Every one of these can be undone.</p>
        </div>

        {batches.length === 0 ? (
          <EmptyState icon={Upload} title="Nothing imported yet" body="Your first upload will appear here." />
        ) : (
          <div className="table-scroll">
            <table className="w-full text-sm">
              <caption className="sr-only">Past imports with row counts and status</caption>
              <thead>
                <tr className="border-b border-gray-600">
                  <th scope="col" className="metric-label px-4 py-3 text-left">File</th>
                  <th scope="col" className="metric-label px-4 py-3 text-left">Status</th>
                  <th scope="col" className="metric-label px-4 py-3 text-right">Read</th>
                  <th scope="col" className="metric-label px-4 py-3 text-right">Posted</th>
                  <th scope="col" className="metric-label px-4 py-3 text-right">Duplicates</th>
                  <th scope="col" className="metric-label px-4 py-3 text-right">Unreadable</th>
                </tr>
              </thead>
              <tbody>
                {batches.map((batch) => (
                  <tr key={batch.id} className="border-b border-gray-600/50 last:border-0">
                    <td className="px-4 py-3">
                      <Link href={`/imports/${batch.id}`} className="font-medium text-gray-100 hover:text-brand-400">
                        {batch.fileName}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-gray-400">{STATUS_LABELS[batch.status]}</td>
                    <td className="tnum px-4 py-3 text-right text-gray-400">{batch.rowsRead}</td>
                    <td className="tnum px-4 py-3 text-right text-gray-300">{batch.rowsImported}</td>
                    <td className="tnum px-4 py-3 text-right text-gray-400">{batch.rowsDuplicate}</td>
                    <td className="tnum px-4 py-3 text-right text-gray-400">{batch.rowsFailed}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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

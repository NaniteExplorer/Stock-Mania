"use client";

import * as React from "react";
import Link from "next/link";
import { Archive, ArchiveRestore, ChevronRight, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { ActionForm, SubmitButton } from "@/ui/action-form";
import { InstitutionMark } from "@/ui/provider-picker";
import {
  bulkCloseAccountsAction,
  closeCashAccountAction,
  deleteEmptyCashAccountAction,
  reopenCashAccountAction,
} from "./actions";

export interface AccountRow {
  id: string;
  name: string;
  code: string;
  institution: string | null;
  suffix: string | null;
  kind: string;
  currency: string;
  isClosed: boolean;
  isSystem: boolean;
  postingCount: number;
  balance: string;
}

/**
 * The account list.
 *
 * Client-side only for the tick boxes: the rows themselves are filtered and
 * sorted on the server, so what is on screen is what the query returned rather
 * than a subset the browser chose to reveal.
 */
export default function AccountsTable({ rows }: { rows: readonly AccountRow[] }) {
  const [selected, setSelected] = React.useState<ReadonlySet<string>>(new Set());

  const closable = React.useMemo(
    () => rows.filter((row) => !row.isSystem && !row.isClosed).map((row) => row.id),
    [rows],
  );
  const effective = React.useMemo(
    () => closable.filter((id) => selected.has(id)),
    [closable, selected],
  );
  const allSelected = closable.length > 0 && effective.length === closable.length;

  return (
    <>
      {effective.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-2xl border border-brand-500/30 bg-brand-500/5 px-4 py-3">
          <p className="text-xs font-medium text-gray-200">
            {effective.length} account{effective.length === 1 ? "" : "s"} selected
          </p>
          <ActionForm
            action={bulkCloseAccountsAction}
            confirm={{
              title: `Close ${effective.length} account(s)?`,
              body: "They stop accepting postings and leave the account pickers. Balances and history are kept, and each can be reopened.",
              confirmLabel: "Close them",
            }}
            onResult={(state) => {
              if (state.ok) setSelected(new Set());
            }}
          >
            <>
              {effective.map((id) => (
                <input key={id} type="hidden" name="accountId" value={id} />
              ))}
              <SubmitButton icon={<Archive aria-hidden />} className="h-9 px-3 text-xs">
                Close selected
              </SubmitButton>
            </>
          </ActionForm>
          <button
            type="button"
            className="text-xs text-gray-400 hover:underline"
            onClick={() => setSelected(new Set())}
          >
            Clear selection
          </button>
        </div>
      )}

      <section className="panel p-0">
        <div className="table-scroll">
          <table className="w-full text-sm">
            <caption className="sr-only">
              Cash accounts, with kind, currency and derived balance
            </caption>
            <thead>
              <tr className="border-b border-gray-600">
                <th scope="col" className="px-4 py-3 text-left">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-brand-500"
                    checked={allSelected}
                    ref={(node) => {
                      if (node) node.indeterminate = effective.length > 0 && !allSelected;
                    }}
                    disabled={closable.length === 0}
                    onChange={() => setSelected(allSelected ? new Set() : new Set(closable))}
                    aria-label="Select all open accounts"
                  />
                </th>
                <th scope="col" className="metric-label px-4 py-3 text-left">Account</th>
                <th scope="col" className="metric-label px-4 py-3 text-left">Kind</th>
                <th scope="col" className="metric-label px-4 py-3 text-left">Currency</th>
                <th scope="col" className="metric-label px-4 py-3 text-left">Status</th>
                <th scope="col" className="metric-label px-4 py-3 text-right">Balance</th>
                <th scope="col" className="metric-label px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.id}
                  className={cn(
                    "border-b border-gray-600/50 last:border-0",
                    selected.has(row.id) && "bg-brand-500/5",
                  )}
                >
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-brand-500"
                      checked={selected.has(row.id)}
                      disabled={row.isSystem || row.isClosed}
                      onChange={() =>
                        setSelected((current) => {
                          const next = new Set(current);
                          if (next.has(row.id)) next.delete(row.id);
                          else next.add(row.id);
                          return next;
                        })
                      }
                      aria-label={`Select ${row.name}`}
                    />
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      href={`/accounts/${row.id}`}
                      className="group flex items-center gap-3"
                    >
                      <InstitutionMark institution={row.institution} />
                      <span>
                        <span className="block font-medium text-gray-100 group-hover:text-brand-400">
                          {row.name}
                        </span>
                        <span className="block text-xs text-gray-500">
                          {row.institution ?? row.code}
                          {row.suffix && ` · ending ${row.suffix}`}
                        </span>
                      </span>
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-gray-400">{row.kind}</td>
                  <td className="px-4 py-3 text-gray-400">{row.currency}</td>
                  <td className="px-4 py-3">
                    <span
                      className={cn(
                        "pill",
                        row.isClosed ? undefined : "pill-brand",
                      )}
                    >
                      {row.isClosed ? "Closed" : "Open"}
                    </span>
                    <p className="tnum mt-1 text-xs text-gray-500">
                      {row.postingCount} posting{row.postingCount === 1 ? "" : "s"}
                    </p>
                  </td>
                  <td className="tnum px-4 py-3 text-right font-medium text-gray-100">
                    {row.balance}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap justify-end gap-2">
                      {!row.isSystem && !row.isClosed && (
                        <ActionForm
                          action={closeCashAccountAction}
                          fields={{ accountId: row.id }}
                          confirm={{
                            title: `Close ${row.name}?`,
                            body: "It stops accepting new postings and leaves the account pickers. Its balance and history are kept, and you can reopen it at any time.",
                            confirmLabel: "Close it",
                          }}
                        >
                          <SubmitButton icon={<Archive aria-hidden />} className="h-9 px-3 text-xs">
                            Close
                          </SubmitButton>
                        </ActionForm>
                      )}

                      {!row.isSystem && row.isClosed && (
                        <ActionForm action={reopenCashAccountAction} fields={{ accountId: row.id }}>
                          <SubmitButton
                            icon={<ArchiveRestore aria-hidden />}
                            className="h-9 px-3 text-xs"
                          >
                            Reopen
                          </SubmitButton>
                        </ActionForm>
                      )}

                      {/*
                        * Delete, here on the row, for an account with nothing
                        * posted to it.
                        *
                        * It used to live only on the detail page, on the theory
                        * that a destructive control should cost one more click.
                        * That reasoning does not survive contact with the case it
                        * applies to: an account with no postings has nothing to
                        * lose, and hiding its delete behind a page nobody thought
                        * to open reads as "this app will not let me delete
                        * anything". The genuinely destructive control — delete the
                        * account *and its history* — is still detail-page only,
                        * and still requires the account be closed first.
                        */}
                      {!row.isSystem && row.postingCount === 0 && (
                        <ActionForm
                          action={deleteEmptyCashAccountAction}
                          fields={{ accountId: row.id }}
                          confirm={{
                            title: `Delete ${row.name}?`,
                            body: "Nothing has ever been posted to this account, so nothing is lost.",
                            confirmLabel: "Delete it",
                            tone: "danger",
                          }}
                        >
                          <SubmitButton
                            icon={<Trash2 aria-hidden />}
                            tone="danger"
                            className="h-9 px-3 text-xs"
                          >
                            Delete
                          </SubmitButton>
                        </ActionForm>
                      )}

                      <Link href={`/accounts/${row.id}`} className="ghost-btn h-9 px-3 text-xs">
                        Open
                        <ChevronRight className="h-3.5 w-3.5" aria-hidden />
                      </Link>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {rows.length === 0 && (
          <p className="px-5 py-10 text-center text-sm text-gray-500">
            No accounts match this filter.
          </p>
        )}
      </section>
    </>
  );
}

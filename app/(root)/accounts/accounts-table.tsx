"use client";

import * as React from "react";
import Link from "next/link";
import { Archive, ArchiveRestore, ChevronRight, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { ActionForm, SubmitButton } from "@/ui/action-form";
import { InstitutionMark } from "@/ui/provider-picker";
import { Panel } from "@/components/ui/page-shell";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ActionCell, TextCell } from "@/components/ui/data-cell";
import { Button } from "@/components/ui/button";
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
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-2xl border border-(--accent)/30 bg-(--accent)/5 px-4 py-3">
          <p className="text-xs font-medium text-(--fg)">
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
            className="text-xs text-(--fg-secondary) hover:underline"
            onClick={() => setSelected(new Set())}
          >
            Clear selection
          </button>
        </div>
      )}

      <Panel title="Your accounts" description="Balances are summed from postings at read time." flush>
          <Table aria-label="Cash accounts, with kind, currency and derived balance">
            <TableHeader>
              <TableRow>
                <TableHead>
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-(--accent)"
                    checked={allSelected}
                    ref={(node) => {
                      if (node) node.indeterminate = effective.length > 0 && !allSelected;
                    }}
                    disabled={closable.length === 0}
                    onChange={() => setSelected(allSelected ? new Set() : new Set(closable))}
                    aria-label="Select all open accounts"
                  />
                </TableHead>
                <TableHead>Account</TableHead>
                <TableHead>Kind</TableHead>
                <TableHead>Currency</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Balance</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow
                  key={row.id}
                  aria-selected={selected.has(row.id) || undefined}
                  className={cn(selected.has(row.id) && "bg-(--accent)/5")}
                >
                  <TableCell>
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-(--accent)"
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
                  </TableCell>
                  <TableCell>
                    <Link
                      href={`/accounts/${row.id}`}
                      className="group flex items-center gap-3"
                    >
                      <InstitutionMark institution={row.institution} />
                      <span>
                        <span className="block font-medium text-(--fg) group-hover:text-(--accent)">
                          {row.name}
                        </span>
                        <span className="block text-xs text-(--fg-muted)">
                          {row.institution ?? row.code}
                          {row.suffix && ` · ending ${row.suffix}`}
                        </span>
                      </span>
                    </Link>
                  </TableCell>
                  <TextCell>{row.kind}</TextCell>
                  <TextCell>{row.currency}</TextCell>
                  <TextCell secondary={`${row.postingCount} posting${row.postingCount === 1 ? "" : "s"}`}>
                    {row.isClosed ? "Closed" : "Open"}
                  </TextCell>
                  <TextCell className="text-right tabular-nums">{row.balance}</TextCell>
                  <ActionCell>
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

                      <Button asChild variant="ghost" size="sm">
                        <Link href={`/accounts/${row.id}`}>
                          Open
                          <ChevronRight className="h-3.5 w-3.5" aria-hidden />
                        </Link>
                      </Button>
                    </div>
                  </ActionCell>
                </TableRow>
              ))}
              {rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="py-10 text-center text-(--fg-muted)">
                    No accounts match this filter.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
      </Panel>
    </>
  );
}

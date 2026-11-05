"use client";

import * as React from "react";
import { Trash2, Undo2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { ActionForm, SubmitButton } from "@/ui/action-form";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ActionCell, TextCell } from "@/components/ui/data-cell";
import {
  bulkDeleteTransactionsAction,
  deleteTransactionAction,
  reverseTransactionAction,
} from "../actions";

/** One row of an account's own ledger, projected on the server. */
export interface LedgerRow {
  id: string;
  date: string;
  narration: string;
  otherSide: string;
  amount: string;
  /** Money arriving in *this* account. */
  incoming: boolean;
  /** A reversal cannot itself be reversed — reverse the original instead. */
  isReversal: boolean;
}

/**
 * An account's transactions, with the two removal controls the ledger actually
 * distinguishes.
 *
 * **Reverse** is for a transaction that happened and was recorded wrongly: it
 * posts the opposite entry and leaves both on the statement. **Delete** is for an
 * entry that should never have existed — a duplicate from a re-import. One button
 * for both would force every correction to either invent a phantom pair of
 * postings or destroy the evidence, depending on which meaning we picked, so both
 * are offered and each says what it does.
 *
 * There is deliberately no *edit*. Editing a posted transaction in place would
 * make the balance above it unexplainable from its own history, which is the one
 * property this whole ledger exists to keep.
 */
export default function LedgerTable({
  accountId,
  rows,
}: {
  accountId: string;
  rows: readonly LedgerRow[];
}) {
  const [selected, setSelected] = React.useState<ReadonlySet<string>>(new Set());

  const ids = React.useMemo(() => rows.map((row) => row.id), [rows]);
  const chosen = React.useMemo(() => ids.filter((id) => selected.has(id)), [ids, selected]);
  const allSelected = ids.length > 0 && chosen.length === ids.length;

  const toggle = (id: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <>
      {chosen.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-2xl border border-(--loss)/30 bg-(--loss)/5 px-4 py-3">
          <p className="text-xs font-medium text-(--fg)">
            {chosen.length} transaction{chosen.length === 1 ? "" : "s"} selected
          </p>
          <ActionForm
            action={bulkDeleteTransactionsAction}
            fields={{ accountId, transactionIds: chosen.join(",") }}
            confirm={{
              title: `Delete ${chosen.length} transaction(s)?`,
              body: "They leave every balance, report and total. Use this for entries that should never have existed — to correct one that did happen, reverse it instead so both sides stay visible.",
              confirmLabel: "Delete them",
              tone: "danger",
            }}
            onResult={(state) => {
              if (state.ok) setSelected(new Set());
            }}
          >
            <SubmitButton icon={<Trash2 aria-hidden />} tone="danger" className="h-9 px-3 text-xs">
              Delete selected
            </SubmitButton>
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

      <Table aria-label="Transactions touching this account, newest first">
          <TableHeader>
            <TableRow>
              <TableHead>
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-(--accent)"
                  checked={allSelected}
                  ref={(node) => {
                    if (node) node.indeterminate = chosen.length > 0 && !allSelected;
                  }}
                  disabled={ids.length === 0}
                  onChange={() => setSelected(allSelected ? new Set() : new Set(ids))}
                  aria-label="Select every transaction on this page"
                />
              </TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Narration</TableHead>
              <TableHead>Other side</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow
                key={row.id}
                aria-selected={selected.has(row.id) || undefined}
                className={cn(selected.has(row.id) && "bg-(--loss)/5")}
              >
                <TableCell>
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-(--accent)"
                    checked={selected.has(row.id)}
                    onChange={() => toggle(row.id)}
                    aria-label={`Select ${row.narration}`}
                  />
                </TableCell>
                <TextCell className="tabular-nums">{row.date}</TextCell>
                <TextCell secondary={row.isReversal ? "reversal" : undefined}>{row.narration}</TextCell>
                <TextCell>{row.otherSide}</TextCell>
                {/* Library gap: FigureCell has no gain/loss tone, so direction is coloured here. */}
                <TextCell className={cn("text-right tabular-nums", row.incoming ? "text-(--gain)" : "text-(--loss)")}>
                  {row.incoming ? "+" : "−"}
                  {row.amount}
                </TextCell>
                <ActionCell>
                  <div className="flex justify-end gap-2">
                    {/*
                     * Hidden on a reversal because the use case refuses it: the
                     * user should reverse the original, and offering a button
                     * whose only outcome is a refusal is worse than not offering
                     * it. Whether the *original* already has a reversal is not
                     * known here — that would be a query per row — so the domain
                     * answers that on submit.
                     */}
                    {!row.isReversal && (
                      <ActionForm
                        action={reverseTransactionAction}
                        fields={{ accountId, transactionId: row.id }}
                        confirm={{
                          title: `Reverse ${row.narration}?`,
                          body: "An equal and opposite entry is posted. Both stay in the ledger, so the correction is visible rather than silent.",
                          confirmLabel: "Reverse it",
                        }}
                      >
                        <SubmitButton icon={<Undo2 aria-hidden />} className="h-8 px-3 text-xs">
                          Reverse
                        </SubmitButton>
                      </ActionForm>
                    )}
                    <ActionForm
                      action={deleteTransactionAction}
                      fields={{ accountId, transactionId: row.id }}
                      confirm={{
                        title: `Delete ${row.narration}?`,
                        body: "It leaves every balance and report. Use this only for an entry that should never have existed, such as a duplicate import — otherwise reverse it.",
                        confirmLabel: "Delete it",
                        tone: "danger",
                      }}
                    >
                      <SubmitButton
                        icon={<Trash2 aria-hidden />}
                        tone="danger"
                        className="h-8 px-3 text-xs"
                      >
                        Delete
                      </SubmitButton>
                    </ActionForm>
                  </div>
                </ActionCell>
              </TableRow>
            ))}
          </TableBody>
      </Table>
    </>
  );
}

"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ConfirmRemoval } from "@/components/ui/confirm-removal";
import { phraseMatches, removalPhrase } from "./bulk-scope";
import { removeTransactionAction, type BulkRemovalState } from "./actions";
import { useRemovalUndo, writeBanner } from "./bulk-remove";

/**
 * Per-row removal from the register's `Del` (Batch 5). The existing §7.1 confirm dialog,
 * scoped to one row: the row id travels to `removeTransactionAction`, which runs the
 * same removal path as "Remove all matching" and returns one undoable `requestId`. The
 * banner and `Ctrl+Z` then undo it exactly as they undo a bulk removal.
 */
export interface SingleRemoveRow {
  id: string;
  label: string;
  /** Signed, formatted amount (U+2212 for money out). */
  net: string;
  date: string;
}

export default function SingleRemove({
  row,
  onClose,
}: {
  /** The row to remove; `null` keeps the dialog closed. */
  row: SingleRemoveRow | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const { undo } = useRemovalUndo();

  const onDone = React.useCallback(
    (state: BulkRemovalState) => {
      if (!state.requestId) return;
      const next = { requestId: state.requestId, message: state.message };
      writeBanner(next);
      onClose();
      toast.success(state.message, { action: { label: "Undo", onClick: () => undo(next.requestId) } });
      router.refresh();
    },
    [onClose, router, undo],
  );

  return (
    <ConfirmRemoval
      open={row !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      count={1}
      chips={row ? [row.label] : []}
      net={row?.net ?? ""}
      range={row?.date ?? ""}
      undoNote="One undo restores it, for 30 days."
      phrase={removalPhrase(1)}
      phraseMatches={(typed) => phraseMatches(typed, 1)}
      fields={{ transactionId: row?.id ?? "" }}
      action={removeTransactionAction}
      onDone={onDone}
      onReview={() => {
        onClose();
        router.refresh();
      }}
    />
  );
}

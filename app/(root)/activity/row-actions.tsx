"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import type { ActionState } from "@/ui/action-state";
import type { VerbState } from "@/app/activity.usecases";
import { redoActivityAction, undoActivityAction } from "./actions";
import { ActivityCommandContext } from "./activity-grid";
import styles from "./activity.module.css";

/**
 * Undo / Redo for one row. A disabled verb is never hidden and always carries its
 * reason as visible text (DESIGN §9e). Class A undo asks once, inline.
 *
 * The grid's `Ctrl+Z` / `Ctrl+Y` (§6.1) arrive through `ActivityCommandContext` and press
 * these same controls: undo opens the inline confirmation with focus on its Undo button,
 * redo submits this row's Redo form. `Esc` or Cancel returns focus to the grid.
 */
export default function RowActions({ requestId, undo, redo }: { requestId: string; undo: VerbState; redo: VerbState }) {
  const [undoState, undoAction, undoPending] = React.useActionState<ActionState | null, FormData>(undoActivityAction.bind(null, requestId), null);
  const [redoState, redoAction, redoPending] = React.useActionState<ActionState | null, FormData>(redoActivityAction, null);
  const [confirming, setConfirming] = React.useState(false);
  const { command, returnFocus } = React.useContext(ActivityCommandContext);
  const [dismissed, setDismissed] = React.useState<number | null>(null);
  const redoForm = React.useRef<HTMLFormElement>(null);
  // Stable, so React attaches it once: focus moves to Undo when the key opens the
  // confirmation, and is not pulled back on every later render.
  const focusOnMount = React.useCallback((button: HTMLButtonElement | null) => button?.focus(), []);
  const reasonId = `undo-reason-${requestId}`;
  const redoReasonId = `redo-reason-${requestId}`;
  const result = undoState ?? redoState;

  // Ctrl+Z on this row: the same inline confirmation a click opens, never a direct undo.
  const keyed = !!command && command.verb === "undo" && command.requestId === requestId && command.nonce !== dismissed;
  const showConfirm = undo.available && (confirming || keyed);
  const cancel = () => {
    setConfirming(false);
    if (command) setDismissed(command.nonce);
    if (keyed) returnFocus();
  };

  // Ctrl+Y on this row: submit the existing Redo form (redo has no confirmation, §9e).
  React.useEffect(() => {
    if (command?.verb === "redo" && command.requestId === requestId && redo.available) redoForm.current?.requestSubmit();
  }, [command, requestId, redo.available]);

  return <div className={styles.verbs}>
    {undo.available
      ? showConfirm
        ? <form action={undoAction} className={styles.confirm}
          onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); cancel(); } }}>
          <span className={styles.note}>Undo this whole change? It is all or nothing.</span>
          <Button type="submit" size="xs" disabled={undoPending} ref={keyed ? focusOnMount : undefined}>Undo</Button>
          <Button type="button" size="xs" variant="outline" onClick={cancel}>Cancel</Button>
        </form>
        : <Button type="button" size="xs" variant="outline" onClick={() => setConfirming(true)}>Undo</Button>
      : <><Button type="button" size="xs" variant="outline" disabled aria-describedby={reasonId}>Undo</Button>
        <span id={reasonId} className={styles.reason}>{undo.reason}</span></>}
    {redo.available
      ? <form ref={redoForm} action={redoAction}><Button type="submit" size="xs" variant="outline" disabled={redoPending}>Redo</Button></form>
      : <><Button type="button" size="xs" variant="outline" disabled aria-describedby={redoReasonId}>Redo</Button>
        <span id={redoReasonId} className={styles.reason}>{redo.reason}</span></>}
    <span aria-live="polite" className={result && !result.ok ? styles.refused : styles.ok}>{result?.message ?? ""}</span>
  </div>;
}

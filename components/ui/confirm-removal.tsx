"use client";

import * as React from "react";
import { Button } from "./button";
import { Input } from "./input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./dialog";
import styles from "./controls.module.css";

/**
 * The remove-all confirmation (DESIGN §7.1, task 2.6.b).
 *
 * Radix Dialog supplies the focus trap, `Esc` and focus return; Cancel takes the
 * initial focus. The scope is restated as read-only chips, the typed phrase carries
 * the ungrouped count, and every refusal *replaces* the form rather than sitting
 * under it. The component is presentation only: the phrase rule arrives as
 * `phraseMatches`, the server action and its state shape from the caller.
 */
export interface ConfirmRemovalState {
  ok: boolean;
  message: string;
  requestId?: string;
  refusal?: string;
  blockedIds?: string[];
  actualCount?: number;
}

export interface ConfirmRemovalProps<S extends ConfirmRemovalState = ConfirmRemovalState> {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  count: number;
  /** Literal chip labels of the active filter; empty means unfiltered (refused). */
  chips: readonly string[];
  /** Net amount, already formatted and signed (U+2212). */
  net: string;
  /** Date range touched, already formatted. */
  range: string;
  /** "One undo restores all …" line. */
  undoNote: string;
  phrase: string;
  phraseMatches: (typed: string) => boolean;
  /** Hidden fields posted with the confirmation (the filter and the count). */
  fields: Record<string, string>;
  action: (previous: S | null, formData: FormData) => Promise<S>;
  onDone: (state: S) => void;
  /** "Review again" after the count drifted: the caller refreshes the scope. */
  onReview: () => void;
  /** Renders a blocked row (a link, normally). */
  renderBlocked?: (id: string) => React.ReactNode;
  /**
   * A refusal known before the dialog opens: protected rows already in scope (D1), or a
   * filter that could not be read. It replaces the form, so there is no confirmation to
   * give (§7 item 2). Takes precedence over the form, never over the unfiltered refusal.
   */
  preflight?: Pick<ConfirmRemovalState, "message" | "refusal" | "blockedIds"> | null;
  /** Balance-sheet accounts the removal changes: "Balances change in 4 accounts" (§7.1). */
  accounts?: readonly string[];
  /**
   * *Filter them out* (§7.1): offered beside a refusal that names blocked rows; the caller
   * adds an exclusion to the table's filter and closes.
   */
  onFilterOut?: (ids: readonly string[]) => void;
}

const grouped = (n: number) => n.toLocaleString("en-IN");

export function ConfirmRemoval<S extends ConfirmRemovalState>(props: ConfirmRemovalProps<S>) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      {props.open && <ConfirmRemovalBody key={`${props.count}:${props.chips.join("|")}`} {...props} />}
    </Dialog>
  );
}

function ConfirmRemovalBody<S extends ConfirmRemovalState>(props: ConfirmRemovalProps<S>) {
  const cancelRef = React.useRef<HTMLButtonElement>(null);
  const [typed, setTyped] = React.useState("");
  const [state, formAction, pending] = React.useActionState<S | null, FormData>(props.action, null);
  const { onDone } = props;
  const reported = React.useRef<S | null>(null);

  React.useEffect(() => {
    if (state && state.ok && reported.current !== state) {
      reported.current = state;
      onDone(state);
    }
  }, [state, onDone]);

  const matched = props.phraseMatches(typed);
  const phraseId = React.useId();
  const hintId = React.useId();
  const unfiltered = props.chips.length === 0;
  const refusal = props.preflight ?? (state && !state.ok && state.refusal !== "PHRASE" ? state : null);
  const blocked = refusal?.blockedIds ?? [];
  const canFilterOut = !!props.onFilterOut && blocked.length > 0 && refusal?.refusal === "RECONCILED";

  const close = (
    <Button ref={cancelRef} type="button" variant="outline" onClick={() => props.onOpenChange(false)}>
      Close
    </Button>
  );

  return (
    <DialogContent
      showCloseButton={false}
      onOpenAutoFocus={(event) => {
        event.preventDefault();
        cancelRef.current?.focus();
      }}
    >
      <DialogHeader>
        <DialogTitle>
          {unfiltered ? "Remove all transactions" : `Remove ${grouped(props.count)} transaction${props.count === 1 ? "" : "s"}`}
        </DialogTitle>
      </DialogHeader>

      {unfiltered ? (
        <>
          <DialogDescription>
            Remove-all needs a filter. Narrow the table first, so the scope is something you chose.
          </DialogDescription>
          <DialogFooter>{close}</DialogFooter>
        </>
      ) : refusal ? (
        <>
          <DialogDescription role="alert">{refusal.message}</DialogDescription>
          {blocked.length > 0 && (
            <ul aria-label="Rows that block the removal">
              {blocked.map((id) => (
                <li key={id}>{props.renderBlocked ? props.renderBlocked(id) : id}</li>
              ))}
            </ul>
          )}
          <DialogFooter>
            {refusal.refusal === "DRIFTED" ? (
              <Button ref={cancelRef} type="button" variant="outline" onClick={props.onReview}>
                Review again
              </Button>
            ) : (
              <>
                {close}
                {canFilterOut && (
                  <Button type="button" variant="outline" onClick={() => props.onFilterOut?.(blocked)}>
                    Filter them out
                  </Button>
                )}
              </>
            )}
          </DialogFooter>
        </>
      ) : (
        <form action={formAction}>
          <DialogDescription>These filters set the scope. To change it, close and refilter.</DialogDescription>
          <ul aria-label="Scope">
            {props.chips.map((chip) => (
              <li key={chip} className={styles.chip}>{chip}</li>
            ))}
          </ul>
          <dl>
            <div><dt>Rows</dt><dd className="tnum">{grouped(props.count)}</dd></div>
            <div><dt>Net amount</dt><dd className="tnum">{props.net}</dd></div>
            <div><dt>Date range</dt><dd className="tnum">{props.range}</dd></div>
          </dl>
          {props.accounts && props.accounts.length > 0 && (
            <>
              <p>Balances change in {grouped(props.accounts.length)} account{props.accounts.length === 1 ? "" : "s"}</p>
              <ul aria-label="Accounts whose balances change">
                {props.accounts.map((name) => (
                  <li key={name}>{name}</li>
                ))}
              </ul>
            </>
          )}
          <p>{props.undoNote}</p>
          {Object.entries(props.fields).map(([name, value]) => (
            <input key={name} type="hidden" name={name} value={value} />
          ))}
          <label htmlFor={phraseId}>
            Type <strong>{props.phrase}</strong> to confirm
          </label>
          <Input
            id={phraseId}
            name="phrase"
            autoComplete="off"
            spellCheck={false}
            value={typed}
            aria-describedby={hintId}
            aria-invalid={state?.refusal === "PHRASE" ? true : undefined}
            onChange={(event) => setTyped(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !matched) event.preventDefault();
            }}
          />
          <DialogFooter>
            <Button ref={cancelRef} type="button" variant="outline" onClick={() => props.onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="destructive" disabled={!matched || pending} loading={pending}>
              Remove {grouped(props.count)} rows
            </Button>
          </DialogFooter>
          <p id={hintId} aria-live="polite">
            {state?.refusal === "PHRASE" ? state.message : matched ? "" : "Type the phrase to enable"}
          </p>
        </form>
      )}
    </DialogContent>
  );
}

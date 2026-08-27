"use client";

import * as React from "react";
import { Scale } from "lucide-react";
import { Card, Field } from "@/ui/primitives";
import { ActionForm, SubmitButton } from "@/ui/action-form";
import type { ActionState } from "@/ui/action-state";
import { bookAdjustmentAction, reconcileAccountAction } from "../actions";

/**
 * Reconciliation, and the one thing to do about a difference.
 *
 * This control existed as a server action for the whole of Phase 2 with nothing
 * on any screen calling it. The reason it needs a client component is the
 * two-step shape: reconciling *reports* a difference and changes nothing, and
 * only once the user has seen that report does booking an adjustment make sense
 * as an offer. A single form could not do that without either hiding the report
 * or posting something nobody asked for.
 *
 * The date and closing balance are lifted into state so the second form submits
 * the same two values the first was told about, without the user retyping them.
 */
export default function ReconcilePanel({
  accountId,
  accountName,
  today,
}: {
  accountId: string;
  accountName: string;
  today: string;
}) {
  const [report, setReport] = React.useState<ActionState | null>(null);
  const [asOf, setAsOf] = React.useState(today);
  const [closing, setClosing] = React.useState("");

  const settled = report?.ok === true;
  const differs = report !== null && !report.ok && closing !== "";

  return (
    <Card
      title="Reconcile against a statement"
      subtitle="Type the closing balance your bank prints. Nothing is changed — you are told the difference, and what to do about it."
      className="mb-6"
    >
      <ActionForm
        action={reconcileAccountAction}
        fields={{ accountId }}
        quiet
        className="grid gap-4 md:grid-cols-3"
        onResult={setReport}
      >
        <>
          <Field name="asOf" label="Statement date" required>
            {(props) => (
              <input
                {...props}
                name="asOf"
                type="date"
                className="form-input"
                value={asOf}
                max={today}
                onChange={(event) => setAsOf(event.target.value)}
                required
              />
            )}
          </Field>

          <Field
            name="statementClosing"
            label="Closing balance"
            hint="As printed, without the currency symbol."
            required
          >
            {(props) => (
              <input
                {...props}
                name="statementClosing"
                className="form-input tnum"
                inputMode="decimal"
                placeholder="48250.75"
                value={closing}
                onChange={(event) => setClosing(event.target.value)}
                required
              />
            )}
          </Field>

          <div className="flex items-end">
            <SubmitButton icon={<Scale aria-hidden />} className="h-12 w-full px-4 text-xs">
              Check the difference
            </SubmitButton>
          </div>
        </>
      </ActionForm>

      {report && (
        <div
          className={
            settled
              ? "mt-4 rounded-xl border border-green-500/30 bg-green-500/5 p-4"
              : "mt-4 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4"
          }
          role="status"
        >
          <p className={settled ? "text-sm text-green-400" : "text-sm text-amber-300"}>
            {report.message}
          </p>

          {differs && (
            <div className="mt-4 border-t border-white/10 pt-4">
              <p className="mb-3 text-xs text-gray-400">
                If the statement is right and the missing movements are not worth importing, book
                the difference as an adjustment against{" "}
                <span className="text-gray-300">Equity:Opening Balances</span>. The original
                postings are left alone — the correction is a new transaction, so both stay visible.
              </p>
              <ActionForm
                action={bookAdjustmentAction}
                fields={{ accountId, asOf, statementClosing: closing }}
                confirm={{
                  title: "Book the difference?",
                  body: `A transaction is posted so ${accountName} reads ${closing} on ${asOf}. It can be reversed later, but not un-posted.`,
                  confirmLabel: "Book the adjustment",
                }}
                onResult={(state) => {
                  if (state.ok) setReport(null);
                }}
              >
                <SubmitButton icon={<Scale aria-hidden />} className="h-10 px-4 text-xs">
                  Book the difference as an adjustment
                </SubmitButton>
              </ActionForm>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

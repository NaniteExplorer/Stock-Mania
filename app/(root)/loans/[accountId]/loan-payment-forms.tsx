"use client";

import * as React from "react";
import { Field } from "@/ui/primitives";
import { recordInstalmentAction, recordPrepaymentAction, type LoanActionState } from "../actions";

export interface PayFromOption {
  id: string;
  label: string;
}

/**
 * Two forms: an instalment and a lump sum.
 *
 * The prepayment form makes the borrower choose what the money shortens, because
 * the lender does and the two answers differ: reducing the term saves more
 * interest, reducing the instalment eases monthly cashflow. Defaulting it would
 * quietly pick one and then show a schedule the lender does not agree with.
 */
export default function LoanPaymentForms({
  loanAccountId,
  accounts,
  defaultPeriod,
  defaultDate,
}: {
  loanAccountId: string;
  accounts: readonly PayFromOption[];
  defaultPeriod: number;
  defaultDate: string;
}) {
  const [emiState, emiAction, payingEmi] = React.useActionState<LoanActionState | null, FormData>(
    recordInstalmentAction,
    null,
  );
  const [prepayState, prepayAction, prepaying] = React.useActionState<LoanActionState | null, FormData>(
    recordPrepaymentAction,
    null,
  );

  return (
    <div className="space-y-6">
      <form action={emiAction} className="grid gap-4 md:grid-cols-4">
        <input type="hidden" name="loanAccountId" value={loanAccountId} />

        <Field name="fromAccountId" label="Paid from" required>
          {(props) => (
            <select {...props} name="fromAccountId" className="form-input" required defaultValue="">
              <option value="" disabled>
                Choose an account
              </option>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.label}
                </option>
              ))}
            </select>
          )}
        </Field>

        <Field name="period" label="Instalment number" hint="The split comes from the schedule.">
          {(props) => (
            <input
              {...props}
              name="period"
              className="form-input tnum"
              inputMode="numeric"
              defaultValue={defaultPeriod}
            />
          )}
        </Field>

        <Field name="paidOn" label="Paid on" hint="Defaults to the scheduled date.">
          {(props) => <input {...props} name="paidOn" type="date" className="form-input" />}
        </Field>

        <div className="flex items-end">
          <button type="submit" className="btn-glow" disabled={payingEmi || accounts.length === 0}>
            {payingEmi ? "Recording…" : "Record instalment"}
          </button>
        </div>

        {emiState && (
          <p
            className={emiState.ok ? "md:col-span-4 text-sm text-green-500" : "md:col-span-4 text-sm text-red-500"}
            role="status"
          >
            {emiState.message}
          </p>
        )}
      </form>

      <form action={prepayAction} className="grid gap-4 border-t border-gray-600 pt-5 md:grid-cols-4">
        <input type="hidden" name="loanAccountId" value={loanAccountId} />

        <Field name="fromAccountId" label="Prepay from" required>
          {(props) => (
            <select {...props} name="fromAccountId" className="form-input" required defaultValue="">
              <option value="" disabled>
                Choose an account
              </option>
              {accounts.map((account) => (
                <option key={`prepay-${account.id}`} value={account.id}>
                  {account.label}
                </option>
              ))}
            </select>
          )}
        </Field>

        <Field name="amount" label="Lump sum" required>
          {(props) => (
            <input {...props} name="amount" className="form-input tnum" inputMode="decimal" placeholder="500000.00" required />
          )}
        </Field>

        <Field name="paidOn" label="Paid on" required>
          {(props) => (
            <input {...props} name="paidOn" type="date" className="form-input" defaultValue={defaultDate} required />
          )}
        </Field>

        <Field name="reduces" label="Shortens" hint="The lender makes you choose; so does this.">
          {(props) => (
            <select {...props} name="reduces" className="form-input" defaultValue="TERM">
              <option value="TERM">The term — saves more interest</option>
              <option value="INSTALMENT">The instalment — eases cashflow</option>
            </select>
          )}
        </Field>

        <div className="md:col-span-4 flex flex-wrap items-center gap-3">
          <button type="submit" className="ghost-btn h-10 px-4 text-xs" disabled={prepaying}>
            {prepaying ? "Recording…" : "Record prepayment"}
          </button>
          {prepayState && (
            <p className={prepayState.ok ? "text-sm text-green-500" : "text-sm text-red-500"} role="status">
              {prepayState.message}
            </p>
          )}
        </div>
      </form>
    </div>
  );
}

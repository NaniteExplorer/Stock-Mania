"use client";

import * as React from "react";
import { Field } from "@/ui/primitives";
import { accrueChargesAction, payCardAction, type CardActionState } from "../actions";

export interface PayFromOption {
  id: string;
  label: string;
}

/**
 * Pay the card, and post a closed cycle's interest.
 *
 * Two forms rather than one, because they are two different decisions: paying is
 * the user's, and charging interest is the issuer's — which the app *reproduces*
 * from the postings rather than accepting from a statement. If the issuer billed
 * something else, that is a discrepancy worth seeing, and it only exists as a
 * question because this figure is computed independently.
 */
export default function PayCardForm({
  cardAccountId,
  accounts,
  suggestedAmount,
  defaultDate,
}: {
  cardAccountId: string;
  accounts: readonly PayFromOption[];
  suggestedAmount: string;
  defaultDate: string;
}) {
  const [payState, payAction, paying] = React.useActionState<CardActionState | null, FormData>(
    payCardAction,
    null,
  );
  const [chargeState, chargeAction, charging] = React.useActionState<CardActionState | null, FormData>(
    accrueChargesAction,
    null,
  );

  return (
    <div className="space-y-6">
      <form action={payAction} className="grid gap-4 md:grid-cols-2">
        <input type="hidden" name="cardAccountId" value={cardAccountId} />

        <Field name="fromAccountId" label="Pay from" required>
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

        <Field name="amount" label="Amount" required hint="Defaults to the last statement's total.">
          {(props) => (
            <input
              {...props}
              name="amount"
              className="form-input tnum"
              inputMode="decimal"
              defaultValue={suggestedAmount}
              required
            />
          )}
        </Field>

        <Field name="postedOn" label="Paid on" required>
          {(props) => (
            <input {...props} name="postedOn" type="date" className="form-input" defaultValue={defaultDate} required />
          )}
        </Field>

        <div className="flex items-end gap-3">
          <button type="submit" className="btn-glow" disabled={paying || accounts.length === 0}>
            {paying ? "Recording…" : "Record payment"}
          </button>
        </div>

        {payState && (
          <p
            className={payState.ok ? "md:col-span-2 text-sm text-green-500" : "md:col-span-2 text-sm text-red-500"}
            role="status"
          >
            {payState.message}
          </p>
        )}
      </form>

      <form action={chargeAction} className="grid gap-4 border-t border-gray-600 pt-5 md:grid-cols-2">
        <input type="hidden" name="cardAccountId" value={cardAccountId} />

        <Field
          name="statementDate"
          label="Charge interest for the cycle ending"
          hint="Computed per day from the previous due date, on what the postings say was owed."
        >
          {(props) => (
            <input {...props} name="statementDate" type="date" className="form-input" defaultValue={defaultDate} />
          )}
        </Field>

        <div className="space-y-2">
          <label className="flex items-center gap-2 text-sm text-gray-300">
            <input type="checkbox" name="lateFee" className="h-4 w-4 rounded border-gray-600 bg-gray-800" />
            Also charge the late fee
          </label>
          <label className="flex items-center gap-2 text-sm text-gray-300">
            <input type="checkbox" name="annualFee" className="h-4 w-4 rounded border-gray-600 bg-gray-800" />
            Also charge the annual fee
          </label>
        </div>

        <div className="md:col-span-2 flex flex-wrap items-center gap-3">
          <button type="submit" className="ghost-btn h-10 px-4 text-xs" disabled={charging}>
            {charging ? "Charging…" : "Post interest and fees"}
          </button>
          {chargeState && (
            <p className={chargeState.ok ? "text-sm text-green-500" : "text-sm text-red-500"} role="status">
              {chargeState.message}
            </p>
          )}
        </div>
      </form>
    </div>
  );
}

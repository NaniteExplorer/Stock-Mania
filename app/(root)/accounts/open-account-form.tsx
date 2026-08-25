"use client";

import * as React from "react";
import { Field } from "@/ui/primitives";
import { ProviderPicker } from "@/ui/provider-picker";
import { openCashAccountAction, type ActionState } from "./actions";

/**
 * The open-an-account form.
 *
 * A client component only because it needs `useActionState` to show the result.
 * Every field is a plain `<input name>`; the amount is submitted as text and
 * parsed by `Money.fromRupees` on the server, so no float exists at any point.
 */
export default function OpenAccountForm() {
  const [state, action, pending] = React.useActionState<ActionState | null, FormData>(
    openCashAccountAction,
    null,
  );
  const errors = state?.fieldErrors ?? {};

  return (
    <form action={action} className="grid gap-4 md:grid-cols-2">
      <Field name="name" label="Account name" required error={errors.name?.[0]}>
        {(props) => (
          <input {...props} name="name" className="form-input" placeholder="HDFC Savings" required />
        )}
      </Field>

      <Field name="subtype" label="Kind" required error={errors.subtype?.[0]}>
        {(props) => (
          <select {...props} name="subtype" className="form-input" defaultValue="BANK">
            <option value="BANK">Bank account</option>
            <option value="SAVINGS">Savings account</option>
            <option value="WALLET">Wallet (Paytm, PhonePe)</option>
            <option value="CASH">Cash in hand</option>
          </select>
        )}
      </Field>

      <Field name="institution" label="Bank or provider" error={errors.institution?.[0]}>
        {(props) => <ProviderPicker {...props} name="institution" kinds={["BANK", "WALLET"]} placeholder="HDFC Bank" />}
      </Field>

      <Field
        name="accountNumberSuffix"
        label="Last four digits"
        hint="Only the last four are ever stored."
        error={errors.accountNumberSuffix?.[0]}
      >
        {(props) => (
          <input {...props} name="accountNumberSuffix" className="form-input" inputMode="numeric" maxLength={4} />
        )}
      </Field>

      <Field
        name="openingBalance"
        label="Balance today"
        hint="Booked against Equity:Opening Balances, so the ledger balances from day one."
        error={errors.openingBalance?.[0]}
      >
        {(props) => (
          <input {...props} name="openingBalance" className="form-input tnum" inputMode="decimal" placeholder="200000.00" />
        )}
      </Field>

      <Field name="openingBalanceOn" label="As on" error={errors.openingBalanceOn?.[0]}>
        {(props) => <input {...props} name="openingBalanceOn" type="date" className="form-input" />}
      </Field>

      <div className="md:col-span-2 flex flex-wrap items-center gap-3">
        <button type="submit" className="btn-glow" disabled={pending}>
          {pending ? "Opening…" : "Open account"}
        </button>
        {state && (
          <p className={state.ok ? "text-sm text-green-500" : "text-sm text-red-500"} role="status">
            {state.message}
          </p>
        )}
      </div>
    </form>
  );
}

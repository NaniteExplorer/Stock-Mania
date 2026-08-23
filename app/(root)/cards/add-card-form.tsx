"use client";

import * as React from "react";
import { Field } from "@/ui/primitives";
import { openCardAction, type CardActionState } from "./actions";

/**
 * Add a card, with its terms.
 *
 * The defaults are the common Indian ones — 18th statement date, 20-day grace,
 * 42% p.a., 5% minimum with a ₹500 floor, 18% GST — so the form is usable without
 * hunting through a cardholder agreement, and each is editable because none of
 * them is universal.
 */
export default function AddCardForm() {
  const [state, action, pending] = React.useActionState<CardActionState | null, FormData>(
    openCardAction,
    null,
  );
  const errors = state?.fieldErrors ?? {};

  return (
    <form action={action} className="grid gap-4 md:grid-cols-3">
      <Field name="name" label="Card name" required error={errors.name?.[0]}>
        {(props) => <input {...props} name="name" className="form-input" placeholder="HDFC Regalia" required />}
      </Field>

      <Field name="institution" label="Issuer" error={errors.institution?.[0]}>
        {(props) => <input {...props} name="institution" className="form-input" placeholder="HDFC Bank" />}
      </Field>

      <Field
        name="accountNumberSuffix"
        label="Last four digits"
        error={errors.accountNumberSuffix?.[0]}
      >
        {(props) => (
          <input {...props} name="accountNumberSuffix" className="form-input" inputMode="numeric" maxLength={4} />
        )}
      </Field>

      <Field name="creditLimit" label="Credit limit" required error={errors.creditLimit?.[0]}>
        {(props) => (
          <input {...props} name="creditLimit" className="form-input tnum" inputMode="decimal" defaultValue="200000.00" required />
        )}
      </Field>

      <Field
        name="statementDay"
        label="Statement day"
        hint="Clamped in short months — a 31st becomes the 28th in February."
        error={errors.statementDay?.[0]}
      >
        {(props) => (
          <input {...props} name="statementDay" className="form-input tnum" inputMode="numeric" defaultValue={18} />
        )}
      </Field>

      <Field name="graceDays" label="Days to pay" error={errors.graceDays?.[0]}>
        {(props) => (
          <input {...props} name="graceDays" className="form-input tnum" inputMode="numeric" defaultValue={20} />
        )}
      </Field>

      <Field
        name="financeRate"
        label="Finance rate (% p.a.)"
        hint="Applied per day from the due date, ACT/365F."
        error={errors.financeRate?.[0]}
      >
        {(props) => (
          <input {...props} name="financeRate" className="form-input tnum" inputMode="decimal" defaultValue="42" />
        )}
      </Field>

      <Field name="minimumDuePercent" label="Minimum due (%)" error={errors.minimumDuePercent?.[0]}>
        {(props) => (
          <input {...props} name="minimumDuePercent" className="form-input tnum" inputMode="decimal" defaultValue="5" />
        )}
      </Field>

      <Field name="minimumDueFloor" label="Minimum due floor" error={errors.minimumDueFloor?.[0]}>
        {(props) => (
          <input {...props} name="minimumDueFloor" className="form-input tnum" inputMode="decimal" defaultValue="500.00" />
        )}
      </Field>

      <Field name="lateFee" label="Late fee" error={errors.lateFee?.[0]}>
        {(props) => (
          <input {...props} name="lateFee" className="form-input tnum" inputMode="decimal" defaultValue="500.00" />
        )}
      </Field>

      <Field name="annualFee" label="Annual fee" error={errors.annualFee?.[0]}>
        {(props) => (
          <input {...props} name="annualFee" className="form-input tnum" inputMode="decimal" defaultValue="0.00" />
        )}
      </Field>

      <Field name="gstOnCharges" label="GST on charges (%)" error={errors.gstOnCharges?.[0]}>
        {(props) => (
          <input {...props} name="gstOnCharges" className="form-input tnum" inputMode="decimal" defaultValue="18" />
        )}
      </Field>

      <Field
        name="pointsPerHundred"
        label="Points per ₹100"
        hint="Tracked as a quantity, valued only when you redeem them."
        error={errors.pointsPerHundred?.[0]}
      >
        {(props) => (
          <input {...props} name="pointsPerHundred" className="form-input tnum" inputMode="decimal" defaultValue="0" />
        )}
      </Field>

      <Field
        name="openingBalance"
        label="Owed today"
        hint="As a positive amount — it is a debt."
        error={errors.openingBalance?.[0]}
      >
        {(props) => (
          <input {...props} name="openingBalance" className="form-input tnum" inputMode="decimal" placeholder="18240.00" />
        )}
      </Field>

      <Field name="openingBalanceOn" label="As on" error={errors.openingBalanceOn?.[0]}>
        {(props) => <input {...props} name="openingBalanceOn" type="date" className="form-input" />}
      </Field>

      <div className="md:col-span-3 flex flex-wrap items-center gap-3">
        <button type="submit" className="btn-glow" disabled={pending}>
          {pending ? "Adding…" : "Add card"}
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

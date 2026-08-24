"use client";

import * as React from "react";
import { Field } from "@/ui/primitives";
import { addInstrumentAction, type InvestingActionState } from "./actions";

/**
 * Add an instrument.
 *
 * The kind list is the thirteen leaves rather than a generic "stock / fund /
 * other", because the choice decides how the holding is taxed and whether it can
 * be sold at all: a liquid fund is slab-taxed at any holding period, an ELSS is
 * locked for three years, and an SGB is exempt at maturity. Asking once, here, is
 * what lets every later screen answer without guessing.
 */
export default function AddInstrumentForm() {
  const [state, action, pending] = React.useActionState<InvestingActionState | null, FormData>(
    addInstrumentAction,
    null,
  );
  const errors = state?.fieldErrors ?? {};

  return (
    <form action={action} className="grid gap-4 md:grid-cols-3">
      <Field name="symbol" label="Symbol" required error={errors.symbol?.[0]}>
        {(props) => <input {...props} name="symbol" className="form-input" placeholder="INFY" required />}
      </Field>

      <Field name="name" label="Name" required error={errors.name?.[0]}>
        {(props) => <input {...props} name="name" className="form-input" placeholder="Infosys Ltd" required />}
      </Field>

      <Field name="kind" label="Kind" required error={errors.kind?.[0]}>
        {(props) => (
          <select {...props} name="kind" className="form-input" defaultValue="LISTED_EQUITY">
            <option value="LISTED_EQUITY">Listed equity</option>
            <option value="ETF">ETF</option>
            <option value="INDEX_FUND">Index fund</option>
            <option value="MUTUAL_FUND">Mutual fund (equity)</option>
            <option value="ELSS_FUND">ELSS (3-year lock)</option>
            <option value="LIQUID_FUND">Liquid fund (slab-taxed)</option>
            <option value="DEBT_FUND">Debt fund (slab-taxed)</option>
            <option value="BOND">Bond</option>
            <option value="GOVT_SECURITY">Government security</option>
            <option value="SOVEREIGN_GOLD_BOND">Sovereign gold bond</option>
            <option value="DIGITAL_GOLD">Digital gold (grams)</option>
            <option value="DIGITAL_SILVER">Digital silver (grams)</option>
            <option value="CRYPTO">Crypto (VDA)</option>
          </select>
        )}
      </Field>

      <Field name="isin" label="ISIN" error={errors.isin?.[0]}>
        {(props) => <input {...props} name="isin" className="form-input" maxLength={12} placeholder="INE009A01021" />}
      </Field>

      <Field name="exchange" label="Exchange" error={errors.exchange?.[0]}>
        {(props) => <input {...props} name="exchange" className="form-input" placeholder="NSE" />}
      </Field>

      <Field
        name="quoteRef"
        label="Price source code"
        hint="An AMFI scheme code is not an NSE ticker — leave blank to use the symbol."
        error={errors.quoteRef?.[0]}
      >
        {(props) => <input {...props} name="quoteRef" className="form-input" placeholder="120503" />}
      </Field>

      <div className="md:col-span-3 flex flex-wrap items-center gap-3">
        <button type="submit" className="btn-glow" disabled={pending}>
          {pending ? "Adding…" : "Add instrument"}
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

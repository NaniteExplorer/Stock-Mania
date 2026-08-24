"use client";

import * as React from "react";
import { Field } from "@/ui/primitives";
import { addInstrumentAction, type InvestingActionState } from "./actions";

/**
 * Add an instrument.
 *
 * The kind list is the fifteen leaves rather than a generic "stock / fund /
 * other", because the choice decides how the holding is taxed and whether it can
 * be sold at all: a liquid fund is slab-taxed at any holding period, an ELSS is
 * locked for three years, an SGB is exempt at maturity, and F&O is not a capital
 * gain at all. Asking once, here, is what lets every later screen answer without
 * guessing.
 *
 * Some leaves carry facts of their own — an option's strike and expiry, what an
 * ETF holds — and those fields appear only for the kind that needs them. They are
 * not cosmetic: an option with no strike is refused by its own constructor,
 * because a half-specified derivative is not a derivative.
 */
export default function AddInstrumentForm() {
  const [state, action, pending] = React.useActionState<InvestingActionState | null, FormData>(
    addInstrumentAction,
    null,
  );
  const errors = state?.fieldErrors ?? {};
  const [kind, setKind] = React.useState("LISTED_EQUITY");
  const isOption = kind === "OPTION";
  const isFuture = kind === "FUTURE";
  const isContract = isOption || isFuture;

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
          <select
            {...props}
            name="kind"
            className="form-input"
            value={kind}
            onChange={(event) => setKind(event.target.value)}
          >
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
            <option value="OPTION">Option (F&amp;O — business income)</option>
            <option value="FUTURE">Future (F&amp;O — business income)</option>
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

      {kind === "ETF" && (
        <Field
          name="underlying"
          label="What the ETF holds"
          hint="Gold ETFs changed tax class in the 2023 budget, so this is not cosmetic."
          error={errors.underlying?.[0]}
        >
          {(props) => (
            <select {...props} name="underlying" className="form-input" defaultValue="EQUITY">
              <option value="EQUITY">Equity</option>
              <option value="DEBT">Debt (slab-taxed)</option>
              <option value="GOLD">Gold</option>
            </select>
          )}
        </Field>
      )}

      {kind === "DEBT_FUND" && (
        <label className="flex items-center gap-2 text-sm text-gray-300 md:col-span-3">
          <input type="checkbox" name="legacyUnits" className="h-4 w-4" />
          These units were bought before 1 April 2023 (they keep indexation and the 20% long-term rate)
        </label>
      )}

      {isContract && (
        <>
          <Field
            name="underlyingSymbol"
            label="Underlying"
            required
            hint="The index or share the contract is on."
            error={errors.underlyingSymbol?.[0]}
          >
            {(props) => (
              <input {...props} name="underlyingSymbol" className="form-input" placeholder="NIFTY" required />
            )}
          </Field>

          <Field name="expiry" label="Expiry" required error={errors.expiry?.[0]}>
            {(props) => <input {...props} name="expiry" type="date" className="form-input" required />}
          </Field>

          <Field
            name="lotSize"
            label="Lot size"
            required
            hint="Units of the underlying per lot. A quantity of 1 is one lot, not one share."
            error={errors.lotSize?.[0]}
          >
            {(props) => (
              <input
                {...props}
                name="lotSize"
                className="form-input tnum"
                inputMode="numeric"
                placeholder="75"
                required
              />
            )}
          </Field>
        </>
      )}

      {isOption && (
        <>
          <Field name="right" label="Call or put" required error={errors.right?.[0]}>
            {(props) => (
              <select {...props} name="right" className="form-input" defaultValue="CALL">
                <option value="CALL">Call</option>
                <option value="PUT">Put</option>
              </select>
            )}
          </Field>

          <Field name="strike" label="Strike" required error={errors.strike?.[0]}>
            {(props) => (
              <input
                {...props}
                name="strike"
                className="form-input tnum"
                inputMode="decimal"
                placeholder="24000.00"
                required
              />
            )}
          </Field>
        </>
      )}

      {isFuture && (
        <Field
          name="contractMonth"
          label="Contract month"
          hint="Which monthly series, for rolling a position. Taken from the expiry when blank."
          error={errors.contractMonth?.[0]}
        >
          {(props) => (
            <input {...props} name="contractMonth" className="form-input tnum" placeholder="2026-09" />
          )}
        </Field>
      )}

      {isContract && (
        <p className="md:col-span-3 text-xs text-amber-500">
          F&amp;O is taxed as non-speculative business income at your slab rate, and its
          losses cannot be set off against capital gains. Set your marginal rate on
          Settings, or the report assumes the top slab.
        </p>
      )}

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

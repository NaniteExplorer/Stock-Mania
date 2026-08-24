"use client";

import * as React from "react";
import { Field } from "@/ui/primitives";
import { saveTaxSettingsAction, type SettingsActionState } from "./actions";

export interface TaxSettingsFormProps {
  financialYear: string;
  marginalSlabPercent: string;
  ltcgExemption: string;
  regimeKey: string;
  usesNewRegime: boolean;
  /** True when nothing is stored yet, so the fields shown are assumptions. */
  isAssumed: boolean;
}

/**
 * The tax settings the report cannot derive.
 *
 * Three of the four are facts about the person rather than about their money —
 * the marginal slab rate, whether they opted into the concessional regime, and
 * which year this applies to — and none of them is derivable from a ledger. Until
 * this form existed the history screen ran every assessment at the top slab and
 * said so; that was honest and expensive, because 30% on interest income is wrong
 * for most people by a factor of two or more.
 *
 * Per financial year, deliberately. Changing this year's slab rate must not
 * change what last year's return said.
 */
export default function TaxSettingsForm(props: TaxSettingsFormProps) {
  const [state, action, pending] = React.useActionState<SettingsActionState | null, FormData>(
    saveTaxSettingsAction,
    null,
  );
  const errors = state?.fieldErrors ?? {};

  return (
    <form action={action} className="mt-4 grid gap-4 md:grid-cols-2">
      <Field
        name="financialYear"
        label="Financial year"
        hint="Settings are stored per year, so a reprinted return keeps its own rate."
        required
        error={errors.financialYear?.[0]}
      >
        {(fieldProps) => (
          <input
            {...fieldProps}
            name="financialYear"
            className="form-input tnum"
            defaultValue={props.financialYear}
            required
          />
        )}
      </Field>

      <Field
        name="marginalSlabPercent"
        label="Marginal slab rate (%)"
        hint="Applied to interest, dividends and F&O business income."
        required
        error={errors.marginalSlabPercent?.[0]}
      >
        {(fieldProps) => (
          <input
            {...fieldProps}
            name="marginalSlabPercent"
            className="form-input tnum"
            inputMode="decimal"
            defaultValue={props.marginalSlabPercent}
            required
          />
        )}
      </Field>

      <Field
        name="ltcgExemption"
        label="Annual LTCG exemption"
        hint="₹1,25,000 under the FY2025-26 rules. Stored so a budget change is a data edit."
        required
        error={errors.ltcgExemption?.[0]}
      >
        {(fieldProps) => (
          <input
            {...fieldProps}
            name="ltcgExemption"
            className="form-input tnum"
            inputMode="decimal"
            defaultValue={props.ltcgExemption}
            required
          />
        )}
      </Field>

      <Field name="regimeKey" label="Statutory regime" error={errors.regimeKey?.[0]}>
        {(fieldProps) => (
          <select {...fieldProps} name="regimeKey" className="form-input" defaultValue={props.regimeKey}>
            <option value="india-fy2025">India — from 23 July 2024</option>
            <option value="india-fy2024">India — to 22 July 2024</option>
          </select>
        )}
      </Field>

      <label className="flex items-center gap-2 text-sm text-gray-300 md:col-span-2">
        <input
          type="checkbox"
          name="usesNewRegime"
          defaultChecked={props.usesNewRegime}
          className="h-4 w-4"
        />
        I have opted into the new (concessional) income-tax regime
      </label>

      <div className="flex flex-wrap items-center gap-3 md:col-span-2">
        <button type="submit" className="btn-glow" disabled={pending}>
          {pending ? "Saving…" : "Save tax settings"}
        </button>
        {props.isAssumed && !state?.ok && (
          <p className="text-xs text-amber-500" role="status">
            Nothing is stored for this year yet, so the tax panel runs at the top slab — a ceiling
            rather than an estimate.
          </p>
        )}
        {state && (
          <p className={state.ok ? "text-sm text-green-500" : "text-sm text-red-500"} role="status">
            {state.message}
          </p>
        )}
      </div>
    </form>
  );
}

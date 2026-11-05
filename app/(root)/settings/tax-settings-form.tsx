"use client";

import * as React from "react";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
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
          <Input
            {...fieldProps}
            name="financialYear"
            className="tabular-nums"
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
          <Input
            {...fieldProps}
            name="marginalSlabPercent"
            className="tabular-nums"
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
          <Input
            {...fieldProps}
            name="ltcgExemption"
            className="tabular-nums"
            inputMode="decimal"
            defaultValue={props.ltcgExemption}
            required
          />
        )}
      </Field>

      <Field name="regimeKey" label="Statutory regime" error={errors.regimeKey?.[0]}>
        {(fieldProps) => (
          <NativeSelect {...fieldProps} name="regimeKey" defaultValue={props.regimeKey}>
            <option value="india-fy2025">India — from 23 July 2024</option>
            <option value="india-fy2024">India — to 22 July 2024</option>
          </NativeSelect>
        )}
      </Field>

      <div className="md:col-span-2">
        <Checkbox
          name="usesNewRegime"
          defaultChecked={props.usesNewRegime}
          label="I have opted into the new (concessional) income-tax regime"
        />
      </div>

      <div className="flex flex-wrap items-center gap-3 md:col-span-2">
        <Button type="submit" loading={pending} disabled={pending}>Save tax settings</Button>
        {props.isAssumed && !state?.ok && (
          <p className="text-xs text-(--warn)" role="status">
            Nothing is stored for this year yet, so the tax panel runs at the top slab — a ceiling
            rather than an estimate.
          </p>
        )}
        {state && (
          <p className={state.ok ? "text-sm text-(--gain)" : "text-sm text-(--loss)"} role="status">
            {state.message}
          </p>
        )}
      </div>
    </form>
  );
}

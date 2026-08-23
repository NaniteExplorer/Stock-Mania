"use client";

import * as React from "react";
import { Field } from "@/ui/primitives";
import { setBudgetAction, type BudgetActionState } from "./actions";

export interface CategoryOption {
  id: string;
  label: string;
}

export default function BudgetForm({
  categories,
  defaultMonth,
}: {
  categories: readonly CategoryOption[];
  defaultMonth: string;
}) {
  const [state, action, pending] = React.useActionState<BudgetActionState | null, FormData>(
    setBudgetAction,
    null,
  );

  return (
    <form action={action} className="grid gap-4 md:grid-cols-2">
      <Field name="accountId" label="Category" required>
        {(props) => (
          <select {...props} name="accountId" className="form-input" required defaultValue="">
            <option value="" disabled>
              Choose a category
            </option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.label}
              </option>
            ))}
          </select>
        )}
      </Field>

      <Field name="limit" label="Monthly limit" required>
        {(props) => (
          <input {...props} name="limit" className="form-input tnum" inputMode="decimal" placeholder="10000.00" required />
        )}
      </Field>

      <Field
        name="month"
        label="Month"
        hint={`Blank for a recurring limit; ${defaultMonth} to override just this month.`}
      >
        {(props) => <input {...props} name="month" className="form-input" placeholder={defaultMonth} />}
      </Field>

      <Field name="warnAtPercent" label="Warn at (%)">
        {(props) => (
          <input
            {...props}
            name="warnAtPercent"
            className="form-input tnum"
            inputMode="numeric"
            defaultValue={80}
          />
        )}
      </Field>

      <label className="flex items-center gap-2 text-sm text-gray-300 md:col-span-2">
        <input type="checkbox" name="carryover" className="h-4 w-4 rounded border-gray-600 bg-gray-800" />
        Carry the leftover — and any overspend — into next month
      </label>

      <div className="md:col-span-2 flex flex-wrap items-center gap-3">
        <button type="submit" className="btn-glow" disabled={pending}>
          {pending ? "Saving…" : "Set budget"}
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

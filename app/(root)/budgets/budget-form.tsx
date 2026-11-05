"use client";

import * as React from "react";
import { Field } from "@/components/ui/field";
import { setBudgetAction, type BudgetActionState } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";

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
          <NativeSelect {...props} name="accountId" required defaultValue="">
            <option value="" disabled>
              Choose a category
            </option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.label}
              </option>
            ))}
          </NativeSelect>
        )}
      </Field>

      <Field name="limit" label="Monthly limit" required>
        {(props) => (
          <Input {...props} name="limit" className="tabular-nums" inputMode="decimal" placeholder="10000.00" required />
        )}
      </Field>

      <Field
        name="month"
        label="Month"
        hint={`Blank for a recurring limit; ${defaultMonth} to override just this month.`}
      >
        {(props) => <Input {...props} name="month" placeholder={defaultMonth} />}
      </Field>

      <Field name="warnAtPercent" label="Warn at (%)">
        {(props) => (
          <Input
            {...props}
            name="warnAtPercent"
            className="tabular-nums"
            inputMode="numeric"
            defaultValue={80}
          />
        )}
      </Field>

      <label className="flex items-center gap-2 text-sm text-(--fg-secondary) md:col-span-2">
        <input type="checkbox" name="carryover" className="h-4 w-4 rounded border-(--border) bg-(--bg-surface)" />
        Carry the leftover — and any overspend — into next month
      </label>

      <div className="md:col-span-2 flex flex-wrap items-center gap-3">
        <Button type="submit" loading={pending} disabled={pending}>
          {pending ? "Saving…" : "Set budget"}
        </Button>
        {state && (
          <p className={state.ok ? "text-sm text-(--gain)" : "text-sm text-(--loss)"} role="status">
            {state.message}
          </p>
        )}
      </div>
    </form>
  );
}

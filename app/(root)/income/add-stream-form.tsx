"use client";

import * as React from "react";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Button } from "@/components/ui/button";
import { createIncomeStreamAction } from "./actions";
import type { ActionState } from "@/ui/action-state";
import styles from "./income.module.css";

/** Client only for useActionState; every field posts as plain text. */
export default function AddStreamForm() {
  const [state, action, pending] = React.useActionState<ActionState | null, FormData>(createIncomeStreamAction, null);
  const errors = state?.fieldErrors ?? {};
  return <form action={action} className={styles.form}>
    <Field name="name" label="Name" required error={errors.name?.[0]}>{(p) => <Input {...p} name="name" placeholder="Salary" required />}</Field>
    <Field name="kind" label="Kind" required error={errors.kind?.[0]}>{(p) => <NativeSelect {...p} name="kind" defaultValue="SALARY">
      <option value="SALARY">Salary</option><option value="FREELANCE">Freelance</option><option value="BONUS">Bonus</option>
      <option value="RENT">Rent received</option><option value="INTEREST">Interest</option><option value="OTHER">Other</option>
    </NativeSelect>}</Field>
    <Field name="payer" label="Payer" hint="Employer, tenant or client." error={errors.payer?.[0]}>{(p) => <Input {...p} name="payer" />}</Field>
    <Field name="currency" label="Currency" required error={errors.currency?.[0]}>{(p) => <NativeSelect {...p} name="currency" defaultValue="INR">
      <option value="INR">INR — Indian rupee</option><option value="USD">USD — US dollar</option>
    </NativeSelect>}</Field>
    <Field name="cadence" label="Paid" required error={errors.cadence?.[0]}>{(p) => <NativeSelect {...p} name="cadence" defaultValue="MONTHLY">
      <option value="MONTHLY">Monthly</option><option value="QUARTERLY">Quarterly</option><option value="HALF_YEARLY">Half-yearly</option><option value="ANNUAL">Annually</option>
    </NativeSelect>}</Field>
    <Field name="anchor" label="First due date" required hint="Every later date is counted from this one." error={errors.anchor?.[0]}>{(p) => <Input {...p} name="anchor" type="date" required />}</Field>
    <Field name="expected" label="Expected amount" hint="Blank means not known — shown as an em-dash, never zero." error={errors.expected?.[0]}>{(p) => <Input {...p} name="expected" inputMode="decimal" />}</Field>
    <Field name="grace" label="Grace days" required hint="Days after the due date before it counts as missing." error={errors.grace?.[0]}>{(p) => <Input {...p} name="grace" inputMode="numeric" defaultValue="5" required />}</Field>
    <div className={styles.formActions}>
      <Button type="submit" loading={pending} disabled={pending}>Add stream</Button>
      <p role="status" aria-live="polite" className={state ? (state.ok ? styles.ok : styles.error) : undefined}>{state?.message}</p>
    </div>
  </form>;
}

"use client";

import * as React from "react";
import { Input } from "../../../components/ui/input";
import { NativeSelect } from "../../../components/ui/native-select";
import { Checkbox } from "../../../components/ui/checkbox";
import { Button } from "../../../components/ui/button";
import type { ActionState } from "@/ui/action-state";
import { CADENCE_LABELS, KIND_LABELS } from "./model";
import styles from "./commitments.module.css";

type Action = (previous: ActionState | null, formData: FormData) => Promise<ActionState>;

function Field({ name, label, hint, error, children }: { name: string; label: string; hint?: string; error?: string; children: React.ReactNode }) {
  return <label className={styles.field} htmlFor={name}>
    <span>{label}</span>
    {children}
    {error ? <span id={`${name}-error`} className={styles.error}>{error}</span> : hint ? <span id={`${name}-hint`} className={styles.hint}>{hint}</span> : null}
  </label>;
}

/** The action is passed in by the page, so this form renders in tests without the container. */
export default function AddCommitmentForm({ action }: { action: Action }) {
  const [state, formAction, pending] = React.useActionState<ActionState | null, FormData>(action, null);
  const errors = state?.fieldErrors ?? {};
  const aria = (name: string, hint?: boolean) => ({
    id: name, name, "aria-invalid": errors[name] ? true : undefined,
    "aria-describedby": errors[name] ? `${name}-error` : hint ? `${name}-hint` : undefined,
  });

  return <form action={formAction} className={styles.form} id="add-commitment">
    <Field name="name" label="Name" error={errors.name?.[0]}><Input {...aria("name")} required placeholder="Netflix" /></Field>
    <Field name="kind" label="Kind" error={errors.kind?.[0]}>
      <NativeSelect {...aria("kind")} defaultValue="STREAMING">{Object.entries(KIND_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</NativeSelect>
    </Field>
    <Field name="cadence" label="Cadence" error={errors.cadence?.[0]}>
      <NativeSelect {...aria("cadence")} defaultValue="MONTHLY">{Object.entries(CADENCE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</NativeSelect>
    </Field>
    <Field name="startsOn" label="First charge on" error={errors.startsOn?.[0]}><Input {...aria("startsOn")} type="date" required /></Field>
    <Field name="price" label="Price per charge (₹)" hint="Leave blank if not known; it shows as not entered, never ₹0." error={errors.price?.[0]}>
      <Input {...aria("price", true)} inputMode="decimal" placeholder="649.00" />
    </Field>
    <Field name="cancelNoticeDays" label="Notice to cancel (days)" hint="Leave blank if not known." error={errors.cancelNoticeDays?.[0]}>
      <Input {...aria("cancelNoticeDays", true)} inputMode="numeric" />
    </Field>
    <Field name="endsOn" label="Last day it runs" hint="Only for a fixed term or one already cancelled." error={errors.endsOn?.[0]}>
      <Input {...aria("endsOn", true)} type="date" />
    </Field>
    <Checkbox name="autoRenews" label="Auto-renews" description="Charges again without you doing anything." defaultChecked />
    <div className={styles.footer}>
      <Button type="submit" loading={pending}>Add commitment</Button>
      <p role="status" aria-live="polite" className={state && !state.ok ? styles.error : styles.hint}>{state?.message ?? ""}</p>
    </div>
  </form>;
}

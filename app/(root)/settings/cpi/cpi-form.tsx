"use client";

import * as React from "react";
import { Input } from "../../../../components/ui/input";
import { Button } from "../../../../components/ui/button";
import type { ActionState } from "@/ui/action-state";
import { baseFor, type CpiEditValues } from "./cpi-model";
import styles from "./cpi.module.css";

type Action = (previous: ActionState | null, formData: FormData) => Promise<ActionState>;

function Field({ name, label, hint, error, children }: { name: string; label: string; hint?: string; error?: string; children: React.ReactNode }) {
  return <label className={styles.field} htmlFor={name}>
    <span>{label}</span>
    {children}
    {error ? <span id={`${name}-error`} className={styles.error}>{error}</span> : hint ? <span id={`${name}-hint`} className={styles.hint}>{hint}</span> : null}
  </label>;
}

/** Add or edit one month; recording an existing month replaces it. The action is passed in so tests need no container. */
export default function CpiForm({ action, initial }: { action: Action; initial: CpiEditValues | null }) {
  const [state, formAction, pending] = React.useActionState<ActionState | null, FormData>(action, null);
  const [month, setMonth] = React.useState(initial?.month ?? "");
  const errors = state?.fieldErrors ?? {};
  const base = baseFor(month);
  const aria = (name: string, hint?: boolean) => ({
    id: name, name, "aria-invalid": errors[name] ? true : undefined,
    "aria-describedby": errors[name] ? `${name}-error` : hint ? `${name}-hint` : undefined,
  });

  return <form action={formAction} className={styles.form} id="cpi-entry">
    <Field name="month" label="Month (yyyy-mm)" hint="Recording a month that exists replaces it." error={errors.month?.[0]}>
      <Input {...aria("month", true)} required placeholder="2026-09" inputMode="numeric"
        value={month} onChange={(event) => setMonth(event.target.value)} />
    </Field>
    <div className={styles.field}>
      <span>Base</span>
      <output htmlFor="month" aria-live="polite" className={styles.base}>{base === null ? "Set from the month" : `${base} = 100`}</output>
    </div>
    <Field name="index" label="Index" hint="As published, up to 4 decimals." error={errors.index?.[0]}>
      <Input {...aria("index", true)} required inputMode="decimal" placeholder="193.4" defaultValue={initial?.index} />
    </Field>
    <Field name="source" label="Source" error={errors.source?.[0]}>
      <Input {...aria("source")} required maxLength={200} placeholder="MoSPI press release" defaultValue={initial?.source} />
    </Field>
    <div className={styles.footer}>
      <Button type="submit" loading={pending}>{initial ? "Save changes" : "Record CPI"}</Button>
      <p role="status" aria-live="polite" className={state && !state.ok ? styles.error : styles.hint}>{state?.message ?? ""}</p>
    </div>
  </form>;
}

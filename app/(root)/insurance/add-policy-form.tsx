"use client";

import * as React from "react";
import { Input } from "../../../components/ui/input";
import { NativeSelect } from "../../../components/ui/native-select";
import { Button } from "../../../components/ui/button";
import type { ActionState } from "../../../src/ui/action-state";
import styles from "./insurance.module.css";

type Action = (previous: ActionState | null, form: FormData) => Promise<ActionState>;

/** The action arrives as a prop so this form never imports the server container. */
export default function AddPolicyForm({ action }: { action: Action }) {
  const [state, submit, pending] = React.useActionState<ActionState | null, FormData>(action, null);
  const errors = state?.fieldErrors ?? {};
  const field = (name: string, label: string, control: (props: { id: string; "aria-invalid": boolean; "aria-describedby"?: string }) => React.ReactNode, hint?: string) => {
    const error = errors[name]?.[0];
    const describedBy = error ? `${name}-error` : hint ? `${name}-hint` : undefined;
    return <div className={styles.field}>
      <label htmlFor={`policy-${name}`}>{label}</label>
      {control({ id: `policy-${name}`, "aria-invalid": Boolean(error), "aria-describedby": describedBy })}
      {error ? <span id={`${name}-error`} className={styles.error}>{error}</span> : hint ? <span id={`${name}-hint`} className={styles.muted}>{hint}</span> : null}
    </div>;
  };

  return <form action={submit} className={styles.form}>
    {field("kind", "Kind of cover", (p) => <NativeSelect {...p} name="kind" defaultValue="HEALTH" required>
      <option value="HEALTH">Health</option><option value="TERM_LIFE">Term life</option>
      <option value="PERSONAL_ACCIDENT">Personal accident</option><option value="MOTOR">Motor</option>
      <option value="HOME">Home</option><option value="OTHER">Other</option>
    </NativeSelect>)}
    {field("insurer", "Insurer", (p) => <Input {...p} name="insurer" required maxLength={120} />)}
    {field("insured", "Whom it covers", (p) => <Input {...p} name="insured" required maxLength={120} placeholder="Self + spouse" />)}
    {field("currency", "Currency", (p) => <NativeSelect {...p} name="currency" defaultValue="INR">
      <option value="INR">INR</option><option value="USD">USD</option>
    </NativeSelect>)}
    {field("sumInsured", "Sum insured", (p) => <Input {...p} name="sumInsured" inputMode="decimal" />, "Optional. Recorded, never scored.")}
    {field("premium", "Premium each time", (p) => <Input {...p} name="premium" inputMode="decimal" />, "Optional. Blank means not known.")}
    {field("cadence", "Premium due", (p) => <NativeSelect {...p} name="cadence" defaultValue="ANNUAL">
      <option value="MONTHLY">Monthly</option><option value="QUARTERLY">Quarterly</option>
      <option value="HALF_YEARLY">Half-yearly</option><option value="ANNUAL">Annually</option>
    </NativeSelect>)}
    {field("startsOn", "Cover started", (p) => <Input {...p} name="startsOn" type="date" required />, "Premiums fall due from this date.")}
    {field("cancelNoticeDays", "Notice to cancel (days)", (p) => <Input {...p} name="cancelNoticeDays" inputMode="numeric" />, "Optional. Blank means not known, not zero.")}
    {field("endsOn", "Cover ends", (p) => <Input {...p} name="endsOn" type="date" />, "Optional. Leave blank while it renews.")}
    <div className={styles.footer}>
      <Button type="submit" loading={pending} disabled={pending}>Add policy</Button>
      {state && <p role="status" className={state.ok ? undefined : styles.error}>{state.message}</p>}
    </div>
  </form>;
}

"use client";

import * as React from "react";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/ui/page-shell";
import type { ActionState } from "@/ui/action-state";
import { saveAssumptionsAction } from "./actions";

export interface AssumptionFieldView {
  readonly key: string;
  readonly label: string;
  readonly unit: string;
  /** The stored value as typed text; empty means unknown. */
  readonly text: string;
  /** Who said so: "Cited: …", "You", or empty when unknown. */
  readonly sourceNote: string;
}

export interface AssumptionsFormProps {
  readonly fields: readonly AssumptionFieldView[];
  /** The current age, derived from the date of birth, or null when none is given. */
  readonly currentAge: number | null;
  readonly npsVerifiedOn: string;
}

/** Client only for useActionState. Empty fields are saved as unknown, never as zero. */
export default function AssumptionsForm({ fields, currentAge, npsVerifiedOn }: AssumptionsFormProps) {
  const [state, action, pending] = React.useActionState<ActionState | null, FormData>(saveAssumptionsAction, null);
  const errors = state?.fieldErrors ?? {};
  return (
    <Panel title="Assumptions">
    <form action={action} aria-label="Assumptions" className="grid gap-4 md:grid-cols-2">
      <p className="text-sm text-(--fg-secondary) md:col-span-2">
        {currentAge === null
          ? "Current age is unknown: add your date of birth in Settings. It is never guessed."
          : `Current age ${currentAge}, from the date of birth in Settings.`}{" "}
        Leave a field empty when you do not know it; the projection then names it instead of assuming.
      </p>
      {fields.map((f) => (
        <Field key={f.key} name={f.key} label={`${f.label} (${f.unit})`} hint={f.sourceNote || "Unknown"} error={errors[f.key]?.[0]}>
          {(p) => <Input {...p} name={f.key} inputMode="decimal" defaultValue={f.text} />}
        </Field>
      ))}
      <Field name="npsVerifiedOn" label="NPS shares verified on" hint="The day you checked both shares against the current PFRDA text. An edit is not a verification." error={errors.npsVerifiedOn?.[0]}>
        {(p) => <Input {...p} name="npsVerifiedOn" type="date" defaultValue={npsVerifiedOn} />}
      </Field>
      <div className="flex items-center gap-3 md:col-span-2">
        <Button type="submit" loading={pending} disabled={pending}>Save assumptions</Button>
        <p role="status" aria-live="polite" className={state ? (state.ok ? "text-sm text-(--gain)" : "text-sm text-(--loss)") : undefined}>{state?.message}</p>
      </div>
    </form>
    </Panel>
  );
}

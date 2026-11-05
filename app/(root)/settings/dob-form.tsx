"use client";

import * as React from "react";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { saveDateOfBirthAction, type SettingsActionState } from "./actions";

/** Optional date of birth. Empty and saved clears it; nothing is ever guessed in its place. */
export default function DateOfBirthForm({ bornOn }: { bornOn: string }) {
  const [state, action, pending] = React.useActionState<SettingsActionState | null, FormData>(saveDateOfBirthAction, null);
  return (
    <form action={action} className="mt-4 flex flex-wrap items-end gap-4">
      <Field name="bornOn" label="Date of birth" hint="Optional. Used only to state your age on the projection and the net-worth chart. Leave empty and save to remove it." error={state?.fieldErrors?.bornOn?.[0]}>
        {(fieldProps) => <Input {...fieldProps} name="bornOn" type="date" className="tabular-nums" defaultValue={bornOn} />}
      </Field>
      <Button type="submit" loading={pending} disabled={pending}>Save</Button>
      <p role="status" aria-live="polite" className={state ? (state.ok ? "text-sm text-(--gain)" : "text-sm text-(--loss)") : undefined}>{state?.message}</p>
    </form>
  );
}

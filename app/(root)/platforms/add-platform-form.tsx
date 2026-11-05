"use client";

import * as React from "react";
import { Field } from "@/components/ui/field";
import { ProviderPicker } from "@/ui/provider-picker";
import { INSTITUTION_KINDS, institutionKindLabel } from "@/domain/institutions";
import { addPlatformAction, type PlatformActionState } from "./actions";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";

/**
 * Register a platform.
 *
 * The name field is the `ProviderPicker` — a text input with the shipped
 * catalogue behind it — rather than a `<select>`, because the catalogue is a
 * convenience and not a boundary: a co-operative broker nobody has heard of has
 * to be as registrable as Zerodha. Picking from the list only fills the spelling
 * in, which is what stops "Groww" and "groww" becoming two rows.
 */
export default function AddPlatformForm() {
  const [state, action, pending] = React.useActionState<PlatformActionState | null, FormData>(
    addPlatformAction,
    null,
  );
  const errors = state?.fieldErrors ?? {};

  return (
    <form action={action} className="grid gap-4 md:grid-cols-3">
      <Field name="name" label="Name" required error={errors.name?.[0]}>
        {(props) => (
          <ProviderPicker {...props} name="name" placeholder="Zerodha, SafeGold, Kuvera…" />
        )}
      </Field>

      <Field
        name="kind"
        label="What sort"
        required
        hint="A vault holds metal in grams; a broker holds everything listed. This decides which forms offer it."
        error={errors.kind?.[0]}
      >
        {(props) => (
          <NativeSelect {...props} name="kind" defaultValue="BROKER">
            {INSTITUTION_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {institutionKindLabel(kind)}
              </option>
            ))}
          </NativeSelect>
        )}
      </Field>

      <Field name="notes" label="Notes" hint="Optional — a client code, which family member's it is." error={errors.notes?.[0]}>
        {(props) => <Input {...props} name="notes" maxLength={500} />}
      </Field>

      <div className="md:col-span-3 flex items-center gap-3">
        <button type="submit" className="primary-btn h-10 px-5 text-sm" disabled={pending}>
          {pending ? "Adding…" : "Add platform"}
        </button>
        {state && (
          <p className={state.ok ? "text-sm text-(--gain)" : "text-sm text-(--loss)"} role="status">
            {state.message}
          </p>
        )}
      </div>
    </form>
  );
}

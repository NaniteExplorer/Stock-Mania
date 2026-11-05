import type * as React from "react";
import { Label } from "../../../../components/ui/label";

/**
 * Label + control + hint/error wiring for the holding and entry forms.
 * Same render-prop contract as the retired primitives `Field`, so the
 * `htmlFor` / `id` / `aria-describedby` / `aria-invalid` links cannot drift.
 */
export function FormField({
  name,
  label,
  hint,
  error,
 required = false,
  children,
}: {
  name: string;
  label: string;
  hint?: string;
  error?: string;
 required?: boolean;
  children: (props: { id: string; "aria-invalid": boolean; "aria-describedby": string | undefined }) => React.ReactNode;
}) {
  const describedBy = error ? `${name}-error` : hint ? `${name}-hint` : undefined;
  return (
    <div className="space-y-2">
      <Label htmlFor={name}>
        {label}
        {required && <span className="text-(--loss)" aria-hidden>*</span>}
      </Label>
      {children({ id: name, "aria-invalid": Boolean(error), "aria-describedby": describedBy })}
      {error ? (
        <p id={`${name}-error`} className="text-sm text-(--loss)">{error}</p>
      ) : hint ? (
        <p id={`${name}-hint`} className="text-xs text-(--fg-muted)">{hint}</p>
      ) : null}
    </div>
  );
}

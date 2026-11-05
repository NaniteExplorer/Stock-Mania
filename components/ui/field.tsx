import type { ReactNode } from "react";
import styles from "./field.module.css";

export type FieldControlProps = { id: string; "aria-invalid": boolean; "aria-describedby": string | undefined; "aria-required"?: boolean };

/**
 * Label + control + hint/error, with the wiring done once: the label targets the
 * control's id, the control is described by the error (when present) or the hint,
 * and `aria-invalid` follows the error. The error is announced politely.
 * `id` defaults to `name`; pass one when the same name appears twice on a page.
 */
export function Field({ name, id = name, label, hint, error, required = false, children }: {
  name: string; id?: string; label: string; hint?: string; error?: string; required?: boolean;
  children: (props: FieldControlProps) => ReactNode;
}) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [errorId, hintId].filter(Boolean).join(" ") || undefined;
  return <div className={styles.field}>
    <label htmlFor={id} className={styles.label}>{label}{required && <span className={styles.required} aria-hidden="true">*</span>}</label>
    {children({ id, "aria-invalid": Boolean(error), "aria-describedby": describedBy, ...(required ? { "aria-required": true } : {}) })}
    {hint && <p id={hintId} className={styles.hint}>{hint}</p>}
    {error && <p id={errorId} className={styles.error} role="alert">{error}</p>}
  </div>;
}

"use client";

import * as React from "react";
import { cn } from "../../lib/utils";
import { Icon } from "../icons";
import styles from "./controls.module.css";

type CheckboxProps = Omit<React.ComponentProps<"input">, "type" | "children"> & {
  label: React.ReactNode;
  description?: React.ReactNode;
  indeterminate?: boolean;
};

function Checkbox({ label, description, indeterminate = false, className, ref, ...props }: CheckboxProps) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  React.useImperativeHandle(ref, () => inputRef.current!, []);
  React.useEffect(() => { if (inputRef.current) inputRef.current.indeterminate = indeterminate; });
  const id = React.useId();
  return <label className={styles.choice} data-disabled={props.disabled || undefined}>
    <input {...props} ref={inputRef} type="checkbox" data-slot="checkbox"
      aria-checked={indeterminate ? "mixed" : props["aria-checked"]}
      aria-labelledby={props["aria-labelledby"] ?? `${id}-label`}
      aria-describedby={[props["aria-describedby"], description ? `${id}-description` : undefined].filter(Boolean).join(" ") || undefined}
      data-indeterminate={indeterminate || undefined} className={cn(styles.choiceInput, className)} />
    <span className={styles.checkboxMarker} aria-hidden="true"><span className={styles.checkGlyph}><Icon name="ck" size={14} /></span><span className={styles.mixedGlyph}><Icon name="ix" size={14} /></span></span>
    <span className={styles.choiceText}><span id={`${id}-label`}>{label}</span>{description && <span id={`${id}-description`} className={styles.choiceDescription}>{description}</span>}</span>
  </label>;
}

export { Checkbox, type CheckboxProps };

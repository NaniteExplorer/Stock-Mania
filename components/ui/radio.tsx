"use client";

import * as React from "react";
import { cn } from "../../lib/utils";
import styles from "./controls.module.css";

type RadioProps = Omit<React.ComponentProps<"input">, "type" | "children"> & { label: React.ReactNode; description?: React.ReactNode };

/** Radios sharing a name retain the browser's Arrow-key grouping and form value. */
function Radio({ label, description, className, ...props }: RadioProps) {
  const id = React.useId();
  return <label className={styles.choice} data-disabled={props.disabled || undefined}>
    <input {...props} type="radio" data-slot="radio" className={cn(styles.choiceInput, className)}
      aria-labelledby={props["aria-labelledby"] ?? `${id}-label`}
      aria-describedby={[props["aria-describedby"], description ? `${id}-description` : undefined].filter(Boolean).join(" ") || undefined} />
    <span className={styles.radioMarker} aria-hidden="true" />
    <span className={styles.choiceText}><span id={`${id}-label`}>{label}</span>{description && <span id={`${id}-description`} className={styles.choiceDescription}>{description}</span>}</span>
  </label>;
}

export { Radio, type RadioProps };

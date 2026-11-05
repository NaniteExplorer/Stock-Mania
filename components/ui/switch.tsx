"use client";

import * as React from "react";
import { cn } from "../../lib/utils";
import styles from "./controls.module.css";

type SwitchProps = Omit<React.ComponentProps<"input">, "type" | "children" | "role"> & { label: React.ReactNode; description?: React.ReactNode };

function Switch({ label, description, className, ...props }: SwitchProps) {
  const id = React.useId();
  return <label className={styles.choice} data-disabled={props.disabled || undefined}>
    <input {...props} type="checkbox" role="switch" data-slot="switch" className={cn(styles.choiceInput, className)}
      aria-labelledby={props["aria-labelledby"] ?? `${id}-label`}
      aria-describedby={[props["aria-describedby"], description ? `${id}-description` : undefined].filter(Boolean).join(" ") || undefined} />
    <span className={styles.switchMarker} aria-hidden="true" />
    <span className={styles.choiceText}><span id={`${id}-label`}>{label}</span>{description && <span id={`${id}-description`} className={styles.choiceDescription}>{description}</span>}</span>
  </label>;
}

export { Switch, type SwitchProps };

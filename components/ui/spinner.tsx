import type { ComponentProps } from "react";
import styles from "./feedback.module.css";

export function Spinner({ label = "Loading", size = 16, className, ...props }:
  Omit<ComponentProps<"span">, "children"> & { label?: string; size?: 14 | 16 | 20 }) {
  return <span {...props} role="status" aria-label={label} aria-busy="true"
    className={[styles.spinner, className].filter(Boolean).join(" ")} data-size={size} />;
}

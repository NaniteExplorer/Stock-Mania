import type { ComponentProps } from "react";
import styles from "./feedback.module.css";

/** Decorative placeholder: put the accessible loading status on its containing region. */
export function Skeleton({ className, ...props }: Omit<ComponentProps<"span">, "children">) {
  return <span {...props} aria-hidden="true" className={[styles.skeleton, className].filter(Boolean).join(" ")} />;
}

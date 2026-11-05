import type { ComponentProps, ReactNode } from "react";
import { Icon, type IconName } from "../icons";
import styles from "./feedback.module.css";

type Tone = "info" | "warning" | "error" | "success";
const icons: Record<Tone, IconName> = { info: "info", warning: "warn", error: "warn", success: "check" };

/** Persistent notices are not automatically live: callers opt in for newly arriving feedback. */
export function Banner({ tone = "info", title, children, className, ...props }:
  Omit<ComponentProps<"section">, "title"> & { tone?: Tone; title: ReactNode }) {
  return <section {...props} data-tone={tone} className={[styles.banner, className].filter(Boolean).join(" ")}>
    <Icon name={icons[tone]} size={16} className={styles.noticeIcon} />
    <div className={styles.noticeBody}><strong>{title}</strong>{children && <div>{children}</div>}</div>
  </section>;
}

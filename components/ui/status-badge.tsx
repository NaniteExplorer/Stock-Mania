import type { ReactNode } from "react";
import styles from "./data-display.module.css";

export type StatusTone = "neutral" | "accent" | "info" | "gain" | "loss" | "warning";

/**
 * A standalone status label (freshness, phase, due/overdue, open/closed). The
 * text carries the meaning; tone only reinforces it, so `children` is required
 * and must be readable on its own. Not interactive. Replaces the legacy `Pill`.
 */
export function StatusBadge({ tone = "neutral", children, className }: { tone?: StatusTone; children: ReactNode; className?: string }) {
  return <span className={className ? `${styles.badge} ${className}` : styles.badge} data-tone={tone === "neutral" ? "outline" : tone}>{children}</span>;
}

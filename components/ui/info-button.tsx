"use client";

import * as React from "react";
import { Popover as Primitive } from "radix-ui";
import feedback from "./feedback.module.css";
import styles from "./info-button.module.css";

/**
 * A KPI's explanation, reachable by keyboard (task D.6, DESIGN §3).
 *
 * Replaces the mockups' `<i class="info-i" title="…">`, which only a mouse could read.
 * The hit target is a 24px `<button>` (§1.1 `--h-xs`); the 16px circle inside is a
 * marker (§1.1b) and is `aria-hidden`. The explanation is the button's description, so a
 * screen reader hears it on focus, and it opens in a Radix popover on Enter/Space/click.
 * Radix supplies `aria-expanded`, `aria-controls`, `Esc` to dismiss and focus return.
 *
 * Uses the Radix primitive directly (as `tooltip.tsx` does) with the library popover
 * surface from `feedback.module.css`, so `page-shell` stays free of the `@/` alias.
 */
export function InfoButton({ label, explanation, className }: { label: string; explanation: string; className?: string }) {
  const descriptionId = React.useId();
  if (!label.trim() || !explanation.trim()) throw new Error("InfoButton requires a label and a specific explanation");
  const name = `About ${label}`;
  return (
    <Primitive.Root>
      <Primitive.Trigger asChild>
        <button type="button" className={[styles.infoButton, className].filter(Boolean).join(" ")} aria-label={name} aria-describedby={descriptionId}>
          <span className={styles.infoGlyph} aria-hidden="true">i</span>
        </button>
      </Primitive.Trigger>
      <span id={descriptionId} className={styles.description}>{explanation}</span>
      <Primitive.Portal>
        <Primitive.Content side="top" align="start" sideOffset={4} collisionPadding={16} aria-label={name}
          className={[feedback.popover, styles.content].join(" ")}>
          <p className={styles.text}>{explanation}</p>
        </Primitive.Content>
      </Primitive.Portal>
    </Primitive.Root>
  );
}

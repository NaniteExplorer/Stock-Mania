"use client";

import * as React from "react";
import { Button } from "../../../../components/ui/button";
import type { ActionState } from "@/ui/action-state";
import styles from "./cpi.module.css";

type Action = (previous: ActionState | null, formData: FormData) => Promise<ActionState>;

/** Tombstones one month; a refusal is shown beside the button. */
export default function RemoveCpiButton({ action, month, label }: { action: Action; month: string; label: string }) {
  const [state, formAction, pending] = React.useActionState<ActionState | null, FormData>(action, null);
  return <form action={formAction} className={styles.inline}>
    <input type="hidden" name="month" value={month} />
    <Button type="submit" variant="outline" size="sm" loading={pending} aria-label={`Remove CPI for ${label}`}>Remove</Button>
    {state && !state.ok ? <span role="alert" className={styles.error}>{state.message}</span> : null}
  </form>;
}

"use client";

import * as React from "react";
import { Input } from "../../../../components/ui/input";
import { Button } from "../../../../components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../../../components/ui/table";
import type { ActionState } from "@/ui/action-state";
import { shareField, totalOf, type SleeveRow } from "./allocation-model";
import styles from "./allocation.module.css";

type Action = (previous: ActionState | null, formData: FormData) => Promise<ActionState>;

function Status({ state }: { state: ActionState | null }) {
  return <p role="status" aria-live="polite" className={state && !state.ok ? styles.error : styles.hint}>{state?.message ?? ""}</p>;
}

/** Whole-allocation entry: one share per holding; the exact running total is shown live. */
export function AllocationForm({ rows, action, removeAction, hasStored }: { rows: readonly SleeveRow[]; action: Action; removeAction: Action; hasStored: boolean }) {
  const [state, formAction, pending] = React.useActionState<ActionState | null, FormData>(action, null);
  const [removeState, removeFormAction, removing] = React.useActionState<ActionState | null, FormData>(removeAction, null);
  const [shares, setShares] = React.useState<Record<string, string>>(() => Object.fromEntries(rows.map((r) => [r.id, r.share])));
  const total = totalOf(rows.map((r) => ({ id: r.id, share: shares[r.id] ?? "" })));
  const errors = state?.fieldErrors ?? {};
  const totalText = total.kind === "invalid" ? "some shares are not numbers" : `${total.text}% of 100%`;
  const complete = total.kind === "total" && total.complete;

  return <>
    <form action={formAction} id="allocation-entry" className={styles.loading}>
      <Table aria-label="Target share per holding">
        <TableHeader><TableRow><TableHead>Holding</TableHead><TableHead className={styles.figure}>Target share (%)</TableHead></TableRow></TableHeader>
        <TableBody>
          {rows.map((row) => {
            const name = shareField(row.id);
            const error = errors[name]?.[0];
            return <TableRow key={row.id}>
              <TableCell><label htmlFor={name}>{row.name}</label></TableCell>
              <TableCell className={styles.figure}>
                <Input id={name} name={name} inputMode="decimal" placeholder="0" className={styles.share}
                  aria-invalid={error ? true : undefined} aria-describedby={error ? `${name}-error` : undefined}
                  value={shares[row.id] ?? ""} onChange={(event) => { const value = event.target.value; setShares((s) => ({ ...s, [row.id]: value })); }} />
                {error ? <span id={`${name}-error`} className={styles.error}>{error}</span> : null}
              </TableCell>
            </TableRow>;
          })}
        </TableBody>
      </Table>
      <div className={styles.footer}>
        <output aria-live="polite" className={complete ? styles.base : styles.error}>Total: {totalText}</output>
        <Button type="submit" loading={pending}>Save target allocation</Button>
        <Status state={state} />
      </div>
    </form>
    {hasStored ? <form action={removeFormAction} className={styles.inline}>
      <Button type="submit" variant="outline" loading={removing}>Clear target allocation</Button>
      <Status state={removeState} />
    </form> : null}
  </>;
}

/** The owner's band: both figures typed, no pre-fill. Wider than 5 points / 25% (rule 6.2). */
export function BandForm({ initial, action, removeAction }: { initial: { absolute: string; relative: string } | null; action: Action; removeAction: Action }) {
  const [state, formAction, pending] = React.useActionState<ActionState | null, FormData>(action, null);
  const [removeState, removeFormAction, removing] = React.useActionState<ActionState | null, FormData>(removeAction, null);
  const errors = state?.fieldErrors ?? {};
  const aria = (name: string) => ({
    id: name, name, required: true, inputMode: "decimal" as const, "aria-invalid": errors[name] ? true : undefined,
    "aria-describedby": errors[name] ? `${name}-error` : `${name}-hint`,
  });
  return <>
    <form action={formAction} className={styles.form} id="band-entry">
      <label className={styles.field} htmlFor="absolute">
        <span>Absolute band (percentage points)</span>
        <Input {...aria("absolute")} defaultValue={initial?.absolute} />
        {errors.absolute ? <span id="absolute-error" className={styles.error}>{errors.absolute[0]}</span>
          : <span id="absolute-hint" className={styles.hint}>Must be wider than 5 points.</span>}
      </label>
      <label className={styles.field} htmlFor="relative">
        <span>Relative band (% of the target)</span>
        <Input {...aria("relative")} defaultValue={initial?.relative} />
        {errors.relative ? <span id="relative-error" className={styles.error}>{errors.relative[0]}</span>
          : <span id="relative-hint" className={styles.hint}>Must be wider than 25%. The narrower of the two applies to each holding.</span>}
      </label>
      <div className={styles.footer}>
        <Button type="submit" loading={pending}>{initial ? "Save band" : "Record band"}</Button>
        <Status state={state} />
      </div>
    </form>
    {initial ? <form action={removeFormAction} className={styles.inline}>
      <Button type="submit" variant="outline" loading={removing}>Clear band</Button>
      <Status state={removeState} />
    </form> : null}
  </>;
}

"use client";

import * as React from "react";
import { Field } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { recordMinimumDueAction, removeMinimumDueAction, type CardActionState } from "../actions";

/**
 * Record the minimum due printed on the last closed statement. It overrides the card's
 * percentage-and-floor rule for that one statement only; clearing it restores the rule.
 */
export default function MinimumDueForm({
  cardAccountId,
  statementThrough,
  statementLabel,
  entered,
}: {
  cardAccountId: string;
  statementThrough: string;
  statementLabel: string;
  /** The typed amount as decimal text, or null when the rule applies. */
  entered: string | null;
}) {
  const [state, action, pending] = React.useActionState<CardActionState | null, FormData>(recordMinimumDueAction, null);
  const [removeState, removeAction, removing] = React.useActionState<CardActionState | null, FormData>(removeMinimumDueAction, null);
  const errors = state?.fieldErrors ?? {};

  return (
    <div className="space-y-4">
      <form action={action} className="grid gap-4 md:grid-cols-2">
        <input type="hidden" name="accountId" value={cardAccountId} />
        <input type="hidden" name="statementThrough" value={statementThrough} />
        <Field name="amount" label={`Minimum due on statement ${statementLabel}`} error={errors.amount?.[0]} required>
          {(props) => (
            <Input {...props} name="amount" className="tabular-nums" inputMode="decimal" required
              placeholder="As printed, e.g. 1250.00" defaultValue={entered ?? undefined} />
          )}
        </Field>
        <div className="flex flex-wrap items-end gap-3 md:col-span-2">
          <Button type="submit" loading={pending}>{entered ? "Save correction" : "Record minimum due"}</Button>
          <p role="status" aria-live="polite" className={state && !state.ok ? "text-xs text-(--loss)" : "text-xs text-(--fg-muted)"}>{state?.message ?? ""}</p>
        </div>
      </form>
      {entered ? (
        <form action={removeAction} className="flex flex-wrap items-center gap-3">
          <input type="hidden" name="accountId" value={cardAccountId} />
          <input type="hidden" name="statementThrough" value={statementThrough} />
          <Button type="submit" variant="outline" loading={removing}>Clear typed minimum</Button>
          <p role="status" aria-live="polite" className={removeState && !removeState.ok ? "text-xs text-(--loss)" : "text-xs text-(--fg-muted)"}>{removeState?.message ?? ""}</p>
        </form>
      ) : null}
    </div>
  );
}

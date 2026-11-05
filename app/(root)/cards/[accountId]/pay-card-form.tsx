"use client";

import * as React from "react";
import { Field } from "@/components/ui/field";
import { InstitutionMark } from "@/ui/provider-picker";
import { accrueChargesAction, payCardAction, type CardActionState } from "../actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";

export interface PayFromOption {
  id: string;
  label: string;
  /** The stored institution name, for the mark beside the chosen account (never inside an <option>). */
  institution?: string | null;
}

/**
 * Pay the card, and post a closed cycle's interest.
 *
 * Two forms rather than one, because they are two different decisions: paying is
 * the user's, and charging interest is the issuer's — which the app *reproduces*
 * from the postings rather than accepting from a statement. If the issuer billed
 * something else, that is a discrepancy worth seeing, and it only exists as a
 * question because this figure is computed independently.
 */
export default function PayCardForm({
  cardAccountId,
  accounts,
  suggestedAmount,
  defaultDate,
}: {
  cardAccountId: string;
  accounts: readonly PayFromOption[];
  suggestedAmount: string;
  defaultDate: string;
}) {
  const [payState, payAction, paying] = React.useActionState<CardActionState | null, FormData>(
    payCardAction,
    null,
  );
  const [chargeState, chargeAction, charging] = React.useActionState<CardActionState | null, FormData>(
    accrueChargesAction,
    null,
  );
  const [fromId, setFromId] = React.useState("");
  const from = accounts.find((account) => account.id === fromId);

  return (
    <div className="space-y-6">
      <form action={payAction} className="grid gap-4 md:grid-cols-2">
        <input type="hidden" name="cardAccountId" value={cardAccountId} />

        <Field name="fromAccountId" label="Pay from" required>
          {(props) => (
            <NativeSelect
              {...props}
              name="fromAccountId"
              required
              defaultValue=""
              onChange={(event) => setFromId(event.target.value)}
            >
              <option value="" disabled>
                Choose an account
              </option>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.label}
                </option>
              ))}
            </NativeSelect>
          )}
        </Field>

        {from?.institution && (
          <p className="md:col-span-2 -mt-2 flex items-center gap-2 text-xs text-(--fg-secondary)" data-testid="pay-from-institution">
            <InstitutionMark institution={from.institution} size={20} />
            {from.institution}
          </p>
        )}

        <Field name="amount" label="Amount" required hint="Defaults to the last statement's total.">
          {(props) => (
            <Input
              {...props}
              name="amount"
              className="tabular-nums"
              inputMode="decimal"
              defaultValue={suggestedAmount}
              required
            />
          )}
        </Field>

        <Field name="postedOn" label="Paid on" required>
          {(props) => (
            <Input {...props} name="postedOn" type="date" defaultValue={defaultDate} required />
          )}
        </Field>

        <div className="flex items-end gap-3">
          <Button type="submit" disabled={paying || accounts.length === 0}>
            {paying ? "Recording…" : "Record payment"}
          </Button>
        </div>

        {payState && (
          <p
            className={payState.ok ? "md:col-span-2 text-sm text-(--gain)" : "md:col-span-2 text-sm text-(--loss)"}
            role="status"
          >
            {payState.message}
          </p>
        )}
      </form>

      <form action={chargeAction} className="grid gap-4 border-t border-(--border) pt-5 md:grid-cols-2">
        <input type="hidden" name="cardAccountId" value={cardAccountId} />

        <Field
          name="statementDate"
          label="Charge interest for the cycle ending"
          hint="Computed per day from the previous due date, on what the postings say was owed."
        >
          {(props) => (
            <Input {...props} name="statementDate" type="date" defaultValue={defaultDate} />
          )}
        </Field>

        <div className="space-y-2">
          <label className="flex items-center gap-2 text-sm text-(--fg-secondary)">
            <input type="checkbox" name="lateFee" className="h-4 w-4 rounded border-(--border) bg-(--bg-surface)" />
            Also charge the late fee
          </label>
          <label className="flex items-center gap-2 text-sm text-(--fg-secondary)">
            <input type="checkbox" name="annualFee" className="h-4 w-4 rounded border-(--border) bg-(--bg-surface)" />
            Also charge the annual fee
          </label>
        </div>

        <div className="md:col-span-2 flex flex-wrap items-center gap-3">
          <Button variant="outline" type="submit" size="sm" disabled={charging}>
            {charging ? "Charging…" : "Post interest and fees"}
          </Button>
          {chargeState && (
            <p className={chargeState.ok ? "text-sm text-(--gain)" : "text-sm text-(--loss)"} role="status">
              {chargeState.message}
            </p>
          )}
        </div>
      </form>
    </div>
  );
}

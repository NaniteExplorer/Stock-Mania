"use client";

import * as React from "react";
import { Field } from "@/ui/primitives";
import { recordMetalHoldingAction, type InvestingActionState } from "../actions";

export interface FundingAccount {
  id: string;
  label: string;
}

/**
 * Records grams bought, and where the money came from.
 *
 * The funding account is the field that makes this honest. Buying gold is a
 * *swap*: rupees leave the bank, metal arrives, and you are no richer for having
 * done it. Booking it without the cash leg leaves the bank still showing money it
 * no longer has, with the gold sitting beside it — net worth up by the purchase
 * price, for buying something.
 *
 * "Already owned" is the one case where there is no cash leg to record, because
 * the payment happened before the ledger existed. It is deliberately not the
 * default once there is an account to choose.
 */
export default function MetalHoldingForm({
  instrumentId,
  defaultDate,
  accounts,
}: {
  instrumentId: string;
  defaultDate: string;
  accounts: readonly FundingAccount[];
}) {
  const [state, action, pending] = React.useActionState<InvestingActionState | null, FormData>(
    recordMetalHoldingAction,
    null,
  );

  return (
    <form action={action} className="grid gap-4 md:grid-cols-3">
      <input type="hidden" name="instrumentId" value={instrumentId} />
      <Field
        name="grams"
        label="Grams acquired"
        required
        hint="Full current grams for first setup; only new grams for a later purchase."
      >
        {(props) => (
          <input
            {...props}
            name="grams"
            className="form-input tnum"
            inputMode="decimal"
            placeholder="5.2500"
            required
          />
        )}
      </Field>
      <Field
        name="invested"
        label="Amount invested"
        required
        hint="The total that actually left your account, GST included."
      >
        {(props) => (
          <input
            {...props}
            name="invested"
            className="form-input tnum"
            inputMode="decimal"
            placeholder="35000.00"
            required
          />
        )}
      </Field>
      <Field
        name="charges"
        label="Of which GST and fees"
        hint="Optional. Taken out of the amount above, not added to it — so a gram's real rate stays visible."
      >
        {(props) => (
          <input
            {...props}
            name="charges"
            className="form-input tnum"
            inputMode="decimal"
            placeholder="1050.00"
          />
        )}
      </Field>
      <Field
        name="fundingAccountId"
        label="Paid from"
        required
        hint="The account the money left. Buying gold does not change your net worth — it moves it."
      >
        {(props) => (
          <select
            {...props}
            name="fundingAccountId"
            className="form-input"
            defaultValue={accounts[0]?.id ?? "OPENING"}
            required
          >
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.label}
              </option>
            ))}
            <option value="OPENING">Already owned — no payment to record</option>
          </select>
        )}
      </Field>
      <Field name="recordedOn" label="As of" required>
        {(props) => (
          <input
            {...props}
            name="recordedOn"
            type="date"
            className="form-input"
            defaultValue={defaultDate}
            required
          />
        )}
      </Field>
      <div className="flex items-center gap-3 md:col-span-3">
        <button type="submit" className="btn-glow" disabled={pending}>
          {pending ? "Recording…" : "Add investment"}
        </button>
        {state && (
          <p className={state.ok ? "text-sm text-green-500" : "text-sm text-red-500"} role="status">
            {state.message}
          </p>
        )}
      </div>
    </form>
  );
}

"use client";

import * as React from "react";
import { Field } from "@/ui/primitives";
import { ProviderPicker } from "@/ui/provider-picker";
import {
  accrueLeaseAction,
  openLeaseAction,
  settleLeaseAction,
  type LeasingActionState,
} from "./leasing-actions";

/** A gram-denominated holding a lease can be opened against. */
export interface LeasableHolding {
  id: string;
  label: string;
  held: string;
}

function Result({ state }: { state: LeasingActionState | null }) {
  if (!state) return null;
  return (
    <p className={state.ok ? "text-sm text-green-500" : "text-sm text-red-500"} role="status">
      {state.message}
    </p>
  );
}

/**
 * Open a lease.
 *
 * The holding is a `<select>` of gram-measured instruments only, because the use
 * case refuses anything else — leasing shares is a different product with
 * different tax, and offering it here would only produce a rejection.
 */
export function OpenLeaseForm({
  holdings,
  defaultDate,
}: {
  holdings: readonly LeasableHolding[];
  defaultDate: string;
}) {
  const [state, action, pending] = React.useActionState<LeasingActionState | null, FormData>(
    openLeaseAction,
    null,
  );
  const errors = state?.fieldErrors ?? {};

  if (holdings.length === 0) {
    return (
      <p className="text-sm text-gray-400">
        Add a digital-gold holding and record what you bought first — a lease is gold you already own
        put out to earn, so there has to be gold to lease.
      </p>
    );
  }

  return (
    <form action={action} className="grid gap-4 md:grid-cols-3">
      <Field name="instrumentId" label="Gold holding" required error={errors.instrumentId?.[0]}>
        {(props) => (
          <select {...props} name="instrumentId" className="form-input" required defaultValue="">
            <option value="" disabled>
              Choose a holding
            </option>
            {holdings.map((holding) => (
              <option key={holding.id} value={holding.id}>
                {holding.label} — {holding.held}g held
              </option>
            ))}
          </select>
        )}
      </Field>

      <Field name="platform" label="Platform" required error={errors.platform?.[0]}>
        {(props) => (
          <ProviderPicker
            {...props}
            name="platform"
            kinds={["BROKER", "WALLET"]}
            placeholder="Where the lease sits"
          />
        )}
      </Field>

      <Field
        name="quantity"
        label="Grams leased"
        required
        hint="Grams, not rupees — the interest is paid in gold."
        error={errors.quantity?.[0]}
      >
        {(props) => (
          <input
            {...props}
            name="quantity"
            className="form-input tnum"
            inputMode="decimal"
            placeholder="8.5"
            required
          />
        )}
      </Field>

      <Field name="startOn" label="Started on" required error={errors.startOn?.[0]}>
        {(props) => (
          <input {...props} name="startOn" type="date" className="form-input" defaultValue={defaultDate} required />
        )}
      </Field>

      <Field
        name="closesOn"
        label="Closes on"
        required
        hint="Interest stops here even if nobody closes it."
        error={errors.closesOn?.[0]}
      >
        {(props) => <input {...props} name="closesOn" type="date" className="form-input" required />}
      </Field>

      <Field
        name="annualRate"
        label="Annual rate %"
        required
        hint="Paid in grams, on completed months only."
        error={errors.annualRate?.[0]}
      >
        {(props) => (
          <input {...props} name="annualRate" className="form-input tnum" inputMode="decimal" placeholder="4" required />
        )}
      </Field>

      <Field
        name="tdsRate"
        label="TDS %"
        hint="10% under §194A unless the platform says otherwise."
        error={errors.tdsRate?.[0]}
      >
        {(props) => (
          <input {...props} name="tdsRate" className="form-input tnum" inputMode="decimal" placeholder="10" />
        )}
      </Field>

      <Field name="reference" label="Reference" hint="Blank numbers it for you." error={errors.reference?.[0]}>
        {(props) => <input {...props} name="reference" className="form-input" placeholder="LEASE-0001" />}
      </Field>

      <Field
        name="sourceReference"
        label="Platform reference"
        hint="Their own id, for reconciliation."
        error={errors.sourceReference?.[0]}
      >
        {(props) => <input {...props} name="sourceReference" className="form-input" />}
      </Field>

      <div className="md:col-span-3 flex flex-wrap items-center gap-3">
        <button type="submit" className="btn-glow" disabled={pending}>
          {pending ? "Opening…" : "Open lease"}
        </button>
        <Result state={state} />
      </div>
    </form>
  );
}

/**
 * Book what a lease has earned, and close it.
 *
 * Two forms, not one button: accruing and closing are separate events, and a
 * screen that did both at once would leave no way to book the last month's grams
 * after a lease had already been settled.
 */
export function LeaseRowActions({
  leaseId,
  reference,
  defaultDate,
  isActive,
}: {
  leaseId: string;
  reference: string;
  defaultDate: string;
  isActive: boolean;
}) {
  const [accrueState, accrue, accruing] = React.useActionState<LeasingActionState | null, FormData>(
    accrueLeaseAction,
    null,
  );
  const [settleState, settle, settling] = React.useActionState<LeasingActionState | null, FormData>(
    settleLeaseAction,
    null,
  );

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <form action={accrue}>
          <input type="hidden" name="leaseId" value={leaseId} />
          <input type="hidden" name="asOf" value={defaultDate} />
          <button type="submit" className="ghost-btn h-8 px-3 text-xs" disabled={accruing}>
            {accruing ? "Booking…" : "Accrue interest"}
          </button>
        </form>

        {isActive && (
          <form action={settle} className="flex items-center gap-2">
            <input type="hidden" name="leaseId" value={leaseId} />
            <input type="hidden" name="endedOn" value={defaultDate} />
            <select
              name="outcome"
              className="form-input h-8 w-auto py-0 text-xs"
              defaultValue="MATURED"
              aria-label={`How ${reference} ended`}
            >
              <option value="MATURED">Matured</option>
              <option value="CANCELLED">Cancelled early</option>
            </select>
            <button type="submit" className="ghost-btn h-8 px-3 text-xs" disabled={settling}>
              {settling ? "Closing…" : "Close"}
            </button>
          </form>
        )}
      </div>
      <Result state={accrueState} />
      <Result state={settleState} />
    </div>
  );
}

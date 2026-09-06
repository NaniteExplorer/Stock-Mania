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
import { deleteLeaseAction, updateLeaseAction } from "./admin-actions";
import type { InvestingActionState } from "./actions";

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
  accounts = [],
  defaultDate,
}: {
  holdings: readonly LeasableHolding[];
  /** Cash accounts a rupee payout can land in. */
  accounts?: readonly { id: string; label: string }[];
  defaultDate: string;
}) {
  const [state, action, pending] = React.useActionState<LeasingActionState | null, FormData>(
    openLeaseAction,
    null,
  );
  const errors = state?.fieldErrors ?? {};
  const [payoutMode, setPayoutMode] = React.useState<"GRAMS" | "CASH">("GRAMS");
  const [tenure, setTenure] = React.useState("12");
  const [startOn, setStartOn] = React.useState(defaultDate);

  /*
   * The closing date is derived from a tenure, because that is how the product
   * is sold — "a six-month lease", never "a lease closing on the 14th of
   * August". The date stays editable underneath for the lease that does not fit
   * a preset.
   */
  const closesOn = React.useMemo(() => {
    if (tenure === "CUSTOM") return "";
    const start = new Date(`${startOn}T00:00:00Z`);
    if (Number.isNaN(start.getTime())) return "";
    start.setUTCMonth(start.getUTCMonth() + Number(tenure));
    return start.toISOString().slice(0, 10);
  }, [startOn, tenure]);

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
            kinds={["BULLION", "WALLET", "BROKER"]}
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
          <input
            {...props}
            name="startOn"
            type="date"
            className="form-input"
            value={startOn}
            onChange={(event) => setStartOn(event.target.value)}
            required
          />
        )}
      </Field>

      <Field name="tenure" label="Tenure" hint="The way the product is sold. Sets the closing date.">
        {(props) => (
          <select
            {...props}
            className="form-input"
            value={tenure}
            onChange={(event) => setTenure(event.target.value)}
          >
            <option value="3">3 months</option>
            <option value="6">6 months</option>
            <option value="12">12 months</option>
            <option value="18">18 months</option>
            <option value="24">24 months</option>
            <option value="36">36 months</option>
            <option value="CUSTOM">Custom — pick a date</option>
          </select>
        )}
      </Field>

      <Field
        name="closesOn"
        label="Closes on"
        required
        hint="Interest stops here even if nobody closes it."
        error={errors.closesOn?.[0]}
      >
        {(props) => (
          <input
            {...props}
            name="closesOn"
            type="date"
            className="form-input"
            key={closesOn}
            defaultValue={closesOn}
            required
          />
        )}
      </Field>

      <Field
        name="annualRate"
        label="Annual rate %"
        required
        hint="On the grams leased, per year."
        error={errors.annualRate?.[0]}
      >
        {(props) => (
          <input {...props} name="annualRate" className="form-input tnum" inputMode="decimal" placeholder="4" required />
        )}
      </Field>

      <Field
        name="payoutFrequency"
        label="Interest paid"
        required
        hint="When a gram is actually earned — nothing is credited between payout dates."
        error={errors.payoutFrequency?.[0]}
      >
        {(props) => (
          <select {...props} name="payoutFrequency" className="form-input" defaultValue="MONTHLY">
            <option value="MONTHLY">Monthly</option>
            <option value="QUARTERLY">Quarterly</option>
            <option value="HALF_YEARLY">Every six months</option>
            <option value="ANNUAL">Yearly</option>
            <option value="ON_MATURITY">Once, at maturity</option>
          </select>
        )}
      </Field>

      <Field
        name="payoutMode"
        label="Paid in"
        required
        hint="Grams make the holding grow. Rupees leave the leased gold exactly as it is."
        error={errors.payoutMode?.[0]}
      >
        {(props) => (
          <select
            {...props}
            name="payoutMode"
            className="form-input"
            value={payoutMode}
            onChange={(event) => setPayoutMode(event.target.value as "GRAMS" | "CASH")}
          >
            <option value="GRAMS">More gold — grams into the holding</option>
            <option value="CASH">Rupees — into an account</option>
          </select>
        )}
      </Field>

      {payoutMode === "CASH" && (
        <Field
          name="payoutAccountId"
          label="Paid into"
          required
          hint="Where the rent lands. Booking it to the gold holding would say you received grams you did not."
          error={errors.payoutAccountId?.[0]}
        >
          {(props) => (
            <select {...props} name="payoutAccountId" className="form-input" required defaultValue="">
              <option value="" disabled>
                Choose an account
              </option>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.label}
                </option>
              ))}
            </select>
          )}
        </Field>
      )}

      <Field
        name="tdsRate"
        label="TDS %"
        hint="Blank means no TDS withheld, which is what most digital-gold platforms do. Set a rate only if yours deducts one."
        error={errors.tdsRate?.[0]}
      >
        {(props) => (
          <input {...props} name="tdsRate" className="form-input tnum" inputMode="decimal" placeholder="0" />
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
 * Add due gold interest into the holding, and close the lease.
 *
 * Two forms, not one button: adding due grams and closing are separate events,
 * and a screen that did both at once would leave no way to book the last month's
 * grams after a lease had already been settled.
 */
export function LeaseRowActions({
  leaseId,
  reference,
  defaultDate,
  isActive,
  platform,
  quantity,
  startOn,
  closesOn,
  annualRate,
  tdsRate,
  hasBookedInterest,
  autoAccrue = false,
}: {
  leaseId: string;
  reference: string;
  defaultDate: string;
  isActive: boolean;
  platform: string;
  quantity: string;
  startOn: string;
  closesOn: string;
  annualRate: string;
  tdsRate: string;
  /**
   * Whether grams have already been credited into the ledger.
   *
   * Decides which fields the edit form offers. Once interest is booked, the terms
   * that produced it are frozen — the postings were computed from them — so the
   * form shows only the descriptive fields rather than presenting inputs whose
   * only outcome is a refusal.
   */
  hasBookedInterest: boolean;
  /** Adds newly completed monthly payouts when this holding is visited. */
  autoAccrue?: boolean;
}) {
  const [editing, setEditing] = React.useState(false);
  const [updateState, update, saving] = React.useActionState<InvestingActionState | null, FormData>(
    updateLeaseAction,
    null,
  );
  const [deleteState, remove, removing] = React.useActionState<
    InvestingActionState | null,
    FormData
  >(deleteLeaseAction, null);
  const [accrueState, accrue, accruing] = React.useActionState<LeasingActionState | null, FormData>(
    accrueLeaseAction,
    null,
  );
  const [settleState, settle, settling] = React.useActionState<LeasingActionState | null, FormData>(
    settleLeaseAction,
    null,
  );

  React.useEffect(() => {
    if (!autoAccrue || !isActive) return;
    const storageKey = `gold-lease-accrual:${leaseId}:${defaultDate}`;
    if (window.sessionStorage.getItem(storageKey)) return;
    window.sessionStorage.setItem(storageKey, "1");
    const data = new FormData();
    data.set("leaseId", leaseId);
    data.set("asOf", defaultDate);
    React.startTransition(() => accrue(data));
  }, [accrue, autoAccrue, defaultDate, isActive, leaseId]);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <form action={accrue}>
          <input type="hidden" name="leaseId" value={leaseId} />
          <input type="hidden" name="asOf" value={defaultDate} />
          <button type="submit" className="ghost-btn h-8 px-3 text-xs" disabled={accruing}>
            {accruing ? "Booking…" : "Add due grams"}
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

        <button
          type="button"
          className="ghost-btn h-8 px-3 text-xs"
          onClick={() => setEditing((open) => !open)}
          aria-expanded={editing}
        >
          {editing ? "Cancel" : "Edit"}
        </button>

        {!hasBookedInterest && (
          <form action={remove}>
            <input type="hidden" name="leaseId" value={leaseId} />
            <button
              type="submit"
              className="ghost-btn h-8 px-3 text-xs text-red-400"
              disabled={removing}
              title={`Remove ${reference}. Only possible because it has earned nothing yet.`}
            >
              {removing ? "Removing…" : "Remove"}
            </button>
          </form>
        )}
      </div>

      {editing && (
        <form action={update} className="grid gap-3 rounded-xl border border-gray-600 p-3 md:grid-cols-3">
          <input type="hidden" name="leaseId" value={leaseId} />

          <Field name={`platform-${leaseId}`} label="Platform">
            {(props) => (
              <ProviderPicker
                {...props}
                name="platform"
                defaultValue={platform}
                kinds={["BULLION", "WALLET", "BROKER"]}
              />
            )}
          </Field>

          <Field name={`ref-${leaseId}`} label="Their reference">
            {(props) => (
              <input {...props} name="sourceReference" className="form-input" maxLength={120} />
            )}
          </Field>

          <Field name={`notes-${leaseId}`} label="Notes">
            {(props) => <input {...props} name="notes" className="form-input" maxLength={500} />}
          </Field>

          {hasBookedInterest ? (
            <p className="md:col-span-3 text-xs text-amber-500">
              Interest has already been booked into the ledger from these terms, so the grams, rate
              and dates are fixed — changing them would leave those postings claiming an accrual
              this lease no longer says it earned. Close it and open a corrected one instead.
            </p>
          ) : (
            <>
              <Field name={`qty-${leaseId}`} label="Grams">
                {(props) => (
                  <input
                    {...props}
                    name="quantity"
                    className="form-input tnum"
                    inputMode="decimal"
                    defaultValue={quantity}
                  />
                )}
              </Field>

              <Field name={`rate-${leaseId}`} label="Rate % a year">
                {(props) => (
                  <input
                    {...props}
                    name="annualRate"
                    className="form-input tnum"
                    inputMode="decimal"
                    defaultValue={annualRate}
                  />
                )}
              </Field>

              <Field name={`tds-${leaseId}`} label="TDS %">
                {(props) => (
                  <input
                    {...props}
                    name="tdsRate"
                    className="form-input tnum"
                    inputMode="decimal"
                    defaultValue={tdsRate}
                  />
                )}
              </Field>

              <Field name={`start-${leaseId}`} label="Starts">
                {(props) => (
                  <input {...props} name="startOn" type="date" className="form-input" defaultValue={startOn} />
                )}
              </Field>

              <Field name={`close-${leaseId}`} label="Closes">
                {(props) => (
                  <input {...props} name="closesOn" type="date" className="form-input" defaultValue={closesOn} />
                )}
              </Field>
            </>
          )}

          <div className="md:col-span-3">
            <button type="submit" className="primary-btn h-9 px-4 text-xs" disabled={saving}>
              {saving ? "Saving…" : "Save the lease"}
            </button>
          </div>
        </form>
      )}

      <Result state={accrueState} />
      <Result state={settleState} />
      {updateState && (
        <p
          className={updateState.ok ? "text-xs text-green-500" : "max-w-md text-xs text-red-500"}
          role="status"
        >
          {updateState.message}
        </p>
      )}
      {deleteState && (
        <p
          className={deleteState.ok ? "text-xs text-green-500" : "max-w-md text-xs text-red-500"}
          role="status"
        >
          {deleteState.message}
        </p>
      )}
    </div>
  );
}

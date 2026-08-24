"use client";

import * as React from "react";
import { Field } from "@/ui/primitives";
import {
  applySplitAction,
  recordBuyAction,
  recordSellAction,
  type InvestingActionState,
} from "../actions";

export interface AccountOption {
  id: string;
  label: string;
}

/**
 * Buy, sell, and apply a split.
 *
 * The sell form asks for **charges and deductible charges separately**, which
 * looks like a nuisance and is the whole point: STT is a real cost that is never
 * deductible against a capital gain, so one combined field would make deducting it
 * the path of least resistance and overstate the deduction on every equity sale.
 */
export default function TradeForms({
  instrumentId,
  accounts,
  defaultDate,
  heldUnits,
}: {
  instrumentId: string;
  accounts: readonly AccountOption[];
  defaultDate: string;
  heldUnits: string;
}) {
  const [buyState, buyAction, buying] = React.useActionState<InvestingActionState | null, FormData>(
    recordBuyAction,
    null,
  );
  const [sellState, sellAction, selling] = React.useActionState<InvestingActionState | null, FormData>(
    recordSellAction,
    null,
  );
  const [splitState, splitAction, splitting] = React.useActionState<InvestingActionState | null, FormData>(
    applySplitAction,
    null,
  );

  const accountField = (name: string, label: string) => (
    <Field name={name} label={label} required>
      {(props) => (
        <select {...props} name="accountId" className="form-input" required defaultValue="">
          <option value="" disabled>
            Choose an account
          </option>
          {accounts.map((account) => (
            <option key={`${name}-${account.id}`} value={account.id}>
              {account.label}
            </option>
          ))}
        </select>
      )}
    </Field>
  );

  return (
    <div className="space-y-6">
      <form action={buyAction} className="grid gap-4 md:grid-cols-5">
        <input type="hidden" name="instrumentId" value={instrumentId} />
        {accountField("buyAccount", "Paid from")}

        <Field name="buyQuantity" label="Units" required>
          {(props) => <input {...props} name="quantity" className="form-input tnum" inputMode="decimal" required />}
        </Field>

        <Field name="buyPrice" label="Price per unit" required>
          {(props) => <input {...props} name="pricePerUnit" className="form-input tnum" inputMode="decimal" required />}
        </Field>

        <Field name="buyDate" label="Traded on" required>
          {(props) => (
            <input {...props} name="tradedOn" type="date" className="form-input" defaultValue={defaultDate} required />
          )}
        </Field>

        <Field name="buyCharges" label="Charges" hint="Capitalised into the basis.">
          {(props) => <input {...props} name="charges" className="form-input tnum" inputMode="decimal" placeholder="0.00" />}
        </Field>

        <div className="md:col-span-5 flex flex-wrap items-center gap-3">
          <button type="submit" className="btn-glow" disabled={buying || accounts.length === 0}>
            {buying ? "Recording…" : "Record buy"}
          </button>
          {buyState && (
            <p className={buyState.ok ? "text-sm text-green-500" : "text-sm text-red-500"} role="status">
              {buyState.message}
            </p>
          )}
        </div>
      </form>

      <form action={sellAction} className="grid gap-4 border-t border-gray-600 pt-5 md:grid-cols-6">
        <input type="hidden" name="instrumentId" value={instrumentId} />
        {accountField("sellAccount", "Proceeds to")}

        <Field name="sellQuantity" label="Units" required hint={`${heldUnits} held`}>
          {(props) => <input {...props} name="quantity" className="form-input tnum" inputMode="decimal" required />}
        </Field>

        <Field name="sellPrice" label="Price per unit" required>
          {(props) => <input {...props} name="pricePerUnit" className="form-input tnum" inputMode="decimal" required />}
        </Field>

        <Field name="sellDate" label="Traded on" required>
          {(props) => (
            <input {...props} name="tradedOn" type="date" className="form-input" defaultValue={defaultDate} required />
          )}
        </Field>

        <Field name="sellCharges" label="Charges" hint="Everything the broker took.">
          {(props) => <input {...props} name="charges" className="form-input tnum" inputMode="decimal" placeholder="0.00" />}
        </Field>

        <Field
          name="deductibleCharges"
          label="Of which deductible"
          hint="STT never is."
        >
          {(props) => (
            <input {...props} name="deductibleCharges" className="form-input tnum" inputMode="decimal" placeholder="0.00" />
          )}
        </Field>

        <Field name="method" label="Lot method" hint="Overrides the default for this sale.">
          {(props) => (
            <select {...props} name="method" className="form-input" defaultValue="FIFO">
              <option value="FIFO">FIFO — the statutory default</option>
              <option value="LIFO">LIFO</option>
              <option value="HIFO">HIFO — least gain</option>
              <option value="AVERAGE_COST">Average cost</option>
              <option value="SPECIFIC_ID">Specific lots</option>
            </select>
          )}
        </Field>

        <div className="md:col-span-6 flex flex-wrap items-center gap-3">
          <button type="submit" className="ghost-btn h-10 px-4 text-xs" disabled={selling || accounts.length === 0}>
            {selling ? "Recording…" : "Record sell"}
          </button>
          {sellState && (
            <p className={sellState.ok ? "text-sm text-green-500" : "text-sm text-red-500"} role="status">
              {sellState.message}
            </p>
          )}
        </div>
      </form>

      <form action={splitAction} className="grid gap-4 border-t border-gray-600 pt-5 md:grid-cols-4">
        <input type="hidden" name="instrumentId" value={instrumentId} />

        <Field name="from" label="Split from" hint="1, for a 1:5 split.">
          {(props) => <input {...props} name="from" className="form-input tnum" inputMode="decimal" defaultValue="1" />}
        </Field>

        <Field name="to" label="Split to" hint="5, for a 1:5 split.">
          {(props) => <input {...props} name="to" className="form-input tnum" inputMode="decimal" defaultValue="5" />}
        </Field>

        <Field name="exDate" label="Ex-date" hint="The date it takes effect, not the announcement.">
          {(props) => <input {...props} name="exDate" type="date" className="form-input" defaultValue={defaultDate} />}
        </Field>

        <div className="flex items-end">
          <button type="submit" className="ghost-btn h-10 px-4 text-xs" disabled={splitting}>
            {splitting ? "Applying…" : "Apply split"}
          </button>
        </div>

        {splitState && (
          <p
            className={splitState.ok ? "md:col-span-4 text-sm text-green-500" : "md:col-span-4 text-sm text-red-500"}
            role="status"
          >
            {splitState.message}
          </p>
        )}
      </form>
    </div>
  );
}

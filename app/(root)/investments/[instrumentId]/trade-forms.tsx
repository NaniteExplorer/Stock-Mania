"use client";

import * as React from "react";
import {
  applySplitAction,
  recordBuyAction,
  recordSellAction,
  type InvestingActionState,
} from "../actions";
import { Input } from "../../../../components/ui/input";
import { NativeSelect } from "../../../../components/ui/native-select";
import { FormField as Field } from "./form-field";

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
        <NativeSelect {...props} name="accountId" required defaultValue="">
          <option value="" disabled>
            Choose an account
          </option>
          {accounts.map((account) => (
            <option key={`${name}-${account.id}`} value={account.id}>
              {account.label}
            </option>
          ))}
        </NativeSelect>
      )}
    </Field>
  );

  return (
    <div className="space-y-6">
      <form action={buyAction} className="grid gap-4 md:grid-cols-5">
        <input type="hidden" name="instrumentId" value={instrumentId} />
        {accountField("buyAccount", "Paid from")}

        <Field name="buyQuantity" label="Units" required>
          {(props) => <Input {...props} name="quantity" className="tnum" inputMode="decimal" required />}
        </Field>

        <Field name="buyPrice" label="Price per unit" required>
          {(props) => <Input {...props} name="pricePerUnit" className="tnum" inputMode="decimal" required />}
        </Field>

        <Field name="buyDate" label="Traded on" required>
          {(props) => (
            <Input {...props} name="tradedOn" type="date" defaultValue={defaultDate} required />
          )}
        </Field>

        <Field name="buyCharges" label="Charges" hint="Capitalised into the basis.">
          {(props) => <Input {...props} name="charges" className="tnum" inputMode="decimal" placeholder="0.00" />}
        </Field>

        <div className="md:col-span-5 flex flex-wrap items-center gap-3">
          <button type="submit" className="btn-glow" disabled={buying || accounts.length === 0}>
            {buying ? "Recording…" : "Record buy"}
          </button>
          {buyState && (
            <p className={buyState.ok ? "text-sm text-(--gain)" : "text-sm text-(--loss)"} role="status">
              {buyState.message}
            </p>
          )}
        </div>
      </form>

      <form action={sellAction} className="grid gap-4 border-t border-(--border) pt-5 md:grid-cols-6">
        <input type="hidden" name="instrumentId" value={instrumentId} />
        {accountField("sellAccount", "Proceeds to")}

        <Field name="sellQuantity" label="Units" required hint={`${heldUnits} held`}>
          {(props) => <Input {...props} name="quantity" className="tnum" inputMode="decimal" required />}
        </Field>

        <Field name="sellPrice" label="Price per unit" required>
          {(props) => <Input {...props} name="pricePerUnit" className="tnum" inputMode="decimal" required />}
        </Field>

        <Field name="sellDate" label="Traded on" required>
          {(props) => (
            <Input {...props} name="tradedOn" type="date" defaultValue={defaultDate} required />
          )}
        </Field>

        <Field name="sellCharges" label="Charges" hint="Everything the broker took.">
          {(props) => <Input {...props} name="charges" className="tnum" inputMode="decimal" placeholder="0.00" />}
        </Field>

        <Field
          name="deductibleCharges"
          label="Of which deductible"
          hint="STT never is."
        >
          {(props) => (
            <Input {...props} name="deductibleCharges" className="tnum" inputMode="decimal" placeholder="0.00" />
          )}
        </Field>

        <Field name="method" label="Lot method" hint="Overrides the default for this sale.">
          {(props) => (
            <NativeSelect {...props} name="method" defaultValue="FIFO">
              <option value="FIFO">FIFO — the statutory default</option>
              <option value="LIFO">LIFO</option>
              <option value="HIFO">HIFO — least gain</option>
              <option value="AVERAGE_COST">Average cost</option>
              <option value="SPECIFIC_ID">Specific lots</option>
            </NativeSelect>
          )}
        </Field>

        <div className="md:col-span-6 flex flex-wrap items-center gap-3">
          <button type="submit" className="ghost-btn h-10 px-4 text-xs" disabled={selling || accounts.length === 0}>
            {selling ? "Recording…" : "Record sell"}
          </button>
          {sellState && (
            <p className={sellState.ok ? "text-sm text-(--gain)" : "text-sm text-(--loss)"} role="status">
              {sellState.message}
            </p>
          )}
        </div>
      </form>

      <form action={splitAction} className="grid gap-4 border-t border-(--border) pt-5 md:grid-cols-4">
        <input type="hidden" name="instrumentId" value={instrumentId} />

        <Field name="from" label="Split from" hint="1, for a 1:5 split.">
          {(props) => <Input {...props} name="from" className="tnum" inputMode="decimal" defaultValue="1" />}
        </Field>

        <Field name="to" label="Split to" hint="5, for a 1:5 split.">
          {(props) => <Input {...props} name="to" className="tnum" inputMode="decimal" defaultValue="5" />}
        </Field>

        <Field name="exDate" label="Ex-date" hint="The date it takes effect, not the announcement.">
          {(props) => <Input {...props} name="exDate" type="date" defaultValue={defaultDate} />}
        </Field>

        <div className="flex items-end">
          <button type="submit" className="ghost-btn h-10 px-4 text-xs" disabled={splitting}>
            {splitting ? "Applying…" : "Apply split"}
          </button>
        </div>

        {splitState && (
          <p
            className={splitState.ok ? "md:col-span-4 text-sm text-(--gain)" : "md:col-span-4 text-sm text-(--loss)"}
            role="status"
          >
            {splitState.message}
          </p>
        )}
      </form>
    </div>
  );
}

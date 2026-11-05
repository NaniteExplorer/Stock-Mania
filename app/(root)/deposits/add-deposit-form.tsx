"use client";

import * as React from "react";
import { Field } from "@/components/ui/field";
import { ProviderPicker } from "@/ui/provider-picker";
import { openDepositAction, type DepositActionState } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";

/**
 * Add a deposit.
 *
 * The form shows every field for every kind rather than hiding some behind the
 * kind selector, and the hints say which kind each applies to. Progressive
 * disclosure would be nicer to look at; it also hides from a user filling in an FD
 * that the instalment field exists at all, which is how someone concludes the app
 * cannot do recurring deposits.
 */
export default function AddDepositForm() {
  const [state, action, pending] = React.useActionState<DepositActionState | null, FormData>(
    openDepositAction,
    null,
  );
  const errors = state?.fieldErrors ?? {};

  return (
    <form action={action} className="grid gap-4 md:grid-cols-3">
      <Field name="name" label="Name" required error={errors.name?.[0]}>
        {(props) => <Input {...props} name="name" placeholder="HDFC FD 5yr" required />}
      </Field>

      <Field name="kind" label="Kind" required error={errors.kind?.[0]}>
        {(props) => (
          <NativeSelect {...props} name="kind" defaultValue="FIXED_DEPOSIT">
            <option value="FIXED_DEPOSIT">Fixed deposit</option>
            <option value="RECURRING_DEPOSIT">Recurring deposit</option>
            <option value="PPF">PPF</option>
            <option value="EPF">EPF</option>
            <option value="NPS">NPS</option>
          </NativeSelect>
        )}
      </Field>

      <Field name="institution" label="Bank or scheme" error={errors.institution?.[0]}>
        {(props) => <ProviderPicker {...props} name="institution" kinds={["BANK", "SAVINGS", "RETIREMENT"]} placeholder="HDFC Bank or PPF" />}
      </Field>

      <Field name="openedOn" label="Opened on" required error={errors.openedOn?.[0]}>
        {(props) => <Input {...props} name="openedOn" type="date" required />}
      </Field>

      <Field name="rate" label="Rate (% p.a.)" hint="FD and RD. PPF and EPF rates are set per year." error={errors.rate?.[0]}>
        {(props) => <Input {...props} name="rate" className="tabular-nums" inputMode="decimal" placeholder="7.1" />}
      </Field>

      <Field name="compounding" label="Compounding" error={errors.compounding?.[0]}>
        {(props) => (
          <NativeSelect {...props} name="compounding" defaultValue="QUARTERLY">
            <option value="QUARTERLY">Quarterly (Indian bank default)</option>
            <option value="MONTHLY">Monthly</option>
            <option value="HALF_YEARLY">Half-yearly</option>
            <option value="ANNUALLY">Annually</option>
            <option value="DAILY">Daily</option>
            <option value="AT_MATURITY">At maturity</option>
          </NativeSelect>
        )}
      </Field>

      <Field name="accrualBasis" label="Interest basis" error={errors.accrualBasis?.[0]}>
        {(props) => (
          <NativeSelect {...props} name="accrualBasis" defaultValue="COMPOUND">
            <option value="COMPOUND">Compound</option>
            <option value="SIMPLE">Simple</option>
          </NativeSelect>
        )}
      </Field>

      <Field name="payout" label="Interest" hint="A payout deposit's value never grows — the interest leaves." error={errors.payout?.[0]}>
        {(props) => (
          <NativeSelect {...props} name="payout" defaultValue="CUMULATIVE">
            <option value="CUMULATIVE">Reinvested (cumulative)</option>
            <option value="PERIODIC_PAYOUT">Paid out each period</option>
          </NativeSelect>
        )}
      </Field>

      <Field name="principal" label="Principal" hint="Fixed deposits." error={errors.principal?.[0]}>
        {(props) => (
          <Input {...props} name="principal" className="tabular-nums" inputMode="decimal" placeholder="100000.00" />
        )}
      </Field>

      <Field name="maturesOn" label="Matures on" hint="Fixed deposits." error={errors.maturesOn?.[0]}>
        {(props) => <Input {...props} name="maturesOn" type="date" />}
      </Field>

      <Field name="instalment" label="Monthly instalment" hint="Recurring deposits." error={errors.instalment?.[0]}>
        {(props) => (
          <Input {...props} name="instalment" className="tabular-nums" inputMode="decimal" placeholder="5000.00" />
        )}
      </Field>

      <Field name="months" label="Months" hint="Recurring deposits." error={errors.months?.[0]}>
        {(props) => <Input {...props} name="months" className="tabular-nums" inputMode="numeric" placeholder="24" />}
      </Field>

      <Field
        name="prematurePenalty"
        label="Break penalty (%)"
        hint="A rate reduction, not a fee — which is how banks actually charge it."
        error={errors.prematurePenalty?.[0]}
      >
        {(props) => (
          <Input {...props} name="prematurePenalty" className="tabular-nums" inputMode="decimal" placeholder="1" />
        )}
      </Field>

      <Field name="npsTier" label="NPS tier" error={errors.npsTier?.[0]}>
        {(props) => (
          <NativeSelect {...props} name="npsTier" defaultValue="">
            <option value="">Not applicable</option>
            <option value="TIER_I">Tier I (locked to 60)</option>
            <option value="TIER_II">Tier II (withdrawable)</option>
          </NativeSelect>
        )}
      </Field>

      <div className="md:col-span-3 flex flex-wrap items-center gap-3">
        <Button type="submit" loading={pending} disabled={pending}>
          {pending ? "Adding…" : "Add deposit"}
        </Button>
        <p className="text-xs text-(--fg-muted)">
          Leave the funding account blank for a deposit that predates your records — it is booked
          against opening balances instead.
        </p>
        {state && (
          <p className={state.ok ? "text-sm text-(--gain)" : "text-sm text-(--loss)"} role="status">
            {state.message}
          </p>
        )}
      </div>
    </form>
  );
}

"use client";

import * as React from "react";
import { Field } from "@/components/ui/field";
import { ProviderPicker } from "@/ui/provider-picker";
import { openLoanAction, type LoanActionState } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";

export default function AddLoanForm() {
  const [state, action, pending] = React.useActionState<LoanActionState | null, FormData>(
    openLoanAction,
    null,
  );
  const errors = state?.fieldErrors ?? {};

  return (
    <form action={action} className="grid gap-4 md:grid-cols-3">
      <Field name="name" label="Loan name" required error={errors.name?.[0]}>
        {(props) => <Input {...props} name="name" placeholder="HDFC Home Loan" required />}
      </Field>

      <Field name="kind" label="Kind" required error={errors.kind?.[0]}>
        {(props) => (
          <NativeSelect {...props} name="kind" defaultValue="HOME">
            <option value="HOME">Home</option>
            <option value="VEHICLE">Vehicle</option>
            <option value="PERSONAL">Personal</option>
            <option value="EDUCATION">Education</option>
            <option value="GOLD">Gold</option>
            <option value="OTHER">Other</option>
          </NativeSelect>
        )}
      </Field>

      <Field name="institution" label="Lender" error={errors.institution?.[0]}>
        {(props) => <ProviderPicker {...props} name="institution" kinds={["BANK"]} placeholder="HDFC Bank" />}
      </Field>

      <Field name="principal" label="Amount borrowed" required error={errors.principal?.[0]}>
        {(props) => (
          <Input {...props} name="principal" className="tabular-nums" inputMode="decimal" placeholder="5000000.00" required />
        )}
      </Field>

      <Field name="annualRate" label="Rate (% p.a.)" required error={errors.annualRate?.[0]}>
        {(props) => (
          <Input {...props} name="annualRate" className="tabular-nums" inputMode="decimal" placeholder="8.5" required />
        )}
      </Field>

      <Field name="periods" label="Instalments" required hint="240 for a 20-year monthly loan." error={errors.periods?.[0]}>
        {(props) => (
          <Input {...props} name="periods" className="tabular-nums" inputMode="numeric" placeholder="240" required />
        )}
      </Field>

      <Field name="frequency" label="Paid" error={errors.frequency?.[0]}>
        {(props) => (
          <NativeSelect {...props} name="frequency" defaultValue="MONTHLY">
            <option value="MONTHLY">Monthly</option>
            <option value="QUARTERLY">Quarterly</option>
            <option value="ANNUALLY">Annually</option>
          </NativeSelect>
        )}
      </Field>

      <Field
        name="accrualBasis"
        label="Interest basis"
        hint="Flat quoting is common in consumer lending and costs roughly double what it says."
        error={errors.accrualBasis?.[0]}
      >
        {(props) => (
          <NativeSelect {...props} name="accrualBasis" defaultValue="REDUCING_BALANCE">
            <option value="REDUCING_BALANCE">Reducing balance</option>
            <option value="FLAT">Flat</option>
          </NativeSelect>
        )}
      </Field>

      <Field name="disbursedOn" label="Disbursed on" required error={errors.disbursedOn?.[0]}>
        {(props) => <Input {...props} name="disbursedOn" type="date" required />}
      </Field>

      <Field name="firstPaymentOn" label="First instalment" hint="Defaults to one period after disbursement." error={errors.firstPaymentOn?.[0]}>
        {(props) => <Input {...props} name="firstPaymentOn" type="date" />}
      </Field>

      <Field
        name="prepaymentPenalty"
        label="Prepayment penalty (%)"
        hint="Floating-rate home loans in India carry none."
        error={errors.prepaymentPenalty?.[0]}
      >
        {(props) => (
          <Input {...props} name="prepaymentPenalty" className="tabular-nums" inputMode="decimal" placeholder="0" />
        )}
      </Field>

      <div className="md:col-span-3 flex flex-wrap items-center gap-3">
        <Button type="submit" loading={pending} disabled={pending}>
          {pending ? "Adding…" : "Add loan"}
        </Button>
        {state && (
          <p className={state.ok ? "text-sm text-(--gain)" : "text-sm text-(--loss)"} role="status">
            {state.message}
          </p>
        )}
      </div>
    </form>
  );
}

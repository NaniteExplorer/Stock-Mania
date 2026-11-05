"use client";

import * as React from "react";
import { Field } from "@/components/ui/field";
import { ProviderMark } from "@/ui/provider-picker";
import { findFinancialProvider } from "@/ui/providers";
import { recordInstalmentAction, recordPrepaymentAction, type LoanActionState } from "../actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";

export interface PayFromOption {
  id: string;
  label: string;
  /** The account's stored institution, so the chosen account can show its mark. */
  institution?: string | null;
}

/**
 * The "paid from" account select, with the chosen account's institution mark.
 *
 * An `<option>` cannot hold an image, so the mark sits inside the field's left edge,
 * the same placement `ProviderPicker` uses for its text input. It follows the chosen
 * account, and it clears when the form resets after a successful submission.
 */
function PayFromSelect({
  accounts,
  keyPrefix,
  ...field
}: {
  accounts: readonly PayFromOption[];
  keyPrefix: string;
  id: string;
  "aria-invalid": boolean;
  "aria-describedby": string | undefined;
}) {
  const [chosen, setChosen] = React.useState("");
  const select = React.useRef<HTMLSelectElement>(null);
  const provider = findFinancialProvider(accounts.find((account) => account.id === chosen)?.institution);

  React.useEffect(() => {
    const form = select.current?.form;
    if (!form) return;
    const cleared = () => setChosen("");
    form.addEventListener("reset", cleared);
    return () => form.removeEventListener("reset", cleared);
  }, []);

  return (
    <div className="relative">
      {provider && (
        <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2">
          <ProviderMark provider={provider} size={20} />
        </span>
      )}
      <NativeSelect
        {...field}
        ref={select}
        name="fromAccountId"
        className={provider ? "!pl-10" : undefined}
        required
        defaultValue=""
        onChange={(event) => setChosen(event.target.value)}
      >
        <option value="" disabled>
          Choose an account
        </option>
        {accounts.map((account) => (
          <option key={`${keyPrefix}${account.id}`} value={account.id}>
            {account.label}
          </option>
        ))}
      </NativeSelect>
    </div>
  );
}

/**
 * Two forms: an instalment and a lump sum.
 *
 * The prepayment form makes the borrower choose what the money shortens, because
 * the lender does and the two answers differ: reducing the term saves more
 * interest, reducing the instalment eases monthly cashflow. Defaulting it would
 * quietly pick one and then show a schedule the lender does not agree with.
 */
export default function LoanPaymentForms({
  loanAccountId,
  accounts,
  defaultPeriod,
  defaultDate,
}: {
  loanAccountId: string;
  accounts: readonly PayFromOption[];
  defaultPeriod: number;
  defaultDate: string;
}) {
  const [emiState, emiAction, payingEmi] = React.useActionState<LoanActionState | null, FormData>(
    recordInstalmentAction,
    null,
  );
  const [prepayState, prepayAction, prepaying] = React.useActionState<LoanActionState | null, FormData>(
    recordPrepaymentAction,
    null,
  );

  return (
    <div className="space-y-6">
      <form action={emiAction} className="grid gap-4 md:grid-cols-4">
        <input type="hidden" name="loanAccountId" value={loanAccountId} />

        <Field name="fromAccountId" label="Paid from" required>
          {(props) => <PayFromSelect {...props} accounts={accounts} keyPrefix="" />}
        </Field>

        <Field name="period" label="Instalment number" hint="The split comes from the schedule.">
          {(props) => (
            <Input
              {...props}
              name="period"
              className="tabular-nums"
              inputMode="numeric"
              defaultValue={defaultPeriod}
            />
          )}
        </Field>

        <Field name="paidOn" label="Paid on" hint="Defaults to the scheduled date.">
          {(props) => <Input {...props} name="paidOn" type="date" />}
        </Field>

        <div className="flex items-end">
          <Button type="submit" disabled={payingEmi || accounts.length === 0}>
            {payingEmi ? "Recording…" : "Record instalment"}
          </Button>
        </div>

        {emiState && (
          <p
            className={emiState.ok ? "md:col-span-4 text-sm text-(--gain)" : "md:col-span-4 text-sm text-(--loss)"}
            role="status"
          >
            {emiState.message}
          </p>
        )}
      </form>

      <form action={prepayAction} className="grid gap-4 border-t border-(--border) pt-5 md:grid-cols-4">
        <input type="hidden" name="loanAccountId" value={loanAccountId} />

        <Field name="fromAccountId" label="Prepay from" required>
          {(props) => <PayFromSelect {...props} accounts={accounts} keyPrefix="prepay-" />}
        </Field>

        <Field name="amount" label="Lump sum" required>
          {(props) => (
            <Input {...props} name="amount" className="tabular-nums" inputMode="decimal" placeholder="500000.00" required />
          )}
        </Field>

        <Field name="paidOn" label="Paid on" required>
          {(props) => (
            <Input {...props} name="paidOn" type="date" defaultValue={defaultDate} required />
          )}
        </Field>

        <Field name="reduces" label="Shortens" hint="The lender makes you choose; so does this.">
          {(props) => (
            <NativeSelect {...props} name="reduces" defaultValue="TERM">
              <option value="TERM">The term — saves more interest</option>
              <option value="INSTALMENT">The instalment — eases cashflow</option>
            </NativeSelect>
          )}
        </Field>

        <div className="md:col-span-4 flex flex-wrap items-center gap-3">
          <Button variant="outline" type="submit" size="sm" disabled={prepaying}>
            {prepaying ? "Recording…" : "Record prepayment"}
          </Button>
          {prepayState && (
            <p className={prepayState.ok ? "text-sm text-(--gain)" : "text-sm text-(--loss)"} role="status">
              {prepayState.message}
            </p>
          )}
        </div>
      </form>
    </div>
  );
}

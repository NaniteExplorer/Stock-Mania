"use client";

import * as React from "react";
import { Field } from "@/ui/primitives";
import { openLeaseAction, type LeasingActionState } from "../leasing-actions";

export default function DigitalGoldLeaseForm({ instrumentId, platform, availableGrams, defaultDate }: { instrumentId: string; platform: string; availableGrams: string; defaultDate: string }) {
  const [state, action, pending] = React.useActionState<LeasingActionState | null, FormData>(openLeaseAction, null);
  const [startOn, setStartOn] = React.useState(defaultDate);
  const [tenureDays, setTenureDays] = React.useState("365");
  const closesOn = React.useMemo(() => {
    const start = new Date(`${startOn}T00:00:00Z`);
    const days = Number(tenureDays);
    if (Number.isNaN(start.getTime()) || !Number.isInteger(days) || days <= 0) return "";
    start.setUTCDate(start.getUTCDate() + days);
    return start.toISOString().slice(0, 10);
  }, [startOn, tenureDays]);
  const available = Number(availableGrams);

  if (!(available > 0)) return <p className="text-sm text-gray-500">All held gold is already leased. Close a lease or acquire more gold before opening another.</p>;

  return (
    <form action={action} className="grid gap-4 md:grid-cols-3">
      <input type="hidden" name="instrumentId" value={instrumentId} />
      <input type="hidden" name="platform" value={platform} />
      <input type="hidden" name="closesOn" value={closesOn} />
      <input type="hidden" name="payoutFrequency" value="MONTHLY" />
      <input type="hidden" name="payoutMode" value="GRAMS" />
      <Field name="quantity" label="Grams to lease" required hint={`${availableGrams}g currently available.`} error={state?.fieldErrors?.quantity?.[0]}>
        {(props) => <input {...props} name="quantity" className="form-input tnum" inputMode="decimal" min="0.00000001" max={availableGrams} step="0.00000001" placeholder={availableGrams} required />}
      </Field>
      <Field name="startOn" label="Lease starts" required error={state?.fieldErrors?.startOn?.[0]}>
        {(props) => <input {...props} name="startOn" type="date" className="form-input" value={startOn} onChange={(event) => setStartOn(event.target.value)} required />}
      </Field>
      <Field name="tenureDays" label="Tenure (days)" required hint={closesOn ? `Matures on ${closesOn}.` : "Enter a positive number of days."}>
        {(props) => <input {...props} name="tenureDays" className="form-input tnum" inputMode="numeric" min="1" step="1" value={tenureDays} onChange={(event) => setTenureDays(event.target.value)} required />}
      </Field>
      <Field name="annualRate" label="Gold interest % p.a." required hint="Paid monthly as additional grams." error={state?.fieldErrors?.annualRate?.[0]}>
        {(props) => <input {...props} name="annualRate" className="form-input tnum" inputMode="decimal" min="0" step="0.0001" placeholder="4.00" required />}
      </Field>
      <Field name="tdsRate" label="TDS %" hint="Leave blank if the platform withholds nothing — most digital-gold platforms do not." error={state?.fieldErrors?.tdsRate?.[0]}>
        {(props) => <input {...props} name="tdsRate" className="form-input tnum" inputMode="decimal" min="0" max="100" step="0.0001" placeholder="0" />}
      </Field>
      <Field name="sourceReference" label="Platform reference" hint={`Lease held with ${platform}.`} error={state?.fieldErrors?.sourceReference?.[0]}>
        {(props) => <input {...props} name="sourceReference" className="form-input" maxLength={120} />}
      </Field>
      <div className="md:col-span-3 flex items-center gap-3">
        <button type="submit" className="btn-glow" disabled={pending || !closesOn}>{pending ? "Opening…" : "Open lease"}</button>
        {state && <p className={state.ok ? "text-sm text-green-500" : "text-sm text-red-500"} role="status">{state.message}</p>}
      </div>
    </form>
  );
}

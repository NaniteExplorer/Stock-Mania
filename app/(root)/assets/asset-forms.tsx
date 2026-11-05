"use client";

import * as React from "react";
import { Field } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { assertValuationAction, createAssetAction, linkAcquisitionAction, replaceModelAction, type AssetActionState } from "./actions";

function SourceSelect(props: React.ComponentProps<typeof NativeSelect>) {
  return (
    <NativeSelect {...props} name="source" defaultValue="SELF_ASSESSED">
      <option value="PROFESSIONAL_VALUATION">Professional valuation</option>
      <option value="MARKET_COMPARABLE">Market comparable</option>
      <option value="PURCHASE_PRICE">Purchase price</option>
      <option value="SELF_ASSESSED">Self-assessed</option>
    </NativeSelect>
  );
}

function Status({ state }: { state: AssetActionState | null }) {
  if (!state) return null;
  return <p role="status" className={state.ok ? "text-sm text-(--fg-secondary)" : "text-sm text-(--loss)"}>{state.message}</p>;
}

/** Add an asset. A depreciation model is labelled a model; it never becomes the stored value. */
export function AddAssetForm() {
  const [state, action, pending] = React.useActionState<AssetActionState | null, FormData>(createAssetAction, null);
  const errors = state?.fieldErrors ?? {};
  return (
    <form action={action} className="grid gap-4 md:grid-cols-3">
      <Field name="name" label="Name" required error={errors.name?.[0]}>
        {(props) => <Input {...props} name="name" placeholder="Hatchback" required />}
      </Field>
      <Field name="kind" label="Kind" required error={errors.kind?.[0]}>
        {(props) => (
          <NativeSelect {...props} name="kind" defaultValue="VEHICLE">
            <option value="REAL_ESTATE">Property</option>
            <option value="VEHICLE">Vehicle</option>
            <option value="OTHER">Other</option>
          </NativeSelect>
        )}
      </Field>
      <Field name="purchaseOn" label="Bought on" error={errors.purchaseOn?.[0]}>
        {(props) => <Input {...props} name="purchaseOn" type="date" />}
      </Field>
      <Field name="purchasePrice" label="Purchase price" error={errors.purchasePrice?.[0]}>
        {(props) => <Input {...props} name="purchasePrice" inputMode="decimal" className="tabular-nums" />}
      </Field>
      <Field name="model" label="Depreciation model" hint="A model, shown beside valuations, never stored as one." error={errors.model?.[0]}>
        {(props) => (
          <NativeSelect {...props} name="model" defaultValue="NONE">
            <option value="NONE">None</option>
            <option value="DECLINING">Declining balance</option>
            <option value="STRAIGHT">Straight line</option>
            <option value="SCHEDULE">Motor IDV schedule</option>
          </NativeSelect>
        )}
      </Field>
      <Field name="rate" label="Rate (% a year)" error={errors.rate?.[0]}>
        {(props) => <Input {...props} name="rate" inputMode="decimal" className="tabular-nums" />}
      </Field>
      <Field name="floor" label="Floor (% of price)" hint="Straight line only." error={errors.floor?.[0]}>
        {(props) => <Input {...props} name="floor" inputMode="decimal" className="tabular-nums" />}
      </Field>
      <Field name="basis" label="Rate basis" hint="Where the rate comes from." error={errors.basis?.[0]}>
        {(props) => <Input {...props} name="basis" placeholder="My own assumption" />}
      </Field>
      <Field name="valuedOn" label="Valued on" error={errors.valuedOn?.[0]}>
        {(props) => <Input {...props} name="valuedOn" type="date" />}
      </Field>
      <Field name="value" label="Value" error={errors.value?.[0]}>
        {(props) => <Input {...props} name="value" inputMode="decimal" className="tabular-nums" />}
      </Field>
      <Field name="source" label="Valuation source" error={errors.source?.[0]}>
        {(props) => <SourceSelect {...props} />}
      </Field>
      <Field name="note" label="Note" error={errors.note?.[0]}>
        {(props) => <Input {...props} name="note" />}
      </Field>
      <div className="flex items-center gap-3 md:col-span-3">
        <Button type="submit" disabled={pending}>{pending ? "Adding…" : "Add asset"}</Button>
        <Status state={state} />
      </div>
    </form>
  );
}

export interface ModelDefaults {
  readonly model: "NONE" | "DECLINING" | "STRAIGHT" | "SCHEDULE";
  readonly rate: string;
  readonly floor: string;
  readonly basis: string;
}

/** Edit (or clear) one asset's depreciation model, wired to replaceModel. */
export function ModelForm({ accountId, name, defaults }: { accountId: string; name: string; defaults: ModelDefaults }) {
  const [state, action, pending] = React.useActionState<AssetActionState | null, FormData>(replaceModelAction, null);
  const errors = state?.fieldErrors ?? {};
  const id = (field: string) => `model-${field}-${accountId}`;
  return (
    <form action={action} className="grid gap-3 md:grid-cols-4" aria-label={`Depreciation model for ${name}`}>
      <input type="hidden" name="accountId" value={accountId} />
      <Field name="model" id={id("model")} label="Depreciation model" error={errors.model?.[0]}>
        {(props) => (
          <NativeSelect {...props} name="model" defaultValue={defaults.model}>
            <option value="NONE">None</option>
            <option value="DECLINING">Declining balance</option>
            <option value="STRAIGHT">Straight line</option>
            <option value="SCHEDULE">Motor IDV schedule</option>
          </NativeSelect>
        )}
      </Field>
      <Field name="rate" id={id("rate")} label="Rate (% a year)" error={errors.rate?.[0]}>
        {(props) => <Input {...props} name="rate" inputMode="decimal" className="tabular-nums" defaultValue={defaults.rate} />}
      </Field>
      <Field name="floor" id={id("floor")} label="Floor (% of price)" hint="Straight line only." error={errors.floor?.[0]}>
        {(props) => <Input {...props} name="floor" inputMode="decimal" className="tabular-nums" defaultValue={defaults.floor} />}
      </Field>
      <Field name="basis" id={id("basis")} label="Rate basis" error={errors.basis?.[0]}>
        {(props) => <Input {...props} name="basis" defaultValue={defaults.basis} />}
      </Field>
      <div className="flex items-center gap-3 md:col-span-4">
        <Button type="submit" variant="outline" disabled={pending}>{pending ? "Saving…" : "Save model"}</Button>
        <Status state={state} />
      </div>
    </form>
  );
}

export interface CandidateOption {
  readonly postingId: string;
  readonly label: string;
}

/** Link an expense posting as the asset's acquisition (1.8). */
export function LinkAcquisitionForm({ accountId, name, candidates }: { accountId: string; name: string; candidates: readonly CandidateOption[] }) {
  const [state, action, pending] = React.useActionState<AssetActionState | null, FormData>(linkAcquisitionAction, null);
  const errors = state?.fieldErrors ?? {};
  if (candidates.length === 0) {
    return <p className="text-sm text-(--fg-secondary)">No expense postings to link yet. Record the purchase as an expense first.</p>;
  }
  return (
    <form action={action} className="grid gap-3 md:grid-cols-4" aria-label={`Link the purchase of ${name}`}>
      <input type="hidden" name="accountId" value={accountId} />
      <div className="md:col-span-3">
        <Field name="postingId" id={`posting-${accountId}`} label="Expense that paid for it" required error={errors.postingId?.[0]}>
          {(props) => (
            <NativeSelect {...props} name="postingId" defaultValue="" required>
              <option value="" disabled>Choose a posting</option>
              {candidates.map((c) => <option key={c.postingId} value={c.postingId}>{c.label}</option>)}
            </NativeSelect>
          )}
        </Field>
      </div>
      <div className="flex items-end gap-3">
        <Button type="submit" variant="outline" disabled={pending}>{pending ? "Linking…" : "Link purchase"}</Button>
      </div>
      <div className="md:col-span-4"><Status state={state} /></div>
    </form>
  );
}

/** Assert a new dated valuation for one asset. */
export function ValuationForm({ accountId, name }: { accountId: string; name: string }) {
  const [state, action, pending] = React.useActionState<AssetActionState | null, FormData>(assertValuationAction, null);
  const errors = state?.fieldErrors ?? {};
  const id = (field: string) => `${field}-${accountId}`;
  return (
    <form action={action} className="grid gap-3 md:grid-cols-4" aria-label={`New valuation for ${name}`}>
      <input type="hidden" name="accountId" value={accountId} />
      <Field name="valuedOn" id={id("valuedOn")} label="Valued on" required error={errors.valuedOn?.[0]}>
        {(props) => <Input {...props} name="valuedOn" type="date" required />}
      </Field>
      <Field name="value" id={id("value")} label="Value" required error={errors.value?.[0]}>
        {(props) => <Input {...props} name="value" inputMode="decimal" className="tabular-nums" required />}
      </Field>
      <Field name="source" id={id("source")} label="Source" error={errors.source?.[0]}>
        {(props) => <SourceSelect {...props} />}
      </Field>
      <div className="flex items-end gap-3">
        <Button type="submit" variant="outline" disabled={pending}>{pending ? "Saving…" : "Record valuation"}</Button>
      </div>
      <div className="md:col-span-4"><Status state={state} /></div>
    </form>
  );
}

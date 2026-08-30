"use client";

import * as React from "react";
import { Field } from "@/ui/primitives";
import { deleteMetalHoldingAction, updateMetalHoldingAction, type InvestingActionState } from "../actions";

export default function MetalTransactionActions({
  instrumentId,
  tradeId,
  grams,
  invested,
  charges,
  recordedOn,
  accounts,
  fundingAccountId,
}: {
  instrumentId: string;
  tradeId: string;
  grams: string;
  invested: string;
  charges: string;
  recordedOn: string;
  accounts: readonly { id: string; label: string }[];
  /**
   * The account this purchase was settled from, so an edit re-books it against
   * the same one. `null` for a position that was opened as already-owned — and
   * it stays that way unless the user changes it, because silently attaching a
   * bank account to it would invent a payment that never happened.
   */
  fundingAccountId: string | null;
}) {
  const [editing, setEditing] = React.useState(false);
  const [confirming, setConfirming] = React.useState(false);
  const [updateState, update, updating] = React.useActionState<InvestingActionState | null, FormData>(updateMetalHoldingAction, null);
  const [deleteState, remove, deleting] = React.useActionState<InvestingActionState | null, FormData>(deleteMetalHoldingAction, null);
  const state = updateState ?? deleteState;
  return (
    <div className="space-y-2">
      <div className="flex justify-end gap-2">
        <button type="button" className="ghost-btn h-8 px-3 text-xs" onClick={() => { setEditing(!editing); setConfirming(false); }}>{editing ? "Cancel" : "Edit"}</button>
        <button type="button" className="ghost-btn h-8 px-3 text-xs text-red-400" onClick={() => { setConfirming(!confirming); setEditing(false); }}>{confirming ? "Cancel" : "Delete"}</button>
      </div>
      {editing && <form action={update} className="grid min-w-80 gap-3 rounded-xl border border-gray-600 p-3 sm:grid-cols-3">
        <input type="hidden" name="instrumentId" value={instrumentId} /><input type="hidden" name="tradeId" value={tradeId} />
        <Field name={`grams-${tradeId}`} label="Grams">{(props) => <input {...props} name="grams" className="form-input tnum" inputMode="decimal" defaultValue={grams} required />}</Field>
        <Field name={`invested-${tradeId}`} label="Invested">{(props) => <input {...props} name="invested" className="form-input tnum" inputMode="decimal" defaultValue={invested} required />}</Field>
        <Field name={`charges-${tradeId}`} label="GST and fees">{(props) => <input {...props} name="charges" className="form-input tnum" inputMode="decimal" defaultValue={charges} />}</Field>
        <Field name={`funding-${tradeId}`} label="Paid from">{(props) => <select {...props} name="fundingAccountId" className="form-input" defaultValue={fundingAccountId ?? "OPENING"} required>
          {accounts.map((account) => <option key={account.id} value={account.id}>{account.label}</option>)}
          <option value="OPENING">Already owned — no payment to record</option>
        </select>}</Field>
        <Field name={`date-${tradeId}`} label="Date">{(props) => <input {...props} name="recordedOn" type="date" className="form-input" defaultValue={recordedOn} required />}</Field>
        <div className="sm:col-span-3"><button type="submit" className="primary-btn h-9 px-4 text-xs" disabled={updating}>{updating ? "Saving…" : "Save changes"}</button></div>
      </form>}
      {confirming && <form action={remove} className="flex items-center justify-end gap-2 rounded-xl border border-red-500/30 p-3">
        <input type="hidden" name="instrumentId" value={instrumentId} /><input type="hidden" name="tradeId" value={tradeId} />
        <span className="text-xs text-gray-400">Permanently remove this investment?</span><button type="submit" className="ghost-btn h-8 px-3 text-xs text-red-400" disabled={deleting}>{deleting ? "Deleting…" : "Confirm delete"}</button>
      </form>}
      {state && <p className={state.ok ? "text-xs text-green-500" : "text-xs text-red-500"} role="status">{state.message}</p>}
    </div>
  );
}

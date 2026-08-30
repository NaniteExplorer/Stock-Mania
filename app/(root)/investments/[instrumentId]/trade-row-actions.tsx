"use client";

import * as React from "react";
import { Field } from "@/ui/primitives";
import {
  correctTradeAction,
  voidTradeAction,
} from "../admin-actions";
import type { InvestingActionState } from "../actions";

export interface TradeRowAccount {
  id: string;
  label: string;
}

/**
 * Correct or undo one trade.
 *
 * Three controls, and the distinction between them is the whole point:
 *
 *   - **Edit** restates. The original is reversed and a corrected trade booked,
 *     so the statement shows both and the pair nets to zero. That is what a
 *     mistyped price deserves.
 *   - **Delete** tombstones. For the purchase you entered twice — a thing that
 *     never happened has no business appearing on a statement at all.
 *
 * The edit form opens pre-filled with what was recorded, so a user changing one
 * number does not have to retype the other five and cannot accidentally zero a
 * field by leaving it blank: blank means "unchanged", never "zero".
 */
export default function TradeRowActions({
  instrumentId,
  tradeId,
  side,
  quantity,
  pricePerUnit,
  charges,
  tradedOn,
  accounts,
  settlementAccountId,
}: {
  instrumentId: string;
  tradeId: string;
  side: "BUY" | "SELL";
  quantity: string;
  pricePerUnit: string;
  charges: string;
  tradedOn: string;
  accounts: readonly TradeRowAccount[];
  settlementAccountId: string | null;
}) {
  const [editing, setEditing] = React.useState(false);
  const [confirming, setConfirming] = React.useState(false);
  const [correctState, correct, correcting] = React.useActionState<
    InvestingActionState | null,
    FormData
  >(correctTradeAction, null);
  const [voidState, undo, undoing] = React.useActionState<InvestingActionState | null, FormData>(
    voidTradeAction,
    null,
  );

  const state = correctState ?? voidState;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="ghost-btn h-8 px-3 text-xs"
          onClick={() => {
            setEditing((open) => !open);
            setConfirming(false);
          }}
          aria-expanded={editing}
        >
          {editing ? "Cancel" : "Edit"}
        </button>
        <button
          type="button"
          className="ghost-btn h-8 px-3 text-xs text-red-400"
          onClick={() => {
            setConfirming((open) => !open);
            setEditing(false);
          }}
          aria-expanded={confirming}
        >
          {confirming ? "Keep it" : "Undo"}
        </button>
      </div>

      {confirming && (
        <div className="space-y-2 rounded-xl border border-gray-600 p-3">
          <p className="max-w-md text-xs text-gray-400">
            Two different things, and only one of them is true. <strong>Reverse</strong> says the
            trade happened and was recorded wrongly — it posts the mirror entry and leaves both on
            the statement. <strong>Delete</strong> says it never happened, and takes it off.
          </p>
          <form action={undo} className="flex flex-wrap items-center gap-2">
            <input type="hidden" name="instrumentId" value={instrumentId} />
            <input type="hidden" name="tradeId" value={tradeId} />
            <select
              name="mode"
              className="form-input h-8 w-auto py-0 text-xs"
              defaultValue="REVERSE"
              aria-label="How to undo this trade"
            >
              <option value="REVERSE">Reverse — it happened, recorded wrongly</option>
              <option value="DELETE">Delete — it never happened</option>
            </select>
            <input
              name="reason"
              className="form-input h-8 w-48 py-0 text-xs"
              placeholder="Why (optional)"
              maxLength={200}
              aria-label="Reason"
            />
            <button type="submit" className="ghost-btn h-8 px-3 text-xs text-red-400" disabled={undoing}>
              {undoing ? "Undoing…" : "Undo the trade"}
            </button>
          </form>
        </div>
      )}

      {editing && (
        <form action={correct} className="grid gap-3 rounded-xl border border-gray-600 p-3 md:grid-cols-3">
          <input type="hidden" name="instrumentId" value={instrumentId} />
          <input type="hidden" name="tradeId" value={tradeId} />

          <Field name={`quantity-${tradeId}`} label="Units">
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

          <Field name={`price-${tradeId}`} label="Price / unit">
            {(props) => (
              <input
                {...props}
                name="pricePerUnit"
                className="form-input tnum"
                inputMode="decimal"
                defaultValue={pricePerUnit}
              />
            )}
          </Field>

          <Field name={`date-${tradeId}`} label="Traded on">
            {(props) => (
              <input {...props} name="tradedOn" type="date" className="form-input" defaultValue={tradedOn} />
            )}
          </Field>

          <Field name={`charges-${tradeId}`} label="Charges">
            {(props) => (
              <input
                {...props}
                name="charges"
                className="form-input tnum"
                inputMode="decimal"
                defaultValue={charges}
              />
            )}
          </Field>

          {side === "SELL" && (
            <>
              <Field
                name={`deductible-${tradeId}`}
                label="Of which deductible"
                hint="STT never is. Left blank, the correction says so rather than guessing."
              >
                {(props) => (
                  <input {...props} name="deductibleCharges" className="form-input tnum" inputMode="decimal" />
                )}
              </Field>

              <Field
                name={`method-${tradeId}`}
                label="Lot method"
                hint="The original sale did not record which it used, so this re-matches."
              >
                {(props) => (
                  <select {...props} name="method" className="form-input" defaultValue="FIFO">
                    <option value="FIFO">FIFO</option>
                    <option value="LIFO">LIFO</option>
                    <option value="HIFO">HIFO</option>
                    <option value="AVERAGE_COST">Average cost</option>
                    <option value="SPECIFIC_ID">Specific id</option>
                  </select>
                )}
              </Field>
            </>
          )}

          <Field name={`account-${tradeId}`} label="Settled through">
            {(props) => (
              <select
                {...props}
                name="settlementAccountId"
                className="form-input"
                defaultValue={settlementAccountId ?? ""}
              >
                <option value="">Unchanged</option>
                {accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.label}
                  </option>
                ))}
              </select>
            )}
          </Field>

          <Field name={`reason-${tradeId}`} label="Why">
            {(props) => (
              <input
                {...props}
                name="reason"
                className="form-input"
                placeholder="Contract note said 520"
                maxLength={200}
              />
            )}
          </Field>

          <div className="md:col-span-3">
            <button type="submit" className="primary-btn h-9 px-4 text-xs" disabled={correcting}>
              {correcting ? "Correcting…" : "Save the correction"}
            </button>
          </div>
        </form>
      )}

      {state && (
        <p
          className={state.ok ? "max-w-md text-xs text-green-500" : "max-w-md text-xs text-red-500"}
          role="status"
        >
          {state.message}
        </p>
      )}
    </div>
  );
}

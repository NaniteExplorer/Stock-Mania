"use client";

import * as React from "react";
import { Field } from "@/ui/primitives";
import {
  closeInstrumentAction,
  deleteInstrumentAction,
  updateInstrumentAction,
} from "../admin-actions";
import type { InvestingActionState } from "../actions";
import { PlatformSelect, type PlatformOption } from "../platform-select";
import type { InstrumentKind } from "@/domain/instruments";
import { hintsFor } from "@/ui/instrument-hints";

/**
 * Correct, close or remove a holding's registration.
 *
 * `quoteRef` is the field this panel exists for. A holding that will not price is
 * almost always a wrong scheme code or slug, and until now the only way to fix
 * one was to delete the instrument and re-add it — which meant re-entering every
 * trade. The label says what the code is for each kind, because "quote reference"
 * on its own tells a user nothing about whether to type INFY or 120503.
 *
 * Kind and currency are shown and not editable, with the reason on the page
 * rather than in a tooltip: both are baked into every disposal already computed,
 * so changing one would silently restate a filed capital gain.
 */
export default function InstrumentAdmin({
  instrumentId,
  kind,
  name,
  isin,
  exchange,
  quoteRef,
  currency,
  institutionId,
  platforms,
  isClosed,
  canDelete,
}: {
  instrumentId: string;
  kind: InstrumentKind;
  name: string;
  isin: string | null;
  exchange: string | null;
  quoteRef: string | null;
  currency: string;
  institutionId: string | null;
  platforms: readonly PlatformOption[];
  isClosed: boolean;
  canDelete: boolean;
}) {
  const [updateState, update, updating] = React.useActionState<
    InvestingActionState | null,
    FormData
  >(updateInstrumentAction, null);
  const [closeState, close, closing] = React.useActionState<InvestingActionState | null, FormData>(
    closeInstrumentAction,
    null,
  );
  const [deleteState, remove, removing] = React.useActionState<
    InvestingActionState | null,
    FormData
  >(deleteInstrumentAction, null);

  const errors = updateState?.fieldErrors ?? {};
  const state = updateState ?? closeState ?? deleteState;

  return (
    <div className="space-y-4">
      <form action={update} className="grid gap-4 md:grid-cols-3">
        <input type="hidden" name="instrumentId" value={instrumentId} />

        <Field name="name" label="Name" required error={errors.name?.[0]}>
          {(props) => (
            <input {...props} name="name" className="form-input" defaultValue={name} required maxLength={160} />
          )}
        </Field>

        <Field name="isin" label="ISIN" hint="Twelve characters, or leave it blank." error={errors.isin?.[0]}>
          {(props) => (
            <input {...props} name="isin" className="form-input" defaultValue={isin ?? ""} maxLength={12} />
          )}
        </Field>

        <Field name="exchange" label="Exchange" error={errors.exchange?.[0]}>
          {(props) => (
            <input
              {...props}
              name="exchange"
              className="form-input"
              defaultValue={exchange ?? ""}
              maxLength={16}
            />
          )}
        </Field>

        <Field
          name="quoteRef"
          label="Price reference"
          hint={hintsFor(kind).quoteHint}
          error={errors.quoteRef?.[0]}
        >
          {(props) => (
            <input
              {...props}
              name="quoteRef"
              className="form-input"
              defaultValue={quoteRef ?? ""}
              maxLength={64}
            />
          )}
        </Field>

        <PlatformSelect
          platforms={platforms}
          instrumentKind={kind}
          defaultValue={institutionId ?? ""}
          error={errors.institutionId?.[0]}
        />

        <div className="self-end">
          <p className="metric-label">Fixed</p>
          <p className="mt-1 text-sm text-gray-400">
            {kind.replace(/_/g, " ").toLowerCase()} · {currency}
          </p>
          <p className="mt-1 text-xs text-gray-500">
            Both are baked into every disposal already computed — changing one would restate a
            capital gain that has been reported. If they are wrong, register a new holding and undo
            the trades.
          </p>
          {hintsFor(kind).tax && (
            <p className="mt-2 text-xs text-gray-400">{hintsFor(kind).tax}</p>
          )}
        </div>

        <div className="md:col-span-3">
          <button type="submit" className="primary-btn h-10 px-5 text-sm" disabled={updating}>
            {updating ? "Saving…" : "Save changes"}
          </button>
        </div>
      </form>

      <div className="flex flex-wrap items-center gap-3 border-t border-gray-600 pt-4">
        <form action={close}>
          <input type="hidden" name="instrumentId" value={instrumentId} />
          {isClosed && <input type="hidden" name="reopen" value="on" />}
          <button type="submit" className="ghost-btn h-9 px-4 text-xs" disabled={closing}>
            {closing ? "Saving…" : isClosed ? "Reopen holding" : "Close holding"}
          </button>
        </form>
        <p className="text-xs text-gray-500">
          Closing keeps every trade and hides it from the pickers. It is the right control for a
          position you have exited.
        </p>
      </div>

      {canDelete && (
        <div className="flex flex-wrap items-center gap-3">
          <form action={remove}>
            <input type="hidden" name="instrumentId" value={instrumentId} />
            <button
              type="submit"
              className="ghost-btn h-9 px-4 text-xs text-red-400"
              disabled={removing}
            >
              {removing ? "Removing…" : "Remove holding"}
            </button>
          </form>
          <p className="text-xs text-gray-500">
            Only offered because nothing has been traded here — this is the registration typo case.
          </p>
        </div>
      )}

      {state && (
        <p className={state.ok ? "text-sm text-green-500" : "text-sm text-red-500"} role="status">
          {state.message}
        </p>
      )}
    </div>
  );
}

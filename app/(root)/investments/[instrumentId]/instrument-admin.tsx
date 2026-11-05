"use client";

import * as React from "react";
import {
  closeInstrumentAction,
  deleteInstrumentAction,
  updateInstrumentAction,
} from "../admin-actions";
import type { InvestingActionState } from "../actions";
import { PlatformSelect, type PlatformOption } from "../platform-select";
import type { InstrumentKind } from "@/domain/instruments";
import { hintsFor } from "@/ui/instrument-hints";
import { Input } from "../../../../components/ui/input";
import { FormField as Field } from "./form-field";

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

  return (
    <div className="space-y-4">
      <form action={update} className="grid gap-4 md:grid-cols-3">
        <input type="hidden" name="instrumentId" value={instrumentId} />

        <Field name="name" label="Name" required error={errors.name?.[0]}>
          {(props) => (
            <Input {...props} name="name" defaultValue={name} required maxLength={160} />
          )}
        </Field>

        <Field name="isin" label="ISIN" hint="Twelve characters, or leave it blank." error={errors.isin?.[0]}>
          {(props) => (
            <Input {...props} name="isin" defaultValue={isin ?? ""} maxLength={12} />
          )}
        </Field>

        <Field name="exchange" label="Exchange" error={errors.exchange?.[0]}>
          {(props) => (
            <Input
              {...props}
              name="exchange"
              
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
            <Input
              {...props}
              name="quoteRef"
              
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
          <p className="text-xs font-medium text-(--fg-muted)">Fixed</p>
          <p className="mt-1 text-sm text-(--fg-secondary)">
            {kind.replace(/_/g, " ").toLowerCase()} · {currency}
          </p>
          <p className="mt-1 text-xs text-(--fg-muted)">
            Both are baked into every disposal already computed — changing one would restate a
            capital gain that has been reported. If they are wrong, register a new holding and undo
            the trades.
          </p>
          {hintsFor(kind).tax && (
            <p className="mt-2 text-xs text-(--fg-secondary)">{hintsFor(kind).tax}</p>
          )}
        </div>

        <div className="md:col-span-3">
          <button type="submit" className="primary-btn h-10 px-5 text-sm" disabled={updating}>
            {updating ? "Saving…" : "Save changes"}
          </button>
          {updateState && (
            <p
              className={updateState.ok ? "mt-3 text-sm text-(--gain)" : "mt-3 text-sm text-(--loss)"}
              role="status"
            >
              {updateState.message}
            </p>
          )}
        </div>
      </form>

      <div className="flex flex-wrap items-center gap-3 border-t border-(--border) pt-4">
        <form action={close}>
          <input type="hidden" name="instrumentId" value={instrumentId} />
          {isClosed && <input type="hidden" name="reopen" value="on" />}
          <button type="submit" className="ghost-btn h-9 px-4 text-xs" disabled={closing}>
            {closing ? "Saving…" : isClosed ? "Reopen holding" : "Close holding"}
          </button>
        </form>
        <p className="text-xs text-(--fg-muted)">
          Closing keeps every trade and hides it from the pickers. It is the right control for a
          position you have exited.
        </p>
        {closeState && (
          <p
            className={closeState.ok ? "text-sm text-(--gain)" : "text-sm text-(--loss)"}
            role="status"
          >
            {closeState.message}
          </p>
        )}
      </div>

      {canDelete && (
        <div className="flex flex-wrap items-center gap-3">
          <form action={remove}>
            <input type="hidden" name="instrumentId" value={instrumentId} />
            <button
              type="submit"
              className="ghost-btn h-9 px-4 text-xs text-(--loss)"
              disabled={removing}
            >
              {removing ? "Removing…" : "Remove holding"}
            </button>
          </form>
          <p className="text-xs text-(--fg-muted)">
            Only offered because nothing has been traded here — this is the registration typo case.
          </p>
          {deleteState && (
            <p
              className={deleteState.ok ? "text-sm text-(--gain)" : "text-sm text-(--loss)"}
              role="status"
            >
              {deleteState.message}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

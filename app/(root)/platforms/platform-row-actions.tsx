"use client";

import * as React from "react";
import { INSTITUTION_KINDS, institutionKindLabel, type InstitutionKind } from "@/domain/institutions";
import {
  archivePlatformAction,
  deletePlatformAction,
  updatePlatformAction,
  type PlatformActionState,
} from "./actions";

/**
 * Rename, archive, restore, remove.
 *
 * `Remove` is offered only when the platform holds nothing, because the use case
 * refuses otherwise — showing a button whose only outcome is a refusal teaches
 * people to ignore the refusals that matter. When it holds something, archiving
 * is the whole answer and the only control shown.
 */
export default function PlatformRowActions({
  platformId,
  name,
  kind,
  sellSpread,
  isArchived,
  canDelete,
  compact = false,
}: {
  platformId: string;
  name: string;
  /**
   * The platform's current kind, so editing the name does not silently change it.
   *
   * The select used to default to `BROKER` for every row, which meant saving a
   * rename on a bullion vault quietly demoted it — and the vault kind is what
   * decides whether a platform is offered for digital gold at all.
   */
  kind: InstitutionKind;
  /** Percent under the benchmark this platform buys back at. "0" means not told. */
  sellSpread: string;
  isArchived: boolean;
  canDelete: boolean;
  compact?: boolean;
}) {
  const [editing, setEditing] = React.useState(false);
  const [updateState, update, updating] = React.useActionState<PlatformActionState | null, FormData>(
    updatePlatformAction,
    null,
  );
  const [archiveState, archive, archiving] = React.useActionState<
    PlatformActionState | null,
    FormData
  >(archivePlatformAction, null);
  const [deleteState, remove, removing] = React.useActionState<PlatformActionState | null, FormData>(
    deletePlatformAction,
    null,
  );

  const state = updateState ?? archiveState ?? deleteState;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {!isArchived && (
          <button
            type="button"
            className="ghost-btn h-8 px-3 text-xs"
            onClick={() => setEditing((open) => !open)}
            aria-expanded={editing}
          >
            {editing ? "Cancel" : "Edit"}
          </button>
        )}

        <form action={archive}>
          <input type="hidden" name="platformId" value={platformId} />
          {isArchived && <input type="hidden" name="restore" value="on" />}
          <button type="submit" className="ghost-btn h-8 px-3 text-xs" disabled={archiving}>
            {archiving ? "Saving…" : isArchived ? "Restore" : "Archive"}
          </button>
        </form>

        {canDelete && (
          <form action={remove}>
            <input type="hidden" name="platformId" value={platformId} />
            <button
              type="submit"
              className="ghost-btn h-8 px-3 text-xs text-red-400"
              disabled={removing}
              title={`Remove ${name}. Only possible because it holds nothing.`}
            >
              {removing ? "Removing…" : "Remove"}
            </button>
          </form>
        )}
      </div>

      {editing && (
        <form action={update} className={compact ? "space-y-2" : "flex flex-wrap items-center gap-2"}>
          <input type="hidden" name="platformId" value={platformId} />
          <input
            name="name"
            defaultValue={name}
            className="form-input h-8 w-44 py-0 text-xs"
            maxLength={120}
            required
            aria-label={`Name for ${name}`}
          />
          <select
            name="kind"
            className="form-input h-8 w-auto py-0 text-xs"
            defaultValue={kind}
            aria-label={`What sort of platform ${name} is`}
          >
            {INSTITUTION_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {institutionKindLabel(kind)}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-1.5 text-xs text-gray-400">
            <span className="whitespace-nowrap">Buys back</span>
            <input
              name="sellSpread"
              defaultValue={sellSpread}
              className="form-input tnum h-8 w-16 py-0 text-xs"
              inputMode="decimal"
              aria-label={`Percent below the benchmark ${name} buys back at`}
            />
            <span className="whitespace-nowrap">% under benchmark</span>
          </label>
          <button type="submit" className="ghost-btn h-8 px-3 text-xs" disabled={updating}>
            {updating ? "Saving…" : "Save"}
          </button>
        </form>
      )}

      {state && (
        <p className={state.ok ? "text-xs text-green-500" : "text-xs text-red-500"} role="status">
          {state.message}
        </p>
      )}
    </div>
  );
}

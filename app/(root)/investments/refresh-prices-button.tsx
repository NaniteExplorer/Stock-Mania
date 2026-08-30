"use client";

import * as React from "react";
import { RefreshCw } from "lucide-react";
import { refreshPortfolioAction, type InvestingActionState } from "./actions";

/** How old the newest stored price may be before a visit re-syncs it. */
const DEFAULT_STALE_AFTER_MINUTES = 360;

export default function RefreshPricesButton({
  instrumentId,
  auto = false,
  lastSyncedAt,
  staleAfterMinutes = DEFAULT_STALE_AFTER_MINUTES,
}: {
  instrumentId?: string;
  /** Sync on arrival when the stored price is stale, and periodically after. */
  auto?: boolean;
  /**
   * When the newest stored quote was fetched, as an ISO string.
   *
   * The auto-sync decides from *this* rather than from a "have I run today"
   * flag in session storage, which is what it used to do and which was wrong in
   * both directions: a flag written before the request meant a failed sync was
   * never retried that day, and a flag surviving a reload meant a page opened the
   * next morning showed yesterday's timestamp and never went to look for a newer
   * one. The freshness of the data is the only thing that should decide whether
   * to fetch it again.
   */
  lastSyncedAt?: string | null;
  staleAfterMinutes?: number;
}) {
  const [state, action, pending] = React.useActionState<InvestingActionState | null, FormData>(
    refreshPortfolioAction,
    null,
  );

  /*
   * One automatic sync per mount, at most. `lastSyncedAt` arrives fresh after
   * the action revalidates, so without this the new value re-running the effect
   * would be harmless but the intent — "check once on arrival" — would be
   * implicit rather than stated.
   */
  const autoSyncedRef = React.useRef(false);

  React.useEffect(() => {
    if (!auto || !instrumentId) return;

    const refresh = () => {
      const data = new FormData();
      data.set("instrumentId", instrumentId);
      React.startTransition(() => action(data));
    };

    const ageMinutes = lastSyncedAt
      ? (Date.now() - new Date(lastSyncedAt).getTime()) / 60_000
      : Number.POSITIVE_INFINITY;

    if (!autoSyncedRef.current && ageMinutes >= staleAfterMinutes) {
      autoSyncedRef.current = true;
      refresh();
    }

    const interval = window.setInterval(refresh, staleAfterMinutes * 60_000);
    return () => window.clearInterval(interval);
  }, [action, auto, instrumentId, lastSyncedAt, staleAfterMinutes]);

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <form action={action}>
        {instrumentId && <input type="hidden" name="instrumentId" value={instrumentId} />}
        <button type="submit" className="ghost-btn h-10 px-4 text-xs" disabled={pending}>
          <RefreshCw className={`mr-2 size-4 ${pending ? "animate-spin" : ""}`} aria-hidden />
          {pending ? "Refreshing…" : "Refresh prices"}
        </button>
      </form>
      {state && (
        <p className={state.ok ? "text-xs text-green-500" : "text-xs text-red-500"} role="status" aria-live="polite">
          {state.message}
        </p>
      )}
    </div>
  );
}

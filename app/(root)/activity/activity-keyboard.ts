import type { TableRow, VerbAvailability } from "../../../components/ui/table-keyboard";
import type { ActivityDayView } from "./activity-model";

/**
 * The Activity screen's side of the DESIGN §6.1 keyboard model (§9e "Keyboard", task
 * 2.8.b). Pure, so which row `Ctrl+Z` / `Ctrl+Y` act on is tested without a DOM.
 *
 * The keys reach only the existing verbs: `Ctrl+Z` opens the target row's own inline
 * confirmation (class A "asks once"), `Ctrl+Y` submits its own Redo form.
 */

/** Refusals this screen adds to the model's own (`TABLE_REFUSALS`). */
export const ACTIVITY_KEY_REFUSALS = Object.freeze({
  /** `E`: an activity row is history; history is undone, never edited. */
  edit: "Activity is history: a change is undone, not edited",
  /** `Del`: §9e "Undo never removes the activity row itself". */
  remove: "Activity is history and is never removed: undo the change instead (Ctrl+Z)",
});

export const dayRowId = (heading: string) => `day-${heading.replace(/[^\w]+/g, "-")}`;

/** Day headings become heading rows (cursor may rest, nothing acts); requests become rows. */
export function activityTableRows(days: readonly ActivityDayView[]): TableRow[] {
  return days.flatMap((day) => [
    { id: dayRowId(day.heading), label: day.heading, mutationClass: "A" as const, heading: true },
    ...day.rows.map((row) => ({
      id: row.requestId,
      label: `${row.time} · ${row.what}`,
      mutationClass: row.classLabel === "Ledger" ? ("A" as const) : ("B" as const),
      // `Enter` moves focus to the row's own verbs, so an older row is reachable too.
      hasDetail: row.undo.available || row.redo.available,
    })),
  ]);
}

export interface VerbTarget {
  readonly availability: VerbAvailability;
  /** The row the key acts on when available. */
  readonly requestId: string | null;
}

const newestFirst = (days: readonly ActivityDayView[]) => days.flatMap((day) => day.rows);

/**
 * `Ctrl+Z`: the newest row whose undo is available (§6.1 "the newest undoable request").
 * When none is, the key refuses with the newest row's own reason, verbatim, so the
 * refusal is heard and matches the text beside its disabled button (§9e).
 */
export function undoTarget(days: readonly ActivityDayView[]): VerbTarget {
  const rows = newestFirst(days);
  const target = rows.find((row) => row.undo.available);
  if (target) return { availability: { available: true }, requestId: target.requestId };
  const newest = rows[0];
  const reason = newest && !newest.undo.available ? newest.undo.reason : "";
  return { availability: { available: false, reason }, requestId: null };
}

/**
 * `Ctrl+Y`: the one row the session's class A cursor allows (D3). Otherwise the
 * INVALIDATED notice when the cursor was spent by a later change, else the newest row's
 * `REDO_CURSOR` reason — the same text the page already shows.
 */
export function redoTarget(days: readonly ActivityDayView[], redoNotice: string | null): VerbTarget {
  const rows = newestFirst(days);
  const target = rows.find((row) => row.redo.available);
  if (target) return { availability: { available: true }, requestId: target.requestId };
  const newest = rows[0];
  const reason = redoNotice ?? (newest && !newest.redo.available ? newest.redo.reason : "");
  return { availability: { available: false, reason }, requestId: null };
}

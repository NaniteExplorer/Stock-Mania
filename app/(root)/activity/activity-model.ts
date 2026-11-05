import type { ActivityAction, ActivityResult, ActivityRow, VerbState } from "@/app/activity.usecases";

/** The Activity screen as plain strings (DESIGN §9e). Pure, so it is testable. */
export interface ActivityRowView {
  readonly requestId: string;
  readonly time: string;
  readonly what: string;
  readonly who: string;
  readonly classLabel: "Ledger" | "Reference";
  readonly records: string;
  readonly undo: VerbState;
  readonly redo: VerbState;
}

export interface ActivityDayView {
  readonly heading: string;
  readonly rows: readonly ActivityRowView[];
}

export interface ActivityView {
  readonly days: readonly ActivityDayView[];
  readonly total: number;
  readonly windowNote: string;
  readonly redoNotice: string | null;
}

const VERB: Record<ActivityAction, string> = {
  CREATE: "Added", UPDATE: "Edited", SOFT_DELETE: "Removed", REVERSE: "Reversed", RESTORE: "Restored",
};
const ORDER: readonly ActivityAction[] = ["CREATE", "UPDATE", "REVERSE", "SOFT_DELETE", "RESTORE"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** `income_stream` -> `income stream`, `IMPORT_BATCH` -> `import batch`. */
export function entityNoun(entityType: string, count: number): string {
  const base = entityType.toLowerCase().replace(/_/g, " ");
  if (count === 1) return base;
  return base.endsWith("y") ? `${base.slice(0, -1)}ies` : base.endsWith("s") ? base : `${base}s`;
}

/** "Added 1 transaction, reversed 1" — ordered, never empty. */
export function describe(row: ActivityRow): string {
  const noun = row.entityTypes.length === 1 ? row.entityTypes[0]! : "record";
  const parts = ORDER.filter((a) => row.counts[a]).map((a, i) => {
    const n = row.counts[a]!;
    const verb = i === 0 ? VERB[a] : VERB[a].toLowerCase();
    return `${verb} ${n} ${entityNoun(noun, n)}`;
  });
  return parts.join(", ");
}

const pad = (n: number) => String(n).padStart(2, "0");
/** Day key in the given offset (minutes east of UTC; IST = 330). */
function local(at: Date, offsetMinutes: number): Date {
  return new Date(at.getTime() + offsetMinutes * 60_000);
}
function dayKey(d: Date): string {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export function dayHeading(at: Date, now: Date, offsetMinutes = 330): string {
  const d = local(at, offsetMinutes);
  const today = local(now, offsetMinutes);
  const yesterday = new Date(today.getTime() - 86_400_000);
  if (dayKey(d) === dayKey(today)) return "Today";
  if (dayKey(d) === dayKey(yesterday)) return "Yesterday";
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export function buildActivityView(result: ActivityResult, now: Date, offsetMinutes = 330): ActivityView {
  const days: { heading: string; rows: ActivityRowView[] }[] = [];
  for (const row of result.rows) {
    const heading = dayHeading(row.at, now, offsetMinutes);
    let day = days[days.length - 1];
    if (!day || day.heading !== heading) {
      day = { heading, rows: [] };
      days.push(day);
    }
    const t = local(row.at, offsetMinutes);
    day.rows.push({
      requestId: row.requestId,
      time: `${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())}`,
      what: describe(row),
      who: row.actor === "YOU" ? "You" : `Actor ${row.actorId}`,
      classLabel: row.mutationClass === "A" ? "Ledger" : "Reference",
      records: `${row.records} ${row.records === 1 ? "record" : "records"}`,
      undo: row.undo,
      redo: row.redo,
    });
  }
  return {
    days,
    total: result.rows.length,
    windowNote: "Changes from the last 30 days. Older changes are kept, not undone.",
    redoNotice: result.redoNotice,
  };
}

/**
 * Activity — the read side of undo/redo (task 2.7, DESIGN §9e).
 *
 * Lists every audited mutation inside the D2 window, grouped by `request_id` (one
 * row = one thing the owner did), and states for each row whether Undo and Redo
 * are available and, when not, why. The writes stay in `UndoBatch` / `RedoBatch`
 * (`ledger.usecases.ts`); this file only reads.
 */

import { Clock, UserId } from "@/core/kernel";
import { TransactionId, TransactionRepository, UNDO_MESSAGES, UNDO_WINDOW } from "@/domain/transactions";
import { InMemoryRedoCursorStore, RedoCursorStore, RedoUnavailableError } from "@/app/ledger.usecases";

export type ActivityAction = "CREATE" | "UPDATE" | "SOFT_DELETE" | "REVERSE" | "RESTORE";

/** One audited event, as the read port returns it. */
export interface ActivityEvent {
  readonly requestId: string;
  readonly actorId: string;
  readonly action: ActivityAction;
  readonly entityType: string;
  readonly entityId: string;
  readonly at: Date;
}

/**
 * Read port over `audit_events`: the owner's events at or after `since`, newest
 * first. The adapter must filter by `userId` (foreign events are never returned).
 */
export interface ActivityLog {
  eventsSince(userId: UserId, since: Date): Promise<readonly ActivityEvent[]>;
}

/** Entity types whose writes are class A (ledger). Everything else audited is class B. */
const LEDGER_ENTITIES: ReadonlySet<string> = new Set(["transaction", "IMPORT_BATCH"]);
/** The only entity type `UndoBatch` can invert today (`TransactionRepository.batch`). */
const UNDOABLE_ENTITY = "transaction";

export const ACTIVITY_REASONS = Object.freeze({
  CLASS_B: "Reference changes cannot be undone here yet: class B undo has not shipped. The change is kept on record.",
  NOT_LEDGER: "This change has no ledger rows to undo. It is kept on record.",
  REDO_CURSOR: "Ledger changes redo one step only: redo is offered on the most recent undo of this session.",
});

export type VerbState =
  | { readonly available: true }
  | { readonly available: false; readonly reason: string };

export interface ActivityRow {
  readonly requestId: string;
  readonly at: Date;
  readonly actor: "YOU" | "OTHER";
  readonly actorId: string;
  readonly mutationClass: "A" | "B";
  /** Count per action, e.g. `{ CREATE: 2, REVERSE: 1 }`. */
  readonly counts: Readonly<Partial<Record<ActivityAction, number>>>;
  readonly entityTypes: readonly string[];
  readonly records: number;
  readonly undo: VerbState;
  readonly redo: VerbState;
}

export interface ActivityResult {
  readonly rows: readonly ActivityRow[];
  readonly since: Date;
  /** Session-level redo note, for a cursor that a newer change invalidated. */
  readonly redoNotice: string | null;
}

const DAY_MS = 86_400_000;
const CURSOR_KEY = Symbol.for("stock-mania.redo-cursors");

/**
 * The process-wide class A redo cursor store (D3: user + session scoped). Kept on
 * `globalThis` so dev reloads do not drop it; shared by the Activity actions.
 */
export function activityRedoCursors(): RedoCursorStore {
  const holder = globalThis as unknown as Record<symbol, RedoCursorStore | undefined>;
  holder[CURSOR_KEY] ??= new InMemoryRedoCursorStore();
  return holder[CURSOR_KEY]!;
}

export class ListActivity {
  constructor(
    private readonly log: ActivityLog,
    private readonly journal: TransactionRepository,
    private readonly cursors: RedoCursorStore,
    private readonly clock: Clock,
  ) {}

  async execute(input: { userId: UserId; sessionId: string }): Promise<ActivityResult> {
    const now = this.clock.now();
    const since = new Date(now.getTime() - UNDO_WINDOW * DAY_MS);
    const events = await this.log.eventsSince(input.userId, since);

    const groups = new Map<string, ActivityEvent[]>();
    for (const event of events) {
      if (event.at.getTime() < since.getTime()) continue;
      const list = groups.get(event.requestId) ?? [];
      list.push(event);
      groups.set(event.requestId, list);
    }

    const cursor = this.cursors.get(input.userId, input.sessionId);
    let redoNotice: string | null = null;
    let redoTarget: string | null = null;
    if (cursor) {
      if (await this.journal.touchedSince(input.userId, cursor.undoRequestId, cursor.transactionIds)) {
        this.cursors.clear(input.userId, input.sessionId);
        redoNotice = new RedoUnavailableError("INVALIDATED").message;
      } else {
        redoTarget = cursor.undoneRequestId;
      }
    }

    const rows: ActivityRow[] = [];
    for (const [requestId, list] of groups) {
      rows.push(await this.row(input.userId, requestId, list, now, redoTarget));
    }
    rows.sort((a, b) => b.at.getTime() - a.at.getTime() || (a.requestId < b.requestId ? -1 : 1));
    return { rows, since, redoNotice };
  }

  private async row(userId: UserId, requestId: string, list: readonly ActivityEvent[], now: Date, redoTarget: string | null): Promise<ActivityRow> {
    const counts: Partial<Record<ActivityAction, number>> = {};
    for (const e of list) counts[e.action] = (counts[e.action] ?? 0) + 1;
    const entityTypes = [...new Set(list.map((e) => e.entityType))].sort();
    const at = new Date(Math.max(...list.map((e) => e.at.getTime())));
    const mutationClass = entityTypes.some((t) => LEDGER_ENTITIES.has(t)) ? "A" : "B";
    const txnIds = [...new Set(list.filter((e) => e.entityType === UNDOABLE_ENTITY).map((e) => e.entityId))];
    const actorId = list[0]!.actorId;

    return {
      requestId, at, actorId, mutationClass, counts, entityTypes,
      actor: actorId === userId.value ? "YOU" : "OTHER",
      records: new Set(list.map((e) => `${e.entityType}:${e.entityId}`)).size,
      undo: await this.undoState(userId, requestId, mutationClass, txnIds, at, now),
      redo: requestId === redoTarget ? { available: true } : { available: false, reason: ACTIVITY_REASONS.REDO_CURSOR },
    };
  }

  private async undoState(userId: UserId, requestId: string, mutationClass: "A" | "B", txnIds: readonly string[], at: Date, now: Date): Promise<VerbState> {
    if (mutationClass === "B") return { available: false, reason: ACTIVITY_REASONS.CLASS_B };
    if (txnIds.length === 0) return { available: false, reason: ACTIVITY_REASONS.NOT_LEDGER };
    if (now.getTime() - at.getTime() > UNDO_WINDOW * DAY_MS) return { available: false, reason: UNDO_MESSAGES.EXPIRED };
    if (await this.journal.touchedSince(userId, requestId, txnIds.map((id) => TransactionId.from(id)))) {
      return { available: false, reason: UNDO_MESSAGES.SUPERSEDED };
    }
    return { available: true };
  }
}

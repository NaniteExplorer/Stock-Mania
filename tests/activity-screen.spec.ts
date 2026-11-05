import { createElement as h } from "react";
import { renderToStaticMarkup as render } from "react-dom/server.browser";
import { UserId, type Clock } from "@/core/kernel";
import type { TransactionRepository } from "@/domain/transactions";
import { UNDO_MESSAGES } from "@/domain/transactions";
import { ACTIVITY_REASONS, ListActivity, type ActivityEvent, type ActivityLog } from "@/app/activity.usecases";
import { InMemoryRedoCursorStore, RedoUnavailableError } from "@/app/ledger.usecases";
import { buildActivityView, dayHeading, describe } from "../app/(root)/activity/activity-model";
import { ActivityEmpty, ActivityScreen, EMPTY_TEXT } from "../app/(root)/activity/activity-view";
import { NAV_ITEMS } from "@/ui/nav";
import { check, checkTrue, done, section } from "./harness";

// Made-up ids only.
const me = UserId.from("u1");
const now = new Date("2026-10-30T10:00:00Z");
const clock = { now: () => now, today: () => "2026-10-30" } as unknown as Clock;
const ago = (hours: number) => new Date(now.getTime() - hours * 3_600_000);
const ev = (requestId: string, action: ActivityEvent["action"], entityType: string, entityId: string, at: Date, actorId = "u1"): ActivityEvent =>
  ({ requestId, actorId, action, entityType, entityId: uuid(entityId), at });
const uuid = (s: string) => `00000000-0000-4000-8000-${Buffer.from(s).toString("hex").padStart(12, "0").slice(-12)}`;

const events: ActivityEvent[] = [
  ev("r-edit", "REVERSE", "transaction", "t1r", ago(1)),
  ev("r-edit", "CREATE", "transaction", "t2", ago(1)),
  ev("r-remove", "SOFT_DELETE", "transaction", "t3", ago(30)),
  ev("r-remove", "SOFT_DELETE", "transaction", "t4", ago(30)),
  ev("r-old-touched", "CREATE", "transaction", "t5", ago(50)),
  ev("r-policy", "CREATE", "insurance_policy", "p1", ago(2)),
  ev("r-import", "CREATE", "IMPORT_BATCH", "b1", ago(3)),
  ev("r-ancient", "CREATE", "transaction", "t9", ago(24 * 31)),
  ev("r-other", "CREATE", "transaction", "t6", ago(4), "agent-1"),
];
const log: ActivityLog = { eventsSince: async (_u, since) => events.filter((e) => e.at >= since) };
const touched = new Set(["r-old-touched", "undo-1"]);
const journal = { touchedSince: async (_u: UserId, requestId: string) => touched.has(requestId) } as unknown as TransactionRepository;

async function main() {
  section("ListActivity — grouping, window, attribution");
  const cursors = new InMemoryRedoCursorStore();
  const result = await new ListActivity(log, journal, cursors, clock).execute({ userId: me, sessionId: "s1" });
  const ids = result.rows.map((r) => r.requestId);
  check("one row per request, newest first, window excludes 31-day-old", ids.join(","), "r-edit,r-policy,r-import,r-other,r-remove,r-old-touched");
  const edit = result.rows[0]!;
  check("edit groups its two events", edit.records, 2);
  check("edit attributable to the owner", edit.actor, "YOU");
  check("other actor is attributed, not hidden", result.rows.find((r) => r.requestId === "r-other")!.actor, "OTHER");

  section("Undo state per mutation class");
  check("class A edit undoable", edit.undo.available, true);
  check("class A superseded refused with UNDO_MESSAGES.SUPERSEDED", result.rows.find((r) => r.requestId === "r-old-touched")!.undo, { available: false, reason: UNDO_MESSAGES.SUPERSEDED });
  const policy = result.rows.find((r) => r.requestId === "r-policy")!;
  check("class B is Reference", policy.mutationClass, "B");
  check("class B refused with its reason", policy.undo, { available: false, reason: ACTIVITY_REASONS.CLASS_B });
  const imp = result.rows.find((r) => r.requestId === "r-import")!;
  check("import header alone is ledger, no txn rows to undo", imp.undo, { available: false, reason: ACTIVITY_REASONS.NOT_LEDGER });
  check("redo disabled without a cursor, with reason", edit.redo, { available: false, reason: ACTIVITY_REASONS.REDO_CURSOR });

  section("Redo cursor (D3)");
  cursors.set(me, "s1", { undoneRequestId: "r-remove", undoRequestId: "undo-0", transactionIds: [] });
  const withCursor = await new ListActivity(log, journal, cursors, clock).execute({ userId: me, sessionId: "s1" });
  check("redo offered on the undone row only", withCursor.rows.filter((r) => r.redo.available).map((r) => r.requestId).join(), "r-remove");
  check("other session sees no redo", (await new ListActivity(log, journal, cursors, clock).execute({ userId: me, sessionId: "s2" })).rows.some((r) => r.redo.available), false);
  cursors.set(me, "s1", { undoneRequestId: "r-remove", undoRequestId: "undo-1", transactionIds: [] });
  const invalid = await new ListActivity(log, journal, cursors, clock).execute({ userId: me, sessionId: "s1" });
  check("invalidated cursor yields the INVALIDATED notice", invalid.redoNotice, new RedoUnavailableError("INVALIDATED").message);
  check("and the cursor is cleared", cursors.get(me, "s1"), null);

  section("View model and render");
  check("describe edit", describe(edit), "Added 1 transaction, reversed 1 transaction");
  check("day heading today", dayHeading(ago(1), now), "Today");
  check("day heading yesterday", dayHeading(ago(30), now), "Yesterday");
  check("day heading dated", dayHeading(new Date("2026-10-20T10:00:00Z"), now), "20 Oct 2026");
  const view = buildActivityView(result, now);
  check("days grouped", view.days.map((d) => d.heading).join(","), "Today,Yesterday,28 Oct 2026");
  const html = render(h(ActivityScreen, { view, actions: (id: string) => h("span", { "data-verb": id }, "verbs") }));
  checkTrue("renders Ledger and Reference chips", html.includes("Ledger") && html.includes("Reference"));
  checkTrue("every row gets its verbs", ids.every((id) => html.includes(`data-verb="${id}"`)));
  checkTrue("empty state text", render(h(ActivityEmpty)).includes(EMPTY_TEXT.replace(/'/g, "&#x27;")));
  checkTrue("nav links /activity", NAV_ITEMS.some((i) => i.href === "/activity"));
  done();
}

void main();

"use server";

import { revalidatePath } from "next/cache";
import { currentUserId, services } from "@/infra/container";
import { getCurrentSession } from "@/infra/auth/session";
import { RedoBatch, UndoBatch } from "@/app/ledger.usecases";
import { activityRedoCursors } from "@/app/activity.usecases";
import { fail, ok, type ActionState } from "@/ui/action-state";

/** The redo cursor is session-scoped (D3); the owner and session come from the cookie, never the form. */
async function owner() {
  const userId = await currentUserId();
  const session = await getCurrentSession();
  const sessionId = session?.session?.id;
  if (!sessionId) throw new Error("Activity actions need a session.");
  const { repositories, clock } = services();
  return { userId, sessionId, journal: repositories.journal, clock };
}

/** Undo one request (bound to its id). A refusal comes back as its message; nothing changed. */
export async function undoActivityAction(requestId: string, _previous: ActionState | null): Promise<ActionState> {
  const { userId, sessionId, journal, clock } = await owner();
  const result = await new UndoBatch(journal, activityRedoCursors(), clock).execute({ userId, sessionId, requestId });
  if (!result.ok) {
    const blocked = (result.error as { blockedBy?: { userMessage?: string } | null }).blockedBy;
    return fail(blocked?.userMessage ?? result.error.userMessage);
  }
  revalidatePath("/activity");
  return ok(`Undone: ${result.value.tombstoned} removed, ${result.value.restored} restored.`);
}

/** Redo the session's one class A step. */
export async function redoActivityAction(_previous: ActionState | null): Promise<ActionState> {
  const { userId, sessionId, journal, clock } = await owner();
  const result = await new RedoBatch(journal, activityRedoCursors(), clock).execute({ userId, sessionId });
  if (!result.ok) return fail(result.error.userMessage);
  revalidatePath("/activity");
  return ok(`Redone: ${result.value.tombstoned} removed, ${result.value.restored} restored.`);
}

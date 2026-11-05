import type { Metadata } from "next";
import { connection } from "next/server";
import { currentUserId, services } from "@/infra/container";
import { getCurrentSession } from "@/infra/auth/session";
import { buildActivityView } from "./activity-model";
import { ActivityEmpty, ActivityScreen } from "./activity-view";
import RowActions from "./row-actions";

export const metadata: Metadata = { title: "Activity" };

/** Every change in the 30-day window, one row per request, with Undo/Redo (DESIGN §9e). */
export default async function Page() {
  await connection();
  const userId = await currentUserId();
  const session = await getCurrentSession();
  const { activity, clock } = services();
  const result = await activity.list.execute({ userId, sessionId: session?.session?.id ?? "" });
  if (result.rows.length === 0) return <ActivityEmpty />;

  const view = buildActivityView(result, clock.now());
  const byId = new Map(result.rows.map((r) => [r.requestId, r]));
  return <ActivityScreen view={view} actions={(id) => {
    const row = byId.get(id)!;
    return <RowActions requestId={id} undo={row.undo} redo={row.redo} />;
  }} />;
}

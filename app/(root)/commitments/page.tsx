import type { Metadata } from "next";
import { connection } from "next/server";
import { CalendarDate } from "@/core/time";
import { currentUserId, services } from "@/infra/container";
import { CommitmentsView } from "./commitments-view";
import AddCommitmentForm from "./add-commitment-form";
import { createCommitmentAction } from "./actions";
import { buildCommitmentsModel } from "./model";

export const metadata: Metadata = { title: "Commitments" };

/**
 * Recurring commitments (DESIGN §9d part 2). A failed read throws to this
 * segment's error.tsx, which names it and offers Retry.
 */
export default async function Page() {
  await connection();
  const userId = await currentUserId();
  const { clock, repositories } = services();
  const today = CalendarDate.parse(clock.today());
  const commitments = await repositories.commitments.list(userId);
  const form = <AddCommitmentForm action={createCommitmentAction} />;
  return commitments.length === 0
    ? <CommitmentsView state={{ kind: "empty" }} form={form} />
    : <CommitmentsView state={{ kind: "ready", model: buildCommitmentsModel(commitments, today) }} form={form} />;
}

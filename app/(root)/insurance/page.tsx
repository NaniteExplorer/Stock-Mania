import type { Metadata } from "next";
import { connection } from "next/server";
import { CalendarDate } from "@/core/time";
import { currentUserId, services } from "@/infra/container";
import { Button } from "@/components/ui/button";
import { InsuranceReadError, InsuranceScreen } from "./insurance-screen";
import { buildInsuranceView } from "./insurance-view";
import AddPolicyForm from "./add-policy-form";
import { createInsurancePolicyAction } from "./actions";

export const metadata: Metadata = { title: "Insurance" };

/** Orchestration only: two owner-scoped reads, one pure view model, one screen. */
export default async function Page() {
  await connection();
  const userId = await currentUserId();
  const { clock, repositories } = services();
  const today = CalendarDate.fromUtcInstant(clock.now());

  const [policies, declarations] = await Promise.allSettled([
    repositories.insurance.list(userId),
    repositories.insurance.declarations(userId),
  ]);
  const retry = <Button asChild variant="outline"><a href="/insurance">Retry</a></Button>;
  if (policies.status === "rejected") return <InsuranceReadError failed="Your policies" retry={retry} />;
  if (declarations.status === "rejected") return <InsuranceReadError failed="Your statements of cover you hold none" retry={retry} />;

  const view = buildInsuranceView(policies.value, declarations.value, today);
  return <InsuranceScreen view={view} addForm={<AddPolicyForm action={createInsurancePolicyAction} />} />;
}

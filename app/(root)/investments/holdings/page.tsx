import type { Metadata } from "next";
import Link from "next/link";
import { BriefcaseBusiness } from "lucide-react";
import { connection } from "next/server";
import { CalendarDate } from "@/core/time";
import type { InvestmentWorkspaceOutput } from "@/app/investing.usecases";
import { Card, EmptyState, PageHeader, Pill } from "@/ui/primitives";
import { currentUserId, ensureSeeded, services } from "@/infra/container";
import HoldingsTable, { type HoldingStatusFilter } from "./holdings-table";

export const metadata: Metadata = { title: "Investment holdings" };

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; kind?: string }>;
}) {
  await connection();

  const params = await searchParams;
  const workspace = await readWorkspace();

  if (!workspace) {
    return (
      <>
        <PageHeader
          title="Holdings"
          subtitle="Open positions appear here once a trade creates units and cost basis."
          badge={<Pill tone="brand">Holdings</Pill>}
          action={<Link href="/investments/new" className="primary-btn h-10 px-4 text-xs">Add investment</Link>}
        />
        <section className="panel p-0">
          <EmptyState
            icon={BriefcaseBusiness}
            title="No holdings yet"
            body="Register an investment and record the purchase to create the first holding row."
          />
        </section>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Holdings"
        subtitle="Search positions by symbol or name, then open the durable holding record."
        badge={<Pill tone={workspace.dataQuality.status === "COMPLETE" ? "brand" : "neutral"}>{workspace.dataQuality.status.toLowerCase()}</Pill>}
      />

      {workspace.dataQuality.status === "PARTIAL" && (
        <Card className="mb-6" title="Complete totals are unavailable">
          <p className="text-sm text-gray-300">
            {workspace.dataQuality.unpricedPositions.concat(workspace.dataQuality.unconvertedPositions).join(", ")}
            {" "}need a price or FX conversion before a complete portfolio total can be shown.
          </p>
        </Card>
      )}

      <HoldingsTable
        positions={workspace.positions}
        query={params.q ?? ""}
        status={parseStatus(params.status)}
        kind={params.kind ?? ""}
      />
    </>
  );
}

async function readWorkspace(): Promise<InvestmentWorkspaceOutput | null> {
  const userId = await currentUserId();
  await ensureSeeded(userId);

  const { investing, repositories } = services();
  const instruments = await repositories.instruments.list(userId, { includeClosed: true });
  if (instruments.length === 0) return null;

  const asOf = CalendarDate.parse(new Date().toISOString().slice(0, 10));
  const workspace = await investing.workspace.execute({ userId, asOf });
  if (!workspace.ok) throw new Error(workspace.error.message);
  return workspace.value;
}

function parseStatus(value: string | undefined): HoldingStatusFilter {
  if (
    value === "priced" ||
    value === "stale" ||
    value === "unpriced" ||
    value === "fx-unavailable"
  ) {
    return value;
  }
  return "";
}

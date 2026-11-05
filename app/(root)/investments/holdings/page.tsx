import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { CalendarDate } from "@/core/time";
import type { InvestmentWorkspaceOutput } from "@/app/investing.usecases";
import { StatusBadge } from "@/components/ui/status-badge";
import { Page as Shell, Masthead, Panel } from "../../../../components/ui/page-shell";
import { Banner } from "../../../../components/ui/banner";
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
      <Shell>
        <Masthead
          title="Holdings"
          side={<><StatusBadge tone="accent">Holdings</StatusBadge><Link href="/investments/new" className="primary-btn h-10 px-4 text-xs">Add investment</Link></>}
        />
        <p className="text-sm text-(--fg-muted)">Open positions appear here once a trade creates units and cost basis.</p>
        <Banner title="No holdings yet">
          <p>Register an investment and record the purchase to create the first holding row.</p>
        </Banner>
      </Shell>
    );
  }

  return (
    <Shell>
      <Masthead
        title="Holdings"
        side={<StatusBadge tone={workspace.dataQuality.status === "COMPLETE" ? "accent" : "neutral"}>{workspace.dataQuality.status.toLowerCase()}</StatusBadge>}
      />
      <p className="text-sm text-(--fg-muted)">Search positions by symbol, name or platform, then open the durable holding record.</p>

      {workspace.dataQuality.status === "PARTIAL" && (
        <Panel title="Complete totals are unavailable">
          <p className="text-sm text-(--fg-secondary)">
            {workspace.dataQuality.unpricedPositions.concat(workspace.dataQuality.unconvertedPositions).join(", ")}
            {" "}need a price or FX conversion before a complete portfolio total can be shown.
          </p>
        </Panel>
      )}

      <HoldingsTable
        positions={workspace.positions}
        query={params.q ?? ""}
        status={parseStatus(params.status)}
        kind={params.kind ?? ""}
      />
    </Shell>
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

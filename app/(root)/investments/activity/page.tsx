import type { Metadata } from "next";
import Link from "next/link";
import { Activity } from "lucide-react";
import { connection } from "next/server";
import { CalendarDate } from "@/core/time";
import type { InvestmentWorkspaceOutput } from "@/app/investing.usecases";
import { Card, EmptyState, PageHeader, Pill } from "@/ui/primitives";
import { currentUserId, ensureSeeded, services } from "@/infra/container";

export const metadata: Metadata = { title: "Investment activity" };

export default async function Page() {
  await connection();

  const workspace = await readWorkspace();

  if (!workspace) {
    return (
      <>
        <PageHeader title="Activity" subtitle="Investment records appear after the first trade." badge={<Pill tone="brand">Activity</Pill>} />
        <section className="panel p-0">
          <EmptyState
            icon={Activity}
            title="No investment activity yet"
            body="Once holdings exist, this page keeps compact links to their durable records and realised-gain history."
          />
        </section>
      </>
    );
  }

  const attention = workspace.positions.filter((position) => position.isStale || !position.marketValue);
  const recent = workspace.positions.slice(0, 8);

  return (
    <>
      <PageHeader
        title="Activity"
        subtitle="Compact links to the investment records that explain the numbers."
        badge={<Pill tone={attention.length === 0 ? "brand" : "neutral"}>{attention.length === 0 ? "current" : `${attention.length} need attention`}</Pill>}
      />

      <div className="grid gap-4 lg:grid-cols-[1fr_22rem]">
        <Card title="Holding records" subtitle="Open the durable record for trades, lots, tax detail and any lease branch.">
          {recent.length === 0 ? (
            <p className="text-sm text-gray-500">No open holding records.</p>
          ) : (
            <ul className="divide-y divide-gray-600/60">
              {recent.map((position) => (
                <li key={position.instrumentId} className="flex items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <Link href={`/investments/${position.instrumentId}`} className="font-medium text-gray-100 hover:text-brand-400">
                      {position.symbol}
                    </Link>
                    <p className="truncate text-xs text-gray-500">{position.name}</p>
                  </div>
                  <span className={position.marketValue && !position.isStale ? "text-xs text-gray-500" : "text-xs text-amber-500"}>
                    {position.marketValue ? (position.isStale ? "stale" : "priced") : "unpriced"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <div className="space-y-4">
          <Card title="Realised history" subtitle="Sales and closed holdings stay visible after the position exits.">
            <Link href="/investments/history" className="ghost-btn h-10 px-4 text-xs">
              Open realised gains
            </Link>
          </Card>
          <Card title="Data quality" subtitle={`Valuation date ${workspace.asOf}`}>
            <p className="text-sm text-gray-300">{workspace.dataQuality.status.toLowerCase()}</p>
            {attention.length > 0 && (
              <ul className="mt-3 space-y-1 text-sm text-amber-500">
                {attention.slice(0, 5).map((position) => (
                  <li key={position.instrumentId}>
                    <Link href={`/investments/${position.instrumentId}`} className="hover:text-amber-300">
                      {position.symbol}: {position.marketValue ? "stale price" : "unpriced"}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
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

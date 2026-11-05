import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { CalendarDate } from "@/core/time";
import type { InvestmentWorkspaceOutput } from "@/app/investing.usecases";
import { StatusBadge } from "@/components/ui/status-badge";
import { Page as Shell, Masthead, Panel } from "../../../../components/ui/page-shell";
import { Banner } from "../../../../components/ui/banner";
import { currentUserId, ensureSeeded, services } from "@/infra/container";

export const metadata: Metadata = { title: "Investment activity" };

export default async function Page() {
  await connection();

  const workspace = await readWorkspace();

  if (!workspace) {
    return (
      <Shell>
        <Masthead title="Activity" side={<StatusBadge tone="accent">Activity</StatusBadge>} />
        <p className="text-sm text-(--fg-muted)">Investment records appear after the first trade.</p>
        <Banner title="No investment activity yet">
          <p>Once holdings exist, this page keeps compact links to their durable records and realised-gain history.</p>
        </Banner>
      </Shell>
    );
  }

  const attention = workspace.positions.filter((position) => position.isStale || !position.marketValue);
  const recent = workspace.positions.slice(0, 8);

  return (
    <Shell>
      <Masthead
        title="Activity"
        side={<StatusBadge tone={attention.length === 0 ? "accent" : "neutral"}>{attention.length === 0 ? "current" : `${attention.length} need attention`}</StatusBadge>}
      />
      <p className="text-sm text-(--fg-muted)">Compact links to the investment records that explain the numbers.</p>

      <div className="grid gap-4 lg:grid-cols-[1fr_22rem]">
        <Panel title="Holding records" description="Open the durable record for trades, lots, tax detail and any lease branch.">
          {recent.length === 0 ? (
            <p className="text-sm text-(--fg-muted)">No open holding records.</p>
          ) : (
            <ul className="divide-y divide-(--border)/60">
              {recent.map((position) => (
                <li key={position.instrumentId} className="flex items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <Link href={`/investments/${position.instrumentId}`} className="font-medium text-(--fg) hover:text-brand-400">
                      {position.symbol}
                    </Link>
                    <p className="truncate text-xs text-(--fg-muted)">{position.name}</p>
                  </div>
                  <span className={position.marketValue && !position.isStale ? "text-xs text-(--fg-muted)" : "text-xs text-(--warn)"}>
                    {position.marketValue ? (position.isStale ? "stale" : "priced") : "unpriced"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <div className="space-y-4">
          <Panel title="Realised history" description="Sales and closed holdings stay visible after the position exits.">
            <Link href="/investments/history" className="ghost-btn h-10 px-4 text-xs">
              Open realised gains
            </Link>
          </Panel>
          <Panel title="Data quality" description={`Valuation date ${workspace.asOf}`}>
            <p className="text-sm text-(--fg-secondary)">{workspace.dataQuality.status.toLowerCase()}</p>
            {attention.length > 0 && (
              <ul className="mt-3 space-y-1 text-sm text-(--warn)">
                {attention.slice(0, 5).map((position) => (
                  <li key={position.instrumentId}>
                    <Link href={`/investments/${position.instrumentId}`} className="hover:text-(--warn)">
                      {position.symbol}: {position.marketValue ? "stale price" : "unpriced"}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>
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

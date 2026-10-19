import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { ArrowLeft } from "lucide-react";
import { CalendarDate } from "@/core/time";
import { CashAsset } from "@/domain/assets";
import { Card, PageHeader, Pill } from "@/ui/primitives";
import { currentUserId, ensureSeeded, services } from "@/infra/container";
import EntryLaneNav, {
  entryLane,
  normalizeEntryLane,
  type EntryLaneSearchParams,
} from "./entry-lane-nav";
import RecordInvestmentForm from "./record-investment-form";
import RecordMetalForm from "./record-metal-form";

export const metadata: Metadata = { title: "Add investment" };

const CARD_TITLE = {
  market: "Record a trade",
  metal: "Record a metal purchase",
  manual: "Record a manual holding",
} as const;

export default async function NewInvestmentPage({
  searchParams,
}: {
  searchParams: Promise<EntryLaneSearchParams>;
}) {
  await connection();

  const userId = await currentUserId();
  await ensureSeeded(userId);

  const lane = normalizeEntryLane((await searchParams).lane);
  const today = CalendarDate.parse(new Date().toISOString().slice(0, 10));
  const { repositories } = services();
  const [accounts, platformRows] = await Promise.all([
    repositories.accounts.list(userId),
    repositories.platforms.list(userId),
  ]);

  const cashAccounts = accounts
    .filter((account) => CashAsset.classify(account) !== null)
    .map((account) => ({ id: account.id.value, label: account.displayName }));
  const platforms = platformRows.map((platform) => ({
    id: platform.id.value,
    name: platform.name,
    kind: platform.kind,
  }));

  return (
    <>
      <PageHeader
        title="Add investment"
        subtitle="Pick what you are adding first — each asset family is identified differently and carries different charges."
        badge={<Pill tone="brand">{entryLane(lane).label}</Pill>}
        action={
          <Link href="/investments" className="ghost-btn h-10 px-4 text-xs">
            <ArrowLeft className="size-4" aria-hidden />
            Investments
          </Link>
        }
      />

      <EntryLaneNav activeLane={lane} />

      <Card title={CARD_TITLE[lane]} subtitle={entryLane(lane).hint}>
        {lane === "metal" ? (
          <RecordMetalForm
            accounts={cashAccounts}
            platforms={platforms}
            defaultDate={today.toISO()}
          />
        ) : (
          <RecordInvestmentForm
            lane={lane}
            accounts={cashAccounts}
            platforms={platforms}
            defaultDate={today.toISO()}
          />
        )}
      </Card>
    </>
  );
}

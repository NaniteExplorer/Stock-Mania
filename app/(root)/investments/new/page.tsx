import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { ArrowLeft } from "lucide-react";
import { CalendarDate } from "@/core/time";
import { CashAsset } from "@/domain/assets";
import { Card, PageHeader, Pill } from "@/ui/primitives";
import { currentUserId, ensureSeeded, services } from "@/infra/container";
import RecordInvestmentForm from "./record-investment-form";

export const metadata: Metadata = { title: "Add investment" };

export default async function NewInvestmentPage() {
  await connection();

  const userId = await currentUserId();
  await ensureSeeded(userId);

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
        subtitle="Search the local instrument catalogue first, then record the trade from the contract note."
        badge={<Pill tone="brand">Search first</Pill>}
        action={
          <Link href="/investments" className="ghost-btn h-10 px-4 text-xs">
            <ArrowLeft className="size-4" aria-hidden />
            Investments
          </Link>
        }
      />

      <Card
        title="Record a trade"
        subtitle="Zerodha is offered as a preferred platform when available, but the holding can sit with any broker, bank, wallet or vault."
      >
        <RecordInvestmentForm
          accounts={cashAccounts}
          platforms={platforms}
          defaultDate={today.toISO()}
        />
      </Card>
    </>
  );
}

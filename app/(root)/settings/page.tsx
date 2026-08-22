import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Coins, ShieldCheck } from "lucide-react";
import { getCurrentSession } from "@/infra/auth/session";
import { Currency } from "@/core/money";
import { Card, PageHeader, Pill } from "@/ui/primitives";

export const metadata: Metadata = { title: "Settings" };

/**
 * Read-only for now, deliberately.
 *
 * v1 let you pick a display currency and stored it in a Mongo user-preferences
 * collection. There is no equivalent table in the v2 schema yet, and inventing
 * one here — ahead of the phase that designs it — would mean a migration to undo
 * later. So this page reports what is true and offers no control it cannot honour.
 */
export default async function SettingsPage() {
  const session = await getCurrentSession();
  if (!session?.user) redirect("/sign-in");
  const { name, email } = session.user;
  const reporting = Currency.reporting;

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeader
        title="Settings"
        subtitle="A deliberately small, manual-first setup."
        badge={<Pill tone="brand">Read-only until Phase 2</Pill>}
      />

      <section className="panel p-6">
        <h2 className="font-semibold text-gray-100">Account</h2>
        <dl className="mt-4 grid grid-cols-[8rem_1fr] gap-y-3 text-sm">
          <dt className="text-gray-500">Name</dt>
          <dd className="text-gray-200">{name}</dd>
          <dt className="text-gray-500">Email</dt>
          <dd className="text-gray-200">{email}</dd>
        </dl>
      </section>

      <section className="panel p-6">
        <div className="flex items-center gap-3">
          <span className="icon-chip">
            <Coins className="h-5 w-5" />
          </span>
          <div>
            <h2 className="font-semibold text-gray-100">Reporting currency</h2>
            <p className="text-xs text-gray-500">
              Amounts are stored in the currency they were entered in and
              reported in this one.
            </p>
          </div>
        </div>
        <p className="tnum mt-4 text-sm text-gray-200">
          {reporting.symbol} · {reporting.code}
        </p>
        <p className="mt-2 text-xs text-gray-500">
          Choosing a different reporting currency needs a preferences table and
          an FX rate book, both of which arrive with the pricing engine.
        </p>
      </section>

      <section className="panel flex items-start gap-3 p-4 text-sm">
        <span className="icon-chip shrink-0">
          <ShieldCheck className="h-5 w-5" />
        </span>
        <p className="text-gray-400">
          <strong className="text-gray-100">Manual mode is active.</strong> No
          broker, mailbox, cloud drive or scheduled sync is connected — and none
          is planned. Everything here is entered by you or imported from a file
          you already have.
        </p>
      </section>
    </div>
  );
}

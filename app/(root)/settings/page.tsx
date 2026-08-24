import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Coins, Landmark, ShieldCheck } from "lucide-react";
import { getCurrentSession } from "@/infra/auth/session";
import { Currency } from "@/core/money";
import { CalendarDate, FinancialYear } from "@/core/time";
import { currentUserId, ensureSeeded, services } from "@/infra/container";
import { PageHeader, Pill } from "@/ui/primitives";
import TaxSettingsForm from "./tax-settings-form";

export const metadata: Metadata = { title: "Settings" };

/**
 * Mostly read-only, and the one editable thing is the one the reports need.
 *
 * The reporting currency still reports rather than offers, because changing it
 * needs a preferences table and an FX rate book. The **tax settings** are
 * different: they are facts about the person that no ledger can derive, and
 * without them the history screen's tax panel ran every assessment at the top
 * slab. That was honest — it said so — and wrong for most people by a wide
 * margin, which is a poor trade for a form with four fields.
 */
export default async function SettingsPage() {
  const session = await getCurrentSession();
  if (!session?.user) redirect("/sign-in");
  const { name, email } = session.user;
  const reporting = Currency.reporting;

  const userId = await currentUserId();
  await ensureSeeded(userId);
  const today = CalendarDate.parse(new Date().toISOString().slice(0, 10));
  const financialYear = FinancialYear.containing(today);
  const stored = await services().repositories.taxSettings.findFor(userId, financialYear);

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeader
        title="Settings"
        subtitle="A deliberately small, manual-first setup."
        badge={<Pill tone="brand">{financialYear.label}</Pill>}
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

      <section className="panel p-6">
        <div className="flex items-center gap-3">
          <span className="icon-chip">
            <Landmark className="h-5 w-5" />
          </span>
          <div>
            <h2 className="font-semibold text-gray-100">Tax settings</h2>
            <p className="text-xs text-gray-500">
              Your circumstances, which no ledger can derive. Stored per financial
              year so a reprinted return keeps the rate it was filed at.
            </p>
          </div>
        </div>
        <TaxSettingsForm
          financialYear={stored?.financialYear ?? financialYear.label}
          marginalSlabPercent={stored ? stored.marginalSlabRate.toFixed(2) : "30"}
          ltcgExemption={stored ? stored.ltcgExemption.toDecimalString() : "125000.00"}
          regimeKey={stored?.regimeKey ?? "india-fy2025"}
          usesNewRegime={stored?.usesNewRegime ?? true}
          isAssumed={stored === null}
        />
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

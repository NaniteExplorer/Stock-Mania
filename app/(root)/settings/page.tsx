import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentSession } from "@/infra/auth/session";
import { Currency } from "@/core/money";
import { CalendarDate, FinancialYear } from "@/core/time";
import { currentUserId, ensureSeeded, services } from "@/infra/container";
import { Masthead, Page, Panel } from "@/components/ui/page-shell";
import { StatusBadge } from "@/components/ui/status-badge";
import { Banner } from "@/components/ui/banner";
import TaxSettingsForm from "./tax-settings-form";
import DateOfBirthForm from "./dob-form";

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
  const projection = await services().projection();
  const profile = await projection.load.execute({ userId: projection.userId });
  const bornOn = profile.ok ? profile.value.bornOn : null;

  return (
    <Page>
      <Masthead
        title="Settings"
        subtitle="A deliberately small, manual-first setup."
        side={<StatusBadge tone="accent">{financialYear.label}</StatusBadge>}
      />

      <Panel title="Account">
        <dl className="grid grid-cols-[8rem_1fr] gap-y-3 text-sm">
          <dt className="text-(--fg-muted)">Name</dt>
          <dd>{name}</dd>
          <dt className="text-(--fg-muted)">Email</dt>
          <dd>{email}</dd>
        </dl>
        <DateOfBirthForm bornOn={bornOn?.toString() ?? ""} />
      </Panel>

      <Panel title="Reporting currency" description="Amounts are stored in the currency they were entered in and reported in this one.">
        <p className="text-sm tabular-nums">
          {reporting.symbol} · {reporting.code}
        </p>
        <p className="mt-2 text-xs text-(--fg-muted)">
          Choosing a different reporting currency needs a preferences table and
          an FX rate book, both of which arrive with the pricing engine.
        </p>
      </Panel>

      <Panel title="Tax settings" description="Your circumstances, which no ledger can derive. Stored per financial year so a reprinted return keeps the rate it was filed at.">
        <TaxSettingsForm
          financialYear={stored?.financialYear ?? financialYear.label}
          marginalSlabPercent={stored ? stored.marginalSlabRate.toFixed(2) : "30"}
          ltcgExemption={stored ? stored.ltcgExemption.toDecimalString() : "125000.00"}
          regimeKey={stored?.regimeKey ?? "india-fy2025"}
          usesNewRegime={stored?.usesNewRegime ?? true}
          isAssumed={stored === null}
        />
      </Panel>

      <Banner title="Manual mode is active.">
        <p>
          No broker, mailbox, cloud drive or scheduled sync is connected — and none
          is planned. Everything here is entered by you or imported from a file
          you already have.
        </p>
      </Banner>
    </Page>
  );
}

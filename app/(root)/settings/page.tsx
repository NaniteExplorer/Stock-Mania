import { getCurrentSession } from "@/lib/better-auth/auth";
import { redirect } from "next/navigation";
import { isConnected as isZerodhaConnected, disconnectZerodha } from "@/features/orders/zerodha.client";
import { isAlpacaConfigured } from "@/features/orders/alpaca.client";
import { userPreferencesService } from "@/features/user/user.preferences";
import { taxSettingsService } from "@/features/tax/tax.settings.service";
import { getDriveImportStatus } from "@/features/imports/drive-import.actions";
import TaxSettingsForm from "@/components/wealth/TaxSettingsForm";
import DriveImportPanel from "@/components/wealth/DriveImportPanel";
import SettingsClient from "./settings-client";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ success?: string; error?: string }>;
}) {
  const session = await getCurrentSession();
  if (!session?.user) redirect("/sign-in");

  const params = await searchParams;
  const [zerodhaOk, prefs, taxSettings, driveStatus] = await Promise.all([
    isZerodhaConnected(session.user.id),
    userPreferencesService.get(session.user.id),
    taxSettingsService.get(session.user.id),
    getDriveImportStatus(),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <SettingsClient
        user={{ id: session.user.id, name: session.user.name, email: session.user.email }}
        zerodhaConnected={zerodhaOk}
        alpacaConfigured={isAlpacaConfigured()}
        prefs={prefs}
        successMessage={params.success}
        errorMessage={params.error}
      />
      <div className="flex max-w-5xl flex-col gap-6">
        <TaxSettingsForm settings={taxSettings} />
        <DriveImportPanel status={driveStatus} />
      </div>
    </div>
  );
}

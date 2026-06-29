import { getCurrentSession } from "@/lib/better-auth/auth";
import { redirect } from "next/navigation";
import { isConnected as isZerodhaConnected, disconnectZerodha } from "@/features/orders/zerodha.client";
import { isAlpacaConfigured } from "@/features/orders/alpaca.client";
import { userPreferencesService } from "@/features/user/user.preferences";
import SettingsClient from "./settings-client";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ success?: string; error?: string }>;
}) {
  const session = await getCurrentSession();
  if (!session?.user) redirect("/sign-in");

  const params = await searchParams;
  const [zerodhaOk, prefs] = await Promise.all([
    isZerodhaConnected(session.user.id),
    userPreferencesService.get(session.user.id),
  ]);

  return (
    <SettingsClient
      user={{ id: session.user.id, name: session.user.name, email: session.user.email }}
      zerodhaConnected={zerodhaOk}
      alpacaConfigured={isAlpacaConfigured()}
      prefs={prefs}
      successMessage={params.success}
      errorMessage={params.error}
    />
  );
}

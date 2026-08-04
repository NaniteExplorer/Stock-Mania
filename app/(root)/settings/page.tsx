import { getCurrentSession } from "@/lib/better-auth/auth";
import { redirect } from "next/navigation";
import { userPreferencesService } from "@/features/user/user.preferences";
import SettingsClient from "./settings-client";

export default async function SettingsPage() {
  const session = await getCurrentSession();
  if (!session?.user) redirect("/sign-in");
  const prefs = await userPreferencesService.get(session.user.id);
  return <SettingsClient user={{ name: session.user.name, email: session.user.email }} displayCurrency={prefs.displayCurrency} />;
}

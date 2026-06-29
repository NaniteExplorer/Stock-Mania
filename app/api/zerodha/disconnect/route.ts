import { getCurrentSession } from "@/lib/better-auth/auth";
import { disconnectZerodha } from "@/features/orders/zerodha.client";
import { config } from "@/core/config/env";

export async function GET(): Promise<Response> {
  const base = config.app().baseUrl;
  const session = await getCurrentSession();
  if (!session?.user) {
    return Response.redirect(new URL("/sign-in", base));
  }
  await disconnectZerodha(session.user.id);
  return Response.redirect(new URL("/settings?success=zerodha_disconnected", base));
}

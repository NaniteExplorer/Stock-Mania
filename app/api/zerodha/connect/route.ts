import { getCurrentSession } from "@/lib/better-auth/auth";
import { getLoginUrl } from "@/features/orders/zerodha.client";
import { config } from "@/core/config/env";

export async function GET(): Promise<Response> {
  const session = await getCurrentSession();
  if (!session?.user) {
    return Response.redirect(
      new URL("/sign-in", config.app().baseUrl),
    );
  }

  // Redirect the browser to Zerodha's OAuth login page.
  // After login, Zerodha calls back our /api/zerodha/callback route.
  const loginUrl = getLoginUrl();
  return Response.redirect(loginUrl);
}

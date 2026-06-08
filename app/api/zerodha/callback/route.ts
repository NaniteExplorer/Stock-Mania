import { getCurrentSession } from "@/lib/better-auth/auth";
import { exchangeToken, storeAccessToken } from "@/features/orders/zerodha.client";
import { config } from "@/core/config/env";
import { logger } from "@/core/logger";

// Zerodha request tokens are alphanumeric strings up to 64 chars.
const REQUEST_TOKEN_RE = /^[A-Za-z0-9]{1,64}$/;

export async function GET(request: Request): Promise<Response> {
  const base = config.app().baseUrl;
  const { searchParams } = new URL(request.url);
  const requestToken = searchParams.get("request_token");
  const status = searchParams.get("status");

  if (status === "error" || !requestToken || !REQUEST_TOKEN_RE.test(requestToken)) {
    return Response.redirect(new URL("/settings?error=zerodha_auth_failed", base));
  }

  const session = await getCurrentSession();
  if (!session?.user) {
    return Response.redirect(new URL("/sign-in", base));
  }

  try {
    const accessToken = await exchangeToken(requestToken);
    await storeAccessToken(session.user.id, accessToken);
    return Response.redirect(new URL("/settings?success=zerodha_connected", base));
  } catch (err) {
    logger.error("[zerodha/callback] token exchange failed", err);
    return Response.redirect(new URL("/settings?error=zerodha_token_exchange", base));
  }
}

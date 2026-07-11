import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { getCurrentSession } from "@/lib/better-auth/auth";
import { getLoginUrl, ZERODHA_STATE_COOKIE } from "@/features/orders/zerodha.client";
import { config } from "@/core/config/env";

export async function GET(): Promise<Response> {
  const session = await getCurrentSession();
  if (!session?.user) {
    return Response.redirect(
      new URL("/sign-in", config.app().baseUrl),
    );
  }

  // CSRF protection: bind this OAuth round-trip to the browser with a random
  // state — Kite echoes redirect_params back to our callback, where it must
  // match the httpOnly cookie set here.
  const state = randomBytes(16).toString("hex");
  const cookieStore = await cookies();
  cookieStore.set(ZERODHA_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: config.app().nodeEnv === "production",
    maxAge: 10 * 60,
    path: "/api/zerodha",
  });

  // Redirect the browser to Zerodha's OAuth login page.
  // After login, Zerodha calls back our /api/zerodha/callback route.
  const loginUrl = new URL(getLoginUrl());
  loginUrl.searchParams.set("redirect_params", `state=${state}`);
  return Response.redirect(loginUrl);
}

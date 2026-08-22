import { NextRequest, NextResponse } from "next/server";
import { getSessionCookie } from "better-auth/cookies";

/**
 * Next.js 16 renamed `middleware` to `proxy` (Node.js runtime). This is an
 * OPTIMISTIC auth gate only — it checks for the presence of a session cookie to
 * redirect signed-out users early. Real authorization is enforced per page/route
 * via getCurrentSession(). Do not treat this as a security boundary.
 */
/**
 * Public routes that never require a session cookie.
 *
 * `/forgot-password` and `/reset-password` are here for a reason: without them a
 * signed-out user clicking the emailed reset link was redirected straight to
 * /sign-in, which made password reset impossible to complete. They are reached
 * precisely when there is no session.
 */
const PUBLIC_PATHS = new Set([
  "/",
  "/sign-in",
  "/sign-up",
  "/forgot-password",
  "/reset-password",
]);

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Public marketing landing + auth pages stay open to signed-out visitors.
  if (PUBLIC_PATHS.has(pathname)) return NextResponse.next();

  const sessionCookie = getSessionCookie(request);

  // No cookie -> send to sign-in for any gated route.
  if (!sessionCookie) {
    return NextResponse.redirect(new URL("/sign-in", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|icon.svg|apple-icon|sign-in|sign-up|assets).*)",
  ],
};

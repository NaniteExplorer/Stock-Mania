import { NextRequest, NextResponse } from "next/server";
import { getSessionCookie } from "better-auth/cookies";

/**
 * Next.js 16 renamed `middleware` to `proxy` (Node.js runtime). This is an
 * OPTIMISTIC auth gate only — it checks for the presence of a session cookie to
 * redirect signed-out users early. Real authorization is enforced per page/route
 * via getCurrentSession(). Do not treat this as a security boundary.
 */
export function proxy(request: NextRequest) {
  const sessionCookie = getSessionCookie(request);

  // No cookie -> send to sign-in. (Redirecting to "/" would loop, since "/" is
  // also matched here.)
  if (!sessionCookie) {
    return NextResponse.redirect(new URL("/sign-in", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|sign-in|sign-up|assets).*)",
  ],
};

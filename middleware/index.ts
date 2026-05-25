import {NextRequest, NextResponse} from "next/server";
import {getSessionCookie} from "better-auth/cookies";

export async function middleware(request: NextRequest) {
  const sessionCookie = getSessionCookie(request);

  //     THIS IS NOT SECURE
  //     THIS IS THE RECOMMENDED APPROACH TO OPTIMISTICALLY REDIRECT USERS
  //     WE RECOMMEND HANDLING AUTH CHECKS IN EACH PAGE/ROUTE
  if (!sessionCookie) {
    return NextResponse.redirect(new URL("/", request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|sign-in|sign-up|assets).*)",
  ],
};

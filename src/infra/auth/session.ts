import "server-only";

import { cache } from "react";
import { headers } from "next/headers";
import { auth } from "./server";

/**
 * Thrown when the session cannot be read because the database is unreachable —
 * deliberately distinct from "no session", so an outage renders a 503-style
 * state instead of silently bouncing a signed-in user to the sign-in page.
 */
export class AuthUnavailableError extends Error {
  constructor(cause: unknown) {
    super("Auth is unavailable (database unreachable)");
    this.name = "AuthUnavailableError";
    this.cause = cause;
  }
}

// Dedupe outage logs: one line per window rather than one per call site.
let lastUnavailableLogAt = 0;
const UNAVAILABLE_LOG_WINDOW_MS = 30_000;

/**
 * Per-request memoised session read. The layout, the page and every server
 * action in one request share a single query.
 *
 * Returns `null` only for "not signed in".
 */
export const getCurrentSession = cache(async () => {
  try {
    return await auth.api.getSession({ headers: await headers() });
  } catch (error) {
    // Next signals "this route must be dynamic" by throwing out of headers()
    // during prerender. That is control flow, not a failure — let it through
    // untouched or the route silently renders an error state.
    if ((error as { digest?: string })?.digest === "DYNAMIC_SERVER_USAGE") {
      throw error;
    }
    if (Date.now() - lastUnavailableLogAt > UNAVAILABLE_LOG_WINDOW_MS) {
      lastUnavailableLogAt = Date.now();
      console.error("Unable to read auth session", error);
    }
    throw new AuthUnavailableError(error);
  }
});

/**
 * For call sites that prefer "outage is treated as signed out" — public pages
 * that only use the session to decide whether to show user chrome.
 */
export const getOptionalSession = async () => {
  try {
    return await getCurrentSession();
  } catch (error) {
    if ((error as { digest?: string })?.digest === "DYNAMIC_SERVER_USAGE") {
      throw error;
    }
    return null;
  }
};

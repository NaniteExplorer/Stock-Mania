import { cache } from "react";
import { betterAuth } from "better-auth";
import { mongodbAdapter } from "better-auth/adapters/mongodb";
import {
  connectToDatabase,
  DatabaseUnavailableError,
} from "@/core/db/connection";
import { config } from "@/core/config/env";
import { nextCookies } from "better-auth/next-js";
import type { Db } from "mongodb";
import { headers } from "next/headers";
import {
  sendPasswordResetEmail,
  sendVerificationEmail,
} from "@/lib/nodemailer";
import { logger } from "@/core/logger";

const isProduction = config.app().nodeEnv === "production";

const createAuth = (db: Parameters<typeof mongodbAdapter>[0]) =>
  betterAuth({
    database: mongodbAdapter(db),
    secret: config.auth().secret,
    baseURL: config.auth().baseUrl,
    // Only accept auth requests originating from our own app (defense-in-depth
    // against cross-site requests on top of Next's same-origin Server Actions).
    trustedOrigins: [config.auth().baseUrl],
    emailAndPassword: {
      enabled: true,
      disableSignUp: false,
      // In production users must confirm their email before they can sign in.
      // In local/dev we skip this — SMTP usually isn't reachable, so the
      // verification email never arrives and accounts would be unusable.
      requireEmailVerification: isProduction,
      minPasswordLength: 8,
      maxPasswordLength: 128,
      autoSignIn: false,
      // Emails a reset link pointing at our /reset-password page (token embedded).
      sendResetPassword: async ({ user, token }) => {
        const url = `${config.auth().baseUrl}/reset-password?token=${token}`;
        try {
          await sendPasswordResetEmail({ email: user.email, name: user.name, url });
        } catch (err) {
          logger.error("Failed to send password reset email", err);
        }
      },
    },
    emailVerification: {
      // Send the verification email on sign-up only in production (matches
      // requireEmailVerification); avoids noisy SMTP failures in local dev.
      sendOnSignUp: isProduction,
      autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ user, url }) => {
        try {
          await sendVerificationEmail({ email: user.email, name: user.name, url });
        } catch (err) {
          logger.error("Failed to send verification email", err);
        }
      },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 7, // 7 days
      updateAge: 60 * 60 * 24, // refresh the cookie once per day
    },
    advanced: {
      // Force the Secure flag in production regardless of inferred protocol.
      useSecureCookies: isProduction,
      defaultCookieAttributes: {
        httpOnly: true,
        sameSite: "lax",
      },
    },
    plugins: [nextCookies()],
  });

let authInstance: ReturnType<typeof createAuth> | null = null;

export const auth = async () => {
  if (authInstance) return authInstance;

  const mongoose = await connectToDatabase();
  const db = mongoose.connection.db;

  if (!db) {
    throw new Error("MongoDB connection not found");
  }

  // Mongoose bundles its own copy of the mongodb driver, so its Db type is
  // structurally identical but nominally different from our top-level `mongodb`
  // package's Db — hence the cast. Safe as long as both driver majors match.
  authInstance = createAuth(db as unknown as Db);

  return authInstance;
};

/**
 * Thrown when the session cannot be read because infrastructure (DB) is down —
 * distinct from "no session" so callers don't treat an outage as logged-out.
 */
export class AuthUnavailableError extends Error {
  constructor(cause: unknown) {
    super("Auth is unavailable (database unreachable)");
    this.name = "AuthUnavailableError";
    this.cause = cause;
  }
}

// Dedupe outage logs: one line per window instead of one per call site.
let lastUnavailableLogAt = 0;
const UNAVAILABLE_LOG_WINDOW_MS = 30_000;

/**
 * Per-request memoized session read (React cache): the layout, pages and every
 * server action in one request share a single DB lookup.
 *
 * Returns `null` only for "not signed in". Infrastructure failures throw
 * AuthUnavailableError so the caller can render a 503-style state instead of
 * bouncing the user to sign-in.
 */
export const getCurrentSession = cache(async () => {
  try {
    const authInstance = await auth();

    return await authInstance.api.getSession({
      headers: await headers(),
    });
  } catch (error) {
    // Next.js signals "this route must be dynamic" by throwing from headers()
    // during prerender — control flow, not a failure. Let it propagate as-is.
    if ((error as { digest?: string })?.digest === "DYNAMIC_SERVER_USAGE") {
      throw error;
    }
    if (Date.now() - lastUnavailableLogAt > UNAVAILABLE_LOG_WINDOW_MS) {
      lastUnavailableLogAt = Date.now();
      logger.error("Unable to read auth session", error);
    }
    throw new AuthUnavailableError(
      error instanceof DatabaseUnavailableError ? error.cause : error,
    );
  }
});

/**
 * Convenience for call sites that prefer "outage → treated as signed out"
 * (e.g. public pages that just hide user chrome).
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

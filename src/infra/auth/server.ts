import "server-only";

import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";

import { db } from "@/infra/db/client";
import { users, sessions, authAccounts, verifications } from "@/infra/db/schema";
import { config } from "@/core/config";
import { sendPasswordResetEmail, sendVerificationEmail } from "./mail";

const isProduction = config.app().nodeEnv === "production";

/**
 * The auth instance.
 *
 * Unlike v1 this is a plain `const`, not an async factory: libSQL needs no
 * connection handshake before the adapter can be built, so the lazy singleton
 * and its `await auth()` at every call site are gone.
 *
 * The explicit `schema` map is required, not decorative. better-auth resolves
 * its models by the singular names `user`, `session`, `account` and
 * `verification`, while our schema module exports them as `users`, `sessions`,
 * `authAccounts` and `verifications`. Without the map the adapter cannot find a
 * table. `usePlural` stays false for the same reason it looks tempting: the SQL
 * table names are already singular — it is only the JS bindings that are plural.
 *
 * `camelCase` is deliberately unset. Our columns are camelCase in both the SQL
 * and the Drizzle keys (`emailVerified`, `createdAt`), so the default field
 * resolution already lines up.
 */
export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "sqlite",
    schema: {
      user: users,
      session: sessions,
      account: authAccounts,
      verification: verifications,
    },
    // libSQL over HTTP has awkward transaction semantics with Drizzle; the
    // sequential path is what better-auth defaults to and is sufficient here.
    transaction: false,
  }),
  secret: config.auth().secret,
  baseURL: config.auth().baseUrl,
  // Only accept auth requests originating from our own app — defence in depth
  // on top of Next's same-origin Server Actions.
  trustedOrigins: [config.auth().baseUrl],
  emailAndPassword: {
    enabled: true,
    disableSignUp: false,
    // Production requires a confirmed email. Local development does not: SMTP is
    // usually unreachable there, so the verification mail never arrives and
    // every account would be permanently unusable.
    requireEmailVerification: isProduction,
    minPasswordLength: 8,
    maxPasswordLength: 128,
    autoSignIn: false,
    sendResetPassword: async ({ user, token }) => {
      const url = `${config.auth().baseUrl}/reset-password?token=${token}`;
      await sendPasswordResetEmail({ email: user.email, name: user.name, url });
    },
  },
  emailVerification: {
    sendOnSignUp: isProduction,
    autoSignInAfterVerification: true,
    sendVerificationEmail: async ({ user, url }) => {
      await sendVerificationEmail({ email: user.email, name: user.name, url });
    },
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 days
    updateAge: 60 * 60 * 24, // refresh the cookie once a day
  },
  /**
   * v1 threw away its rate limiting when `core/ratelimit` (Redis-backed) was
   * deleted, which silently removed the 5-per-15-minute cap on sign-in. These
   * built-in rules restore it without a Redis dependency.
   */
  rateLimit: {
    enabled: true,
    window: 60,
    max: 30,
    storage: "memory",
    customRules: {
      "/sign-in/email": { window: 900, max: 5 },
      "/sign-up/email": { window: 3600, max: 10 },
      "/request-password-reset": { window: 900, max: 5 },
      "/reset-password": { window: 900, max: 5 },
    },
  },
  advanced: {
    useSecureCookies: isProduction,
    defaultCookieAttributes: { httpOnly: true, sameSite: "lax" },
  },
  plugins: [nextCookies()],
});

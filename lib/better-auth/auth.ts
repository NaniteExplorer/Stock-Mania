import { betterAuth } from "better-auth";
import { mongodbAdapter } from "better-auth/adapters/mongodb";
import { connectToDatabase } from "@/core/db/connection";
import { config } from "@/core/config/env";
import { nextCookies } from "better-auth/next-js";
import type { Db } from "mongodb"; // <-- 1. Import the top-level Db type
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
      // Users must confirm their email before they can sign in. autoSignIn is
      // therefore off — sign-up returns a "check your email" state instead.
      requireEmailVerification: true,
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
      // Better Auth sends this automatically on sign-up because
      // requireEmailVerification is true; sendOnSignUp makes that explicit.
      sendOnSignUp: true,
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

  // 2. Cast the Mongoose DB to the top-level MongoDB Db type
  authInstance = createAuth(db as unknown as Db);

  return authInstance;
};

export const getCurrentSession = async () => {
  try {
    const authInstance = await auth();

    return await authInstance.api.getSession({
      headers: await headers(),
    });
  } catch (error) {
    logger.error("Unable to read auth session", error);
    return null;
  }
};

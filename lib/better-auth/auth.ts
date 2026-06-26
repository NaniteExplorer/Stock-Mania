import { betterAuth } from "better-auth";
import { mongodbAdapter } from "better-auth/adapters/mongodb";
import { connectToDatabase } from "@/core/db/connection";
import { config } from "@/core/config/env";
import { nextCookies } from "better-auth/next-js";
import type { Db } from "mongodb"; // <-- 1. Import the top-level Db type
import { headers } from "next/headers";
import { sendPasswordResetEmail } from "@/lib/nodemailer";
import { logger } from "@/core/logger";

const createAuth = (db: Parameters<typeof mongodbAdapter>[0]) =>
  betterAuth({
    database: mongodbAdapter(db),
    secret: config.auth().secret,
    baseURL: config.auth().baseUrl,
    emailAndPassword: {
      enabled: true,
      disableSignUp: false,
      requireEmailVerification: false,
      minPasswordLength: 8,
      maxPasswordLength: 128,
      autoSignIn: true,
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
    console.error("Unable to read auth session", error);
    return null;
  }
};

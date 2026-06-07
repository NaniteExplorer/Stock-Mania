"use server";

import { headers } from "next/headers";
import { eventBus } from "@/core/queue/event-bus";
import { auth } from "@/lib/better-auth/auth";
import { rateLimiter } from "@/core/ratelimit";
import { logger } from "@/core/logger";

const MINUTE = 60 * 1000;

async function getClientIp(): Promise<string> {
  const h = await headers();
  const forwarded = h.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return h.get("x-real-ip") || "unknown";
}

/** Fail-open rate-limit guard: returns true if the action may proceed. */
async function withinLimit(
  key: string,
  limit: number,
  windowMs: number,
): Promise<boolean> {
  try {
    const { allowed } = await rateLimiter.check(key, limit, windowMs);
    return allowed;
  } catch {
    logger.warn("Rate limiter unavailable; allowing request", { key });
    return true;
  }
}

export const signUpWithEmail = async ({
  email,
  password,
  fullName,
  country,
  investmentGoals,
  riskTolerance,
  preferredIndustry,
}: SignUpFormData) => {
  try {
    const ip = await getClientIp();
    if (!(await withinLimit(`signup:${ip}`, 10, 60 * MINUTE))) {
      return {
        success: false,
        error: "Too many sign-up attempts. Please try again later.",
      };
    }

    const authInstance = await auth();
    const response = await authInstance.api.signUpEmail({
      body: { email, password, name: fullName },
    });

    if (response) {
      await eventBus.publish({
        name: "app/user.created",
        data: {
          email,
          name: fullName,
          country,
          investmentGoals,
          riskTolerance,
          preferredIndustry,
        },
      });
    }
    return { success: true, data: response };
  } catch (error) {
    logger.error("Sign up failed", error);
    return { success: false, error: "Sign up failed" };
  }
};

export const signInWithEmail = async ({ email, password }: SignInFormData) => {
  try {
    const ip = await getClientIp();
    // Per IP + email — throttles credential stuffing / brute force.
    if (!(await withinLimit(`signin:${ip}:${email}`, 5, 15 * MINUTE))) {
      return {
        success: false,
        error:
          "Too many sign-in attempts. Please wait a few minutes and try again.",
      };
    }

    const authInstance = await auth();
    const response = await authInstance.api.signInEmail({
      body: { email, password },
    });
    return { success: true, data: response };
  } catch (error) {
    logger.error("Sign in failed", error);
    return { success: false, error: "Sign in failed" };
  }
};

export const signOut = async () => {
  try {
    const authInstance = await auth();
    await authInstance.api.signOut({ headers: await headers() });
  } catch (e) {
    logger.error("Sign out failed", e);
    return { success: false, error: "Sign out failed" };
  }
};

"use server";

import { headers } from "next/headers";
import { eventBus } from "@/core/queue/event-bus";
import { auth } from "@/lib/better-auth/auth";
import { rateLimiter } from "@/core/ratelimit";
import { logger } from "@/core/logger";
import { sendWelcomeEmail } from "@/lib/nodemailer";

/** A warm, profile-personalised welcome message (no AI dependency). */
function buildWelcomeIntro({
  investmentGoals,
  riskTolerance,
  preferredIndustry,
}: Pick<SignUpFormData, "investmentGoals" | "riskTolerance" | "preferredIndustry">): string {
  const goal = (investmentGoals || "growth").toLowerCase();
  const risk = (riskTolerance || "balanced").toLowerCase();
  const industry = preferredIndustry || "the markets";
  return (
    `Your ${risk}-risk, ${goal}-focused workspace is ready. ` +
    `Track your complete net worth — accounts, investments, ESOPs and assets — ` +
    `keep an eye on ${industry}, and act with AI-powered market context. Welcome to the calm way to manage money.`
  );
}

const MINUTE = 60 * 1000;

// Loose but sufficient: rejects non-IP garbage that could poison rate-limit keys.
const IP_RE = /^[\d.a-f:]{2,45}$/i;

function sanitizeIp(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const candidate = raw.trim();
  return IP_RE.test(candidate) ? candidate : null;
}

async function getClientIp(): Promise<string> {
  const h = await headers();
  // x-real-ip is set by the outermost proxy and cannot be forged by clients.
  const realIp = sanitizeIp(h.get("x-real-ip"));
  if (realIp) return realIp;
  // x-forwarded-for: leftmost entry is client-supplied and can be spoofed.
  // Take the rightmost entry, which is the one added by the trusted proxy.
  const forwarded = h.get("x-forwarded-for");
  if (forwarded) {
    const parts = forwarded.split(",");
    for (let i = parts.length - 1; i >= 0; i--) {
      const ip = sanitizeIp(parts[i]);
      if (ip) return ip;
    }
  }
  return "unknown";
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

/**
 * Turn a Better-Auth APIError into a clear, user-facing message. Better-Auth
 * throws an error carrying `body.code` (machine code) and `body.message`; we map
 * the codes users actually hit to friendly copy and fall back gracefully.
 */
function describeAuthError(error: unknown, fallback: string): string {
  const e = error as { body?: { code?: string; message?: string } };
  switch (e?.body?.code) {
    case "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL":
    case "USER_ALREADY_EXISTS":
      return "An account with this email already exists. Try signing in instead.";
    case "INVALID_EMAIL_OR_PASSWORD":
      return "Incorrect email or password. Please try again.";
    case "INVALID_PASSWORD":
      return "Incorrect password. Please try again.";
    case "USER_NOT_FOUND":
      return "No account found with this email.";
    case "PASSWORD_TOO_SHORT":
      return "Your password must be at least 8 characters.";
    case "INVALID_TOKEN":
    case "TOKEN_EXPIRED":
      return "This reset link is invalid or has expired. Request a new one.";
    default:
      return e?.body?.message || fallback;
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

    // Everything below is best-effort: a failure here must NEVER fail an account
    // that was already created.
    if (response) {
      // Personalised welcome email — sent directly so it always lands, even when
      // background workers (Inngest/Kafka) aren't running.
      try {
        await sendWelcomeEmail({
          email,
          name: fullName,
          intro: buildWelcomeIntro({ investmentGoals, riskTolerance, preferredIndustry }),
        });
      } catch (emailError) {
        logger.warn("welcome email failed (non-fatal)", { emailError });
      }

      // Domain event for any background consumers (analytics, etc.).
      try {
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
      } catch (publishError) {
        logger.warn("user.created event publish failed (non-fatal)", {
          publishError,
        });
      }
    }
    return { success: true, data: response };
  } catch (error) {
    logger.error("Sign up failed", error);
    return {
      success: false,
      error: describeAuthError(error, "We couldn't create your account. Please try again."),
    };
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
    return {
      success: false,
      error: describeAuthError(error, "We couldn't sign you in. Please try again."),
    };
  }
};

/**
 * Start the password-reset flow. Always reports success to the caller so the UI
 * cannot be used to discover which emails are registered (enumeration safety).
 */
export const requestPasswordReset = async (email: string) => {
  try {
    const ip = await getClientIp();
    if (!(await withinLimit(`reset:${ip}`, 5, 15 * MINUTE))) {
      return {
        success: false,
        error: "Too many requests. Please wait a few minutes and try again.",
      };
    }

    const authInstance = await auth();
    await authInstance.api.requestPasswordReset({
      body: { email, redirectTo: "/reset-password" },
    });
    return { success: true };
  } catch (error) {
    // Swallow real errors too — never reveal whether the email exists.
    logger.warn("requestPasswordReset issue", { error });
    return { success: true };
  }
};

/** Complete the reset using the token from the emailed link. */
export const resetPassword = async (token: string, newPassword: string) => {
  try {
    const authInstance = await auth();
    await authInstance.api.resetPassword({ body: { token, newPassword } });
    return { success: true };
  } catch (error) {
    logger.error("resetPassword failed", error);
    return {
      success: false,
      error: describeAuthError(error, "This reset link is invalid or has expired."),
    };
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

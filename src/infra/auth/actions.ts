"use server";

import { headers } from "next/headers";
import { z } from "zod";

import { auth } from "./server";
import { sendWelcomeEmail } from "./mail";
import { DEFAULT_COUNTRY_CODE, countryByCode } from "@/ui/countries";

/**
 * Auth server actions.
 *
 * Ported from v1's `lib/actions/auth.actions.ts`, minus the parts that died with
 * it: the Redis rate limiter (better-auth's own `rateLimit` config replaces it —
 * see `server.ts`), the `user.created` event-bus publish (no message queue in
 * v2), and the AI-flavoured welcome copy that consumed the investment-goal /
 * risk-tolerance / preferred-industry fields the sign-up form no longer collects.
 *
 * Kept, because both are genuinely good: the explicit password-strength messages,
 * and the error-code map that turns better-auth codes into copy a user can act on.
 */

const emailSchema = z.string().trim().toLowerCase().email("Enter a valid email address.");
const nameSchema = z.string().trim().min(2, "Enter your full name.").max(120);

function validatePasswordStrength(password: string): string | null {
  if (password.length < 8) return "Your password must be at least 8 characters.";
  if (password.length > 128) return "Your password must be 128 characters or fewer.";
  if (!/[a-z]/.test(password)) return "Your password must include a lowercase letter.";
  if (!/[A-Z]/.test(password)) return "Your password must include an uppercase letter.";
  if (!/\d/.test(password)) return "Your password must include a number.";
  if (!/[^A-Za-z0-9]/.test(password)) return "Your password must include a symbol.";
  return null;
}

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
    case "EMAIL_NOT_VERIFIED":
      return "Please verify your email first. Check your inbox for the verification link.";
    case "TOO_MANY_REQUESTS":
      return "Too many attempts. Please wait a few minutes and try again.";
    default:
      return e?.body?.message || fallback;
  }
}

export interface SignUpInput {
  fullName: string;
  email: string;
  password: string;
  country: string;
}

export async function signUpWithEmail(input: SignUpInput) {
  try {
    const email = emailSchema.safeParse(input.email);
    if (!email.success) {
      return { success: false as const, error: email.error.issues[0].message };
    }
    const name = nameSchema.safeParse(input.fullName);
    if (!name.success) {
      return { success: false as const, error: name.error.issues[0].message };
    }
    const weak = validatePasswordStrength(input.password);
    if (weak) return { success: false as const, error: weak };

    const country = countryByCode(input.country)?.code ?? DEFAULT_COUNTRY_CODE;

    const response = await auth.api.signUpEmail({
      body: { email: email.data, password: input.password, name: name.data },
    });

    // Best effort, and deliberately after the account exists: a bounced welcome
    // email must never fail a sign-up that already succeeded.
    if (response) {
      await sendWelcomeEmail({
        email: email.data,
        name: name.data,
        intro:
          "Your workspace is ready. Add your accounts to start tracking net worth, " +
          "spending and investments in one ledger.",
      });
    }

    return { success: true as const, requiresVerification: true, country };
  } catch (error) {
    console.error("auth.signup.failed", error);
    return {
      success: false as const,
      error: describeAuthError(error, "We couldn't create your account. Please try again."),
    };
  }
}

export async function signInWithEmail(input: { email: string; password: string }) {
  try {
    const email = emailSchema.safeParse(input.email);
    if (!email.success) {
      return { success: false as const, error: "Incorrect email or password. Please try again." };
    }
    await auth.api.signInEmail({ body: { email: email.data, password: input.password } });
    return { success: true as const };
  } catch (error) {
    // Never reveal whether the submitted email address exists.
    void error;
    return {
      success: false as const,
      error: "Incorrect email or password. Please try again.",
    };
  }
}

export async function requestPasswordReset(email: string) {
  try {
    const parsed = emailSchema.safeParse(email);
    // Report success even for a malformed address: the response must not reveal
    // whether an account exists.
    if (parsed.success) {
      await auth.api.requestPasswordReset({
        body: { email: parsed.data, redirectTo: "/reset-password" },
      });
    }
  } catch (error) {
    console.warn("auth.reset.request.issue", error);
  }
  return { success: true as const };
}

export async function resetPassword(token: string, newPassword: string) {
  try {
    // The same strength policy as sign-up — otherwise reset is a backdoor to a
    // weak password.
    const weak = validatePasswordStrength(newPassword);
    if (weak) return { success: false as const, error: weak };

    await auth.api.resetPassword({ body: { token, newPassword } });
    return { success: true as const };
  } catch (error) {
    return {
      success: false as const,
      error: describeAuthError(error, "This reset link is invalid or has expired."),
    };
  }
}

export async function signOut() {
  try {
    await auth.api.signOut({ headers: await headers() });
    return { success: true as const };
  } catch (error) {
    console.error("auth.signout.failed", error);
    return { success: false as const, error: "Sign out failed" };
  }
}

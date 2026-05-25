"use server";

import { inngest } from "@/lib/inngest/client";
import { auth } from "@/lib/better-auth/auth";
import { headers } from "next/headers";

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
    // 1. Await the function to get the actual better-auth instance
    const authInstance = await auth();

    // 2. Call the API on the returned instance
    const response = await authInstance.api.signUpEmail({
      body: { email, password, name: fullName },
    });

    if (response) {
      await inngest.send({
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
    console.log("Sign up failed", error);
    return {
      success: false,
      error: "Sign up failed",
    };
  }
};
export const signInWithEmail = async ({ email, password }: SignInFormData) => {
  try {
    // 1. Await the function to get the actual better-auth instance
    const authInstance = await auth();

    // 2. Call the API on the returned instance
    const response = await authInstance.api.signInEmail({
      body: { email, password },
    });

    return { success: true, data: response };
  } catch (error) {
    console.log("Sign in failed", error);
    return {
      success: false,
      error: "Sign in failed",
    };
  }
};

export const signOut = async () => {
  try {
    const authInstance = await auth();
    await authInstance.api.signOut({ headers: await headers() });
  } catch (e) {
    console.log("sign out failer", e);
    return { success: false, error: "Sign out failed" };
  }
};

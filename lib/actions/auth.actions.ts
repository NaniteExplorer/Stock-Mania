"use server";

import { inngest } from "@/lib/inngest/client";
import { auth } from "@/lib/better-auth/auth";

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

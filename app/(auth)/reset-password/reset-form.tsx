"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import InputField from "@/components/forms/InputField";
import { resetPassword } from "@/lib/actions/auth.actions";

interface ResetForm {
  newPassword: string;
  confirmPassword: string;
}

export default function ResetForm({ token }: { token: string }) {
  const router = useRouter();
  const {
    register,
    handleSubmit,
    getValues,
    formState: { errors, isSubmitting },
  } = useForm<ResetForm>({
    defaultValues: { newPassword: "", confirmPassword: "" },
    mode: "onBlur",
  });

  if (!token) {
    return (
      <div className="text-center">
        <h1 className="form-title">Invalid reset link</h1>
        <p className="mb-8 text-sm leading-6 text-gray-500">
          This link is missing its token or has expired. Request a new one to continue.
        </p>
        <Link href="/forgot-password" className="btn-brand inline-flex items-center justify-center px-6">
          Request a new link
        </Link>
      </div>
    );
  }

  const onSubmit = async ({ newPassword }: ResetForm) => {
    try {
      const result = await resetPassword(token, newPassword);
      if (result.success) {
        toast.success("Password updated", {
          description: "You can now sign in with your new password.",
        });
        router.push("/sign-in");
      } else {
        toast.error("Couldn't reset password", { description: result.error });
      }
    } catch {
      toast.error("Something went wrong", {
        description: "Please try again in a moment.",
      });
    }
  };

  return (
    <>
      <h1 className="form-title">Set a new password</h1>
      <p className="mb-8 text-sm leading-6 text-gray-500">
        Choose a strong password you don&apos;t use anywhere else.
      </p>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
        <InputField
          name="newPassword"
          label="New password"
          type="password"
          placeholder="At least 8 characters"
          register={register}
          error={errors.newPassword}
          validation={{
            required: "Password is required",
            minLength: { value: 8, message: "Use at least 8 characters" },
          }}
        />

        <InputField
          name="confirmPassword"
          label="Confirm password"
          type="password"
          placeholder="Re-enter your password"
          register={register}
          error={errors.confirmPassword}
          validation={{
            required: "Please confirm your password",
            validate: (value: string) =>
              value === getValues("newPassword") || "Passwords do not match",
          }}
        />

        <Button type="submit" disabled={isSubmitting} className="btn-brand mt-2 w-full">
          {isSubmitting ? "Updating…" : "Update password"}
        </Button>

        <p className="text-center text-sm text-gray-500">
          <Link href="/sign-in" className="footer-link">
            Back to sign in
          </Link>
        </p>
      </form>
    </>
  );
}

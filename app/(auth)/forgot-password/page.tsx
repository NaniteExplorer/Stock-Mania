"use client";

import { useState } from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { MailCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import InputField from "@/components/forms/InputField";
import { requestPasswordReset } from "@/lib/actions/auth.actions";

interface ForgotForm {
  email: string;
}

const ForgotPassword = () => {
  const [sentTo, setSentTo] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ForgotForm>({ defaultValues: { email: "" }, mode: "onBlur" });

  const onSubmit = async ({ email }: ForgotForm) => {
    try {
      const result = await requestPasswordReset(email);
      if (result.success) {
        setSentTo(email);
        toast.success("Check your inbox", {
          description: "If an account exists for that email, a reset link is on its way.",
        });
      } else {
        toast.error("Couldn't send reset link", { description: result.error });
      }
    } catch {
      toast.error("Something went wrong", {
        description: "Please try again in a moment.",
      });
    }
  };

  if (sentTo) {
    return (
      <div className="text-center">
        <span className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl border border-green-500/25 bg-green-500/10 text-green-500">
          <MailCheck className="h-7 w-7" />
        </span>
        <h1 className="form-title">Check your email</h1>
        <p className="mb-8 text-sm leading-6 text-gray-500">
          If an account exists for <span className="font-semibold text-gray-300">{sentTo}</span>,
          we&apos;ve sent a link to reset your password. The link expires in 1 hour.
        </p>
        <Link href="/sign-in" className="btn-brand inline-flex items-center justify-center px-6">
          Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <>
      <h1 className="form-title">Forgot password?</h1>
      <p className="mb-8 text-sm leading-6 text-gray-500">
        Enter the email linked to your account and we&apos;ll send you a secure
        link to reset your password.
      </p>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
        <InputField
          name="email"
          label="Email"
          placeholder="you@company.com"
          register={register}
          error={errors.email}
          validation={{
            required: "Email is required",
            pattern: { value: /^\w+@\w+\.\w+$/, message: "Enter a valid email" },
          }}
        />

        <Button type="submit" disabled={isSubmitting} className="btn-brand mt-2 w-full">
          {isSubmitting ? "Sending link…" : "Send reset link"}
        </Button>

        <p className="text-center text-sm text-gray-500">
          Remembered it?{" "}
          <Link href="/sign-in" className="footer-link">
            Back to sign in
          </Link>
        </p>
      </form>
    </>
  );
};

export default ForgotPassword;

"use client";

import Link from "next/link";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/button";
import InputField from "../../../components/forms/InputField";
import FooterLink from "@/components/forms/FooterLink";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { signInWithEmail } from "@/infra/auth/actions";

const SignIn = () => {
  const router = useRouter();
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<SignInFormData>({
    defaultValues: {
      email: "",
      password: "",
    },
    mode: "onBlur",
  });

  const onSubmit = async (data: SignInFormData) => {
    try {
      const result = await signInWithEmail(data);
      if (result.success) {
        toast.success("Welcome back!");
        router.push("/dashboard");
      } else {
        toast.error(result.error ?? "We couldn't sign you in.");
      }
    } catch (e) {
      console.error(e);
      toast.error("We couldn't sign you in. Please try again.");
    }
  };

  return (
    <>
      <h1 className="form-title">Welcome back</h1>
      <p className="mb-8 text-sm leading-6 text-gray-500">
        Sign in to track your complete net worth — accounts, investments, ESOPs
        and assets — alongside live markets and AI signals.
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
            pattern: /^\w+@\w+\.\w+$/,
          }}
        />

        <InputField
          name="password"
          label="Password"
          placeholder="Enter your password"
          type="password"
          register={register}
          error={errors.password}
          validation={{ required: "Password is required", minLength: 8 }}
        />

        <div className="flex justify-end">
          <Link
            href="/forgot-password"
            className="text-sm font-medium text-brand-500 hover:brightness-110"
          >
            Forgot password?
          </Link>
        </div>

        <Button
          type="submit"
          disabled={isSubmitting}
          className="btn-brand w-full mt-2"
        >
          {isSubmitting ? "Signing in" : "Enter dashboard"}
        </Button>

        <FooterLink
          text="Don't have an account?"
          linkText="Create an account"
          href="/sign-up"
        />
      </form>
    </>
  );
};
export default SignIn;

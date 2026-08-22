"use client";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/button";
import InputField from "@/components/forms/InputField";
import { CountrySelectField } from "@/components/forms/CountrySelectField";
import { DEFAULT_COUNTRY_CODE } from "@/ui/countries";
import FooterLink from "@/components/forms/FooterLink";
import { signUpWithEmail } from "@/infra/auth/actions";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

const SignUp = () => {
  const router = useRouter();
  const {
    register,
    handleSubmit,
    control,
    formState: { errors, isSubmitting },
  } = useForm<SignUpFormData>({
    defaultValues: {
      fullName: "",
      email: "",
      password: "",
      country: DEFAULT_COUNTRY_CODE,
    },
    mode: "onBlur",
  });

  const onSubmit = async (data: SignUpFormData) => {
    try {
      const result = await signUpWithEmail(data);
      if (result?.success) {
        toast.success("Account created", {
          description:
            "Check your email and click the verification link to activate your account.",
        });
        router.push("/sign-in");
      } else {
        toast.error(result?.error ?? "We couldn't create your account.");
      }
    } catch (e) {
      console.error(e);
      toast.error("We couldn't create your account. Please try again.");
    }
  };

  return (
    <>
      <h1 className="form-title">Start tracking your net worth</h1>
      <p className="mb-8 text-sm leading-6 text-gray-500">
        Create your account to bring accounts, investments, ESOPs and assets
        together in one exact, double-entry ledger.
      </p>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
        <InputField
          name="fullName"
          label="Full Name"
          placeholder="Aarav Sharma"
          register={register}
          error={errors.fullName}
          validation={{ required: "Full name is required", minLength: 2 }}
        />

        <InputField
          name="email"
          label="Email"
          placeholder="you@company.com"
          register={register}
          error={errors.email}
          validation={{
            required: "Email is required",
            pattern: {
              value: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
              message: "Enter a valid email address",
            },
          }}
        />

        <InputField
          name="password"
          label="Password"
          placeholder="8+ chars with upper, lower, number & symbol"
          type="password"
          register={register}
          error={errors.password}
          validation={{
            required: "Password is required",
            minLength: { value: 8, message: "At least 8 characters" },
            validate: (value: string) =>
              /[a-z]/.test(value) &&
              /[A-Z]/.test(value) &&
              /\d/.test(value) &&
              /[^A-Za-z0-9]/.test(value)
                ? true
                : "Include upper, lower, a number and a symbol",
          }}
        />

        <CountrySelectField
          name="country"
          label="Country"
          control={control}
          error={errors.country}
          required
        />

        <Button
          type="submit"
          disabled={isSubmitting}
          className="btn-brand w-full mt-5"
        >
          {isSubmitting ? "Creating account" : "Create secure workspace"}
        </Button>

        <FooterLink
          text="Already have an account?"
          linkText="Sign in"
          href="/sign-in"
        />
      </form>
    </>
  );
};
export default SignUp;

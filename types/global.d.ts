import type { Control, FieldError, RegisterOptions, UseFormRegister } from "react-hook-form";

/**
 * Ambient form types shared by the auth pages and `components/forms/`.
 *
 * v1 declared ~30 globals here, most of them shapes for the Finnhub, watchlist,
 * alerts and news features that v2 drops. What remains is the sign-up/sign-in
 * form data and the props of the four form primitives.
 *
 * `SignUpFormData` lost `investmentGoals`, `riskTolerance` and `preferredIndustry`
 * along with the AI onboarding that read them.
 */
declare global {
  type SignInFormData = {
    email: string;
    password: string;
  };

  type SignUpFormData = {
    fullName: string;
    email: string;
    password: string;
    country: string;
  };

  type FormInputProps = {
    name: string;
    label: string;
    placeholder: string;
    type?: string;
    register: UseFormRegister;
    error?: FieldError;
    validation?: RegisterOptions;
    disabled?: boolean;
    value?: string;
  };

  type Option = {
    value: string;
    label: string;
  };

  type SelectFieldProps = {
    name: string;
    label: string;
    placeholder: string;
    options: readonly Option[];
    control: Control;
    error?: FieldError;
    required?: boolean;
  };

  type FooterLinkProps = {
    text: string;
    linkText: string;
    href: string;
  };
}

export {};

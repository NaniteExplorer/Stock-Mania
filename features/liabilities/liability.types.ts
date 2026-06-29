export type LiabilityType =
  | "HOME_LOAN"
  | "CAR_LOAN"
  | "PERSONAL_LOAN"
  | "EDUCATION_LOAN"
  | "CREDIT_CARD"
  | "OTHER";

export const LIABILITY_TYPE_LABELS: Record<LiabilityType, string> = {
  HOME_LOAN: "Home loan",
  CAR_LOAN: "Car / vehicle loan",
  PERSONAL_LOAN: "Personal loan",
  EDUCATION_LOAN: "Education loan",
  CREDIT_CARD: "Credit card",
  OTHER: "Other",
};

export interface Liability {
  id: string;
  userId: string;
  name: string;
  lender: string;
  type: LiabilityType;
  /** Current amount still owed (in INR). */
  outstanding: number;
  /** Optional monthly instalment. */
  emi: number | null;
  /** Optional annual interest rate (%). */
  interestRate: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateLiabilityInput {
  name: string;
  lender: string;
  type: LiabilityType;
  outstanding: number;
  emi?: number | null;
  interestRate?: number | null;
}

export type UpdateLiabilityInput = Partial<CreateLiabilityInput>;

export type GoldLeaseStatus = "ACTIVE" | "CLOSED";

export interface LeaseAccrual {
  date: Date;
  grams: number;
}

export interface GoldLease {
  id: string;
  userId: string;
  name: string;
  /** Principal grams placed on lease. */
  leasedGrams: number;
  /** Annual lease yield, paid in additional grams. */
  annualRatePercent: number;
  startDate: Date;
  /** Optional fixed term; principal is returned at the end. null = open-ended. */
  termMonths: number | null;
  status: GoldLeaseStatus;
  /** Cumulative grams earned from accruals so far. */
  accruedGrams: number;
  lastAccruedAt: Date;
  accruals: LeaseAccrual[];
  createdAt: Date;
  updatedAt: Date;
  // derived
  totalGrams: number; // leasedGrams + accruedGrams
  valueInr: number; // totalGrams × ₹/gram (0 if price unavailable)
}

export interface CreateGoldLeaseInput {
  name: string;
  leasedGrams: number;
  annualRatePercent: number;
  startDate: string; // ISO
  termMonths?: number | null;
}

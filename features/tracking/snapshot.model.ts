import { Model, Schema, model, models } from "mongoose";
import type { MonthlyWealthMetrics, MonthlyWealthValues, SnapshotSource } from "./tracking.types";

export interface SnapshotBreakdownDoc {
  accounts: number;
  investments: number;
  brokerage: number;
  esops: number;
  assets: number;
  liabilities: number;
  creditCard: number;
}

export interface NetWorthSnapshotDoc {
  userId: string;
  capturedAt: Date;
  /** "YYYY-MM" month bucket — unique per user (idempotency key). */
  periodKey: string;
  currency: string;
  totalAssets: number;
  totalLiabilities: number;
  netWorth: number;
  breakdown: SnapshotBreakdownDoc;
  values: MonthlyWealthValues | null;
  metrics: MonthlyWealthMetrics | null;
  contributions: number;
  withdrawals: number;
  marketMovement: number;
  income: number;
  debtReduction: number;
  source: SnapshotSource;
  note: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const BreakdownSchema = new Schema<SnapshotBreakdownDoc>(
  {
    accounts: { type: Number, default: 0 },
    investments: { type: Number, default: 0 },
    brokerage: { type: Number, default: 0 },
    esops: { type: Number, default: 0 },
    assets: { type: Number, default: 0 },
    liabilities: { type: Number, default: 0 },
    creditCard: { type: Number, default: 0 },
  },
  { _id: false },
);

const MonthlyValuesSchema = new Schema<MonthlyWealthValues>(
  {
    cash: { type: Number, default: 0 }, indianStocks: { type: Number, default: 0 },
    usStocks: { type: Number, default: 0 }, cryptoCurrency: { type: Number, default: 0 },
    etfs: { type: Number, default: 0 }, reits: { type: Number, default: 0 },
    digitalGold: { type: Number, default: 0 }, creditCardLoans: { type: Number, default: 0 },
    loans: { type: Number, default: 0 }, sbiBank: { type: Number, default: 0 },
    jioPaymentsBank: { type: Number, default: 0 }, axisBank: { type: Number, default: 0 },
    mutualFunds: { type: Number, default: 0 }, ppf: { type: Number, default: 0 },
    rdFd: { type: Number, default: 0 }, nps: { type: Number, default: 0 },
    epfo: { type: Number, default: 0 }, equityCryptoPnl: { type: Number, default: 0 },
    lifeInsurance: { type: Number, default: 0 }, healthInsurance: { type: Number, default: 0 },
  },
  { _id: false },
);

const MonthlyMetricsSchema = new Schema<MonthlyWealthMetrics>(
  {
    inHand: { type: Number, default: 0 }, cashExcludingSalary: { type: Number, default: 0 },
    midTerm: { type: Number, default: 0 }, longTerm: { type: Number, default: 0 },
    totalDebts: { type: Number, default: 0 }, netWorth: { type: Number, default: 0 },
    totalWorth: { type: Number, default: 0 },
  },
  { _id: false },
);

const SnapshotSchema = new Schema<NetWorthSnapshotDoc>(
  {
    userId: { type: String, required: true, index: true },
    capturedAt: { type: Date, required: true, index: true },
    periodKey: { type: String, required: true },
    currency: { type: String, required: true, default: "INR", uppercase: true },
    totalAssets: { type: Number, required: true, default: 0 },
    totalLiabilities: { type: Number, required: true, default: 0 },
    netWorth: { type: Number, required: true, default: 0 },
    breakdown: { type: BreakdownSchema, default: () => ({}) },
    values: { type: MonthlyValuesSchema, default: null },
    metrics: { type: MonthlyMetricsSchema, default: null },
    contributions: { type: Number, default: 0 },
    withdrawals: { type: Number, default: 0 },
    marketMovement: { type: Number, default: 0 },
    income: { type: Number, default: 0 },
    debtReduction: { type: Number, default: 0 },
    source: { type: String, required: true, enum: ["MANUAL", "IMPORTED", "EDITED"], default: "MANUAL" },
    note: { type: String, default: null },
  },
  { timestamps: true },
);

// One snapshot per user per month — auto-capture, re-capture and CSV re-import
// all upsert into the same row instead of duplicating.
SnapshotSchema.index({ userId: 1, periodKey: 1 }, { unique: true });

export const NetWorthSnapshot: Model<NetWorthSnapshotDoc> =
  (models?.networthsnapshot as Model<NetWorthSnapshotDoc>) ||
  model<NetWorthSnapshotDoc>("networthsnapshot", SnapshotSchema);

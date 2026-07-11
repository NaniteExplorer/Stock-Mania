import { Model, Schema, model, models } from "mongoose";
import type { SnapshotSource } from "./tracking.types";

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
    contributions: { type: Number, default: 0 },
    withdrawals: { type: Number, default: 0 },
    marketMovement: { type: Number, default: 0 },
    income: { type: Number, default: 0 },
    debtReduction: { type: Number, default: 0 },
    source: { type: String, required: true, enum: ["AUTO", "MANUAL", "IMPORTED", "EDITED"], default: "AUTO" },
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

import { connectToDatabase } from "@/core/db/connection";
import { Schema, model, models } from "mongoose";

interface UserPreferences {
  userId: string;
  whatsappNumber: string | null;
  whatsappAlertsEnabled: boolean;
  emailAlertsEnabled: boolean;
  displayCurrency: string;
  /** Own/family account numbers, UPI handles or names — used to flag self transfers. */
  selfPayees: string[];
  updatedAt: Date;
}

const prefsSchema = new Schema<UserPreferences>(
  {
    userId: { type: String, required: true, unique: true, index: true },
    whatsappNumber: { type: String, default: null },
    whatsappAlertsEnabled: { type: Boolean, default: false },
    emailAlertsEnabled: { type: Boolean, default: true },
    displayCurrency: { type: String, default: "INR", uppercase: true },
    selfPayees: { type: [String], default: [] },
  },
  { timestamps: { createdAt: false, updatedAt: "updatedAt" } },
);

const PrefsModel =
  models.UserPreferences ?? model<UserPreferences>("UserPreferences", prefsSchema);

export const userPreferencesService = {
  async get(userId: string): Promise<UserPreferences> {
    await connectToDatabase();
    const raw = await PrefsModel.findOne({ userId }).lean();
    const doc = raw as (UserPreferences & { _id?: unknown }) | null;
    if (!doc) {
      return {
        userId,
        whatsappNumber: null,
        whatsappAlertsEnabled: false,
        emailAlertsEnabled: true,
        displayCurrency: "INR",
        selfPayees: [],
        updatedAt: new Date(),
      };
    }
    return {
      userId: doc.userId,
      whatsappNumber: doc.whatsappNumber ?? null,
      whatsappAlertsEnabled: doc.whatsappAlertsEnabled ?? false,
      emailAlertsEnabled: doc.emailAlertsEnabled ?? true,
      displayCurrency: doc.displayCurrency ?? "INR",
      selfPayees: doc.selfPayees ?? [],
      updatedAt: doc.updatedAt,
    };
  },

  async update(
    userId: string,
    patch: Partial<Omit<UserPreferences, "userId" | "updatedAt">>,
  ): Promise<void> {
    await connectToDatabase();
    await PrefsModel.findOneAndUpdate(
      { userId },
      { $set: patch },
      { upsert: true },
    );
  },
};

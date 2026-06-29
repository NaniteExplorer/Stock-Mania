import { connectToDatabase } from "@/core/db/connection";
import { TaxSettings as TaxSettingsModel, type TaxSettingsDoc } from "./tax.settings.model";
import { DEFAULT_TAX_CONFIG } from "./tax.config";
import type { TaxConfig } from "./tax.config";

export interface TaxSettings {
  slabPercent: number;
  ltcgExemption: number;
  equityStcgPercent: number;
  equityLtcgPercent: number;
  equityLtcgThresholdDays: number;
  cryptoRatePercent: number;
  goldLtcgPercent: number;
  goldLtcgThresholdDays: number;
}

const DEFAULT_SETTINGS: TaxSettings = {
  slabPercent: 30,
  ltcgExemption: 125000,
  equityStcgPercent: 20,
  equityLtcgPercent: 12.5,
  equityLtcgThresholdDays: 365,
  cryptoRatePercent: 30,
  goldLtcgPercent: 12.5,
  goldLtcgThresholdDays: 730,
};

/** Build a resolved TaxConfig from a user's editable settings. */
export function toTaxConfig(s: TaxSettings): TaxConfig {
  const base = DEFAULT_TAX_CONFIG;
  return {
    slabPercent: s.slabPercent,
    ltcgExemption: s.ltcgExemption,
    rules: {
      EQUITY: { ...base.rules.EQUITY, shortTermRatePercent: s.equityStcgPercent, longTermRatePercent: s.equityLtcgPercent, ltcgThresholdDays: s.equityLtcgThresholdDays },
      EQUITY_MF: { ...base.rules.EQUITY_MF, shortTermRatePercent: s.equityStcgPercent, longTermRatePercent: s.equityLtcgPercent, ltcgThresholdDays: s.equityLtcgThresholdDays },
      DEBT: { ...base.rules.DEBT },
      CRYPTO: { ...base.rules.CRYPTO, shortTermRatePercent: s.cryptoRatePercent, longTermRatePercent: s.cryptoRatePercent },
      GOLD: { ...base.rules.GOLD, longTermRatePercent: s.goldLtcgPercent, ltcgThresholdDays: s.goldLtcgThresholdDays },
    },
  };
}

const toSettings = (doc: TaxSettingsDoc | null): TaxSettings => ({
  slabPercent: doc?.slabPercent ?? DEFAULT_SETTINGS.slabPercent,
  ltcgExemption: doc?.ltcgExemption ?? DEFAULT_SETTINGS.ltcgExemption,
  equityStcgPercent: doc?.equityStcgPercent ?? DEFAULT_SETTINGS.equityStcgPercent,
  equityLtcgPercent: doc?.equityLtcgPercent ?? DEFAULT_SETTINGS.equityLtcgPercent,
  equityLtcgThresholdDays: doc?.equityLtcgThresholdDays ?? DEFAULT_SETTINGS.equityLtcgThresholdDays,
  cryptoRatePercent: doc?.cryptoRatePercent ?? DEFAULT_SETTINGS.cryptoRatePercent,
  goldLtcgPercent: doc?.goldLtcgPercent ?? DEFAULT_SETTINGS.goldLtcgPercent,
  goldLtcgThresholdDays: doc?.goldLtcgThresholdDays ?? DEFAULT_SETTINGS.goldLtcgThresholdDays,
});

export const taxSettingsService = {
  defaults(): TaxSettings {
    return { ...DEFAULT_SETTINGS };
  },

  async get(userId: string): Promise<TaxSettings> {
    await connectToDatabase();
    const doc = await TaxSettingsModel.findOne({ userId }).lean<TaxSettingsDoc>();
    return toSettings(doc);
  },

  async getConfig(userId: string): Promise<TaxConfig> {
    return toTaxConfig(await this.get(userId));
  },

  async save(userId: string, input: Partial<TaxSettings>): Promise<void> {
    await connectToDatabase();
    await TaxSettingsModel.updateOne({ userId }, { $set: { userId, ...input } }, { upsert: true });
  },
};

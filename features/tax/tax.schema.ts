import { z } from "zod";

const pct = z.number().min(0).max(100);
const days = z.number().int().min(0).max(3650);

export const taxSettingsSchema = z.object({
  slabPercent: pct,
  ltcgExemption: z.number().min(0),
  equityStcgPercent: pct,
  equityLtcgPercent: pct,
  equityLtcgThresholdDays: days,
  cryptoRatePercent: pct,
  goldLtcgPercent: pct,
  goldLtcgThresholdDays: days,
});

/**
 * Brand identity — single source of truth.
 *
 * Safe to import from both Server and Client Components (contains no secrets).
 * Rebranding the app = editing this file + the theme tokens in app/globals.css.
 */
export const BRAND = {
  name: "stockMania",
  legalName: "stockMania",
  tagline: "Track markets. Spot signals. Trade with conviction.",
  description:
    "Track real-time stock prices, build watchlists, get AI-powered market summaries, and explore deep company insights.",
  email: {
    /** Display name shown in the email "From" field. The actual address is the
     *  authenticated SMTP user (see core/config/env.ts -> email.user). */
    fromName: "stockMania",
    /** Public contact address used in email copy/links. */
    support: "support@stockmania.app",
  },
  copyrightYear: 2026,
  address: "stockMania HQ",
} as const;

export type Brand = typeof BRAND;

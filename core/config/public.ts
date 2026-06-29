/**
 * Client-safe configuration. Only NEXT_PUBLIC_* values live here — they are
 * inlined into the browser bundle at build time. NEVER put secrets here.
 */
export const publicConfig = {
  baseUrl: process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000",
} as const;

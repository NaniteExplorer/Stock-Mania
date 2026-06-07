/**
 * Next.js instrumentation — runs once when the server starts.
 * Validates configuration early so misconfiguration is visible at boot rather
 * than on the first request. See https://nextjs.org/docs/app/guides/instrumentation
 */
export async function register() {
  // Only run in the Node.js server runtime (skip edge / build analysis).
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { validateServerConfig } = await import("@/core/config/env");
  validateServerConfig();
}

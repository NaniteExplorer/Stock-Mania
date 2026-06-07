/**
 * Next.js instrumentation — runs once when the server starts.
 * Node.js-specific code (DNS setup, config validation) lives in
 * instrumentation.node.ts so the edge-runtime bundler never sees node:dns.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./instrumentation.node");
  }
}

import type { NextConfig } from "next";

// Baseline security headers applied to every response. These are safe with the
// TradingView embeds. A Content-Security-Policy is intentionally NOT enabled
// here because it must allowlist the TradingView script/frame origins — see
// SECURITY.md for a ready-to-enable, scoped CSP to verify against the widgets.
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), browsing-topics=()",
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  { key: "X-DNS-Prefetch-Control", value: "on" },
];

const nextConfig: NextConfig = {
  // standalone output is only needed for Docker self-hosting.
  // Set NEXT_OUTPUT=standalone in your Dockerfile build stage; leave it unset for Vercel.
  ...(process.env.NEXT_OUTPUT === "standalone" ? { output: "standalone" } : {}),
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;

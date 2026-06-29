import type { NextConfig } from "next";

// Content-Security-Policy. Scoped to allowlist the TradingView script/frame
// origins (and Finnhub / Google APIs used by the client) so the embedded
// widgets keep working. 'unsafe-inline' is required because Next.js and the
// TradingView widgets inject inline scripts/styles without a nonce; tighten to
// a nonce-based policy (see node_modules/next/dist/docs/.../content-security-policy.md)
// if those inline scripts are ever eliminated.
//
// 'unsafe-eval' is added in development ONLY: React/Turbopack use eval() for
// debugging features (callstacks, fast refresh). React never uses eval() in
// production, so the production policy stays strict.
const isDev = process.env.NODE_ENV === "development";

const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""} https://s3.tradingview.com https://*.tradingview.com`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https:",
  "frame-src https://*.tradingview.com https://www.tradingview.com",
  "connect-src 'self' https://*.tradingview.com https://finnhub.io https://*.googleapis.com",
  "font-src 'self' data:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
]
  .join("; ")
  .concat(";");

// Baseline security headers applied to every response.
const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
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
  experimental: { serverActions: { bodySizeLimit: "3mb" } },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;

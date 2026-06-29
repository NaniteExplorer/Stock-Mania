/**
 * Per-IP rate limiting for public API route handlers (Request-based).
 *
 * Server Actions use `lib/actions/auth.actions.ts` helpers (next/headers based);
 * this variant reads the IP off a Web `Request` so it works in route handlers
 * such as the SSE price stream and the health check.
 */
import { rateLimiter } from "@/core/ratelimit";
import { logger } from "@/core/logger";

// Loose but sufficient: rejects non-IP garbage that could poison limiter keys.
const IP_RE = /^[\d.a-f:]{2,45}$/i;

function sanitizeIp(raw: string | null): string | null {
  if (!raw) return null;
  const candidate = raw.trim();
  return IP_RE.test(candidate) ? candidate : null;
}

export function requestIp(request: Request): string {
  const realIp = sanitizeIp(request.headers.get("x-real-ip"));
  if (realIp) return realIp;
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const parts = forwarded.split(",");
    // Rightmost entry is added by the trusted proxy; leftmost can be spoofed.
    for (let i = parts.length - 1; i >= 0; i--) {
      const ip = sanitizeIp(parts[i]);
      if (ip) return ip;
    }
  }
  return "unknown";
}

/**
 * Returns a 429 Response when the caller is over the limit, or null when the
 * request may proceed. Fails open if the limiter backend is unavailable.
 */
export async function enforceRequestRateLimit(
  request: Request,
  prefix: string,
  limit: number,
  windowMs: number,
): Promise<Response | null> {
  const key = `${prefix}:${requestIp(request)}`;
  try {
    const { allowed, resetMs } = await rateLimiter.check(key, limit, windowMs);
    if (allowed) return null;
    return new Response("Too many requests", {
      status: 429,
      headers: { "Retry-After": String(Math.ceil(resetMs / 1000)) },
    });
  } catch {
    logger.warn("Rate limiter unavailable; allowing request", { key });
    return null;
  }
}

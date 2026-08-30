import { readFile } from "node:fs/promises";
import path from "node:path";
import type { NextRequest } from "next/server";
import { findFinancialProvider } from "@/ui/providers";

/**
 * Logo proxy. The client always requests this single same-origin URL; we
 * resolve the institution logo once, server-side, and cache it hard.
 *
 * Why a proxy (the "permanent" fix):
 *  - one stable, CSP-clean URL instead of flaky third-party <img> sources
 *  - the upstream fetch is cached (Next data cache + Cache-Control), so a slow
 *    or rate-limited logo host is hit at most once per revalidation window
 *  - a curated local asset (provider.logo) always wins
 *  - favicons are the last-resort fallback; a 404 lets the client render our own
 *    branded gradient badge. We never fabricate a bank's logo.
 *
 * A miss is cached as hard as a hit, which is the half that was missing. For a
 * bank neither favicon service knows - State Bank of India is one - every source
 * fails on every request, and an uncached 404 meant the same ~2.8s of upstream
 * lookups was repeated on every page that drew the badge. The client had already
 * handled the 404 correctly; what was expensive was arriving at it again.
 */
export const runtime = "nodejs";
export const revalidate = 604800; // 7 days

const MIN_ICON_BYTES = 100; // guard against empty/placeholder responses
// Google upscales nothing: when it has no large icon it returns a ~200-700 byte
// 16px stub. Require a real 128px-worth of bytes or skip to the next source.
const MIN_GOOGLE_ICON_BYTES = 1500;
const MAX_ICON_BYTES = 1_000_000;
const ALLOWED_REMOTE_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/x-icon",
  "image/vnd.microsoft.icon",
]);

/**
 * How long to wait on one upstream before giving up on it.
 *
 * `fetch` has no default timeout, so a host that accepts the connection and then
 * stalls holds this route open indefinitely - the failure mode Clearbit's
 * withdrawal produced, and the reason it had to be removed from the ladder
 * rather than left to fail naturally. A budget per source keeps a hung host to a
 * bounded cost instead of an open-ended one.
 */
const UPSTREAM_TIMEOUT_MS = 3000;

/** Browser caching for a miss. Matches a hit, so a badge costs one lookup a day. */
const MISS_CACHE_CONTROL = "public, max-age=86400, s-maxage=604800";

/**
 * Misses already served, by provider id, so a second request in the same server
 * process skips the upstreams entirely.
 *
 * `Cache-Control` alone fixes the repeat only for a browser that has already
 * asked. This covers the rest: a fresh tab, a hard reload, another user, and dev,
 * where there is no CDN honouring `s-maxage` at all. Bounded by construction -
 * the key space is the provider list, which is a fixed table in the source, so
 * this cannot grow without someone adding a bank.
 */
const missUntil = new Map<string, number>();
const MISS_TTL_MS = 86_400_000; // a day, matching what the browser is told

function missIsFresh(id: string): boolean {
  const until = missUntil.get(id);
  if (until === undefined) return false;
  if (until > Date.now()) return true;
  missUntil.delete(id);
  return false;
}

/** A 404 the caller is told to remember, so the client draws its own badge. */
function noLogo(id: string): Response {
  missUntil.set(id, Date.now() + MISS_TTL_MS);
  return new Response(null, { status: 404, headers: { "Cache-Control": MISS_CACHE_CONTROL } });
}

/**
 * Ordered upstream logo URLs for a domain, keyless only.
 *
 * v1 also tried logo.dev and Brandfetch when their API keys were set. Both are
 * gone: v2 takes no API keys.
 *
 * Clearbit is gone too, and not by preference — its keyless logo API has been
 * withdrawn and the host now refuses the connection outright. Leaving it first in
 * the ladder meant every single lookup paid a connect timeout before reaching a
 * source that works, on a route whose whole job is to be fast and cached.
 *
 * What remains are two favicon services. A favicon is not a logo, which is why a
 * genuine curated asset still wins and why a miss returns 404 rather than a
 * guess — the client then draws our own badge, which does not pretend to be
 * anybody's brand.
 */
function candidateSources(domain: string): Array<{ url: string; minBytes: number }> {
  return [
    {
      url: `https://www.google.com/s2/favicons?domain=${domain}&sz=128`,
      minBytes: MIN_GOOGLE_ICON_BYTES,
    },
    { url: `https://icons.duckduckgo.com/ip3/${domain}.ico`, minBytes: MIN_ICON_BYTES },
  ];
}

async function fetchImage(url: string, minBytes: number): Promise<Response | null> {
  try {
    const res = await fetch(url, {
      next: { revalidate },
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const contentType = (res.headers.get("content-type") ?? "").split(";", 1)[0]!.trim().toLowerCase();
    if (!ALLOWED_REMOTE_IMAGE_TYPES.has(contentType)) return null;
    const declaredLength = Number(res.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_ICON_BYTES) return null;
    const buffer = await res.arrayBuffer();
    if (buffer.byteLength < minBytes || buffer.byteLength > MAX_ICON_BYTES) return null;
    return new Response(buffer, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        // No `immutable`: an upstream favicon can be superseded by a curated
        // asset, and browsers must be able to pick that up within a day.
        "Cache-Control": "public, max-age=86400, s-maxage=604800",
      },
    });
  } catch {
    return null;
  }
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const provider = findFinancialProvider(id);
  // An unknown id is not a lookup at all, and must not be remembered as a miss:
  // it is a bug or a stale link, and caching it would hide a later fix.
  if (!provider) {
    return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
  }

  // 1. Curated local asset wins outright. Served inline (not a redirect) so
  // the browser caches the crisp vector itself, never a stale redirect target.
  if (provider.logo) {
    try {
      const publicRoot = path.resolve(process.cwd(), "public");
      const filePath = path.resolve(publicRoot, provider.logo.replace(/^[/\\]+/, ""));
      if (filePath !== publicRoot && !filePath.startsWith(`${publicRoot}${path.sep}`)) {
        return noLogo(provider.id);
      }
      const bytes = await readFile(filePath);
      if (bytes.byteLength > MAX_ICON_BYTES) return noLogo(provider.id);
      const contentType = provider.logo.endsWith(".svg")
        ? "image/svg+xml"
        : provider.logo.endsWith(".webp")
          ? "image/webp"
          : "image/png";
      return new Response(new Uint8Array(bytes), {
        status: 200,
        headers: {
          "Content-Type": contentType,
          "Cache-Control": "public, max-age=86400, s-maxage=604800",
          ...(contentType === "image/svg+xml"
            ? { "Content-Security-Policy": "default-src 'none'; sandbox" }
            : {}),
        },
      });
    } catch {
      // fall through to remote sources if the curated file is missing
    }
  }
  if (!provider.domain) return noLogo(provider.id);

  /*
   * A provider that failed every source recently fails them again, so skip
   * straight to the badge rather than repeating lookups that cannot succeed.
   *
   * Deliberately below the curated asset and not above it: this guards the
   * network, not the route. Checking it earlier would be faster and wrong -
   * dropping a logo file into `public/` would appear to do nothing until the
   * remembered miss expired, which is the sort of delay that gets diagnosed as a
   * broken feature.
   */
  if (missIsFresh(provider.id)) {
    return new Response(null, { status: 404, headers: { "Cache-Control": MISS_CACHE_CONTROL } });
  }

  // 2. Try logo providers (real logos) then the favicon fallback, in order.
  for (const { url, minBytes } of candidateSources(provider.domain)) {
    const image = await fetchImage(url, minBytes);
    if (image) return image;
  }

  // 3. No logo available — the client renders our branded badge.
  return noLogo(provider.id);
}

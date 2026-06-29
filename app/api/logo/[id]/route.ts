import type { NextRequest } from "next/server";
import { config } from "@/core/config/env";
import { findFinancialProvider } from "@/lib/financial-providers";

/**
 * Logo proxy. The client always requests this single same-origin URL; we
 * resolve the institution logo once, server-side, and cache it hard.
 *
 * Why a proxy (the "permanent" fix):
 *  - one stable, CSP-clean URL instead of flaky third-party <img> sources
 *  - the upstream fetch is cached (Next data cache + Cache-Control), so a slow
 *    or rate-limited logo host is hit at most once per revalidation window
 *  - a curated local asset (provider.logo) always wins
 *  - a real logo PROVIDER (logo.dev / Brandfetch) is used when a token is set,
 *    giving proper brand logos rather than favicons
 *  - favicon is the keyless fallback; a 404 lets the client render our own
 *    branded gradient badge. We never fabricate a bank's logo.
 */
export const runtime = "nodejs";
export const revalidate = 604800; // 7 days

const MIN_ICON_BYTES = 100; // guard against empty/placeholder responses

/** Ordered upstream logo URLs for a domain — real-logo providers first. */
function candidateSources(domain: string): string[] {
  const { logoDevToken, brandfetchClientId } = config.logo();
  const sources: string[] = [];
  if (logoDevToken) {
    sources.push(`https://img.logo.dev/${domain}?token=${logoDevToken}&size=128&format=png&retina=true`);
  }
  if (brandfetchClientId) {
    sources.push(`https://cdn.brandfetch.io/${domain}/w/128/h/128?c=${brandfetchClientId}`);
  }
  // Keyless fallback — a favicon (site icon), not a full logo, but always free.
  sources.push(`https://icons.duckduckgo.com/ip3/${domain}.ico`);
  return sources;
}

async function fetchImage(url: string): Promise<Response | null> {
  try {
    const res = await fetch(url, { next: { revalidate } });
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.startsWith("image/")) return null;
    const buffer = await res.arrayBuffer();
    if (buffer.byteLength < MIN_ICON_BYTES) return null;
    return new Response(buffer, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=86400, s-maxage=604800, immutable",
      },
    });
  } catch {
    return null;
  }
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const provider = findFinancialProvider(id);
  if (!provider) return new Response(null, { status: 404 });

  // 1. Curated local asset wins outright.
  if (provider.logo) {
    return Response.redirect(new URL(provider.logo, req.nextUrl.origin), 307);
  }
  if (!provider.domain) return new Response(null, { status: 404 });

  // 2. Try logo providers (real logos) then the favicon fallback, in order.
  for (const url of candidateSources(provider.domain)) {
    const image = await fetchImage(url);
    if (image) return image;
  }

  // 3. No logo available — the client renders our branded badge.
  return new Response(null, { status: 404 });
}

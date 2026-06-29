import { config } from "@/core/config/env";
import { cache } from "@/core/cache";
import { enforceRequestRateLimit } from "@/core/http/rate-limit-request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface FinnhubQuote {
  c: number;  // current price
  d: number;  // change
  dp: number; // percent change
  h: number;  // day high
  l: number;  // day low
  o: number;  // open
  pc: number; // prev close
  t: number;  // timestamp
}

/**
 * Fetch price from Finnhub, sharing one upstream call per symbol across all
 * concurrent SSE connections. With Redis: shared across all pods. Without: per-process.
 *
 * 3-second TTL matches the poll interval so the stream never returns stale data
 * yet 1000 users watching the same symbol produce just 1 Finnhub call per 3s.
 */
async function getCachedQuote(symbol: string): Promise<FinnhubQuote | null> {
  const { apiKey, baseUrl } = config.finnhub();
  if (!apiKey) return null;

  return cache.wrap<FinnhubQuote | null>(`price:${symbol}`, 3, async () => {
    try {
      const res = await fetch(`${baseUrl}/quote?symbol=${symbol}&token=${apiKey}`, {
        cache: "no-store",
      });
      if (!res.ok) return null;
      return res.json() as Promise<FinnhubQuote>;
    } catch {
      return null;
    }
  });
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ symbol: string }> },
): Promise<Response> {
  // Public, unauthenticated endpoint — throttle per IP so a single client can't
  // open unbounded SSE streams and exhaust the upstream Finnhub quota.
  const limited = await enforceRequestRateLimit(request, "prices", 60, 60 * 1000);
  if (limited) return limited;

  const { symbol } = await params;
  const upper = symbol.toUpperCase();
  const encoder = new TextEncoder();

  let intervalId: ReturnType<typeof setInterval>;

  const stream = new ReadableStream({
    start(controller) {
      const send = (data: unknown) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch {
          // controller already closed
        }
      };

      getCachedQuote(upper).then((q) => q && send(q)).catch(() => undefined);

      intervalId = setInterval(() => {
        getCachedQuote(upper)
          .then((q) => q && send(q))
          .catch(() => {
            clearInterval(intervalId);
            try { controller.close(); } catch { /* already closed */ }
          });
      }, 3000);
    },
    cancel() {
      clearInterval(intervalId);
    },
  });

  request.signal.addEventListener("abort", () => {
    clearInterval(intervalId);
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

import { logger } from "@/core/logger";

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export interface FetchJSONOptions {
  /** When set, the response is cached by Next's data cache for this many seconds. */
  revalidateSeconds?: number;
  signal?: AbortSignal;
  headers?: Record<string, string>;
}

/**
 * Thin JSON fetch wrapper with consistent error handling + logging.
 *
 * SCALE: this is the single choke point for outbound API calls — the place to
 * add a Redis response cache, request coalescing, circuit breaking, and
 * rate-limit handling for upstream providers (e.g. Finnhub) next session.
 */
export async function fetchJSON<T>(
  url: string,
  options: FetchJSONOptions = {},
): Promise<T> {
  const { revalidateSeconds, signal, headers } = options;

  const init: RequestInit & { next?: { revalidate?: number } } = revalidateSeconds
    ? { cache: "force-cache", next: { revalidate: revalidateSeconds }, signal, headers }
    : { cache: "no-store", signal, headers };

  const res = await fetch(url, init);

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    logger.warn("Upstream fetch failed", { url: redact(url), status: res.status });
    throw new HttpError(res.status, `Fetch failed ${res.status}: ${body}`);
  }

  return (await res.json()) as T;
}

/** Strip secret tokens from a URL before logging it. */
function redact(url: string): string {
  return url
    .replace(/token=[^&]+/gi, "token=***")
    .replace(/apiKey=[^&]+/gi, "apiKey=***");
}

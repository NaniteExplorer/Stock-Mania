/**
 * Rate-limiting abstraction.
 *
 * Ships with an in-process sliding-window limiter so brute-force protection
 * works today with zero infra. It is per-instance only.
 * SCALE: implement a RedisRateLimiter (token bucket / sorted-set sliding window)
 * behind this interface and swap the `rateLimiter` export next session so limits
 * are enforced across all instances behind Nginx/Kong.
 */
export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  /** Milliseconds until the window resets. */
  resetMs: number;
}

export interface RateLimiter {
  check(key: string, limit: number, windowMs: number): Promise<RateLimitResult>;
}

class InMemorySlidingWindow implements RateLimiter {
  private hits = new Map<string, number[]>();

  async check(
    key: string,
    limit: number,
    windowMs: number,
  ): Promise<RateLimitResult> {
    const now = Date.now();
    const windowStart = now - windowMs;
    const recent = (this.hits.get(key) ?? []).filter((t) => t > windowStart);
    recent.push(now);
    this.hits.set(key, recent);

    // Opportunistic cleanup to avoid unbounded growth on a single instance.
    if (this.hits.size > 10_000) {
      for (const [k, times] of this.hits) {
        if (times.every((t) => t <= windowStart)) this.hits.delete(k);
      }
    }

    return {
      allowed: recent.length <= limit,
      remaining: Math.max(0, limit - recent.length),
      resetMs: windowMs,
    };
  }
}

const _global = globalThis as unknown as { _smRl?: RateLimiter };

async function resolveImpl(): Promise<RateLimiter> {
  if (_global._smRl) return _global._smRl;
  if (process.env.REDIS_URL) {
    const { RedisSlidingWindow } = await import("./redis");
    _global._smRl = new RedisSlidingWindow();
  } else {
    _global._smRl = new InMemorySlidingWindow();
  }
  return _global._smRl;
}

export const rateLimiter: RateLimiter = {
  check: (key, limit, windowMs) =>
    resolveImpl().then((rl) => rl.check(key, limit, windowMs)),
};

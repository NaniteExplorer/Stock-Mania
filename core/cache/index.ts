/**
 * Cache abstraction.
 *
 * Ships with an in-process InMemoryCache so the app works with zero infra today.
 * SCALE: implement RedisCache (ioredis / Upstash) behind this same interface and
 * swap the `cache` export next session — no call-site changes. The `wrap` helper
 * is the recommended way to cache upstream API responses once per key (e.g. fetch
 * a symbol's news once and serve it to every user instead of per-user fetches).
 */
export interface CacheProvider {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttlSeconds?: number): Promise<void>;
  delete(key: string): Promise<void>;
  /** Get-or-compute: returns the cached value or runs `producer`, caches, returns it. */
  wrap<T>(key: string, ttlSeconds: number, producer: () => Promise<T>): Promise<T>;
}

type Entry = { value: unknown; expiresAt: number | null };

class InMemoryCache implements CacheProvider {
  private store = new Map<string, Entry>();

  async get<T>(key: string): Promise<T | null> {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.expiresAt !== null && entry.expiresAt < Date.now()) {
      this.store.delete(key);
      return null;
    }
    return entry.value as T;
  }

  async set<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    this.store.set(key, {
      value,
      expiresAt: ttlSeconds ? Date.now() + ttlSeconds * 1000 : null,
    });
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  async wrap<T>(
    key: string,
    ttlSeconds: number,
    producer: () => Promise<T>,
  ): Promise<T> {
    const cached = await this.get<T>(key);
    if (cached !== null) return cached;
    const value = await producer();
    await this.set(key, value, ttlSeconds);
    return value;
  }
}

// Lazy singleton — resolves to RedisCache when REDIS_URL is set, InMemoryCache otherwise.
// Call sites never change; swap happens here only.
const _global = globalThis as unknown as { _smCache?: CacheProvider };

async function resolveImpl(): Promise<CacheProvider> {
  if (_global._smCache) return _global._smCache;
  if (process.env.REDIS_URL) {
    const { RedisCache } = await import("./redis");
    _global._smCache = new RedisCache();
  } else {
    _global._smCache = new InMemoryCache();
  }
  return _global._smCache;
}

export const cache: CacheProvider = {
  get: (k) => resolveImpl().then((c) => c.get(k)),
  set: (k, v, ttl) => resolveImpl().then((c) => c.set(k, v, ttl)),
  delete: (k) => resolveImpl().then((c) => c.delete(k)),
  wrap: (k, ttl, p) => resolveImpl().then((c) => c.wrap(k, ttl, p)),
};

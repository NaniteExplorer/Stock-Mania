import Redis from "ioredis";
import type { CacheProvider } from "./index";

const globalWithRedis = globalThis as unknown as { _smRedis?: Redis };

function getRedis(): Redis {
  if (globalWithRedis._smRedis) return globalWithRedis._smRedis;

  const client = new Redis(process.env.REDIS_URL!, {
    maxRetriesPerRequest: 3,
    enableReadyCheck: false,
    lazyConnect: false,
  });

  client.on("error", (err: Error) => {
    console.error("[redis] error:", err.message);
  });

  globalWithRedis._smRedis = client;
  return client;
}

export class RedisCache implements CacheProvider {
  async get<T>(key: string): Promise<T | null> {
    const raw = await getRedis().get(key);
    return raw ? (JSON.parse(raw) as T) : null;
  }

  async set<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    const serialized = JSON.stringify(value);
    if (ttlSeconds) {
      await getRedis().setex(key, ttlSeconds, serialized);
    } else {
      await getRedis().set(key, serialized);
    }
  }

  async delete(key: string): Promise<void> {
    await getRedis().del(key);
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

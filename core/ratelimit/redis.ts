import Redis from "ioredis";
import type { RateLimiter, RateLimitResult } from "./index";

// Atomic sliding-window via Redis sorted set + Lua script.
// One round-trip per check; safe under concurrent writes.
const SLIDING_WINDOW_LUA = `
local key     = KEYS[1]
local now     = tonumber(ARGV[1])
local window  = tonumber(ARGV[2])
local limit   = tonumber(ARGV[3])
local member  = ARGV[4]

redis.call('ZREMRANGEBYSCORE', key, '-inf', now - window)
local count = tonumber(redis.call('ZCARD', key))

if count < limit then
  redis.call('ZADD', key, now, member)
  redis.call('PEXPIRE', key, window + 1000)
  return {1, limit - count - 1, 0}
else
  local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
  local resetAt = oldest[2] and (tonumber(oldest[2]) + window) or (now + window)
  return {0, 0, math.ceil(resetAt - now)}
end
`;

const globalWithRedis = globalThis as unknown as { _smRlRedis?: Redis };

function getRedis(): Redis {
  if (globalWithRedis._smRlRedis) return globalWithRedis._smRlRedis;

  const client = new Redis(process.env.REDIS_URL!, {
    maxRetriesPerRequest: 3,
    enableReadyCheck: false,
  });

  client.on("error", (err: Error) => {
    console.error("[redis/ratelimit] error:", err.message);
  });

  globalWithRedis._smRlRedis = client;
  return client;
}

export class RedisSlidingWindow implements RateLimiter {
  async check(
    key: string,
    limit: number,
    windowMs: number,
  ): Promise<RateLimitResult> {
    const now = Date.now();
    const member = `${now}-${Math.random().toString(36).slice(2, 8)}`;

    const result = (await getRedis().eval(
      SLIDING_WINDOW_LUA,
      1,
      key,
      String(now),
      String(windowMs),
      String(limit),
      member,
    )) as [number, number, number];

    return {
      allowed: result[0] === 1,
      remaining: result[1],
      resetMs: result[2],
    };
  }
}

import { Redis } from "@upstash/redis";

let redisClient: Redis | null | undefined;
const inMemory = new Map<string, { count: number; resetAt: number }>();

function getRedis() {
  if (redisClient !== undefined) return redisClient;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  redisClient = url && token ? new Redis({ url, token }) : null;
  return redisClient;
}

export function hasSharedRateLimitStore() {
  return Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
}

export async function checkRateLimit(key: string, limit: number, windowSeconds = 60) {
  const redis = getRedis();
  if (redis) {
    const bucket = Math.floor(Date.now() / (windowSeconds * 1000));
    const redisKey = `ekvoice:rate:${key}:${bucket}`;
    const count = await redis.incr(redisKey);
    if (count === 1) await redis.expire(redisKey, windowSeconds + 5);
    return { allowed: count <= limit, remaining: Math.max(0, limit - count) };
  }

  // Local development fallback only. It is not a reliable distributed limiter on serverless hosts.
  const now = Date.now();
  const existing = inMemory.get(key);
  if (!existing || existing.resetAt <= now) {
    inMemory.set(key, { count: 1, resetAt: now + windowSeconds * 1000 });
    return { allowed: true, remaining: limit - 1 };
  }
  existing.count += 1;
  return { allowed: existing.count <= limit, remaining: Math.max(0, limit - existing.count) };
}

export async function reserveMonthlyCharacters(characters: number) {
  const redis = getRedis();
  const limit = Number(process.env.GOOGLE_MONTHLY_CHARACTER_CAP || 250000);
  const now = new Date();
  const monthKey = `ekvoice:google-chars:${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;

  if (redis) {
    const script = `
      local current = tonumber(redis.call('GET', KEYS[1]) or '0')
      local incoming = tonumber(ARGV[1])
      local cap = tonumber(ARGV[2])
      if current + incoming > cap then return -1 end
      local updated = redis.call('INCRBY', KEYS[1], incoming)
      if updated == incoming then redis.call('EXPIRE', KEYS[1], tonumber(ARGV[3])) end
      return updated
    `;
    const result = Number(await redis.eval(script, [monthKey], [String(characters), String(limit), String(40 * 24 * 60 * 60)]));
    return { allowed: result >= 0, limit, used: result >= 0 ? result : null };
  }

  if (process.env.NODE_ENV === "production") {
    return { allowed: false, limit, used: null, reason: "shared_store_required" as const };
  }
  const localKey = monthKey;
  const existing = inMemory.get(localKey) ?? { count: 0, resetAt: Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1) };
  if (existing.count + characters > limit) return { allowed: false, limit, used: existing.count };
  existing.count += characters;
  inMemory.set(localKey, existing);
  return { allowed: true, limit, used: existing.count };
}

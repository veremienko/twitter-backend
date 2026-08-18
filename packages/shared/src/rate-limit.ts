import type { Request, Response, RequestHandler } from 'express';
import type { RedisClient } from './redis.ts';

/**
 * Token bucket, entirely inside one EVAL. A plain HGET-then-HSET pair would
 * race: two concurrent requests on the same key can both read "1 token left"
 * before either writes back, and both get admitted. Lua runs atomically on
 * the Redis server, so the read-refill-decrement-write sequence can't be
 * interleaved by another request or another gateway instance.
 *
 * KEYS[1]  = bucket key
 * ARGV[1]  = capacity
 * ARGV[2]  = refill tokens per second
 * ARGV[3]  = now, epoch milliseconds
 * ARGV[4]  = key TTL in seconds (cleans up buckets nobody hits again)
 *
 * Returns { allowed: 0|1, retryAfterSeconds }.
 */
const TOKEN_BUCKET_SCRIPT = `
local key = KEYS[1]
local capacity = tonumber(ARGV[1])
local refillPerSecond = tonumber(ARGV[2])
local now = tonumber(ARGV[3])
local ttl = tonumber(ARGV[4])

local bucket = redis.call('HMGET', key, 'tokens', 'lastRefill')
local tokens = tonumber(bucket[1])
local lastRefill = tonumber(bucket[2])

if tokens == nil then
    tokens = capacity
    lastRefill = now
end

local elapsedSeconds = math.max(0, (now - lastRefill) / 1000)
tokens = math.min(capacity, tokens + elapsedSeconds * refillPerSecond)

local allowed = 0
if tokens >= 1 then
    allowed = 1
    tokens = tokens - 1
end

redis.call('HSET', key, 'tokens', tostring(tokens), 'lastRefill', tostring(now))
redis.call('EXPIRE', key, ttl)

local retryAfter = 0
if allowed == 0 then
    retryAfter = math.ceil((1 - tokens) / refillPerSecond)
end

return {allowed, retryAfter}
`;

export type RateLimiterOptions = {
    /** Max tokens the bucket can hold, i.e. the size of a burst. */
    capacity: number;
    /** Tokens restored per second once the bucket isn't full. */
    refillPerSecond: number;
    /** Derives the bucket key from the request (e.g. by user id or IP). */
    keyFn: (req: Request, res: Response) => string;
    /** Redis key prefix, in case one Redis instance hosts several limiters. */
    prefix?: string;
};

/**
 * Express middleware enforcing a per-key token bucket in Redis. Responds 429
 * with a `Retry-After` header when the bucket is empty; otherwise calls
 * `next()`. Safe to share one Redis client across multiple limiter instances
 * and multiple gateway processes — the bucket state lives in Redis, not in
 * process memory, so every instance sees the same count.
 */
export function createRateLimiter(
    redis: RedisClient,
    options: RateLimiterOptions,
): RequestHandler {
    const prefix = options.prefix ?? 'ratelimit';
    // A bucket nobody has touched for two refill cycles is done leaking state.
    const ttlSeconds = Math.max(
        1,
        Math.ceil((options.capacity / options.refillPerSecond) * 2),
    );

    return async (req, res, next) => {
        const key = `${prefix}:${options.keyFn(req, res)}`;
        try {
            const [allowed, retryAfter] = (await redis.eval(
                TOKEN_BUCKET_SCRIPT,
                {
                    keys: [key],
                    arguments: [
                        String(options.capacity),
                        String(options.refillPerSecond),
                        String(Date.now()),
                        String(ttlSeconds),
                    ],
                },
            )) as [number, number];

            if (!allowed) {
                res.setHeader('Retry-After', String(retryAfter));
                res.status(429).json({ error: 'Too many requests' });
                return;
            }
            next();
        } catch (error) {
            next(error);
        }
    };
}

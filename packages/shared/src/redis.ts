import { createClient } from 'redis';

export type RedisClient = ReturnType<typeof createClient>;

/** Create a connected Redis client. URL comes from REDIS_URL. */
export async function createRedis(): Promise<RedisClient> {
    const client = createClient({ url: process.env.REDIS_URL });
    client.on('error', (err) => console.error('Redis error:', err.message));
    await client.connect();
    return client;
}

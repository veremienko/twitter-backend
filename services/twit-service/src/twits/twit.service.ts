import { desc } from 'drizzle-orm';
import { z } from 'zod';
import { parseBody, TOPICS, type Producer, type RedisClient } from '@twitter/shared';
import { db } from '../db/client.ts';
import { twits, type Twit } from '../db/schema.ts';

const CACHE_KEY = 'twits:all';
const CACHE_TTL_SECONDS = 30;
const MAX_TEXT_LENGTH = 280;
const MAX_AUTHOR_LENGTH = 64;

const TwitSchema = z.object({
    email: z.string({ error: 'x-user-email header is required' })
        .min(1, 'x-user-email header is required')
        .max(MAX_AUTHOR_LENGTH, 'x-user-email header is required'),
    text: z.string().trim()
        .min(1, `text must be a non-empty string up to ${MAX_TEXT_LENGTH} characters`)
        .max(MAX_TEXT_LENGTH, `text must be a non-empty string up to ${MAX_TEXT_LENGTH} characters`),
});

export class TwitService {
    redis: RedisClient;
    producer: Producer;

    constructor(redis: RedisClient, producer: Producer) {
        this.redis = redis;
        this.producer = producer;
    }

    /** Insert a twit, invalidate the cache and publish twit.created to Kafka (best effort). */
    async createTwit(data: unknown): Promise<Twit> {
        const { text, email } = parseBody(TwitSchema, data);
        const [twit] = await db.insert(twits).values({
            author: email,
            text,
        }).returning();
        await this.redis.del(CACHE_KEY);
        try {
            await this.producer.send({
                topic: TOPICS.TWIT_CREATED,
                messages: [{ value: JSON.stringify(twit) }],
            });
        } catch (error) {
            console.error('Failed to publish twit.created event:', error);
        }
        return twit!;
    }

    /** List twits, newest first, cached in Redis for a short time. */
    async getTwits(): Promise<Twit[]> {
        const cached = await this.redis.get(CACHE_KEY);
        if (cached) return JSON.parse(cached);

        const result = await db.select().from(twits).orderBy(desc(twits.createdAt));
        await this.redis.set(CACHE_KEY, JSON.stringify(result), { EX: CACHE_TTL_SECONDS });
        return result;
    }
}

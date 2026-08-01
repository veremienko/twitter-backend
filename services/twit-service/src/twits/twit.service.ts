import { desc } from 'drizzle-orm';
import { z } from 'zod';
import { parseBody, TOPICS, type Producer, type RedisClient } from '@twitter/shared';
import { db } from '../db/client.ts';
import { twits, type Twit } from '../db/schema.ts';

const CACHE_KEY = 'twits:all';
const CACHE_TTL_SECONDS = 30;
const MAX_TEXT_LENGTH = 280;
const USER_SERVICE_URL = process.env.USER_SERVICE_URL ?? 'http://localhost:3004';
const INTERNAL_TOKEN = process.env.INTERNAL_TOKEN!;

export type TwitWithAuthor = Twit & { authorName: string | null };

const TwitSchema = z.object({
    authorId: z.coerce.number({ error: 'x-user-id header is required' }).int().positive(),
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
        const { text, authorId } = parseBody(TwitSchema, data);
        const [twit] = await db.insert(twits).values({
            authorId,
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

    /** List twits with author names, newest first, cached in Redis for a short time. */
    async getTwits(): Promise<TwitWithAuthor[]> {
        const cached = await this.redis.get(CACHE_KEY);
        if (cached) return JSON.parse(cached);

        const result = await db.select().from(twits).orderBy(desc(twits.createdAt));
        const names = await fetchAuthorNames([...new Set(result.map(twit => twit.authorId))]);
        const enriched = result.map(twit => ({ ...twit, authorName: names.get(twit.authorId) ?? null }));
        await this.redis.set(CACHE_KEY, JSON.stringify(enriched), { EX: CACHE_TTL_SECONDS });
        return enriched;
    }
}

/** Batch-resolve author names via the auth-service internal endpoint. */
async function fetchAuthorNames(ids: number[]): Promise<Map<number, string>> {
    if (ids.length === 0) return new Map();
    const response = await fetch(`${USER_SERVICE_URL}/users?ids=${ids.join(',')}`, {
        headers: { 'x-internal-token': INTERNAL_TOKEN },
    });
    if (!response.ok) throw new Error(`auth-service /users responded with ${response.status}`);
    const users: { id: number; name: string }[] = await response.json();
    return new Map(users.map(user => [user.id, user.name]));
}

import { desc } from 'drizzle-orm';
import { TOPICS, type Producer, type RedisClient } from '@twitter/shared';
import { db } from '../db/client.ts';
import { twits, type NewTwit, type Twit } from '../db/schema.ts';
import {eq} from "drizzle-orm";

const CACHE_KEY = 'twits:all';
const CACHE_TTL_SECONDS = 30;

export class TwitService {
    redis: RedisClient;
    producer: Producer;

    constructor(redis: RedisClient, producer: Producer) {
        this.redis = redis;
        this.producer = producer;
    }

    /** Insert a twit, invalidate the cache and publish twit.created to Kafka. */
    async createTwit(data: NewTwit & { email: string }): Promise<Twit> {
        const [twit] = await db.insert(twits).values({
            author: data.email,
            text: data.text,
        }).returning();
        await this.redis.del(CACHE_KEY);
        await this.producer.send({
            topic: TOPICS.TWIT_CREATED,
            messages: [{ value: JSON.stringify(twit) }],
        });
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

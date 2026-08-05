import { desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
    NewTwitSchema,
    parseBody,
    TOPICS,
    type RedisClient,
    HttpError,
    PaginationSchema,
    requestContext,
} from '@twitter/shared';
import { db } from '../db/client.ts';
import { twits, type Twit, likes, outbox } from '../db/schema.ts';
import { logger } from '../logger.ts';

const CACHE_KEY = 'twits:all';
const CACHE_TTL_SECONDS = 30;
const USER_SERVICE_URL =
    process.env.USER_SERVICE_URL ?? 'http://localhost:3004';
const INTERNAL_TOKEN = process.env.INTERNAL_TOKEN!;

export type TwitWithAuthor = Twit & { authorName: string | null };

/**
 * The public body contract plus the identity twit-service takes from `x-user-id`.
 * `authorId` stays first so a request missing both still reports the header issue.
 */
const CreateTwitSchema = z.object({
    authorId: z.coerce
        .number({ error: 'x-user-id header is required' })
        .int()
        .positive(),
    ...NewTwitSchema.shape,
});

const TwitLikeSchema = z.object({
    userId: z.coerce
        .number({ error: 'x-user-id header is required' })
        .int()
        .positive(),
    twitId: z.coerce.number({ error: 'twitId is required' }).int().positive(),
});

export class TwitService {
    redis: RedisClient;

    constructor(redis: RedisClient) {
        this.redis = redis;
    }

    /** Insert a twit and its twit.created outbox event in one transaction, then invalidate the cache. */
    async createTwit(data: unknown): Promise<Twit> {
        const requestId =
            requestContext.getStore()?.requestId ?? crypto.randomUUID();
        const { text, authorId } = parseBody(CreateTwitSchema, data);
        const result = await db.transaction(async (tx) => {
            const [twit] = await tx
                .insert(twits)
                .values({
                    authorId,
                    text,
                    likes: 0,
                })
                .returning();

            await tx.insert(outbox).values({
                topic: TOPICS.TWIT_CREATED,
                payload: JSON.stringify(twit),
                requestId,
            });
            return twit;
        });

        await this.redis.del(CACHE_KEY);
        return result;
    }

    /** List twits with author names, newest first, cached in Redis for a short time. */
    async getTwits(data: unknown): Promise<TwitWithAuthor[]> {
        const { limit, offset } = parseBody(PaginationSchema, data);

        const paginated = limit !== undefined && offset !== undefined;

        if (!paginated) {
            const cached = await this.redis.get(CACHE_KEY);
            if (cached) return JSON.parse(cached);
        }

        const query = db.select().from(twits).orderBy(desc(twits.createdAt));
        const result = paginated
            ? await query.limit(limit).offset(offset)
            : await query;

        let names = new Map<number, string>();
        let degraded = false;

        try {
            names = await fetchAuthorNames([
                ...new Set(result.map((twit) => twit.authorId)),
            ]);
        } catch (error) {
            degraded = true;
            logger.error(
                error,
                'Unavailable, serving feed without author names',
            );
        }

        const enriched = result.map((twit) => ({
            ...twit,
            authorName: names.get(twit.authorId) ?? null,
        }));
        if (!degraded && !paginated) {
            await this.redis.set(CACHE_KEY, JSON.stringify(enriched), {
                EX: CACHE_TTL_SECONDS,
            });
        }
        return enriched;
    }

    async postLike(data: unknown): Promise<Twit> {
        const { twitId, userId } = parseBody(TwitLikeSchema, data);

        try {
            const twit = await db.transaction(async (tx) => {
                await tx.insert(likes).values({ twitId, userId });

                const [updated] = await tx
                    .update(twits)
                    .set({ likes: sql`${twits.likes} + 1` })
                    .where(eq(twits.id, twitId))
                    .returning();

                if (!updated) throw new HttpError(404, 'twit not found');

                return updated;
            });
            await this.redis.del(CACHE_KEY);
            return twit;
        } catch (error) {
            if (
                error instanceof Error &&
                (error.cause as { code?: string })?.code === '23505'
            ) {
                throw new HttpError(409, 'already liked');
            }
            throw error;
        }
    }
}

/** Batch-resolve author names via the auth-service internal endpoint. */
async function fetchAuthorNames(ids: number[]): Promise<Map<number, string>> {
    if (ids.length === 0) return new Map();
    const response = await fetch(
        `${USER_SERVICE_URL}/users?ids=${ids.join(',')}`,
        {
            headers: { 'x-internal-token': INTERNAL_TOKEN },
            signal: AbortSignal.timeout(2000),
        },
    );
    if (!response.ok)
        throw new Error(
            `auth-service /users responded with ${response.status}`,
        );
    const users: { id: number; name: string }[] = await response.json();
    return new Map(users.map((user) => [user.id, user.name]));
}

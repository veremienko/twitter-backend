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
    decodeCursor,
    encodeCursor,
} from '@twitter/shared';
import { db } from '../db/client.ts';
import { twits, type Twit, likes, outbox } from '../db/schema.ts';
import { logger } from '../logger.ts';

const CACHE_KEY = 'twits:all';
const CACHE_TTL_SECONDS = 30;

// Cache stampede guard for CACHE_KEY: on a miss, only the request that wins
// this lock recomputes (query + fetchAuthorNames) and writes the cache;
// everyone else waits briefly for the winner instead of piling an identical
// recompute on top. The lock's own TTL is the safety net if the winner dies
// mid-recompute — a stuck lock would otherwise block every future miss.
const STAMPEDE_LOCK_KEY = 'lock:twits:all';
const STAMPEDE_LOCK_TTL_MS = 5000;
const STAMPEDE_WAIT_MS = 50;
const STAMPEDE_WAIT_ATTEMPTS = 3;
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
    async getTwits(data: unknown): Promise<{
        items: TwitWithAuthor[];
        nextCursor?: string;
    }> {
        let { limit, nextCursor } = parseBody(PaginationSchema, data);

        let gotStampedeLock = false;
        if (!limit) {
            const cached = await this.redis.get(CACHE_KEY);
            if (cached) return { items: JSON.parse(cached) };

            gotStampedeLock = Boolean(
                await this.redis.set(STAMPEDE_LOCK_KEY, '1', {
                    NX: true,
                    PX: STAMPEDE_LOCK_TTL_MS,
                }),
            );
            if (!gotStampedeLock) {
                const fromWinner = await this.waitForStampedeWinner();
                if (fromWinner) return { items: fromWinner };
                // The winner never finished in time (crashed mid-recompute,
                // or is just slow) — fall through and read Postgres
                // ourselves rather than block the request indefinitely.
            }
        }

        try {
            const after = nextCursor ? decodeCursor(nextCursor) : undefined;

            const query = db.select().from(twits);
            const result = limit
                ? await query
                      .limit(limit)
                      .where(
                          after
                              ? sql`(${twits.createdAt}, ${twits.id}) < (${after.createdAt}, ${after.id})`
                              : undefined,
                      )
                      .orderBy(desc(twits.createdAt), desc(twits.id))
                : await query.orderBy(desc(twits.createdAt));

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
            if (!degraded && !limit && gotStampedeLock) {
                await this.redis.set(CACHE_KEY, JSON.stringify(enriched), {
                    EX: CACHE_TTL_SECONDS,
                });
            }

            if (limit) {
                const lastTwit = enriched[result.length - 1];
                if (lastTwit) {
                    nextCursor = encodeCursor({
                        id: lastTwit.id,
                        createdAt: lastTwit.createdAt.toISOString(),
                    });
                }
            }

            return { items: enriched, nextCursor };
        } finally {
            // Release right away rather than waiting out the full TTL, so a
            // fast recompute doesn't make the next miss wait for no reason.
            if (gotStampedeLock) await this.redis.del(STAMPEDE_LOCK_KEY);
        }
    }

    /** Wait briefly for whoever holds the stampede lock to fill the cache. */
    private async waitForStampedeWinner(): Promise<TwitWithAuthor[] | null> {
        for (let attempt = 0; attempt < STAMPEDE_WAIT_ATTEMPTS; attempt++) {
            await new Promise((resolve) =>
                setTimeout(resolve, STAMPEDE_WAIT_MS),
            );
            const cached = await this.redis.get(CACHE_KEY);
            if (cached) return JSON.parse(cached);
        }
        return null;
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

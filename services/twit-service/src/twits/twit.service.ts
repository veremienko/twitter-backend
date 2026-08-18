import { and, desc, eq, inArray, sql } from 'drizzle-orm';
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
import { twits, type Twit, likes, outbox, homeFeed } from '../db/schema.ts';
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

/**
 * `/feed/home` and `/feed/on-read` share this shape: caller identity from
 * `x-user-id`, plus the same limit/cursor idea as `PaginationSchema` — not
 * reused directly because that schema is a `ZodEffects` (its `.refine`),
 * which cannot be spread into a bigger object the way `NewTwitSchema.shape`
 * is above. Unlike `/twits`, these always paginate: a personal feed has no
 * "give me everything" mode to fall back on.
 */
const FeedQuerySchema = z.object({
    userId: z.coerce
        .number({ error: 'x-user-id header is required' })
        .int()
        .positive(),
    limit: z.coerce
        .number()
        .int()
        .min(1, 'Limit must be at least 1')
        .max(100, 'Limit cannot exceed 100')
        .default(20),
    nextCursor: z.string().optional(),
});

export class TwitService {
    redis: RedisClient;

    constructor(redis: RedisClient) {
        this.redis = redis;
    }

    /**
     * Insert a twit, its twit.created outbox event, and one home_feed row per
     * current follower — all in one transaction — then invalidate the cache.
     *
     * The follower lookup itself runs *before* the transaction opens: an
     * internal HTTP call held inside a DB transaction would keep that
     * connection (and any locks) open for as long as user-service takes to
     * answer. If user-service is unreachable, the twit still gets created —
     * just without fan-out rows for it. Those followers aren't left with no
     * way to see it: `/feed/on-read` computes the feed from `follows` at read
     * time and doesn't depend on `home_feed` at all, only on `/feed/home`
     * (which does) missing this one twit.
     */
    async createTwit(data: unknown): Promise<Twit> {
        const requestId =
            requestContext.getStore()?.requestId ?? crypto.randomUUID();
        const { text, authorId } = parseBody(CreateTwitSchema, data);

        let followerIds: number[] = [];
        try {
            followerIds = await fetchFollowerIds(authorId);
        } catch (error) {
            logger.error(
                error,
                'Unavailable, creating twit without home_feed fan-out',
            );
        }

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

            if (followerIds.length > 0) {
                await tx.insert(homeFeed).values(
                    followerIds.map((followerId) => ({
                        followerId,
                        twitId: twit!.id,
                    })),
                );
            }

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

        if (!limit) {
            const cached = await this.redis.get(CACHE_KEY);
            if (cached)
                return {
                    items: JSON.parse(cached),
                };
        }

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

        const { items: enriched, degraded } =
            await this.enrichWithAuthorNames(result);
        if (!degraded && !limit) {
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
    }

    /**
     * Fan-out-on-write: the precomputed per-follower feed. Reading it is a
     * plain indexed lookup — the cost of fan-out was already paid when each
     * twit was created, not here. Compare with `getFeedOnRead`.
     */
    async getHomeFeed(data: unknown): Promise<{
        items: TwitWithAuthor[];
        nextCursor?: string;
    }> {
        const { userId, limit, nextCursor } = parseBody(FeedQuerySchema, data);
        const after = nextCursor ? decodeCursor(nextCursor) : undefined;

        const rows = await db
            .select({
                twit: twits,
                feedId: homeFeed.id,
                feedCreatedAt: homeFeed.createdAt,
            })
            .from(homeFeed)
            .innerJoin(twits, eq(homeFeed.twitId, twits.id))
            .where(
                and(
                    eq(homeFeed.followerId, userId),
                    after
                        ? sql`(${homeFeed.createdAt}, ${homeFeed.id}) < (${after.createdAt}, ${after.id})`
                        : undefined,
                ),
            )
            .orderBy(desc(homeFeed.createdAt), desc(homeFeed.id))
            .limit(limit);

        const { items } = await this.enrichWithAuthorNames(
            rows.map((row) => row.twit),
        );

        const lastRow = rows[rows.length - 1];
        return {
            items,
            nextCursor: lastRow
                ? encodeCursor({
                      id: lastRow.feedId,
                      createdAt: lastRow.feedCreatedAt.toISOString(),
                  })
                : undefined,
        };
    }

    /**
     * Fan-out-on-read: nothing precomputed. Resolves who this user follows at
     * read time and joins straight against `twits` — cheap on write (nothing
     * to maintain), but every read now depends on user-service being up,
     * unlike `getHomeFeed`, which only depended on it back when each twit was
     * created.
     */
    async getFeedOnRead(data: unknown): Promise<{
        items: TwitWithAuthor[];
        nextCursor?: string;
    }> {
        const { userId, limit, nextCursor } = parseBody(FeedQuerySchema, data);
        const after = nextCursor ? decodeCursor(nextCursor) : undefined;

        let followeeIds: number[];
        try {
            followeeIds = await fetchFollowingIds(userId);
        } catch (error) {
            logger.error(
                error,
                'Unavailable, cannot resolve who this user follows',
            );
            throw new HttpError(503, 'feed temporarily unavailable');
        }

        if (followeeIds.length === 0) return { items: [] };

        const result = await db
            .select()
            .from(twits)
            .where(
                and(
                    inArray(twits.authorId, followeeIds),
                    after
                        ? sql`(${twits.createdAt}, ${twits.id}) < (${after.createdAt}, ${after.id})`
                        : undefined,
                ),
            )
            .orderBy(desc(twits.createdAt), desc(twits.id))
            .limit(limit);

        const { items } = await this.enrichWithAuthorNames(result);

        const lastTwit = result[result.length - 1];
        return {
            items,
            nextCursor: lastTwit
                ? encodeCursor({
                      id: lastTwit.id,
                      createdAt: lastTwit.createdAt.toISOString(),
                  })
                : undefined,
        };
    }

    /** Batch-resolve author names, tolerating user-service being unavailable. */
    private async enrichWithAuthorNames(
        rows: Twit[],
    ): Promise<{ items: TwitWithAuthor[]; degraded: boolean }> {
        let names = new Map<number, string>();
        let degraded = false;

        try {
            names = await fetchAuthorNames([
                ...new Set(rows.map((twit) => twit.authorId)),
            ]);
        } catch (error) {
            degraded = true;
            logger.error(
                error,
                'Unavailable, serving feed without author names',
            );
        }

        return {
            items: rows.map((twit) => ({
                ...twit,
                authorName: names.get(twit.authorId) ?? null,
            })),
            degraded,
        };
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

/** Who follows this author right now — used to fan a new twit out on write. */
async function fetchFollowerIds(authorId: number): Promise<number[]> {
    const response = await fetch(
        `${USER_SERVICE_URL}/users/${authorId}/followers/ids`,
        {
            headers: { 'x-internal-token': INTERNAL_TOKEN },
            signal: AbortSignal.timeout(2000),
        },
    );
    if (!response.ok)
        throw new Error(
            `user-service /followers/ids responded with ${response.status}`,
        );
    return response.json();
}

/** Who this user follows — resolved at read time for the fan-out-on-read feed. */
async function fetchFollowingIds(userId: number): Promise<number[]> {
    const response = await fetch(
        `${USER_SERVICE_URL}/users/${userId}/following/ids`,
        {
            headers: { 'x-internal-token': INTERNAL_TOKEN },
            signal: AbortSignal.timeout(2000),
        },
    );
    if (!response.ok)
        throw new Error(
            `user-service /following/ids responded with ${response.status}`,
        );
    return response.json();
}
